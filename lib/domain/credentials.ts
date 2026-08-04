import { AppointmentStatus, VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  deriveFallbackCode,
  formatFallbackCode,
  generateToken,
  hashFallbackCode,
  hashToken,
} from '@/lib/crypto/tokens';
import { buildPassUrl } from '@/lib/qr';
import { getSettings } from '@/lib/domain/settings';
import { queueEmail } from '@/lib/email/outbox';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS, PUBLIC_TOKEN_TRAILING_DAYS } from '@/lib/constants';
import { addDays, formatDateTime, formatTimeRange } from '@/lib/time';

/**
 * Manual pass revocation and reissue (administrator only).
 *
 * Revocation already happens automatically on rejection, cancellation and
 * re-approval. This module covers the cases those do not: a pass that has been
 * forwarded to someone else, printed and lost, or sent to a mistyped address.
 *
 * Reissue rotates the private token as well as the credential. That is the
 * point of the operation - if the old link kept working, revoking would
 * achieve nothing.
 */

export type CredentialErrorCode =
  | 'NOT_FOUND'
  | 'NOT_APPROVED'
  | 'ALREADY_ARRIVED'
  | 'NO_ACTIVE_PASS';

export class CredentialError extends Error {
  constructor(
    readonly code: CredentialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CredentialError';
  }
}

/**
 * Revoke the active pass without issuing a replacement.
 *
 * The appointment stays APPROVED: the visit is still authorised, the visitor
 * simply has no scannable credential until one is reissued. A guard can still
 * process them manually from the expected list.
 */
export async function revokePass(options: {
  appointmentId: string;
  actorUserId: string;
  now?: Date;
}): Promise<{ referenceNumber: string; revokedCount: number }> {
  const now = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: options.appointmentId },
      include: { visit: true },
    });

    if (!appointment) {
      throw new CredentialError('NOT_FOUND', 'That appointment could not be found.');
    }

    if (appointment.visit && appointment.visit.status !== VisitStatus.EXPECTED) {
      throw new CredentialError(
        'ALREADY_ARRIVED',
        'This visitor has already been processed at the gate, so their pass cannot be revoked.',
      );
    }

    const { count } = await tx.qrCredential.updateMany({
      where: { appointmentId: appointment.id, revokedAt: null },
      data: { revokedAt: now, revokedById: options.actorUserId },
    });

    if (count === 0) {
      throw new CredentialError('NO_ACTIVE_PASS', 'This appointment has no active pass to revoke.');
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.CREDENTIAL_REVOKED,
        targetType: 'Appointment',
        targetId: appointment.id,
        actorUserId: options.actorUserId,
        metadata: { reference: appointment.referenceNumber, revokedCount: count },
      },
      tx,
    );

    return { referenceNumber: appointment.referenceNumber, revokedCount: count };
  });
}

/**
 * Retire the current pass and issue a fresh one.
 *
 * Rotates the private status token too, so the previously emailed link stops
 * resolving. The visitor is emailed the new pass; if they have no email
 * address on file the caller is told, because the new link would otherwise be
 * unreachable.
 */
export async function reissuePass(options: {
  appointmentId: string;
  actorUserId: string;
  appUrl: string;
  now?: Date;
}): Promise<{
  referenceNumber: string;
  emailed: boolean;
  notificationIds: string[];
}> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { id: options.appointmentId },
      include: { visitor: true, teacher: true, destination: true, visit: true },
    });

    if (!appointment) {
      throw new CredentialError('NOT_FOUND', 'That appointment could not be found.');
    }

    if (appointment.status !== AppointmentStatus.APPROVED) {
      throw new CredentialError(
        'NOT_APPROVED',
        'Only an approved appointment can have a pass issued.',
      );
    }

    if (appointment.visit && appointment.visit.status !== VisitStatus.EXPECTED) {
      throw new CredentialError(
        'ALREADY_ARRIVED',
        'This visitor has already been processed at the gate, so a new pass would serve no purpose.',
      );
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const fallbackCode = deriveFallbackCode(tokenHash);
    const statusUrl = buildPassUrl(options.appUrl, rawToken);

    const validFrom = new Date(
      appointment.scheduledStart.getTime() - settings.qrGraceBeforeMinutes * 60_000,
    );
    const expiresAt = new Date(
      appointment.scheduledEnd.getTime() + settings.qrGraceAfterMinutes * 60_000,
    );

    // Retire whatever exists before creating the replacement, so the
    // "one active credential per appointment" rule always holds.
    await tx.qrCredential.updateMany({
      where: { appointmentId: appointment.id, revokedAt: null },
      data: { revokedAt: now, revokedById: options.actorUserId },
    });

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        publicTokenHash: tokenHash,
        publicTokenExpiresAt: addDays(appointment.scheduledEnd, PUBLIC_TOKEN_TRAILING_DAYS),
      },
    });

    await tx.qrCredential.create({
      data: {
        appointmentId: appointment.id,
        tokenHash,
        fallbackCodeHash: hashFallbackCode(fallbackCode),
        validFrom,
        expiresAt,
      },
    });

    const notificationIds: string[] = [];

    if (appointment.visitor.email) {
      notificationIds.push(
        await queueEmail(
          {
            type: 'visitor.approved',
            templateKey: 'visitor-approved',
            recipient: appointment.visitor.email,
            payload: {
              reference: appointment.referenceNumber,
              visitorName: appointment.visitor.fullName,
              teacherName: appointment.teacher.name,
              schoolName: settings.schoolName,
              destinationName: appointment.destination?.nameEn,
              scheduledAt: formatDateTime(appointment.scheduledStart),
              windowText: formatTimeRange(validFrom, expiresAt),
              fallbackCode: formatFallbackCode(fallbackCode),
              instructions: appointment.destination?.instructionsEn ?? undefined,
              statusUrl,
            },
          },
          tx,
        ),
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.CREDENTIAL_REISSUED,
        targetType: 'Appointment',
        targetId: appointment.id,
        actorUserId: options.actorUserId,
        metadata: {
          reference: appointment.referenceNumber,
          emailed: Boolean(appointment.visitor.email),
        },
      },
      tx,
    );

    return {
      referenceNumber: appointment.referenceNumber,
      emailed: Boolean(appointment.visitor.email),
      notificationIds,
    };
  });
}

import { AppointmentStatus, Role, VisitEventType, VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  deriveFallbackCode,
  formatFallbackCode,
  generateToken,
  hashFallbackCode,
  hashToken,
} from '@/lib/crypto/tokens';
import { allocateBadgeNumber } from '@/lib/domain/badges';
import { buildPassUrl } from '@/lib/qr';
import { getSettings } from '@/lib/domain/settings';
import { queueEmail } from '@/lib/email/outbox';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS, PUBLIC_TOKEN_TRAILING_DAYS } from '@/lib/constants';
import { addDays, formatDateTime, formatTimeRange, toIsoDayString } from '@/lib/time';

/**
 * Teacher approval and rejection.
 *
 * Both operations are:
 *   - Transactional. Approval writes the appointment status, exactly one
 *     visit, exactly one credential, the outbox rows and the audit entry, or
 *     it writes none of them.
 *   - Idempotent. Re-submitting an approval (double click, retried request,
 *     back button) returns the existing result instead of creating a second
 *     visit, badge, credential or email.
 *   - Authorized at the data layer. The appointment is loaded with a
 *     `teacherId` filter, so one teacher cannot act on another's request even
 *     with a valid appointment id.
 */

export type DecisionErrorCode =
  | 'NOT_FOUND'
  | 'NOT_YOURS'
  | 'ALREADY_DECIDED'
  | 'UNDER_REVIEW'
  | 'CANCELLED'
  | 'PAST';

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DecisionError';
  }
}

export interface ApprovalResult {
  appointmentId: string;
  referenceNumber: string;
  visitId: string;
  badgeNumber: string;
  /** True when the appointment was already approved before this call. */
  alreadyApproved: boolean;
  notificationIds: string[];
}

/**
 * Approve a pending appointment.
 *
 * `actorRole` allows an administrator to resolve a REVIEW_REQUIRED item; a
 * teacher may only act on a plain PENDING request belonging to them.
 */
export async function approveAppointment(options: {
  appointmentId: string;
  actorUserId: string;
  actorRole: Role;
  note?: string;
  appUrl: string;
  now?: Date;
}): Promise<ApprovalResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: {
        id: options.appointmentId,
        // A teacher is scoped to their own queue at the query level.
        ...(options.actorRole === Role.TEACHER ? { teacherId: options.actorUserId } : {}),
      },
      include: {
        visitor: true,
        teacher: true,
        destination: true,
        visitType: true,
        visit: true,
        credentials: { where: { revokedAt: null } },
      },
    });

    if (!appointment) {
      throw new DecisionError('NOT_FOUND', 'That request could not be found.');
    }

    // --- Idempotency ----------------------------------------------------
    if (appointment.status === AppointmentStatus.APPROVED) {
      const existingVisit = appointment.visit;
      if (existingVisit) {
        return {
          appointmentId: appointment.id,
          referenceNumber: appointment.referenceNumber,
          visitId: existingVisit.id,
          badgeNumber: existingVisit.badgeNumber,
          alreadyApproved: true,
          notificationIds: [],
        };
      }
    }

    if (
      appointment.status === AppointmentStatus.REJECTED ||
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.EXPIRED
    ) {
      throw new DecisionError(
        'ALREADY_DECIDED',
        'This request has already been closed and can no longer be approved.',
      );
    }

    if (
      appointment.status === AppointmentStatus.REVIEW_REQUIRED &&
      options.actorRole !== Role.ADMIN
    ) {
      throw new DecisionError(
        'UNDER_REVIEW',
        'This request is being reviewed by the school office and cannot be approved yet.',
      );
    }

    if (appointment.scheduledEnd.getTime() < now.getTime()) {
      throw new DecisionError(
        'PAST',
        'The requested time has already passed. Ask the visitor to submit a new request.',
      );
    }

    // --- Credential window ----------------------------------------------
    const validFrom = new Date(
      appointment.scheduledStart.getTime() - settings.qrGraceBeforeMinutes * 60_000,
    );
    const expiresAt = new Date(
      appointment.scheduledEnd.getTime() + settings.qrGraceAfterMinutes * 60_000,
    );

    /*
     * The private token is rotated here rather than reused.
     *
     * The spec permits either binding to the current token or rotating during
     * approval, and rotation is what makes the approval email work: the server
     * stores only `publicTokenHash`, so without a fresh raw token it could not
     * build a pass link to send. Rotating also retires the pre-approval link
     * that has been sitting in the visitor's inbox, so only one live URL
     * exists per appointment at any time.
     *
     * The same raw token backs both the status page and the QR credential, so
     * the visitor still has a single link to keep.
     */
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const fallbackCode = deriveFallbackCode(tokenHash);
    const statusUrl = buildPassUrl(options.appUrl, rawToken);

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.APPROVED,
        decisionNote: options.note ?? null,
        decidedAt: now,
        decidedById: options.actorUserId,
        publicTokenHash: tokenHash,
        publicTokenExpiresAt: addDays(appointment.scheduledEnd, PUBLIC_TOKEN_TRAILING_DAYS),
      },
    });

    // "Only one active credential per approved appointment" is enforced by
    // retiring any earlier one before issuing this.
    await tx.qrCredential.updateMany({
      where: { appointmentId: appointment.id, revokedAt: null },
      data: { revokedAt: now, revokedById: options.actorUserId },
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

    const badgeNumber = await allocateBadgeNumber(
      tx,
      settings.badgePrefix,
      toIsoDayString(appointment.scheduledStart),
    );

    const visit = await tx.visit.create({
      data: {
        appointmentId: appointment.id,
        visitorId: appointment.visitorId,
        teacherId: appointment.teacherId,
        destinationId: appointment.destinationId,
        status: VisitStatus.EXPECTED,
        badgeNumber,
        expectedStart: appointment.scheduledStart,
        expectedEnd: appointment.scheduledEnd,
      },
    });

    await tx.visitEvent.create({
      data: {
        visitId: visit.id,
        type: VisitEventType.CREATED,
        actorUserId: options.actorUserId,
        metadata: { reference: appointment.referenceNumber },
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
              windowText: `${formatTimeRange(validFrom, expiresAt)} on ${formatDateTime(appointment.scheduledStart).split(',')[0]}`,
              decisionNote: options.note,
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
        action: AUDIT_ACTIONS.APPOINTMENT_APPROVED,
        targetType: 'Appointment',
        targetId: appointment.id,
        actorUserId: options.actorUserId,
        metadata: {
          reference: appointment.referenceNumber,
          visitId: visit.id,
          badgeNumber,
          actorRole: options.actorRole,
        },
      },
      tx,
    );

    return {
      appointmentId: appointment.id,
      referenceNumber: appointment.referenceNumber,
      visitId: visit.id,
      badgeNumber,
      alreadyApproved: false,
      notificationIds,
    };
  });
}

export interface RejectionResult {
  appointmentId: string;
  referenceNumber: string;
  alreadyRejected: boolean;
  notificationIds: string[];
}

/**
 * Reject a pending appointment.
 *
 * Creates no visit and no credential, and retires any credential that somehow
 * exists, so a rejected request can never produce a usable pass.
 */
export async function rejectAppointment(options: {
  appointmentId: string;
  actorUserId: string;
  actorRole: Role;
  note: string;
  now?: Date;
}): Promise<RejectionResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: {
        id: options.appointmentId,
        ...(options.actorRole === Role.TEACHER ? { teacherId: options.actorUserId } : {}),
      },
      include: { visitor: true, teacher: true },
    });

    if (!appointment) {
      throw new DecisionError('NOT_FOUND', 'That request could not be found.');
    }

    if (appointment.status === AppointmentStatus.REJECTED) {
      return {
        appointmentId: appointment.id,
        referenceNumber: appointment.referenceNumber,
        alreadyRejected: true,
        notificationIds: [],
      };
    }

    if (
      appointment.status === AppointmentStatus.APPROVED ||
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.EXPIRED
    ) {
      throw new DecisionError(
        'ALREADY_DECIDED',
        'This request has already been decided and can no longer be rejected.',
      );
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.REJECTED,
        decisionNote: options.note,
        decidedAt: now,
        decidedById: options.actorUserId,
      },
    });

    // Defensive: a rejected request must leave nothing scannable behind.
    await tx.qrCredential.updateMany({
      where: { appointmentId: appointment.id, revokedAt: null },
      data: { revokedAt: now, revokedById: options.actorUserId },
    });

    await tx.visit.updateMany({
      where: { appointmentId: appointment.id, status: VisitStatus.EXPECTED },
      data: { status: VisitStatus.CANCELLED },
    });

    const notificationIds: string[] = [];

    if (appointment.visitor.email) {
      notificationIds.push(
        await queueEmail(
          {
            type: 'visitor.rejected',
            templateKey: 'visitor-rejected',
            recipient: appointment.visitor.email,
            payload: {
              reference: appointment.referenceNumber,
              visitorName: appointment.visitor.fullName,
              teacherName: appointment.teacher.name,
              schoolName: settings.schoolName,
              scheduledAt: formatDateTime(appointment.scheduledStart),
              decisionNote: options.note,
            },
          },
          tx,
        ),
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.APPOINTMENT_REJECTED,
        targetType: 'Appointment',
        targetId: appointment.id,
        actorUserId: options.actorUserId,
        metadata: { reference: appointment.referenceNumber, actorRole: options.actorRole },
      },
      tx,
    );

    return {
      appointmentId: appointment.id,
      referenceNumber: appointment.referenceNumber,
      alreadyRejected: false,
      notificationIds,
    };
  });
}

/**
 * Visitor-initiated cancellation through the private link.
 * Scoped by token hash, so possession of the link is the authorisation.
 */
export async function cancelAppointmentByToken(options: {
  tokenHash: string;
  now?: Date;
}): Promise<{ cancelled: boolean; referenceNumber?: string; notificationIds: string[] }> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { publicTokenHash: options.tokenHash },
      include: { visitor: true, teacher: true },
    });

    if (!appointment) return { cancelled: false, notificationIds: [] };

    const cancellable: AppointmentStatus[] = [
      AppointmentStatus.PENDING,
      AppointmentStatus.REVIEW_REQUIRED,
      AppointmentStatus.APPROVED,
    ];

    if (!cancellable.includes(appointment.status)) {
      return { cancelled: false, referenceNumber: appointment.referenceNumber, notificationIds: [] };
    }

    // A visit already under way is the guard's business, not the visitor's.
    const activeVisit = await tx.visit.findFirst({
      where: {
        appointmentId: appointment.id,
        status: { in: [VisitStatus.CHECKED_IN, VisitStatus.CHECKED_OUT] },
      },
      select: { id: true },
    });

    if (activeVisit) {
      return { cancelled: false, referenceNumber: appointment.referenceNumber, notificationIds: [] };
    }

    await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.CANCELLED, cancelledAt: now },
    });

    await tx.qrCredential.updateMany({
      where: { appointmentId: appointment.id, revokedAt: null },
      data: { revokedAt: now },
    });

    await tx.visit.updateMany({
      where: { appointmentId: appointment.id, status: VisitStatus.EXPECTED },
      data: { status: VisitStatus.CANCELLED },
    });

    const notificationIds: string[] = [];

    if (appointment.visitor.email) {
      notificationIds.push(
        await queueEmail(
          {
            type: 'visitor.cancelled',
            templateKey: 'visitor-cancelled',
            recipient: appointment.visitor.email,
            payload: {
              reference: appointment.referenceNumber,
              visitorName: appointment.visitor.fullName,
              schoolName: settings.schoolName,
              scheduledAt: formatDateTime(appointment.scheduledStart),
            },
          },
          tx,
        ),
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.APPOINTMENT_CANCELLED,
        targetType: 'Appointment',
        targetId: appointment.id,
        metadata: { reference: appointment.referenceNumber, cancelledBy: 'visitor' },
      },
      tx,
    );

    return { cancelled: true, referenceNumber: appointment.referenceNumber, notificationIds };
  });
}

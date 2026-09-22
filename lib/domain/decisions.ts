import { AppointmentStatus, Role, VisitEventType, VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { deriveFallbackCode, hashFallbackCode } from '@/lib/crypto/tokens';
import { allocateBadgeNumber } from '@/lib/domain/badges';
import { getSettings } from '@/lib/domain/settings';
import { queueInAppNotification } from '@/lib/domain/in-app-notifications';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';
import { formatDateTime, toIsoDayString } from '@/lib/time';

/**
 * Teacher approval and rejection.
 *
 * Both operations are:
 *   - Transactional. Approval writes the appointment status, exactly one
 *     visit, exactly one credential and the audit entry, or it writes none of
 *     them.
 *   - Idempotent. Re-submitting an approval (double click, retried request,
 *     back button) returns the existing result instead of creating a second
 *     visit, badge or credential.
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
     * The pass is bound to the private token issued at submission. It is not
     * rotated.
     *
     * The visitor was shown that link once, on screen, and nothing can be sent
     * to them afterwards - the system has no email. A rotated link would
     * therefore be unreachable, and the approval would strand the visitor it
     * was meant to admit. Binding is also the option the specification names
     * first.
     *
     * It costs nothing in safety. The token alone never admitted anyone: before
     * approval it resolves only to a status page, and afterwards the gate
     * accepts it only through the credential written below, inside its
     * validity window.
     *
     * Only an administrator's reissue rotates the token (see credentials.ts),
     * and that path hands the new link back to the administrator to pass on.
     */
    const tokenHash = appointment.publicTokenHash;
    const fallbackCode = deriveFallbackCode(tokenHash);

    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.APPROVED,
        decisionNote: options.note ?? null,
        decidedAt: now,
        decidedById: options.actorUserId,
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

    // Nothing is sent to the visitor. Their private page reads the new state
    // directly, so reopening the link they saved is how they learn of it.

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
    };
  });
}

export interface RejectionResult {
  appointmentId: string;
  referenceNumber: string;
  alreadyRejected: boolean;
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

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: {
        id: options.appointmentId,
        ...(options.actorRole === Role.TEACHER ? { teacherId: options.actorUserId } : {}),
      },
    });

    if (!appointment) {
      throw new DecisionError('NOT_FOUND', 'That request could not be found.');
    }

    if (appointment.status === AppointmentStatus.REJECTED) {
      return {
        appointmentId: appointment.id,
        referenceNumber: appointment.referenceNumber,
        alreadyRejected: true,
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

    // The visitor sees the decision and the reason on their private page.

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
}): Promise<{ cancelled: boolean; referenceNumber?: string }> {
  const now = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { publicTokenHash: options.tokenHash },
      include: { visitor: true },
    });

    if (!appointment) return { cancelled: false };

    const cancellable: AppointmentStatus[] = [
      AppointmentStatus.PENDING,
      AppointmentStatus.REVIEW_REQUIRED,
      AppointmentStatus.APPROVED,
    ];

    if (!cancellable.includes(appointment.status)) {
      return { cancelled: false, referenceNumber: appointment.referenceNumber };
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
      return { cancelled: false, referenceNumber: appointment.referenceNumber };
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

    /*
     * The host is told, so they are not left expecting someone. A request
     * still held for review was never shown to the teacher, so telling them it
     * was cancelled would disclose that it existed.
     */
    if (appointment.status !== AppointmentStatus.REVIEW_REQUIRED) {
      await queueInAppNotification(
        {
          userId: appointment.teacherId,
          type: 'host.cancelled',
          title: 'A visitor cancelled',
          body: `${appointment.visitor.fullName} cancelled their visit on ${formatDateTime(appointment.scheduledStart)} (${appointment.referenceNumber}).`,
          link: `/teacher/requests/${appointment.id}`,
        },
        tx,
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

    return { cancelled: true, referenceNumber: appointment.referenceNumber };
  });
}

/**
 * Close requests nobody decided on before their time ran out.
 *
 * A PENDING request whose slot has ended can no longer be approved (see the
 * `PAST` check above), so no pass can come of it. Leaving it PENDING anyway
 * would count it as undecided in every queue and report forever, and tell the
 * visitor it is still waiting. The spec's `PENDING -> EXPIRED` transition
 * records what has actually happened.
 *
 * There is no scheduler in this application, so expiry is lazy: every screen
 * that shows appointment statuses calls this first. It is one indexed update
 * and idempotent, so calling it on every read is cheap and a race between two
 * callers only splits the count between their audit entries.
 *
 * REVIEW_REQUIRED is deliberately left alone. Those requests matched the
 * blacklist and are waiting on an administrator, whose decision should be
 * recorded as theirs rather than quietly overtaken by the clock.
 */
export async function expireLapsedRequests(now: Date = new Date()): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.appointment.updateMany({
      where: { status: AppointmentStatus.PENDING, scheduledEnd: { lt: now } },
      data: { status: AppointmentStatus.EXPIRED },
    });

    if (count > 0) {
      await recordAudit(
        {
          action: AUDIT_ACTIONS.APPOINTMENT_EXPIRED,
          targetType: 'Appointment',
          metadata: { affected: count, cutoff: now.toISOString() },
        },
        tx,
      );
    }

    return count;
  });
}

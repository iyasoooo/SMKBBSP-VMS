import {
  AppointmentSource,
  AppointmentStatus,
  type IdentityType,
  Role,
  VisitEventType,
  VisitStatus,
  type VisitorCategory,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  deriveFallbackCode,
  formatFallbackCode,
  generateReferenceNumber,
  generateToken,
  hashFallbackCode,
  hashToken,
  normalizeFallbackCode,
} from '@/lib/crypto/tokens';
import { allocateBadgeNumber } from '@/lib/domain/badges';
import {
  buildIdentityFields,
  normalizeIdentity,
  validateNormalizedIdentity,
} from '@/lib/crypto/identity';
import { normalizeEmail, normalizeName, normalizePhone } from '@/lib/domain/contact';
import { checkBlacklist, type BlacklistDecision } from '@/lib/domain/blacklist';
import { getSettings } from '@/lib/domain/settings';
import { SAFE_VISITOR_SELECT, toSafeVisitor, type SafeVisitor } from '@/lib/domain/presenters';
import { queueInAppNotification } from '@/lib/domain/in-app-notifications';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS, DENIAL_CODES, PUBLIC_TOKEN_TRAILING_DAYS, type DenialCode } from '@/lib/constants';
import { addDays, formatDateTime, toIsoDayString } from '@/lib/time';
import type { WalkInInput } from '@/lib/validation/appointment';

/**
 * Gate operations: pass lookup, check-in, check-out, walk-in registration.
 *
 * Design rules that run through the whole module:
 *   - Every state-changing operation is a transaction and is idempotent. A
 *     guard who taps twice, or whose tablet retries on a flaky connection,
 *     must not create two visits or two badges.
 *   - Conditions are re-checked *inside* the transaction. The blacklist and
 *     credential state are verified again at check-in, not merely at lookup,
 *     because an administrator may have blocked the visitor in between.
 *   - Nothing returned to a guard reveals why a visitor is blocked.
 */

/**
 * The host's arrival notice, shared by the approved and walk-in paths so the
 * two read the same. Name, party, badge and place only - never an identity
 * number or the visit purpose.
 */
function describeArrival(arrival: {
  visitorName: string;
  partySize: number;
  badgeNumber: string;
  destinationName?: string;
  at: Date;
}): string {
  const party = arrival.partySize > 1 ? ` with ${arrival.partySize - 1} other(s)` : '';
  const place = arrival.destinationName ? `, heading to ${arrival.destinationName}` : '';
  return `${arrival.visitorName}${party} checked in at ${formatDateTime(arrival.at)} (badge ${arrival.badgeNumber})${place}.`;
}

// ---------------------------------------------------------------------------
// Pass lookup
// ---------------------------------------------------------------------------

export type PassLookupState =
  | 'VALID'
  | 'TOO_EARLY'
  | 'EXPIRED'
  | 'REVOKED'
  | 'NOT_APPROVED'
  | 'CANCELLED'
  | 'ALREADY_CHECKED_IN'
  | 'ALREADY_CHECKED_OUT'
  | 'NOT_FOUND';

export interface PassLookupResult {
  state: PassLookupState;
  /** Populated for every state except NOT_FOUND. */
  visit?: {
    id: string;
    status: VisitStatus;
    badgeNumber: string;
    expectedStart: Date;
    expectedEnd: Date;
    checkedInAt: Date | null;
    checkedOutAt: Date | null;
    requiresIdSighted: boolean;
    idSightedAt: Date | null;
  };
  appointment?: {
    id: string;
    referenceNumber: string;
    purpose: string;
    partySize: number;
    vehicleNumber: string | null;
    scheduledStart: Date;
    scheduledEnd: Date;
  };
  visitor?: SafeVisitor;
  hostName?: string;
  destinationName?: string;
  visitTypeName?: string;
  /** CLEAR / REVIEW / BLOCKED only. Never a reason. */
  blacklist?: BlacklistDecision;
  /** When the pass is not yet valid, the instant it becomes valid. */
  validFrom?: Date;
}

/** Look up by the raw token scanned from a QR code, or a typed pass URL. */
export async function lookupPassByToken(
  rawTokenOrUrl: string,
  now: Date = new Date(),
): Promise<PassLookupResult> {
  const tokenHash = hashToken(extractToken(rawTokenOrUrl));
  return lookupByCredential({ tokenHash }, now);
}

/** Look up by the 8-character manual fallback code. */
export async function lookupPassByCode(
  code: string,
  now: Date = new Date(),
): Promise<PassLookupResult> {
  const normalized = normalizeFallbackCode(code);
  if (normalized.length === 0) return { state: 'NOT_FOUND' };
  return lookupByCredential({ fallbackCodeHash: hashFallbackCode(normalized) }, now);
}

/**
 * A scanner may return either the bare token or the full pass URL, depending
 * on how the camera library decodes it. Both are accepted.
 */
function extractToken(value: string): string {
  const trimmed = value.trim();
  const match = /\/v\/([A-Za-z0-9_-]+)\/?$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

async function lookupByCredential(
  where: { tokenHash: string } | { fallbackCodeHash: string },
  now: Date,
): Promise<PassLookupResult> {
  // Both columns are unique, so `findFirst` on either resolves at most one row
  // and avoids casting between the two `findUnique` where-shapes.
  const credential = await prisma.qrCredential.findFirst({
    where,
    include: {
      appointment: {
        include: {
          visitor: { select: SAFE_VISITOR_SELECT },
          teacher: { select: { name: true } },
          destination: true,
          visitType: true,
          visit: true,
        },
      },
    },
  });

  // A single generic result for anything we cannot resolve, so a guessed code
  // cannot be distinguished from a code that exists but is not usable.
  if (!credential) return { state: 'NOT_FOUND' };

  const { appointment } = credential;
  const visit = appointment.visit;

  const base: PassLookupResult = {
    state: 'VALID',
    appointment: {
      id: appointment.id,
      referenceNumber: appointment.referenceNumber,
      purpose: appointment.purpose,
      partySize: appointment.partySize,
      vehicleNumber: appointment.vehicleNumber,
      scheduledStart: appointment.scheduledStart,
      scheduledEnd: appointment.scheduledEnd,
    },
    visitor: toSafeVisitor(appointment.visitor),
    hostName: appointment.teacher.name,
    destinationName: appointment.destination?.nameEn,
    visitTypeName: appointment.visitType.nameEn,
    validFrom: credential.validFrom,
    visit: visit
      ? {
          id: visit.id,
          status: visit.status,
          badgeNumber: visit.badgeNumber,
          expectedStart: visit.expectedStart,
          expectedEnd: visit.expectedEnd,
          checkedInAt: visit.checkedInAt,
          checkedOutAt: visit.checkedOutAt,
          requiresIdSighted: appointment.visitType.requiresIdSighted,
          idSightedAt: visit.idSightedAt,
        }
      : undefined,
  };

  // Order matters: the most operationally useful state wins. A guard scanning
  // a visitor who is already inside needs the check-out option, not an
  // "expired" message, even if the window has since closed.
  if (visit?.status === VisitStatus.CHECKED_IN) return { ...base, state: 'ALREADY_CHECKED_IN' };
  if (visit?.status === VisitStatus.CHECKED_OUT) return { ...base, state: 'ALREADY_CHECKED_OUT' };

  if (appointment.status === AppointmentStatus.CANCELLED || visit?.status === VisitStatus.CANCELLED) {
    return { ...base, state: 'CANCELLED' };
  }

  if (appointment.status !== AppointmentStatus.APPROVED) {
    return { ...base, state: 'NOT_APPROVED' };
  }

  if (credential.revokedAt) return { ...base, state: 'REVOKED' };
  if (now < credential.validFrom) return { ...base, state: 'TOO_EARLY' };
  if (now > credential.expiresAt) return { ...base, state: 'EXPIRED' };

  // Matching uses the visitor's stored HMAC and contact values, so the gate
  // never needs the plaintext identity number to evaluate the blacklist.
  const decision = await evaluateStoredVisitor(appointment.visitorId, now);

  return { ...base, state: 'VALID', blacklist: decision };
}

/**
 * Blacklist re-evaluation for an existing visitor.
 *
 * The identity HMAC is already stored, so matching does not require the
 * plaintext number and nothing has to be decrypted at the gate.
 */
async function evaluateStoredVisitor(visitorId: string, now: Date): Promise<BlacklistDecision> {
  const visitor = await prisma.visitor.findUnique({
    where: { id: visitorId },
    select: { identityHmac: true, email: true, phone: true },
  });

  if (!visitor) return 'CLEAR';

  const entries = await prisma.blacklistEntry.findMany({
    where: {
      status: 'ACTIVE',
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
      AND: [
        {
          OR: [
            { identityHmac: visitor.identityHmac },
            ...(visitor.phone ? [{ matchPhone: visitor.phone }] : []),
            ...(visitor.email ? [{ matchEmail: visitor.email }] : []),
          ],
        },
      ],
    },
    select: { matchPolicy: true },
  });

  if (entries.length === 0) return 'CLEAR';
  return entries.some((e) => e.matchPolicy === 'BLOCK') ? 'BLOCKED' : 'REVIEW';
}

/** Guard-facing blacklist state for an existing visit. */
export async function blacklistStateForVisit(
  visitId: string,
  now: Date = new Date(),
): Promise<BlacklistDecision> {
  const visit = await prisma.visit.findUnique({ where: { id: visitId }, select: { visitorId: true } });
  if (!visit) return 'CLEAR';
  return evaluateStoredVisitor(visit.visitorId, now);
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export type GateErrorCode =
  | 'NOT_FOUND'
  | 'WRONG_STATE'
  | 'BLOCKED'
  | 'ID_NOT_SIGHTED'
  | 'PASS_INVALID';

export class GateError extends Error {
  constructor(
    readonly code: GateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

export interface CheckInResult {
  visitId: string;
  badgeNumber: string;
  alreadyCheckedIn: boolean;
}

/**
 * Check a visitor in.
 *
 * Re-validates status, credential window and blacklist inside the transaction.
 * `idSighted` records the guard's declaration that they looked at a physical
 * document - it is explicitly not a claim that the document is genuine.
 */
export async function checkInVisit(options: {
  visitId: string;
  guardUserId: string;
  idSighted: boolean;
  now?: Date;
}): Promise<CheckInResult> {
  const now = options.now ?? new Date();

  /*
   * The blocked branch must not throw from inside the transaction.
   *
   * Marking the visit DENIED and writing its audit entry are writes we want to
   * keep, but throwing inside `$transaction` rolls the whole thing back - so
   * the record of the blocked attempt would vanish, which is exactly what
   * AT-015 requires us to retain. Instead the transaction commits normally and
   * reports that it blocked; the error is raised afterwards.
   */
  const outcome = await prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({
      where: { id: options.visitId },
      include: {
        visitor: true,
        teacher: true,
        destination: true,
        appointment: { include: { visitType: true, credentials: { where: { revokedAt: null } } } },
      },
    });

    if (!visit) throw new GateError('NOT_FOUND', 'That visit could not be found.');

    // Idempotent: a second submission returns the existing state.
    if (visit.status === VisitStatus.CHECKED_IN) {
      return {
        blocked: false as const,
        result: {
          visitId: visit.id,
          badgeNumber: visit.badgeNumber,
          alreadyCheckedIn: true,
        },
      };
    }

    if (visit.status !== VisitStatus.EXPECTED) {
      throw new GateError(
        'WRONG_STATE',
        'This visit can no longer be checked in. Please refresh and try again.',
      );
    }

    const appointment = visit.appointment;
    if (appointment && appointment.status !== AppointmentStatus.APPROVED) {
      throw new GateError('PASS_INVALID', 'This appointment is not approved.');
    }

    // The credential window is re-checked here, not just at lookup time.
    if (appointment) {
      const credential = appointment.credentials[0];
      if (!credential) {
        throw new GateError('PASS_INVALID', 'This pass is no longer valid.');
      }
      if (now < credential.validFrom || now > credential.expiresAt) {
        throw new GateError('PASS_INVALID', 'This pass is outside its valid time window.');
      }
    }

    const requiresId = appointment?.visitType.requiresIdSighted ?? true;
    if (requiresId && !options.idSighted) {
      throw new GateError(
        'ID_NOT_SIGHTED',
        'Confirm that you have seen the visitor’s identification first.',
      );
    }

    // Final blacklist check: an admin may have blocked this visitor since the
    // pass was issued or since the guard scanned it.
    const decision = await evaluateStoredVisitor(visit.visitorId, now);
    if (decision === 'BLOCKED') {
      await tx.visit.update({
        where: { id: visit.id },
        data: { status: VisitStatus.DENIED, denialCode: DENIAL_CODES.BLACKLIST_BLOCK },
      });

      await tx.visitEvent.create({
        data: {
          visitId: visit.id,
          type: VisitEventType.DENIED,
          actorUserId: options.guardUserId,
          metadata: { denialCode: DENIAL_CODES.BLACKLIST_BLOCK },
        },
      });

      await recordAudit(
        {
          action: AUDIT_ACTIONS.VISIT_DENIED,
          targetType: 'Visit',
          targetId: visit.id,
          actorUserId: options.guardUserId,
          metadata: { denialCode: DENIAL_CODES.BLACKLIST_BLOCK, badgeNumber: visit.badgeNumber },
        },
        tx,
      );

      // Commit the denial and its audit entry, then signal the caller.
      return { blocked: true as const };
    }

    const updated = await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: VisitStatus.CHECKED_IN,
        checkedInAt: now,
        checkedInById: options.guardUserId,
        idSightedAt: options.idSighted ? now : null,
        idSightedById: options.idSighted ? options.guardUserId : null,
      },
    });

    const events: Array<{ visitId: string; type: VisitEventType; actorUserId: string }> = [
      { visitId: visit.id, type: VisitEventType.CHECKED_IN, actorUserId: options.guardUserId },
    ];
    if (options.idSighted) {
      events.push({
        visitId: visit.id,
        type: VisitEventType.ID_SIGHTED,
        actorUserId: options.guardUserId,
      });
    }
    await tx.visitEvent.createMany({ data: events });

    await queueInAppNotification(
      {
        userId: visit.teacherId,
        type: 'host.arrival',
        title: 'Your visitor has arrived',
        body: describeArrival({
          visitorName: visit.visitor.fullName,
          partySize: appointment?.partySize ?? 1,
          badgeNumber: visit.badgeNumber,
          destinationName: visit.destination?.nameEn,
          at: now,
        }),
        link: '/teacher/visits',
      },
      tx,
    );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.VISIT_CHECKED_IN,
        targetType: 'Visit',
        targetId: visit.id,
        actorUserId: options.guardUserId,
        metadata: {
          badgeNumber: visit.badgeNumber,
          idSighted: options.idSighted,
          blacklistState: decision,
        },
      },
      tx,
    );

    return {
      blocked: false as const,
      result: {
        visitId: updated.id,
        badgeNumber: updated.badgeNumber,
        alreadyCheckedIn: false,
      },
    };
  });

  if (outcome.blocked) {
    throw new GateError(
      'BLOCKED',
      'This visitor cannot be checked in. Please contact an administrator now.',
    );
  }

  return outcome.result;
}

// ---------------------------------------------------------------------------
// Check-out
// ---------------------------------------------------------------------------

export interface CheckOutResult {
  visitId: string;
  badgeNumber: string;
  alreadyCheckedOut: boolean;
}

export async function checkOutVisit(options: {
  visitId: string;
  guardUserId: string;
  now?: Date;
}): Promise<CheckOutResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({
      where: { id: options.visitId },
      include: { visitor: true, teacher: true, appointment: true },
    });

    if (!visit) throw new GateError('NOT_FOUND', 'That visit could not be found.');

    if (visit.status === VisitStatus.CHECKED_OUT) {
      return {
        visitId: visit.id,
        badgeNumber: visit.badgeNumber,
        alreadyCheckedOut: true,
      };
    }

    if (visit.status !== VisitStatus.CHECKED_IN) {
      throw new GateError('WRONG_STATE', 'Only a visitor who is on site can be checked out.');
    }

    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: VisitStatus.CHECKED_OUT,
        checkedOutAt: now,
        checkedOutById: options.guardUserId,
      },
    });

    await tx.visitEvent.create({
      data: {
        visitId: visit.id,
        type: VisitEventType.CHECKED_OUT,
        actorUserId: options.guardUserId,
      },
    });

    if (settings.notifyHostOnCheckout) {
      await queueInAppNotification(
        {
          userId: visit.teacherId,
          type: 'host.checkout',
          title: 'Your visitor has left',
          body: `${visit.visitor.fullName} (badge ${visit.badgeNumber}) checked out at ${formatDateTime(now)}.`,
          link: '/teacher/visits',
        },
        tx,
      );
    }

    await recordAudit(
      {
        action: AUDIT_ACTIONS.VISIT_CHECKED_OUT,
        targetType: 'Visit',
        targetId: visit.id,
        actorUserId: options.guardUserId,
        metadata: { badgeNumber: visit.badgeNumber },
      },
      tx,
    );

    return {
      visitId: visit.id,
      badgeNumber: visit.badgeNumber,
      alreadyCheckedOut: false,
    };
  });
}

/** Record a guard's decision not to admit an expected visitor. */
export async function denyVisit(options: {
  visitId: string;
  guardUserId: string;
  denialCode: DenialCode;
  note?: string;
  now?: Date;
}): Promise<void> {
  const now = options.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({ where: { id: options.visitId } });
    if (!visit) throw new GateError('NOT_FOUND', 'That visit could not be found.');
    if (visit.status === VisitStatus.DENIED) return;

    if (visit.status !== VisitStatus.EXPECTED) {
      throw new GateError('WRONG_STATE', 'Only an expected visitor can be denied entry.');
    }

    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: VisitStatus.DENIED,
        denialCode: options.denialCode,
        guardNote: options.note ?? null,
      },
    });

    await tx.visitEvent.create({
      data: {
        visitId: visit.id,
        type: VisitEventType.DENIED,
        actorUserId: options.guardUserId,
        metadata: { denialCode: options.denialCode },
      },
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.VISIT_DENIED,
        targetType: 'Visit',
        targetId: visit.id,
        actorUserId: options.guardUserId,
        metadata: { denialCode: options.denialCode, badgeNumber: visit.badgeNumber },
      },
      tx,
    );

    void now;
  });
}

// ---------------------------------------------------------------------------
// Walk-in
// ---------------------------------------------------------------------------

export interface WalkInResult {
  visitId: string;
  badgeNumber: string;
  referenceNumber: string;
  /**
   * The visitor's own pass link, returned exactly once.
   *
   * Only the hash is stored, so this is the sole moment the raw token exists
   * outside the visitor's browser. The caller renders it as a QR on the guard's
   * screen for the visitor to photograph; it must never be redirected to,
   * logged, or persisted.
   */
  passToken: string;
  fallbackCode: string;
}

/**
 * Register and check in a walk-in visitor in one transaction.
 *
 * A blocked visitor produces no visit at all - not a DENIED one - because
 * nothing was ever authorised. The attempt is still audited so an
 * administrator can see it, and the guard receives a neutral instruction with
 * no explanation.
 */
export async function registerWalkIn(options: {
  input: WalkInInput;
  guardUserId: string;
  now?: Date;
}): Promise<WalkInResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();
  const { input } = options;

  const [teacher, visitType, destination] = await Promise.all([
    prisma.user.findFirst({ where: { id: input.teacherId, role: Role.TEACHER, isActive: true } }),
    prisma.visitType.findFirst({ where: { id: input.visitTypeId, isActive: true } }),
    input.destinationId
      ? prisma.destination.findFirst({ where: { id: input.destinationId, isActive: true } })
      : Promise.resolve(null),
  ]);

  if (!teacher) throw new GateError('NOT_FOUND', 'Choose an active host staff member.');
  if (!visitType) throw new GateError('NOT_FOUND', 'Choose an active visit type.');

  const identityType = input.identityType as IdentityType;
  const normalizedIdentity = normalizeIdentity(identityType, input.identityNumber);
  const validation = validateNormalizedIdentity(identityType, normalizedIdentity);
  if (!validation.ok) {
    throw new GateError('NOT_FOUND', 'Enter a valid identification number.');
  }

  const email = normalizeEmail(input.email ?? null);
  const phone = normalizePhone(input.phone);
  const fullName = normalizeName(input.fullName);

  const blacklist = await checkBlacklist(
    { identityType, normalizedIdentity, email, phone },
    prisma,
    now,
  );

  if (blacklist.decision === 'BLOCKED') {
    await recordAudit({
      action: AUDIT_ACTIONS.WALK_IN_BLOCKED,
      targetType: 'Visitor',
      actorUserId: options.guardUserId,
      metadata: {
        matchedOn: blacklist.matchedOn,
        entryCount: blacklist.matchedEntryIds.length,
        visitorName: fullName,
      },
    });

    throw new GateError(
      'BLOCKED',
      'This visitor cannot be checked in. Please contact an administrator now.',
    );
  }

  if (visitType.requiresIdSighted && !input.idSighted) {
    throw new GateError(
      'ID_NOT_SIGHTED',
      'Confirm that you have seen the visitor’s identification first.',
    );
  }

  const expectedEnd = new Date(now.getTime() + input.expectedDurationMinutes * 60_000);
  const referenceNumber = generateReferenceNumber(now);
  const rawToken = generateToken();

  return prisma.$transaction(async (tx) => {
    const identity = buildIdentityFields(identityType, input.identityNumber);

    const existing = await tx.visitor.findFirst({
      where: { identityHmac: identity.hmac, identityType },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const visitorId =
      existing?.id ??
      (
        await tx.visitor.create({
          data: {
            fullName,
            email,
            phone,
            visitorCategory: input.visitorCategory as VisitorCategory,
            identityType,
            identityCiphertext: identity.ciphertext,
            identityIv: identity.iv,
            identityTag: identity.tag,
            identityKeyVersion: identity.keyVersion,
            identityHmac: identity.hmac,
            identityLast4: identity.last4,
            consentVersion: settings.consentVersion,
            consentedAt: now,
          },
          select: { id: true },
        })
      ).id;

    if (existing) {
      await tx.visitor.update({
        where: { id: existing.id },
        data: { fullName, email, phone, consentedAt: now, consentVersion: settings.consentVersion },
      });
    }

    const appointment = await tx.appointment.create({
      data: {
        referenceNumber,
        source: AppointmentSource.WALK_IN,
        visitorId,
        teacherId: teacher.id,
        destinationId: destination?.id ?? null,
        visitTypeId: visitType.id,
        scheduledStart: now,
        scheduledEnd: expectedEnd,
        purpose: input.purpose,
        partySize: input.partySize,
        vehicleNumber: input.vehicleNumber ?? null,
        status: AppointmentStatus.APPROVED,
        decidedAt: now,
        publicTokenHash: hashToken(rawToken),
        publicTokenExpiresAt: addDays(expectedEnd, PUBLIC_TOKEN_TRAILING_DAYS),
      },
    });

    const badgeNumber = await allocateBadgeNumber(
      tx,
      settings.badgePrefix,
      toIsoDayString(now),
    );

    const visit = await tx.visit.create({
      data: {
        appointmentId: appointment.id,
        visitorId,
        teacherId: teacher.id,
        destinationId: destination?.id ?? null,
        status: VisitStatus.CHECKED_IN,
        badgeNumber,
        expectedStart: now,
        expectedEnd,
        checkedInAt: now,
        checkedInById: options.guardUserId,
        idSightedAt: input.idSighted ? now : null,
        idSightedById: input.idSighted ? options.guardUserId : null,
      },
    });

    /*
     * The walk-in's pass. Before this existed the token above was hashed into
     * the appointment and then thrown away, so a walk-in carried a private
     * link nobody could ever be given and scanning anything for them returned
     * "pass not recognised".
     *
     * The window runs from now, because they are already inside, to the end of
     * the expected visit plus the same grace the approval path allows. Expiry
     * does not strand anyone at the exit: `lookupByCredential` resolves
     * CHECKED_IN before it ever considers the window, so a visitor who
     * overstays still scans out.
     */
    await tx.qrCredential.create({
      data: {
        appointmentId: appointment.id,
        tokenHash: hashToken(rawToken),
        fallbackCodeHash: hashFallbackCode(deriveFallbackCode(hashToken(rawToken))),
        validFrom: now,
        expiresAt: new Date(expectedEnd.getTime() + settings.qrGraceAfterMinutes * 60_000),
      },
    });

    await tx.visitEvent.createMany({
      data: [
        { visitId: visit.id, type: VisitEventType.CREATED, actorUserId: options.guardUserId },
        { visitId: visit.id, type: VisitEventType.CHECKED_IN, actorUserId: options.guardUserId },
      ],
    });

    await queueInAppNotification(
      {
        userId: teacher.id,
        type: 'host.arrival',
        title: 'A walk-in visitor is here to see you',
        body: describeArrival({
          visitorName: fullName,
          partySize: input.partySize,
          badgeNumber,
          destinationName: destination?.nameEn,
          at: now,
        }),
        link: '/teacher/visits',
      },
      tx,
    );

    await recordAudit(
      {
        action: AUDIT_ACTIONS.WALK_IN_CREATED,
        targetType: 'Visit',
        targetId: visit.id,
        actorUserId: options.guardUserId,
        metadata: {
          reference: referenceNumber,
          badgeNumber,
          blacklistState: blacklist.decision,
          idSighted: input.idSighted,
        },
      },
      tx,
    );

    return {
      visitId: visit.id,
      badgeNumber,
      referenceNumber,
      passToken: rawToken,
      fallbackCode: formatFallbackCode(deriveFallbackCode(hashToken(rawToken))),
    };
  });
}

// ---------------------------------------------------------------------------
// Gate queries
// ---------------------------------------------------------------------------

/** Everyone currently on site. Used by the active list and emergency screen. */
export async function listOnSiteVisits() {
  return prisma.visit.findMany({
    where: { status: VisitStatus.CHECKED_IN, checkedOutAt: null },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      teacher: { select: { name: true } },
      destination: true,
      appointment: { select: { referenceNumber: true, partySize: true } },
    },
    orderBy: { checkedInAt: 'asc' },
  });
}

/**
 * Free-text search by visitor name, badge number, or appointment reference.
 *
 * Deliberately *not* limited to today, unlike the dashboard's expected and
 * on-site lists. A visitor who turns up a day early or late is exactly the
 * case a guard needs to search for, and scoping the search to today would
 * report "not found" for someone who is legitimately expected tomorrow.
 *
 * Only visitors who are on site or still expected are returned, so the search
 * cannot be used to browse historical visit records from the gate screen.
 */
export async function searchGateVisits(query: string) {
  const term = query.trim();
  if (term.length < 2) return [];

  return prisma.visit.findMany({
    where: {
      OR: [
        { badgeNumber: { contains: term, mode: 'insensitive' } },
        { visitor: { fullName: { contains: term, mode: 'insensitive' } } },
        { appointment: { referenceNumber: { contains: term, mode: 'insensitive' } } },
      ],
      status: { in: [VisitStatus.CHECKED_IN, VisitStatus.EXPECTED] },
    },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      teacher: { select: { name: true } },
      destination: true,
      appointment: { select: { referenceNumber: true } },
    },
    orderBy: { expectedStart: 'asc' },
    take: 25,
  });
}

import {
  CheckpointKind,
  CheckpointMethod,
  Role,
  VisitEventType,
  VisitStatus,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSettings } from '@/lib/domain/settings';
import type { LastSeen } from '@/lib/domain/presenters';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';

/**
 * Visitor checkpoints: a named member of staff confirming a visitor is with
 * them, at a place the school already knows the name of.
 *
 * The design rule that shapes this module is that location is asserted by an
 * authenticated person, never sampled from the visitor's device. That costs
 * precision - there is no answer to "where is this visitor now" between
 * confirmations - and buys a signal that does not evaporate when somebody
 * locks their phone, which is the failure that makes continuous tracking
 * useless as a gate control.
 *
 * Two things follow from it:
 *   - `scannedById` is never null. An unattributed sighting is worth nothing.
 *   - A confirmation is only accepted for a visit a guard has already checked
 *     in. Staff confirm the second leg of a journey whose first leg the gate
 *     verified; nobody can assert presence for someone who never arrived.
 */

/**
 * Two confirmations of the same thing inside this window are the same event.
 *
 * A teacher double-taps, or a tablet retries on a flaky connection, and the
 * timeline must not grow a duplicate that later reads as two sightings.
 */
const DEDUPE_WINDOW_SECONDS = 60;

export type CheckpointErrorCode =
  | 'NOT_FOUND'
  | 'NOT_ON_SITE'
  | 'NOT_YOUR_VISITOR'
  | 'FORBIDDEN'
  | 'DISABLED'
  | 'INVALID_DESTINATION';

export class CheckpointError extends Error {
  constructor(
    readonly code: CheckpointErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CheckpointError';
  }
}

export interface CheckpointActor {
  id: string;
  role: Role;
}

export interface RecordCheckpointResult {
  checkpointId: string;
  createdAt: Date;
  /** True when an identical confirmation inside the dedupe window was reused. */
  deduped: boolean;
  visitorName: string;
  badgeNumber: string;
  destinationName: string | null;
  kind: CheckpointKind;
  method: CheckpointMethod;
}

/**
 * Which roles may confirm a sighting at all.
 *
 * PRINCIPAL is deliberately absent: that role is oversight without authority,
 * and recording a sighting is a write about what happened on the ground.
 */
const CHECKPOINT_ROLES: Role[] = [Role.GUARD, Role.ADMIN, Role.TEACHER];

/**
 * Record one confirmed sighting.
 *
 * Authorization is applied twice, as elsewhere in this codebase: the caller
 * has already proved a signed-in role, and the visit is re-scoped here by
 * `teacherId` so a valid teacher session still cannot confirm somebody else's
 * visitor by passing its id.
 */
export async function recordCheckpoint(options: {
  visitId: string;
  actor: CheckpointActor;
  kind?: CheckpointKind;
  method: CheckpointMethod;
  destinationId?: string | null;
  note?: string | null;
  now?: Date;
}): Promise<RecordCheckpointResult> {
  const now = options.now ?? new Date();
  const kind = options.kind ?? CheckpointKind.ARRIVAL;
  const settings = await getSettings();

  if (!settings.checkpointEnabled) {
    throw new CheckpointError('DISABLED', 'Arrival confirmations are turned off for this school.');
  }

  if (!CHECKPOINT_ROLES.includes(options.actor.role)) {
    throw new CheckpointError('FORBIDDEN', 'You cannot record visitor confirmations.');
  }

  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findUnique({
      where: { id: options.visitId },
      include: {
        visitor: { select: { fullName: true } },
        destination: { select: { id: true, nameEn: true } },
      },
    });

    if (!visit) throw new CheckpointError('NOT_FOUND', 'That visit could not be found.');

    /*
     * A teacher may only confirm their own visitor. Without this a single
     * teacher session could walk visit ids and learn who is on the grounds,
     * which is exactly the disclosure the rest of the system works to prevent.
     */
    if (options.actor.role === Role.TEACHER && visit.teacherId !== options.actor.id) {
      throw new CheckpointError('NOT_YOUR_VISITOR', 'That visitor is not booked to see you.');
    }

    /*
     * Only a visitor the gate has already admitted. EXPECTED means they have
     * not arrived and CHECKED_OUT means they have left; confirming either
     * would be recording something that did not happen.
     */
    if (visit.status !== VisitStatus.CHECKED_IN || visit.checkedOutAt) {
      throw new CheckpointError(
        'NOT_ON_SITE',
        'This visitor is not currently checked in at the gate.',
      );
    }

    let destinationId = options.destinationId ?? null;
    let destinationName = visit.destination?.nameEn ?? null;

    if (destinationId) {
      const destination = await tx.destination.findUnique({ where: { id: destinationId } });
      if (!destination || !destination.isActive) {
        throw new CheckpointError('INVALID_DESTINATION', 'That destination is not available.');
      }
      destinationName = destination.nameEn;
    } else if (visit.destinationId && kind !== CheckpointKind.PRESENCE) {
      /*
       * Fall back to the booked destination for arrival and departure only.
       *
       * Those two happen where the host is, so the booking is the right answer.
       * A roving sighting is not: the guard met the visitor in a corridor and
       * said nothing about where, so inheriting the booking would put a place
       * on the record that nobody actually claimed. It stays null, and the
       * note carries whatever the guard chose to say.
       */
      destinationId = visit.destinationId;
    } else if (kind === CheckpointKind.PRESENCE) {
      destinationName = null;
    }

    const since = new Date(now.getTime() - DEDUPE_WINDOW_SECONDS * 1000);
    const existing = await tx.visitCheckpoint.findFirst({
      where: {
        visitId: visit.id,
        kind,
        destinationId,
        scannedById: options.actor.id,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return {
        checkpointId: existing.id,
        createdAt: existing.createdAt,
        deduped: true,
        visitorName: visit.visitor.fullName,
        badgeNumber: visit.badgeNumber,
        destinationName,
        kind: existing.kind,
        method: existing.method,
      };
    }

    const checkpoint = await tx.visitCheckpoint.create({
      data: {
        visitId: visit.id,
        destinationId,
        scannedById: options.actor.id,
        kind,
        method: options.method,
        note: options.note?.trim() || null,
      },
    });

    await tx.visitEvent.create({
      data: {
        visitId: visit.id,
        type: VisitEventType.CHECKPOINT_RECORDED,
        actorUserId: options.actor.id,
        metadata: { kind, method: options.method, destinationId },
      },
    });

    await recordAudit(
      {
        action: AUDIT_ACTIONS.VISIT_CHECKPOINT_RECORDED,
        targetType: 'Visit',
        targetId: visit.id,
        actorUserId: options.actor.id,
        metadata: {
          badgeNumber: visit.badgeNumber,
          kind,
          method: options.method,
          destinationId,
        },
      },
      tx,
    );

    return {
      checkpointId: checkpoint.id,
      createdAt: checkpoint.createdAt,
      deduped: false,
      visitorName: visit.visitor.fullName,
      badgeNumber: visit.badgeNumber,
      destinationName,
      kind,
      method: options.method,
    };
  });
}

/**
 * The newest confirmation for each of the given visits.
 *
 * One query for the whole dashboard rather than one per row: the guard screen
 * renders every visitor on site, and an N+1 here would be felt on a tablet.
 */
export async function latestCheckpointsFor(visitIds: string[]): Promise<Map<string, LastSeen>> {
  if (visitIds.length === 0) return new Map();

  const rows = await prisma.visitCheckpoint.findMany({
    where: { visitId: { in: visitIds } },
    distinct: ['visitId'],
    // Ordering by visitId first is what reduces this to one row per visit;
    // createdAt descending then makes that row the most recent one.
    orderBy: [{ visitId: 'asc' }, { createdAt: 'desc' }],
    include: {
      destination: { select: { nameEn: true } },
      scannedBy: { select: { name: true } },
    },
  });

  return new Map(
    rows.map((row) => [
      row.visitId,
      {
        at: row.createdAt,
        destinationName: row.destination?.nameEn ?? null,
        confirmedBy: row.scannedBy.name,
        method: row.method,
        kind: row.kind,
      } satisfies LastSeen,
    ]),
  );
}

export interface HostConfirmationState {
  arrivedAt: Date | null;
  departedAt: Date | null;
}

/**
 * Whether each visit has been confirmed arrived and/or departed.
 *
 * Drives the host's own button, which has to know which of the two actions to
 * offer next. Kept separate from `latestCheckpointsFor` because that answers a
 * different question - where was this person last - and conflating the two
 * would make the button depend on a guard's roving sighting.
 */
export async function hostConfirmationsFor(
  visitIds: string[],
): Promise<Map<string, HostConfirmationState>> {
  if (visitIds.length === 0) return new Map();

  const rows = await prisma.visitCheckpoint.findMany({
    where: {
      visitId: { in: visitIds },
      kind: { in: [CheckpointKind.ARRIVAL, CheckpointKind.DEPARTURE] },
    },
    select: { visitId: true, kind: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const states = new Map<string, HostConfirmationState>();
  for (const row of rows) {
    const state = states.get(row.visitId) ?? { arrivedAt: null, departedAt: null };
    if (row.kind === CheckpointKind.ARRIVAL) state.arrivedAt ??= row.createdAt;
    else state.departedAt ??= row.createdAt;
    states.set(row.visitId, state);
  }

  return states;
}

/** Full confirmation timeline for one visit, oldest first. */
export async function listCheckpointsForVisit(visitId: string) {
  return prisma.visitCheckpoint.findMany({
    where: { visitId },
    orderBy: { createdAt: 'asc' },
    include: {
      destination: { select: { nameEn: true, nameMs: true } },
      scannedBy: { select: { name: true, role: true } },
    },
  });
}

export interface ArrivalComplianceStats {
  /** Visits that were actually admitted, and so could have been confirmed. */
  eligibleVisits: number;
  confirmedVisits: number;
  /** 0-100, rounded. Zero eligible visits reports 0 rather than dividing by it. */
  percentage: number;
  byMethod: Record<CheckpointMethod, number>;
}

/**
 * How often staff actually confirm arrivals, over a date range.
 *
 * This exists because the arrival alert is only meaningful once the positive
 * case is reliably recorded: silence means something only if speaking up is
 * the norm. An administrator reads this number to decide whether turning
 * `checkpoint.alertsEnabled` on would inform guards or merely spam them.
 */
export async function arrivalCompliance(range: {
  from: Date;
  to: Date;
}): Promise<ArrivalComplianceStats> {
  const admitted = await prisma.visit.findMany({
    where: {
      checkedInAt: { gte: range.from, lt: range.to },
      status: { in: [VisitStatus.CHECKED_IN, VisitStatus.CHECKED_OUT] },
    },
    select: { id: true },
  });

  const eligibleVisits = admitted.length;
  const byMethod: Record<CheckpointMethod, number> = {
    [CheckpointMethod.HOST_CONFIRM]: 0,
    [CheckpointMethod.SCAN]: 0,
    [CheckpointMethod.GUARD_SIGHTING]: 0,
  };

  if (eligibleVisits === 0) {
    return { eligibleVisits: 0, confirmedVisits: 0, percentage: 0, byMethod };
  }

  const confirmations = await prisma.visitCheckpoint.findMany({
    where: { visitId: { in: admitted.map((visit) => visit.id) }, kind: CheckpointKind.ARRIVAL },
    select: { visitId: true, method: true },
  });

  const confirmed = new Set<string>();
  for (const row of confirmations) {
    confirmed.add(row.visitId);
    byMethod[row.method] += 1;
  }

  return {
    eligibleVisits,
    confirmedVisits: confirmed.size,
    percentage: Math.round((confirmed.size / eligibleVisits) * 100),
    byMethod,
  };
}

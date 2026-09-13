import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CheckpointKind, CheckpointMethod, Role, VisitEventType, VisitStatus } from '@prisma/client';
import {
  createApprovedAppointment,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import {
  arrivalCompliance,
  CheckpointError,
  hostConfirmationsFor,
  latestCheckpointsFor,
  recordCheckpoint,
} from '@/lib/domain/checkpoints';

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/** An approved visit that a guard has already admitted. */
async function admittedVisit(): Promise<string> {
  const created = await createApprovedAppointment(fixtures);

  await testDb.visit.update({
    where: { id: created.visitId },
    data: {
      status: VisitStatus.CHECKED_IN,
      checkedInAt: new Date(),
      checkedInById: fixtures.guard.id,
    },
  });

  return created.visitId;
}

describe('recordCheckpoint', () => {
  it('records a host confirmation against an admitted visit', async () => {
    const visitId = await admittedVisit();

    const result = await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      kind: CheckpointKind.ARRIVAL,
      method: CheckpointMethod.HOST_CONFIRM,
    });

    expect(result.deduped).toBe(false);
    expect(result.badgeNumber).toBeTruthy();

    const rows = await testDb.visitCheckpoint.findMany({ where: { visitId } });
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row?.scannedById).toBe(fixtures.teacher.id);
    // Falls back to the destination the visit was booked against.
    expect(row?.destinationId).toBe(fixtures.destination.id);
  });

  it('writes a visit event so the audit timeline stays complete', async () => {
    const visitId = await admittedVisit();

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.guard.id, role: Role.GUARD },
      method: CheckpointMethod.GUARD_SIGHTING,
      kind: CheckpointKind.PRESENCE,
    });

    const events = await testDb.visitEvent.findMany({
      where: { visitId, type: VisitEventType.CHECKPOINT_RECORDED },
    });
    expect(events).toHaveLength(1);
  });

  it('refuses a teacher who does not host the visit', async () => {
    const visitId = await admittedVisit();

    /*
     * The disclosure this prevents: without it a single teacher session could
     * walk visit ids and learn who is on the grounds.
     */
    await expect(
      recordCheckpoint({
        visitId,
        actor: { id: fixtures.otherTeacher.id, role: Role.TEACHER },
        method: CheckpointMethod.HOST_CONFIRM,
      }),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_VISITOR' });

    expect(await testDb.visitCheckpoint.count({ where: { visitId } })).toBe(0);
  });

  it('lets a guard confirm any visitor on site', async () => {
    const visitId = await admittedVisit();

    const result = await recordCheckpoint({
      visitId,
      actor: { id: fixtures.guard.id, role: Role.GUARD },
      method: CheckpointMethod.SCAN,
    });

    expect(result.deduped).toBe(false);
  });

  it('refuses a visit that has not been checked in at the gate', async () => {
    const created = await createApprovedAppointment(fixtures);

    await expect(
      recordCheckpoint({
        visitId: created.visitId,
        actor: { id: fixtures.teacher.id, role: Role.TEACHER },
        method: CheckpointMethod.HOST_CONFIRM,
      }),
    ).rejects.toBeInstanceOf(CheckpointError);
  });

  it('refuses a visit that has already checked out', async () => {
    const visitId = await admittedVisit();
    await testDb.visit.update({
      where: { id: visitId },
      data: { status: VisitStatus.CHECKED_OUT, checkedOutAt: new Date() },
    });

    await expect(
      recordCheckpoint({
        visitId,
        actor: { id: fixtures.guard.id, role: Role.GUARD },
        method: CheckpointMethod.SCAN,
      }),
    ).rejects.toMatchObject({ code: 'NOT_ON_SITE' });
  });

  it('treats a repeat confirmation inside the window as the same event', async () => {
    const visitId = await admittedVisit();

    const first = await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      method: CheckpointMethod.HOST_CONFIRM,
    });

    const second = await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      method: CheckpointMethod.HOST_CONFIRM,
    });

    expect(second.deduped).toBe(true);
    expect(second.checkpointId).toBe(first.checkpointId);
    expect(await testDb.visitCheckpoint.count({ where: { visitId } })).toBe(1);
  });

  it('records a second confirmation once the dedupe window has passed', async () => {
    const visitId = await admittedVisit();
    const start = new Date();

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      method: CheckpointMethod.HOST_CONFIRM,
      now: start,
    });

    const later = await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      method: CheckpointMethod.HOST_CONFIRM,
      now: new Date(start.getTime() + 61_000),
    });

    expect(later.deduped).toBe(false);
    expect(await testDb.visitCheckpoint.count({ where: { visitId } })).toBe(2);
  });

  it('does not put the booked destination on a roving sighting', async () => {
    const visitId = await admittedVisit();

    /*
     * A guard who met the visitor in a corridor said nothing about where.
     * Inheriting the booking would record a place nobody claimed, so a
     * presence sighting keeps its destination empty and the note carries it.
     */
    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.guard.id, role: Role.GUARD },
      kind: CheckpointKind.PRESENCE,
      method: CheckpointMethod.GUARD_SIGHTING,
      note: 'Corridor outside Block B',
    });

    const row = await testDb.visitCheckpoint.findFirstOrThrow({ where: { visitId } });
    expect(row.destinationId).toBeNull();
    expect(row.note).toBe('Corridor outside Block B');
  });

  it('still records the booked destination for an arrival', async () => {
    const visitId = await admittedVisit();

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      kind: CheckpointKind.ARRIVAL,
      method: CheckpointMethod.HOST_CONFIRM,
    });

    const row = await testDb.visitCheckpoint.findFirstOrThrow({ where: { visitId } });
    expect(row.destinationId).toBe(fixtures.destination.id);
  });

  it('refuses an inactive destination', async () => {
    const visitId = await admittedVisit();
    const retired = await testDb.destination.create({
      data: { code: 'OLDWING', nameEn: 'Old Wing', nameMs: 'Sayap Lama', isActive: false },
    });

    await expect(
      recordCheckpoint({
        visitId,
        actor: { id: fixtures.guard.id, role: Role.GUARD },
        method: CheckpointMethod.SCAN,
        destinationId: retired.id,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DESTINATION' });
  });

  it('refuses a principal, who observes but does not write', async () => {
    const visitId = await admittedVisit();

    await expect(
      recordCheckpoint({
        visitId,
        actor: { id: fixtures.admin.id, role: Role.PRINCIPAL },
        method: CheckpointMethod.GUARD_SIGHTING,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('latestCheckpointsFor', () => {
  it('returns the most recent confirmation per visit', async () => {
    const visitId = await admittedVisit();
    const start = new Date();

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      kind: CheckpointKind.ARRIVAL,
      method: CheckpointMethod.HOST_CONFIRM,
      now: start,
    });

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.guard.id, role: Role.GUARD },
      kind: CheckpointKind.PRESENCE,
      method: CheckpointMethod.GUARD_SIGHTING,
      now: new Date(start.getTime() + 120_000),
    });

    const map = await latestCheckpointsFor([visitId]);
    expect(map.get(visitId)?.kind).toBe(CheckpointKind.PRESENCE);
    expect(map.get(visitId)?.confirmedBy).toBe(fixtures.guard.name);
  });

  it('returns an empty map for no visits, without querying', async () => {
    expect(await latestCheckpointsFor([])).toEqual(new Map());
  });
});

describe('hostConfirmationsFor', () => {
  it('separates arrival from departure', async () => {
    const visitId = await admittedVisit();
    const start = new Date();

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      kind: CheckpointKind.ARRIVAL,
      method: CheckpointMethod.HOST_CONFIRM,
      now: start,
    });

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      kind: CheckpointKind.DEPARTURE,
      method: CheckpointMethod.HOST_CONFIRM,
      now: new Date(start.getTime() + 300_000),
    });

    const state = (await hostConfirmationsFor([visitId])).get(visitId);
    expect(state?.arrivedAt).toBeInstanceOf(Date);
    expect(state?.departedAt).toBeInstanceOf(Date);
  });
});

describe('arrivalCompliance', () => {
  it('reports zero rather than dividing by no admitted visits', async () => {
    const stats = await arrivalCompliance({
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    });

    expect(stats).toMatchObject({ eligibleVisits: 0, confirmedVisits: 0, percentage: 0 });
  });

  it('counts an admitted visit as confirmed only once an arrival is recorded', async () => {
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);

    const visitId = await admittedVisit();
    await admittedVisit();

    expect(await arrivalCompliance({ from, to })).toMatchObject({
      eligibleVisits: 2,
      confirmedVisits: 0,
      percentage: 0,
    });

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.teacher.id, role: Role.TEACHER },
      kind: CheckpointKind.ARRIVAL,
      method: CheckpointMethod.HOST_CONFIRM,
    });

    const after = await arrivalCompliance({ from, to });
    expect(after).toMatchObject({ eligibleVisits: 2, confirmedVisits: 1, percentage: 50 });
    expect(after.byMethod.HOST_CONFIRM).toBe(1);
  });

  it('does not count a presence sighting as an arrival confirmation', async () => {
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 60_000);
    const visitId = await admittedVisit();

    await recordCheckpoint({
      visitId,
      actor: { id: fixtures.guard.id, role: Role.GUARD },
      kind: CheckpointKind.PRESENCE,
      method: CheckpointMethod.GUARD_SIGHTING,
    });

    expect(await arrivalCompliance({ from, to })).toMatchObject({ confirmedVisits: 0 });
  });
});

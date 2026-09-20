import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BlacklistStatus,
  IdentityType,
  MatchPolicy,
  NotificationChannel,
  Role,
  VisitStatus,
} from '@prisma/client';
import {
  nextSchoolSlot,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import { createAppointmentRequest } from '@/lib/domain/appointments';
import { approveAppointment } from '@/lib/domain/decisions';
import {
  checkInVisit,
  checkOutVisit,
  GateError,
  listOnSiteVisits,
  lookupPassByCode,
  lookupPassByToken,
  registerWalkIn,
} from '@/lib/domain/gate';
import { computeIdentityHmac, normalizeIdentity } from '@/lib/crypto/identity';
import { deriveFallbackCode } from '@/lib/crypto/tokens';
import type { AppointmentRequestInput, WalkInInput } from '@/lib/validation/appointment';

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

/**
 * Build an approved appointment whose pass window is open right now, so
 * check-in tests exercise the real credential check rather than bypassing it.
 */
async function createApprovedVisitNow() {
  const slot = nextSchoolSlot();
  const input = {
    fullName: 'Nurul Huda binti Ismail',
    email: 'nurul.huda@contoh.test',
    phone: '012-345 6789',
    identityType: IdentityType.NRIC,
    identityNumber: '880101-14-5523',
    visitorCategory: 'PARENT',
    teacherId: fixtures.teacher.id,
    visitTypeId: fixtures.visitType.id,
    destinationId: fixtures.destination.id,
    visitDate: slot.visitDate,
    visitTime: slot.visitTime,
    purpose: 'Discuss my child mid-term results',
    partySize: 1,
    consent: 'on',
  } as AppointmentRequestInput;

  const created = await createAppointmentRequest(input);
  const appointment = await testDb.appointment.findUniqueOrThrow({
    where: { referenceNumber: created.referenceNumber },
  });

  await approveAppointment({
    appointmentId: appointment.id,
    actorUserId: fixtures.teacher.id,
    actorRole: Role.TEACHER,
  });

  // Move the window so "now" sits inside it.
  const now = new Date();
  await testDb.qrCredential.updateMany({
    where: { appointmentId: appointment.id },
    data: {
      validFrom: new Date(now.getTime() - 30 * 60_000),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    },
  });
  await testDb.visit.updateMany({
    where: { appointmentId: appointment.id },
    data: {
      expectedStart: new Date(now.getTime() - 5 * 60_000),
      expectedEnd: new Date(now.getTime() + 30 * 60_000),
    },
  });

  const refreshed = await testDb.appointment.findUniqueOrThrow({
    where: { id: appointment.id },
    include: { visit: true },
  });

  await testDb.notification.deleteMany();

  return {
    appointmentId: appointment.id,
    visitId: refreshed.visit?.id ?? '',
    tokenHash: refreshed.publicTokenHash,
    fallbackCode: deriveFallbackCode(refreshed.publicTokenHash),
  };
}

describe('AT-011: pass lookup states', () => {
  it('reports VALID inside the window and finds the same record by fallback code', async () => {
    const { fallbackCode, visitId } = await createApprovedVisitNow();

    const byCode = await lookupPassByCode(fallbackCode);
    expect(byCode.state).toBe('VALID');
    expect(byCode.visit?.id).toBe(visitId);
    expect(byCode.blacklist).toBe('CLEAR');

    // The masked identity is what reaches the guard, never the full number.
    expect(byCode.visitor?.identityMasked).toBe('******-**-5523');
    expect(JSON.stringify(byCode)).not.toContain('880101145523');
  });

  it('accepts a code typed with confusable characters and separators', async () => {
    const { fallbackCode } = await createApprovedVisitNow();
    const scrambled = `${fallbackCode.slice(0, 4)}-${fallbackCode.slice(4)}`.toLowerCase();
    expect((await lookupPassByCode(scrambled)).state).toBe('VALID');
  });

  it('reports TOO_EARLY before the window opens', async () => {
    const { appointmentId, fallbackCode } = await createApprovedVisitNow();
    await testDb.qrCredential.updateMany({
      where: { appointmentId },
      data: { validFrom: new Date(Date.now() + 60 * 60_000) },
    });

    expect((await lookupPassByCode(fallbackCode)).state).toBe('TOO_EARLY');
  });

  it('reports EXPIRED after the window closes', async () => {
    const { appointmentId, fallbackCode } = await createApprovedVisitNow();
    await testDb.qrCredential.updateMany({
      where: { appointmentId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect((await lookupPassByCode(fallbackCode)).state).toBe('EXPIRED');
  });

  it('reports REVOKED for a withdrawn pass', async () => {
    const { appointmentId, fallbackCode } = await createApprovedVisitNow();
    await testDb.qrCredential.updateMany({
      where: { appointmentId },
      data: { revokedAt: new Date() },
    });

    expect((await lookupPassByCode(fallbackCode)).state).toBe('REVOKED');
  });

  it('reports CANCELLED for a cancelled appointment', async () => {
    const { appointmentId, fallbackCode } = await createApprovedVisitNow();
    await testDb.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELLED' },
    });

    expect((await lookupPassByCode(fallbackCode)).state).toBe('CANCELLED');
  });

  it('reports NOT_FOUND for an unknown code, leaking nothing', async () => {
    const result = await lookupPassByCode('ZZZZZZZZ');
    expect(result.state).toBe('NOT_FOUND');
    expect(result.visitor).toBeUndefined();
    expect(result.appointment).toBeUndefined();
    expect(result.hostName).toBeUndefined();
  });

  it('reports NOT_FOUND for an empty or malformed code', async () => {
    expect((await lookupPassByCode('')).state).toBe('NOT_FOUND');
    expect((await lookupPassByToken('nonsense')).state).toBe('NOT_FOUND');
  });
});

describe('AT-010 / AT-012: check-in', () => {
  it('records the guard, time, badge, host notification and audit trail', async () => {
    const { visitId } = await createApprovedVisitNow();

    const result = await checkInVisit({
      visitId,
      guardUserId: fixtures.guard.id,
      idSighted: true,
    });

    expect(result.alreadyCheckedIn).toBe(false);

    const visit = await testDb.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit.status).toBe(VisitStatus.CHECKED_IN);
    expect(visit.checkedInById).toBe(fixtures.guard.id);
    expect(visit.checkedInAt).toBeInstanceOf(Date);
    expect(visit.idSightedAt).toBeInstanceOf(Date);
    expect(visit.idSightedById).toBe(fixtures.guard.id);

    const events = await testDb.visitEvent.findMany({ where: { visitId } });
    expect(events.map((e) => e.type).sort()).toEqual(['CHECKED_IN', 'CREATED', 'ID_SIGHTED']);

    // AT-010: the host is told in-app, and nothing is emailed.
    const notifications = await testDb.notification.findMany();
    expect(notifications.map((n) => n.type)).toEqual(['host.arrival']);
    expect(notifications[0]?.channel).toBe(NotificationChannel.IN_APP);
    expect(notifications[0]?.userId).toBe(fixtures.teacher.id);

    expect(await testDb.auditLog.count({ where: { action: 'visit.checked_in' } })).toBe(1);
  });

  it('refuses check-in when the visit type requires ID and the guard did not confirm', async () => {
    const { visitId } = await createApprovedVisitNow();

    await expect(
      checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: false }),
    ).rejects.toThrow(/identification/i);

    const visit = await testDb.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit.status).toBe(VisitStatus.EXPECTED);
  });

  it('is idempotent - a repeated check-in creates nothing new', async () => {
    const { visitId } = await createApprovedVisitNow();

    const first = await checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true });
    const second = await checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true });

    expect(second.alreadyCheckedIn).toBe(true);
    expect(second.badgeNumber).toBe(first.badgeNumber);

    expect(await testDb.visit.count()).toBe(1);
    expect(await testDb.notification.count()).toBe(1);
    expect(
      await testDb.visitEvent.count({ where: { visitId, type: 'CHECKED_IN' } }),
    ).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: 'visit.checked_in' } })).toBe(1);
  });

  it('refuses to check in outside the credential window', async () => {
    const { appointmentId, visitId } = await createApprovedVisitNow();
    await testDb.qrCredential.updateMany({
      where: { appointmentId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(
      checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true }),
    ).rejects.toThrow(/valid time window/i);
  });

  it('denies and audits a visitor blacklisted after the pass was issued', async () => {
    const { visitId } = await createApprovedVisitNow();

    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        identityHmac: computeIdentityHmac(
          IdentityType.NRIC,
          normalizeIdentity(IdentityType.NRIC, '880101-14-5523'),
        ),
        displayName: 'Blocked person',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Restricted internal reason.',
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    await expect(
      checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true }),
    ).rejects.toThrow(/contact an administrator/i);

    const visit = await testDb.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit.status).toBe(VisitStatus.DENIED);
    expect(visit.denialCode).toBe('BLACKLIST_BLOCK');
    expect(visit.checkedInAt).toBeNull();

    // The guard-facing error carries no reason text.
    const audit = await testDb.auditLog.findFirst({ where: { action: 'visit.denied' } });
    expect(JSON.stringify(audit)).not.toContain('Restricted internal reason');
  });
});

describe('AT-016: check-out', () => {
  it('completes the visit and removes it from the on-site list', async () => {
    const { visitId } = await createApprovedVisitNow();
    await checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true });

    expect(await listOnSiteVisits()).toHaveLength(1);

    const result = await checkOutVisit({ visitId, guardUserId: fixtures.guard.id });
    expect(result.alreadyCheckedOut).toBe(false);

    const visit = await testDb.visit.findUniqueOrThrow({ where: { id: visitId } });
    expect(visit.status).toBe(VisitStatus.CHECKED_OUT);
    expect(visit.checkedOutById).toBe(fixtures.guard.id);

    expect(await listOnSiteVisits()).toHaveLength(0);
    expect(await testDb.auditLog.count({ where: { action: 'visit.checked_out' } })).toBe(1);
  });

  it('is idempotent', async () => {
    const { visitId } = await createApprovedVisitNow();
    await checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true });
    await checkOutVisit({ visitId, guardUserId: fixtures.guard.id });

    const second = await checkOutVisit({ visitId, guardUserId: fixtures.guard.id });
    expect(second.alreadyCheckedOut).toBe(true);

    expect(await testDb.visitEvent.count({ where: { visitId, type: 'CHECKED_OUT' } })).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: 'visit.checked_out' } })).toBe(1);
  });

  it('refuses to check out a visitor who never checked in', async () => {
    const { visitId } = await createApprovedVisitNow();
    await expect(
      checkOutVisit({ visitId, guardUserId: fixtures.guard.id }),
    ).rejects.toBeInstanceOf(GateError);
  });
});

describe('AT-014 / AT-015: walk-in', () => {
  function walkInInput(overrides: Partial<WalkInInput> = {}): WalkInInput {
    return {
      fullName: 'Abdul Rahman bin Yusof',
      email: undefined,
      phone: '013-222 3333',
      identityType: IdentityType.NRIC,
      identityNumber: '760101-99-5505',
      visitorCategory: 'CONTRACTOR',
      teacherId: fixtures.teacher.id,
      visitTypeId: fixtures.visitType.id,
      destinationId: fixtures.destination.id,
      purpose: 'Air-conditioning maintenance',
      partySize: 2,
      expectedDurationMinutes: 90,
      vehicleNumber: undefined,
      idSighted: true,
      ...overrides,
    } as WalkInInput;
  }

  it('registers and checks in a clear walk-in without an email address', async () => {
    const result = await registerWalkIn({
      input: walkInInput(),
      guardUserId: fixtures.guard.id,
    });

    const visit = await testDb.visit.findUniqueOrThrow({
      where: { id: result.visitId },
      include: { appointment: true, visitor: true },
    });

    expect(visit.status).toBe(VisitStatus.CHECKED_IN);
    expect(visit.checkedInById).toBe(fixtures.guard.id);
    expect(visit.appointment?.source).toBe('WALK_IN');
    expect(visit.visitor.email).toBeNull();
    expect(result.badgeNumber).toMatch(/^V-\d{6}-\d{4}$/);

    // AT-014: the host is notified in-app; the visitor needs no email.
    const notifications = await testDb.notification.findMany();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('host.arrival');
    expect(notifications[0]?.channel).toBe(NotificationChannel.IN_APP);
    expect(notifications[0]?.userId).toBe(fixtures.teacher.id);

    expect(await testDb.auditLog.count({ where: { action: 'walk_in.created' } })).toBe(1);
  });

  it('AT-015: refuses a blocked walk-in, creates no visit, and audits the attempt', async () => {
    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        identityHmac: computeIdentityHmac(
          IdentityType.NRIC,
          normalizeIdentity(IdentityType.NRIC, '760101-99-5505'),
        ),
        displayName: 'Blocked contractor',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Restricted internal reason that must never reach a guard.',
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    await expect(
      registerWalkIn({ input: walkInInput(), guardUserId: fixtures.guard.id }),
    ).rejects.toThrow(/contact an administrator/i);

    // Nothing was created at all - not even a denied visit.
    expect(await testDb.visit.count()).toBe(0);
    expect(await testDb.appointment.count()).toBe(0);
    expect(await testDb.notification.count()).toBe(0);

    const audit = await testDb.auditLog.findFirst({ where: { action: 'walk_in.blocked' } });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit)).not.toContain('Restricted internal reason');
  });

  it('refuses when ID sighting is required but not confirmed', async () => {
    await expect(
      registerWalkIn({
        input: walkInInput({ idSighted: false }),
        guardUserId: fixtures.guard.id,
      }),
    ).rejects.toThrow(/identification/i);

    expect(await testDb.visit.count()).toBe(0);
  });

  /*
   * The walk-in's pass used to be a token hashed into the appointment and then
   * discarded: nobody could be given it, and scanning anything for a walk-in
   * answered "pass not recognised". These pin the credential that fixes it.
   */
  it('issues a pass the walk-in visitor can actually be given', async () => {
    const result = await registerWalkIn({
      input: walkInInput(),
      guardUserId: fixtures.guard.id,
    });

    expect(result.passToken).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(result.fallbackCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const credential = await testDb.qrCredential.findFirstOrThrow({
      where: { appointment: { visit: { id: result.visitId } } },
    });
    expect(credential.revokedAt).toBeNull();
    expect(credential.validFrom.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('resolves that pass at the gate as someone already inside, not as unknown', async () => {
    const result = await registerWalkIn({
      input: walkInInput(),
      guardUserId: fixtures.guard.id,
    });

    // The whole point: a guard scanning a walk-in on the way out gets the
    // check-out path rather than NOT_FOUND.
    const byToken = await lookupPassByToken(result.passToken);
    expect(byToken.state).toBe('ALREADY_CHECKED_IN');
    expect(byToken.visit?.id).toBe(result.visitId);

    const byCode = await lookupPassByCode(result.fallbackCode);
    expect(byCode.state).toBe('ALREADY_CHECKED_IN');
    expect(byCode.visit?.id).toBe(result.visitId);
  });

  it('does not issue a pass for a blocked walk-in', async () => {
    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        identityHmac: computeIdentityHmac(
          IdentityType.NRIC,
          normalizeIdentity(IdentityType.NRIC, '760101-99-5505'),
        ),
        displayName: 'Blocked contractor',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Restricted internal reason.',
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    await expect(
      registerWalkIn({ input: walkInInput(), guardUserId: fixtures.guard.id }),
    ).rejects.toThrow(/contact an administrator/i);

    expect(await testDb.qrCredential.count()).toBe(0);
  });

  it('allows a visit type that does not require ID sighting', async () => {
    const result = await registerWalkIn({
      input: walkInInput({ visitTypeId: fixtures.visitTypeNoId.id, idSighted: false }),
      guardUserId: fixtures.guard.id,
    });

    const visit = await testDb.visit.findUniqueOrThrow({ where: { id: result.visitId } });
    expect(visit.status).toBe(VisitStatus.CHECKED_IN);
    expect(visit.idSightedAt).toBeNull();
  });
});

describe('AT-018: emergency list totals', () => {
  it('counts people by party size, not by row', async () => {
    const { visitId } = await createApprovedVisitNow();
    await checkInVisit({ visitId, guardUserId: fixtures.guard.id, idSighted: true });

    await registerWalkIn({
      input: {
        fullName: 'Group of three',
        phone: '013-444 5555',
        identityType: IdentityType.NRIC,
        identityNumber: '800101-99-1234',
        visitorCategory: 'OFFICIAL',
        teacherId: fixtures.teacher.id,
        visitTypeId: fixtures.visitType.id,
        purpose: 'District inspection',
        partySize: 3,
        expectedDurationMinutes: 60,
        idSighted: true,
      } as WalkInInput,
      guardUserId: fixtures.guard.id,
    });

    const onSite = await listOnSiteVisits();
    expect(onSite).toHaveLength(2);

    const totalPeople = onSite.reduce((sum, v) => sum + (v.appointment?.partySize ?? 1), 0);
    expect(totalPeople).toBe(4);

    // Checking one out drops both the row and its people from the total.
    await checkOutVisit({ visitId, guardUserId: fixtures.guard.id });

    const after = await listOnSiteVisits();
    expect(after).toHaveLength(1);
    expect(after.reduce((sum, v) => sum + (v.appointment?.partySize ?? 1), 0)).toBe(3);
  });
});

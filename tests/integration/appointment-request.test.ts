import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AppointmentStatus,
  BlacklistStatus,
  IdentityType,
  MatchPolicy,
  NotificationChannel,
} from '@prisma/client';
import {
  createTestVisitor,
  nextSchoolSlot,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import { createAppointmentRequest, resolveSchedule, ScheduleError } from '@/lib/domain/appointments';
import { computeIdentityHmac, normalizeIdentity } from '@/lib/crypto/identity';
import { hashToken } from '@/lib/crypto/tokens';
import { getSettings } from '@/lib/domain/settings';
import type { AppointmentRequestInput } from '@/lib/validation/appointment';

const APP_URL = 'http://localhost:3000';

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function buildInput(overrides: Partial<AppointmentRequestInput> = {}): AppointmentRequestInput {
  const slot = nextSchoolSlot();
  return {
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
    vehicleNumber: undefined,
    consent: 'on',
    ...overrides,
  } as AppointmentRequestInput;
}

describe('createAppointmentRequest', () => {
  it('AT-003: stores a PENDING request, a visitor, and both notifications', async () => {
    const result = await createAppointmentRequest(buildInput(), APP_URL);

    expect(result.status).toBe(AppointmentStatus.PENDING);
    expect(result.referenceNumber).toMatch(/^VP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const appointment = await testDb.appointment.findUnique({
      where: { referenceNumber: result.referenceNumber },
      include: { visitor: true },
    });

    expect(appointment).not.toBeNull();
    expect(appointment?.status).toBe(AppointmentStatus.PENDING);
    expect(appointment?.teacherId).toBe(fixtures.teacher.id);
    expect(appointment?.visitor.fullName).toBe('Nurul Huda binti Ismail');

    // Contact details are normalized on the way in.
    expect(appointment?.visitor.phone).toBe('+60123456789');
    expect(appointment?.visitor.email).toBe('nurul.huda@contoh.test');

    // Two emails: the visitor acknowledgement and the teacher's notification.
    const emails = await testDb.notification.findMany({
      where: { channel: NotificationChannel.EMAIL },
      orderBy: { type: 'asc' },
    });
    expect(emails.map((n) => n.type)).toEqual([
      'teacher.new_request',
      'visitor.request_received',
    ]);

    // Plus an in-app copy for the teacher, so a signed-in host sees it without
    // checking their inbox. It belongs to the host and starts unread.
    const inApp = await testDb.notification.findMany({
      where: { channel: NotificationChannel.IN_APP },
    });
    expect(inApp).toHaveLength(1);
    expect(inApp[0]?.userId).toBe(fixtures.teacher.id);
    expect(inApp[0]?.readAt).toBeNull();
  });

  it('AT-009 / AT-027: persists no plaintext identity and only a token hash', async () => {
    const result = await createAppointmentRequest(buildInput(), APP_URL);

    const appointment = await testDb.appointment.findUnique({
      where: { referenceNumber: result.referenceNumber },
      include: { visitor: true },
    });

    const serialized = JSON.stringify(appointment);
    expect(serialized).not.toContain('880101145523');
    expect(serialized).not.toContain('880101-14-5523');

    // The raw token exists only in the return value, never in the row.
    expect(serialized).not.toContain(result.rawToken);
    expect(appointment?.publicTokenHash).toBe(hashToken(result.rawToken));
    expect(appointment?.visitor.identityLast4).toBe('5523');
  });

  it('keeps the outbox payload free of identity values and raw tokens', async () => {
    const result = await createAppointmentRequest(buildInput(), APP_URL);

    const notifications = await testDb.notification.findMany();
    for (const notification of notifications) {
      const payload = JSON.stringify(notification.payload);
      expect(payload).not.toContain('880101145523');
    }

    // The visitor's own link legitimately carries the token; the teacher's
    // notification must not.
    const teacherNotification = notifications.find((n) => n.type === 'teacher.new_request');
    expect(JSON.stringify(teacherNotification?.payload)).not.toContain(result.rawToken);
  });

  it('reuses one visitor record for a repeat visitor with the same identity', async () => {
    await createAppointmentRequest(buildInput(), APP_URL);
    await createAppointmentRequest(
      buildInput({ fullName: 'Nurul Huda Ismail', phone: '013-999 8888' }),
      APP_URL,
    );

    const visitors = await testDb.visitor.findMany();
    expect(visitors).toHaveLength(1);

    // The most recent details win.
    expect(visitors[0]?.fullName).toBe('Nurul Huda Ismail');
    expect(visitors[0]?.phone).toBe('+60139998888');
    expect(await testDb.appointment.count()).toBe(2);
  });

  it('does not merge two different people who share a name and email', async () => {
    await createAppointmentRequest(buildInput({ identityNumber: '880101-14-5523' }), APP_URL);
    await createAppointmentRequest(buildInput({ identityNumber: '900202-10-1234' }), APP_URL);

    expect(await testDb.visitor.count()).toBe(2);
  });

  it('records consent with the current notice version', async () => {
    const settings = await getSettings();
    await createAppointmentRequest(buildInput(), APP_URL);

    const visitor = await testDb.visitor.findFirst();
    expect(visitor?.consentVersion).toBe(settings.consentVersion);
    expect(visitor?.consentedAt).toBeInstanceOf(Date);
  });

  it('rejects an inactive host without creating anything', async () => {
    await testDb.teacherProfile.update({
      where: { userId: fixtures.teacher.id },
      data: { isAcceptingVisits: false },
    });

    await expect(createAppointmentRequest(buildInput(), APP_URL)).rejects.toThrow(
      /not accepting visits/i,
    );

    expect(await testDb.appointment.count()).toBe(0);
    expect(await testDb.visitor.count()).toBe(0);
  });

  it('AT-004: rejects a past date without creating a partial appointment', async () => {
    await expect(
      createAppointmentRequest(buildInput({ visitDate: '2020-01-06' }), APP_URL),
    ).rejects.toBeInstanceOf(ScheduleError);

    expect(await testDb.appointment.count()).toBe(0);
    expect(await testDb.visitor.count()).toBe(0);
    expect(await testDb.notification.count()).toBe(0);
  });
});

describe('AT-005: blacklist handling on public submission', () => {
  it('routes a hard-block identity match to REVIEW_REQUIRED and alerts admins', async () => {
    const normalized = normalizeIdentity(IdentityType.NRIC, '880101-14-5523');

    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        identityHmac: computeIdentityHmac(IdentityType.NRIC, normalized),
        displayName: 'Blocked person',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Restricted internal reason.',
        // Set from the application clock rather than relying on the column
        // default, which uses the database clock and can sit a few
        // milliseconds ahead of the comparison instant.
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    const result = await createAppointmentRequest(buildInput(), APP_URL);

    expect(result.status).toBe(AppointmentStatus.REVIEW_REQUIRED);

    const notifications = await testDb.notification.findMany();
    const types = notifications.map((n) => n.type).sort();

    // The visitor still gets a neutral acknowledgement; the teacher is not
    // asked to approve; administrators are alerted.
    expect(types).toContain('visitor.request_received');
    expect(types).toContain('admin.review_required');
    expect(types).not.toContain('teacher.new_request');

    // No pass may exist for a request under review.
    expect(await testDb.qrCredential.count()).toBe(0);

    // Nothing in the visitor's own email hints at the block.
    const visitorEmail = notifications.find((n) => n.type === 'visitor.request_received');
    const payload = JSON.stringify(visitorEmail?.payload).toLowerCase();
    expect(payload).not.toContain('blacklist');
    expect(payload).not.toContain('blocked');
    expect(payload).not.toContain('restricted internal reason');
  });

  it('routes a REVIEW-policy phone match to REVIEW_REQUIRED', async () => {
    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        matchPhone: '+60123456789',
        displayName: 'Review person',
        matchPolicy: MatchPolicy.REVIEW,
        reason: 'Restricted internal reason.',
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    const result = await createAppointmentRequest(buildInput(), APP_URL);
    expect(result.status).toBe(AppointmentStatus.REVIEW_REQUIRED);
  });

  it('ignores an entry whose validity window has passed', async () => {
    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        matchPhone: '+60123456789',
        displayName: 'Lapsed person',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Restricted internal reason.',
        validFrom: new Date(Date.now() - 90 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
        createdById: fixtures.admin.id,
      },
    });

    const result = await createAppointmentRequest(buildInput(), APP_URL);
    expect(result.status).toBe(AppointmentStatus.PENDING);
  });

  it('never blocks on a name match alone', async () => {
    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        displayName: 'Nurul Huda binti Ismail',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Restricted internal reason.',
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    const result = await createAppointmentRequest(buildInput(), APP_URL);
    expect(result.status).toBe(AppointmentStatus.PENDING);
  });
});

describe('resolveSchedule', () => {
  it('rejects times outside school hours and on closed days', async () => {
    const settings = await getSettings();
    const now = new Date('2026-03-09T00:00:00Z'); // Monday 08:00 KL

    // Before opening.
    expect(() => resolveSchedule('2026-03-10', '06:00', 30, settings, now)).toThrow(ScheduleError);
    // Finishes after closing.
    expect(() => resolveSchedule('2026-03-10', '16:45', 60, settings, now)).toThrow(ScheduleError);
    // Saturday.
    expect(() => resolveSchedule('2026-03-14', '10:00', 30, settings, now)).toThrow(ScheduleError);
    // Beyond the advance-booking limit.
    expect(() => resolveSchedule('2027-03-10', '10:00', 30, settings, now)).toThrow(ScheduleError);

    // A valid weekday slot inside hours succeeds.
    const valid = resolveSchedule('2026-03-10', '10:00', 30, settings, now);
    expect(valid.scheduledStart.toISOString()).toBe('2026-03-10T02:00:00.000Z');
    expect(valid.scheduledEnd.toISOString()).toBe('2026-03-10T02:30:00.000Z');
  });

  it('enforces the minimum notice period', async () => {
    const settings = await getSettings();
    const now = new Date('2026-03-10T01:30:00Z'); // 09:30 KL

    // 10:00 KL is only 30 minutes away; the default minimum is 60.
    expect(() => resolveSchedule('2026-03-10', '10:00', 30, settings, now)).toThrow(/in advance/i);
  });
});

describe('rollback safety', () => {
  it('leaves no visitor behind when the appointment write fails', async () => {
    const input = buildInput({ visitTypeId: 'does-not-exist' });

    await expect(createAppointmentRequest(input, APP_URL)).rejects.toThrow();

    expect(await testDb.visitor.count()).toBe(0);
    expect(await testDb.appointment.count()).toBe(0);
    expect(await testDb.notification.count()).toBe(0);
  });
});

describe('audit', () => {
  it('AT-024: records creation with safe metadata only', async () => {
    const result = await createAppointmentRequest(buildInput(), APP_URL);

    const entries = await testDb.auditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('appointment.created');

    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain('880101145523');
    expect(serialized).not.toContain(result.rawToken);
  });
});

// Referenced so the unused-import lint rule stays honest about the helper.
void createTestVisitor;

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentStatus, Role, VisitStatus } from '@prisma/client';
import {
  nextSchoolSlot,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import { createAppointmentRequest } from '@/lib/domain/appointments';
import {
  approveAppointment,
  cancelAppointmentByToken,
  DecisionError,
  rejectAppointment,
} from '@/lib/domain/decisions';
import { deriveFallbackCode, hashFallbackCode, hashToken } from '@/lib/crypto/tokens';
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

async function createPendingRequest(overrides: Partial<AppointmentRequestInput> = {}) {
  const slot = nextSchoolSlot();
  const input = {
    fullName: 'Nurul Huda binti Ismail',
    email: 'nurul.huda@contoh.test',
    phone: '012-345 6789',
    identityType: 'NRIC',
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
    ...overrides,
  } as AppointmentRequestInput;

  const result = await createAppointmentRequest(input, APP_URL);
  const appointment = await testDb.appointment.findUniqueOrThrow({
    where: { referenceNumber: result.referenceNumber },
  });

  await testDb.notification.deleteMany(); // isolate decision-time notifications
  return { appointment, rawToken: result.rawToken };
}

describe('AT-006: teacher approves a request', () => {
  it('creates exactly one visit and one active credential in a single transaction', async () => {
    const { appointment } = await createPendingRequest();

    const result = await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      note: 'Please wait at the general office.',
      appUrl: APP_URL,
    });

    expect(result.alreadyApproved).toBe(false);

    const updated = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { visit: true, credentials: true },
    });

    expect(updated.status).toBe(AppointmentStatus.APPROVED);
    expect(updated.decidedById).toBe(fixtures.teacher.id);
    expect(updated.decisionNote).toBe('Please wait at the general office.');

    expect(await testDb.visit.count({ where: { appointmentId: appointment.id } })).toBe(1);
    expect(updated.visit?.status).toBe(VisitStatus.EXPECTED);
    expect(updated.visit?.badgeNumber).toMatch(/^V-\d{6}-\d{4}$/);

    const active = updated.credentials.filter((c) => c.revokedAt === null);
    expect(active).toHaveLength(1);

    // The pass window brackets the appointment by the configured grace period.
    expect(active[0]?.validFrom.getTime()).toBe(updated.scheduledStart.getTime() - 30 * 60_000);
    expect(active[0]?.expiresAt.getTime()).toBe(updated.scheduledEnd.getTime() + 30 * 60_000);

    const audit = await testDb.auditLog.findMany({ where: { action: 'appointment.approved' } });
    expect(audit).toHaveLength(1);

    const notifications = await testDb.notification.findMany();
    expect(notifications.map((n) => n.type)).toEqual(['visitor.approved']);
  });

  it('rotates the private token so the pre-approval link stops working', async () => {
    const { appointment, rawToken } = await createPendingRequest();
    const originalHash = appointment.publicTokenHash;

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    const updated = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });

    expect(updated.publicTokenHash).not.toBe(originalHash);
    expect(updated.publicTokenHash).not.toBe(hashToken(rawToken));

    // The old link now resolves to nothing.
    expect(
      await testDb.appointment.findUnique({ where: { publicTokenHash: originalHash } }),
    ).toBeNull();
  });

  it('issues a fallback code that matches what the visitor page will derive', async () => {
    const { appointment } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    const updated = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { credentials: { where: { revokedAt: null } } },
    });

    const credential = updated.credentials[0];
    const derived = deriveFallbackCode(updated.publicTokenHash);

    expect(credential?.fallbackCodeHash).toBe(hashFallbackCode(derived));
    expect(derived).toHaveLength(8);
    // The stored value is a hash, never the code itself.
    expect(credential?.fallbackCodeHash).not.toBe(derived);
  });

  it('AT-012: is idempotent - repeating it duplicates nothing', async () => {
    const { appointment } = await createPendingRequest();

    const first = await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    const second = await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    expect(second.alreadyApproved).toBe(true);
    expect(second.visitId).toBe(first.visitId);
    expect(second.badgeNumber).toBe(first.badgeNumber);
    expect(second.notificationIds).toHaveLength(0);

    expect(await testDb.visit.count({ where: { appointmentId: appointment.id } })).toBe(1);
    expect(
      await testDb.qrCredential.count({ where: { appointmentId: appointment.id, revokedAt: null } }),
    ).toBe(1);
    expect(await testDb.notification.count()).toBe(1);
    expect(await testDb.auditLog.count({ where: { action: 'appointment.approved' } })).toBe(1);
  });
});

describe('AT-002: cross-teacher authorization', () => {
  it('refuses to let another teacher approve the request', async () => {
    const { appointment } = await createPendingRequest();

    await expect(
      approveAppointment({
        appointmentId: appointment.id,
        actorUserId: fixtures.otherTeacher.id,
        actorRole: Role.TEACHER,
        appUrl: APP_URL,
      }),
    ).rejects.toBeInstanceOf(DecisionError);

    const untouched = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(untouched.status).toBe(AppointmentStatus.PENDING);
    expect(await testDb.visit.count()).toBe(0);
    expect(await testDb.qrCredential.count()).toBe(0);
  });

  it('refuses to let another teacher reject the request', async () => {
    const { appointment } = await createPendingRequest();

    await expect(
      rejectAppointment({
        appointmentId: appointment.id,
        actorUserId: fixtures.otherTeacher.id,
        actorRole: Role.TEACHER,
        note: 'Not available',
      }),
    ).rejects.toBeInstanceOf(DecisionError);

    const untouched = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(untouched.status).toBe(AppointmentStatus.PENDING);
  });

  it('lets an administrator release a request held for review', async () => {
    const { appointment } = await createPendingRequest();
    await testDb.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.REVIEW_REQUIRED },
    });

    // The host teacher still cannot act on it.
    await expect(
      approveAppointment({
        appointmentId: appointment.id,
        actorUserId: fixtures.teacher.id,
        actorRole: Role.TEACHER,
        appUrl: APP_URL,
      }),
    ).rejects.toThrow(/reviewed by the school office/i);

    const result = await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.admin.id,
      actorRole: Role.ADMIN,
      appUrl: APP_URL,
    });

    expect(result.alreadyApproved).toBe(false);
  });
});

describe('AT-007: teacher rejects a request', () => {
  it('records the rejection and issues no usable pass', async () => {
    const { appointment } = await createPendingRequest();

    await rejectAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      note: 'That week is reserved for examinations.',
    });

    const updated = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { visit: true, credentials: true },
    });

    expect(updated.status).toBe(AppointmentStatus.REJECTED);
    expect(updated.decisionNote).toBe('That week is reserved for examinations.');
    expect(updated.visit).toBeNull();
    expect(updated.credentials.filter((c) => c.revokedAt === null)).toHaveLength(0);

    const notifications = await testDb.notification.findMany();
    expect(notifications.map((n) => n.type)).toEqual(['visitor.rejected']);
    expect(JSON.stringify(notifications[0]?.payload)).toContain(
      'That week is reserved for examinations.',
    );

    expect(await testDb.auditLog.count({ where: { action: 'appointment.rejected' } })).toBe(1);
  });

  it('is idempotent', async () => {
    const { appointment } = await createPendingRequest();

    await rejectAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      note: 'Unavailable that day.',
    });

    const second = await rejectAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      note: 'Unavailable that day.',
    });

    expect(second.alreadyRejected).toBe(true);
    expect(await testDb.notification.count()).toBe(1);
  });

  it('cannot reject an already approved request', async () => {
    const { appointment } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    await expect(
      rejectAppointment({
        appointmentId: appointment.id,
        actorUserId: fixtures.teacher.id,
        actorRole: Role.TEACHER,
        note: 'Changed my mind.',
      }),
    ).rejects.toThrow(/already been decided/i);
  });
});

describe('visitor cancellation by token', () => {
  it('cancels a pending request and revokes anything scannable', async () => {
    const { appointment, rawToken } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    // Approval rotated the token, so cancellation must use the current one.
    const approved = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });

    const result = await cancelAppointmentByToken({ tokenHash: approved.publicTokenHash });
    expect(result.cancelled).toBe(true);

    const updated = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { visit: true, credentials: true },
    });

    expect(updated.status).toBe(AppointmentStatus.CANCELLED);
    expect(updated.visit?.status).toBe(VisitStatus.CANCELLED);
    expect(updated.credentials.every((c) => c.revokedAt !== null)).toBe(true);

    // The superseded token is inert.
    expect(
      (await cancelAppointmentByToken({ tokenHash: hashToken(rawToken) })).cancelled,
    ).toBe(false);
  });

  it('reports no cancellation for an unknown token without disclosing anything', async () => {
    const result = await cancelAppointmentByToken({ tokenHash: hashToken('not-a-real-token') });
    expect(result.cancelled).toBe(false);
    expect(result.referenceNumber).toBeUndefined();
  });

  it('refuses to cancel a visit that is already under way', async () => {
    const { appointment } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
      appUrl: APP_URL,
    });

    const approved = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    await testDb.visit.updateMany({
      where: { appointmentId: appointment.id },
      data: { status: VisitStatus.CHECKED_IN, checkedInAt: new Date() },
    });

    const result = await cancelAppointmentByToken({ tokenHash: approved.publicTokenHash });
    expect(result.cancelled).toBe(false);

    const untouched = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(untouched.status).toBe(AppointmentStatus.APPROVED);
  });
});

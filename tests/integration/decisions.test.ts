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
  expireLapsedRequests,
  rejectAppointment,
} from '@/lib/domain/decisions';
import { lookupPassByToken } from '@/lib/domain/gate';
import { deriveFallbackCode, hashFallbackCode, hashToken } from '@/lib/crypto/tokens';
import type { AppointmentRequestInput } from '@/lib/validation/appointment';
import { AUDIT_ACTIONS } from '@/lib/constants';

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

  const result = await createAppointmentRequest(input);
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

    // Nothing is sent to the visitor: approval writes no notification at all.
    expect(await testDb.notification.count()).toBe(0);
  });

  /*
   * The visitor is shown one link, once, at submission, and nothing is ever
   * sent to them. If approval rotated the token that link would die and the
   * approved visitor would be stranded, so this pins the binding end to end:
   * the very same raw token must still open their page AND be accepted by the
   * gate scanner.
   */
  it('binds the pass to the submission token, so the saved link becomes the pass', async () => {
    const { appointment, rawToken } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
    });

    const updated = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { credentials: { where: { revokedAt: null } } },
    });

    // The link the visitor saved still opens their page...
    expect(updated.publicTokenHash).toBe(appointment.publicTokenHash);
    expect(updated.publicTokenHash).toBe(hashToken(rawToken));

    // ...and the pass it now shows is bound to that same token.
    expect(updated.credentials).toHaveLength(1);
    expect(updated.credentials[0]?.tokenHash).toBe(hashToken(rawToken));

    // The gate resolves it. The window may not be open yet, so any state but
    // NOT_FOUND proves the scanner recognises the saved link as this pass.
    const lookup = await lookupPassByToken(rawToken);
    expect(lookup.state).not.toBe('NOT_FOUND');
    expect(lookup.appointment?.referenceNumber).toBe(appointment.referenceNumber);
  });

  it('gives a pending request no scannable pass, even with the right token', async () => {
    const { rawToken } = await createPendingRequest();
    expect((await lookupPassByToken(rawToken)).state).toBe('NOT_FOUND');
  });

  it('issues a fallback code that matches what the visitor page will derive', async () => {
    const { appointment } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
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
    });

    const second = await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
    });

    expect(second.alreadyApproved).toBe(true);
    expect(second.visitId).toBe(first.visitId);
    expect(second.badgeNumber).toBe(first.badgeNumber);

    expect(await testDb.visit.count({ where: { appointmentId: appointment.id } })).toBe(1);
    expect(
      await testDb.qrCredential.count({ where: { appointmentId: appointment.id, revokedAt: null } }),
    ).toBe(1);
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
      }),
    ).rejects.toThrow(/reviewed by the school office/i);

    const result = await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.admin.id,
      actorRole: Role.ADMIN,
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

    // The visitor reads the reason on their private page, from decisionNote
    // (asserted above); nothing is sent to them.
    expect(await testDb.notification.count()).toBe(0);

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
    expect(await testDb.auditLog.count({ where: { action: 'appointment.rejected' } })).toBe(1);
  });

  it('cannot reject an already approved request', async () => {
    const { appointment } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
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
  it('cancels an approved request through the saved link and revokes anything scannable', async () => {
    const { appointment, rawToken } = await createPendingRequest();

    await approveAppointment({
      appointmentId: appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
    });

    // Approval kept the token, so the link saved at submission still cancels.
    const result = await cancelAppointmentByToken({ tokenHash: hashToken(rawToken) });
    expect(result.cancelled).toBe(true);

    const updated = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: { visit: true, credentials: true },
    });

    expect(updated.status).toBe(AppointmentStatus.CANCELLED);
    expect(updated.visit?.status).toBe(VisitStatus.CANCELLED);
    expect(updated.credentials.every((c) => c.revokedAt !== null)).toBe(true);

    // The host is told in-app, so they are not left expecting the visitor.
    const notices = await testDb.notification.findMany({ where: { type: 'host.cancelled' } });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.userId).toBe(fixtures.teacher.id);
    expect(JSON.stringify(notices[0])).not.toContain(rawToken);
  });

  it('does not tell the host about a cancelled request that was held for review', async () => {
    const { appointment, rawToken } = await createPendingRequest();
    // The host never saw a request under review, so a cancellation notice
    // would disclose that it existed.
    await testDb.appointment.update({
      where: { id: appointment.id },
      data: { status: AppointmentStatus.REVIEW_REQUIRED },
    });

    const result = await cancelAppointmentByToken({ tokenHash: hashToken(rawToken) });
    expect(result.cancelled).toBe(true);
    expect(await testDb.notification.count({ where: { type: 'host.cancelled' } })).toBe(0);
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

describe('lapsed requests expire', () => {
  /** An instant just after the request's slot has ended. */
  function afterSlot(appointment: { scheduledEnd: Date }): Date {
    return new Date(appointment.scheduledEnd.getTime() + 60_000);
  }

  it('moves an undecided request to EXPIRED once its slot has ended', async () => {
    const { appointment } = await createPendingRequest();

    const count = await expireLapsedRequests(afterSlot(appointment));

    expect(count).toBe(1);
    const updated = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe(AppointmentStatus.EXPIRED);
  });

  it('leaves a request whose slot has not ended yet', async () => {
    const { appointment } = await createPendingRequest();

    const count = await expireLapsedRequests(new Date(appointment.scheduledEnd.getTime() - 60_000));

    expect(count).toBe(0);
    const updated = await testDb.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updated.status).toBe(AppointmentStatus.PENDING);
  });

  it('never overtakes a decision, or a request held for an administrator', async () => {
    const approved = await createPendingRequest();
    await approveAppointment({
      appointmentId: approved.appointment.id,
      actorUserId: fixtures.teacher.id,
      actorRole: Role.TEACHER,
    });
    const held = await createPendingRequest({ identityNumber: '900202-10-5566' });
    await testDb.appointment.update({
      where: { id: held.appointment.id },
      data: { status: AppointmentStatus.REVIEW_REQUIRED },
    });

    const later = new Date(
      Math.max(approved.appointment.scheduledEnd.getTime(), held.appointment.scheduledEnd.getTime()) +
        60_000,
    );
    expect(await expireLapsedRequests(later)).toBe(0);

    const statuses = await testDb.appointment.findMany({
      where: { id: { in: [approved.appointment.id, held.appointment.id] } },
      select: { id: true, status: true },
    });
    const byId = new Map(statuses.map((row) => [row.id, row.status]));
    expect(byId.get(approved.appointment.id)).toBe(AppointmentStatus.APPROVED);
    expect(byId.get(held.appointment.id)).toBe(AppointmentStatus.REVIEW_REQUIRED);
  });

  it('audits the sweep once, and a repeat changes and records nothing', async () => {
    const { appointment } = await createPendingRequest();
    const now = afterSlot(appointment);

    await expireLapsedRequests(now);
    expect(await expireLapsedRequests(now)).toBe(0);

    const entries = await testDb.auditLog.findMany({
      where: { action: AUDIT_ACTIONS.APPOINTMENT_EXPIRED },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorUserId).toBeNull();
    expect(entries[0]?.metadata).toMatchObject({ affected: 1 });
  });

  it('leaves the expired request impossible to approve', async () => {
    const { appointment } = await createPendingRequest();
    await expireLapsedRequests(afterSlot(appointment));

    await expect(
      approveAppointment({
        appointmentId: appointment.id,
        actorUserId: fixtures.teacher.id,
        actorRole: Role.TEACHER,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });
});

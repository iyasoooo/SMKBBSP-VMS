import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentStatus, VisitStatus } from '@prisma/client';
import {
  createApprovedAppointment,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import { CredentialError, reissuePass, revokePass } from '@/lib/domain/credentials';
import { deriveFallbackCode, hashFallbackCode, hashToken } from '@/lib/crypto/tokens';
import { AUDIT_ACTIONS } from '@/lib/constants';

/**
 * Manual pass revocation and reissue.
 *
 * The property that matters: after either operation, the *old* token and old
 * fallback code must no longer resolve to an active credential. A revoke that
 * leaves the previous link working would be worse than no feature at all,
 * because an administrator would believe they had cut off access.
 */

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function activeCredentialCount(appointmentId: string): Promise<number> {
  return testDb.qrCredential.count({ where: { appointmentId, revokedAt: null } });
}

describe('revokePass', () => {
  it('withdraws the active pass and leaves the appointment approved', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);

    const result = await revokePass({ appointmentId, actorUserId: fixtures.admin.id });

    expect(result.revokedCount).toBe(1);
    expect(await activeCredentialCount(appointmentId)).toBe(0);

    const appointment = await testDb.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appointment.status).toBe(AppointmentStatus.APPROVED);
  });

  it('records who revoked it, and audits the action', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);
    await revokePass({ appointmentId, actorUserId: fixtures.admin.id });

    const credential = await testDb.qrCredential.findFirstOrThrow({ where: { appointmentId } });
    expect(credential.revokedById).toBe(fixtures.admin.id);
    expect(credential.revokedAt).not.toBeNull();

    const audit = await testDb.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.CREDENTIAL_REVOKED, targetId: appointmentId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(fixtures.admin.id);
  });

  it('refuses when there is no active pass', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);
    await revokePass({ appointmentId, actorUserId: fixtures.admin.id });

    await expect(
      revokePass({ appointmentId, actorUserId: fixtures.admin.id }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it('refuses once the visitor has already been checked in', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);
    await testDb.visit.updateMany({
      where: { appointmentId },
      data: { status: VisitStatus.CHECKED_IN, checkedInAt: new Date() },
    });

    await expect(revokePass({ appointmentId, actorUserId: fixtures.admin.id })).rejects.toThrow(
      /already been processed/i,
    );
    // The pass must survive the refusal.
    expect(await activeCredentialCount(appointmentId)).toBe(1);
  });

  it('rejects an unknown appointment', async () => {
    await expect(
      revokePass({ appointmentId: 'does-not-exist', actorUserId: fixtures.admin.id }),
    ).rejects.toThrow(/could not be found/i);
  });
});

describe('reissuePass', () => {
  it('rotates the token so the previous link stops resolving', async () => {
    const { appointmentId, rawToken } = await createApprovedAppointment(fixtures);
    const oldTokenHash = hashToken(rawToken);

    await reissuePass({
      appointmentId,
      actorUserId: fixtures.admin.id,
      appUrl: 'http://localhost:3000',
    });

    // The old token no longer identifies the appointment at all.
    const byOldToken = await testDb.appointment.findUnique({
      where: { publicTokenHash: oldTokenHash },
    });
    expect(byOldToken).toBeNull();

    // And it is not an active credential either.
    const oldCredential = await testDb.qrCredential.findUnique({
      where: { tokenHash: oldTokenHash },
    });
    expect(oldCredential?.revokedAt).not.toBeNull();
  });

  it('invalidates the previous manual fallback code', async () => {
    const { appointmentId, rawToken } = await createApprovedAppointment(fixtures);
    const oldCode = deriveFallbackCode(hashToken(rawToken));

    await reissuePass({
      appointmentId,
      actorUserId: fixtures.admin.id,
      appUrl: 'http://localhost:3000',
    });

    const stillActive = await testDb.qrCredential.findFirst({
      where: { appointmentId, revokedAt: null, fallbackCodeHash: hashFallbackCode(oldCode) },
    });
    expect(stillActive).toBeNull();
  });

  it('leaves exactly one active credential', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);

    await reissuePass({
      appointmentId,
      actorUserId: fixtures.admin.id,
      appUrl: 'http://localhost:3000',
    });
    await reissuePass({
      appointmentId,
      actorUserId: fixtures.admin.id,
      appUrl: 'http://localhost:3000',
    });

    expect(await activeCredentialCount(appointmentId)).toBe(1);
    expect(await testDb.qrCredential.count({ where: { appointmentId } })).toBe(3);
  });

  /*
   * Nothing can be sent to the visitor, so reissue hands the new link back to
   * the administrator. It must be the real, working link - and it must exist
   * only in that return value, never in a stored row.
   */
  it('hands back a working link and code, and stores the link nowhere', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);

    const result = await reissuePass({
      appointmentId,
      actorUserId: fixtures.admin.id,
      appUrl: 'http://localhost:3000',
    });

    const match = /^http:\/\/localhost:3000\/v\/([A-Za-z0-9_-]+)$/.exec(result.passUrl);
    expect(match).not.toBeNull();
    const newToken = match?.[1] ?? '';

    // The returned link opens this appointment, and is its active pass.
    const appointment = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { credentials: { where: { revokedAt: null } } },
    });
    expect(appointment.publicTokenHash).toBe(hashToken(newToken));
    expect(appointment.credentials[0]?.tokenHash).toBe(hashToken(newToken));

    // The returned code is the one the gate will accept.
    expect(result.fallbackCode.replace(/\W/g, '')).toBe(deriveFallbackCode(hashToken(newToken)));
    expect(appointment.credentials[0]?.fallbackCodeHash).toBe(
      hashFallbackCode(deriveFallbackCode(hashToken(newToken))),
    );

    // Nothing was sent, and neither the audit nor any notification holds it.
    expect(await testDb.notification.count()).toBe(0);
    const audit = await testDb.auditLog.findMany();
    expect(JSON.stringify(audit)).not.toContain(newToken);
  });

  it('refuses for an appointment that is not approved', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);
    await testDb.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.REJECTED },
    });

    await expect(
      reissuePass({
        appointmentId,
        actorUserId: fixtures.admin.id,
        appUrl: 'http://localhost:3000',
      }),
    ).rejects.toThrow(/only an approved appointment/i);
  });

  it('audits the reissue', async () => {
    const { appointmentId } = await createApprovedAppointment(fixtures);
    await reissuePass({
      appointmentId,
      actorUserId: fixtures.admin.id,
      appUrl: 'http://localhost:3000',
    });

    const audit = await testDb.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.CREDENTIAL_REISSUED, targetId: appointmentId },
    });
    expect(audit).not.toBeNull();
  });
});

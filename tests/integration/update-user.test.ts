import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedBaseFixtures, testDb, type BaseFixtures } from '../helpers/db';
import { AdminError, updateStaffUser } from '@/lib/domain/admin';
import { AUDIT_ACTIONS } from '@/lib/constants';

/**
 * Correcting a staff member's details.
 *
 * A school will need this: people marry, names are mistyped when an account is
 * created, and a teacher goes on leave without leaving. Before it existed the
 * only remedy was deactivating the account and making another, which strands
 * every visit already attributed to the old one.
 *
 * What the tests are really guarding is the *narrowness* of the action. An
 * edit form that quietly changed a role or an email would be a privilege
 * escalation and an identity change wearing the clothes of a typo fix.
 */

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('updateStaffUser', () => {
  it('renames the account', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Puan Aminah binti Zulkifli-Rahman',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.name).toBe('Puan Aminah binti Zulkifli-Rahman');
  });

  it('trims a name rather than storing the spacing somebody typed', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: '   Encik Tan Chee Keong   ',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.name).toBe('Encik Tan Chee Keong');
  });

  it('refuses a name too short to be one', async () => {
    await expect(
      updateStaffUser({ userId: fixtures.teacher.id, name: ' A ', adminUserId: fixtures.admin.id }),
    ).rejects.toBeInstanceOf(AdminError);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.name).toBe(fixtures.teacher.name);
  });

  it('refuses an account that does not exist', async () => {
    await expect(
      updateStaffUser({ userId: 'nope', name: 'Someone', adminUserId: fixtures.admin.id }),
    ).rejects.toBeInstanceOf(AdminError);
  });

  /*
   * The two fields an edit must never touch. Both have their own deliberate
   * routes - a role change has to revoke sessions, and an email change is a
   * change of credential - so silently accepting them here would be the bug.
   */
  it('leaves the role and the email exactly as they were', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Renamed Only',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.role).toBe(fixtures.teacher.role);
    expect(after.email).toBe(fixtures.teacher.email);
    expect(after.isActive).toBe(true);
  });

  it('does not sign the person out', async () => {
    const session = await testDb.session.create({
      data: {
        userId: fixtures.teacher.id,
        tokenHash: 'hash-for-update-test',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Still Signed In',
      adminUserId: fixtures.admin.id,
    });

    // None of these fields changes who they are or what they may do, so
    // ending every session over a spelling correction would be gratuitous.
    const after = await testDb.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).toBeNull();
  });
});

describe('host profile fields', () => {
  it('updates the department', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: fixtures.teacher.name,
      department: 'Bimbingan dan Kaunseling',
      adminUserId: fixtures.admin.id,
    });

    const profile = await testDb.teacherProfile.findFirstOrThrow({
      where: { userId: fixtures.teacher.id },
    });
    expect(profile.department).toBe('Bimbingan dan Kaunseling');
  });

  /*
   * The difference between "on leave" and "gone". Unticking takes them off the
   * public request form while the account, its history and its sessions all
   * stay exactly as they are.
   */
  it('can stop a host being offered to visitors without disabling them', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: fixtures.teacher.name,
      isAcceptingVisits: false,
      adminUserId: fixtures.admin.id,
    });

    const profile = await testDb.teacherProfile.findFirstOrThrow({
      where: { userId: fixtures.teacher.id },
    });
    const user = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });

    expect(profile.isAcceptingVisits).toBe(false);
    expect(user.isActive).toBe(true);
  });

  it('leaves the profile alone when no profile field is supplied', async () => {
    const before = await testDb.teacherProfile.findFirstOrThrow({
      where: { userId: fixtures.teacher.id },
    });

    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Name Only',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.teacherProfile.findFirstOrThrow({
      where: { userId: fixtures.teacher.id },
    });
    expect(after.department).toBe(before.department);
    expect(after.isAcceptingVisits).toBe(before.isAcceptingVisits);
  });

  it('does not invent a profile for an account that never had one', async () => {
    await updateStaffUser({
      userId: fixtures.guard.id,
      name: 'Nazri bin Baba (Pengawal)',
      department: 'Should be ignored',
      isAcceptingVisits: false,
      adminUserId: fixtures.admin.id,
    });

    const profile = await testDb.teacherProfile.findFirst({
      where: { userId: fixtures.guard.id },
    });
    expect(profile).toBeNull();

    const guard = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.guard.id } });
    expect(guard.name).toBe('Nazri bin Baba (Pengawal)');
  });
});

describe('the audit entry', () => {
  /*
   * A rename is the one edit that makes history hard to read: a visit checked
   * in under one name and reported under another cannot be reconciled unless
   * the change itself was recorded. So both names are kept.
   */
  it('records who changed what, including the previous name', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Puan Aminah binti Rahman',
      adminUserId: fixtures.admin.id,
    });

    const entry = await testDb.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.USER_UPDATED },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry.targetId).toBe(fixtures.teacher.id);
    expect(entry.actorUserId).toBe(fixtures.admin.id);
    expect(entry.metadata).toMatchObject({
      previousName: fixtures.teacher.name,
      newName: 'Puan Aminah binti Rahman',
    });
  });

  it('writes nothing when the change is refused', async () => {
    await expect(
      updateStaffUser({ userId: fixtures.teacher.id, name: 'x', adminUserId: fixtures.admin.id }),
    ).rejects.toBeInstanceOf(AdminError);

    const entries = await testDb.auditLog.count({
      where: { action: AUDIT_ACTIONS.USER_UPDATED },
    });
    expect(entries).toBe(0);
  });
});

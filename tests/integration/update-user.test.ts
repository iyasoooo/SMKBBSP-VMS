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
 * What the tests are really guarding is the *narrowness* of the action. The
 * role stays out of it entirely - an edit form that quietly granted ADMIN
 * would be a privilege escalation wearing the clothes of a typo fix. The email
 * is in, because an account renamed to a different person needs its address to
 * follow, but it is treated as the credential it is: changing it ends every
 * session for that account.
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
   * The role is never editable here, and the email is only touched when one is
   * supplied. Both matter: a silent role change is an escalation, and a silent
   * address change would move somebody's sign-in without telling them.
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

/**
 * The email is the credential, which is why it is treated apart from the rest.
 *
 * It was deliberately excluded at first, on the grounds that changing it is a
 * change of identity rather than of detail. Practice disagreed: renaming a
 * seeded account to a real member of staff leaves the previous holder's
 * address on it, so the directory and the sign-in no longer agree and nothing
 * says so.
 */
describe('changing the email', () => {
  it('updates the address somebody signs in with', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Cheong Kai Tian',
      email: 'cheong.kaitian@smkbbsp.test',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.email).toBe('cheong.kaitian@smkbbsp.test');
    expect(after.name).toBe('Cheong Kai Tian');
  });

  it('lower-cases and trims, so the address cannot be entered two ways', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: fixtures.teacher.name,
      email: '  Cheong.KaiTian@SMKBBSP.test  ',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.email).toBe('cheong.kaitian@smkbbsp.test');
  });

  it('refuses an address another account already uses', async () => {
    await expect(
      updateStaffUser({
        userId: fixtures.teacher.id,
        name: fixtures.teacher.name,
        email: fixtures.otherTeacher.email,
        adminUserId: fixtures.admin.id,
      }),
    ).rejects.toBeInstanceOf(AdminError);

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.email).toBe(fixtures.teacher.email);
  });

  it('accepts the account keeping its own address', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Renamed, same address',
      email: fixtures.teacher.email,
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: fixtures.teacher.id } });
    expect(after.name).toBe('Renamed, same address');
  });

  it('refuses something that is not an address', async () => {
    await expect(
      updateStaffUser({
        userId: fixtures.teacher.id,
        name: fixtures.teacher.name,
        email: 'not-an-address',
        adminUserId: fixtures.admin.id,
      }),
    ).rejects.toBeInstanceOf(AdminError);
  });

  /*
   * The reason this differs from a rename. Changing the address usually means
   * the account has changed hands, and leaving the previous holder signed in
   * would hand them the new person's access for up to twelve hours.
   */
  it('signs every session out when the address changes', async () => {
    const session = await testDb.session.create({
      data: {
        userId: fixtures.teacher.id,
        tokenHash: 'hash-for-email-change',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Cheong Kai Tian',
      email: 'cheong.kaitian@smkbbsp.test',
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).not.toBeNull();
  });

  it('leaves sessions alone when the address is unchanged', async () => {
    const session = await testDb.session.create({
      data: {
        userId: fixtures.teacher.id,
        tokenHash: 'hash-for-unchanged-email',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Just a rename',
      email: fixtures.teacher.email,
      adminUserId: fixtures.admin.id,
    });

    const after = await testDb.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).toBeNull();
  });

  it('records both addresses in the audit entry', async () => {
    await updateStaffUser({
      userId: fixtures.teacher.id,
      name: 'Cheong Kai Tian',
      email: 'cheong.kaitian@smkbbsp.test',
      adminUserId: fixtures.admin.id,
    });

    const entry = await testDb.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.USER_UPDATED },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry.metadata).toMatchObject({
      previousEmail: fixtures.teacher.email,
      newEmail: 'cheong.kaitian@smkbbsp.test',
    });
  });
});

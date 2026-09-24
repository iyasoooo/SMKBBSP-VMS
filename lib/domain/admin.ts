import {
  AppointmentStatus,
  type BlacklistCategory,
  BlacklistStatus,
  type MatchPolicy,
  Role,
  VisitStatus,
  type IdentityType,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { decryptIdentity, computeIdentityHmac, normalizeIdentity } from '@/lib/crypto/identity';
import { hashPassword } from '@/lib/crypto/password';
import { normalizeEmail, normalizePhone } from '@/lib/domain/contact';
import { revokeAllSessionsForUser } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';

/**
 * Administrator services.
 *
 * Each function encapsulates a rule the UI must not be trusted to enforce:
 * the last-admin protection, session revocation on deactivation, and the
 * audited identity reveal all live here rather than in a page component.
 */

export class AdminError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

// ---------------------------------------------------------------------------
// Audited identity reveal
// ---------------------------------------------------------------------------

/**
 * Decrypt and return a visitor's full identity number.
 *
 * This is the only path in the application that produces a plaintext identity.
 * It is admin-only, requires an explicit reason, and writes the audit entry
 * *before* returning the value, so a reveal cannot happen without a record of
 * it even if the response never reaches the browser.
 */
export async function revealIdentity(options: {
  visitorId: string;
  adminUserId: string;
  reason: string;
}): Promise<{ fullValue: string; identityType: IdentityType }> {
  if (options.reason.trim().length < 5) {
    throw new AdminError('REASON_REQUIRED', 'Give a reason for viewing this identity number.');
  }

  const visitor = await prisma.visitor.findUnique({
    where: { id: options.visitorId },
    select: {
      identityType: true,
      identityCiphertext: true,
      identityIv: true,
      identityTag: true,
      identityKeyVersion: true,
    },
  });

  if (!visitor) throw new AdminError('NOT_FOUND', 'That visitor could not be found.');

  // Audit first: the record of the attempt must survive a later failure.
  await recordAudit({
    action: AUDIT_ACTIONS.IDENTITY_REVEALED,
    targetType: 'Visitor',
    targetId: options.visitorId,
    actorUserId: options.adminUserId,
    // `reason` is a forbidden key in the audit sanitiser and is redacted; the
    // justification text is captured separately below as `justification`.
    metadata: { justification: options.reason.slice(0, 200) },
  });

  const fullValue = decryptIdentity({
    ciphertext: visitor.identityCiphertext,
    iv: visitor.identityIv,
    tag: visitor.identityTag,
    keyVersion: visitor.identityKeyVersion,
  });

  return { fullValue, identityType: visitor.identityType };
}

// ---------------------------------------------------------------------------
// Blacklist administration
// ---------------------------------------------------------------------------

export interface BlacklistInput {
  displayName: string;
  identityType?: IdentityType;
  identityNumber?: string;
  phone?: string;
  email?: string;
  matchPolicy: MatchPolicy;
  category: BlacklistCategory;
  reason: string;
  validFrom?: Date;
  validUntil?: Date | null;
}

export async function createBlacklistEntry(
  input: BlacklistInput,
  adminUserId: string,
): Promise<string> {
  const identityHmac =
    input.identityType && input.identityNumber
      ? computeIdentityHmac(
          input.identityType,
          normalizeIdentity(input.identityType, input.identityNumber),
        )
      : null;

  const matchPhone = normalizePhone(input.phone ?? null);
  const matchEmail = normalizeEmail(input.email ?? null);

  // A name-only entry can never match anything, so it is rejected outright
  // rather than being stored as a rule that silently does nothing.
  if (!identityHmac && !matchPhone && !matchEmail) {
    throw new AdminError(
      'NO_MATCH_VALUE',
      'Provide at least an identity number, phone number or email address. A name alone is never matched.',
    );
  }

  const entry = await prisma.blacklistEntry.create({
    data: {
      status: BlacklistStatus.ACTIVE,
      displayName: input.displayName,
      identityHmac,
      matchPhone,
      matchEmail,
      matchPolicy: input.matchPolicy,
      category: input.category,
      reason: input.reason,
      // Set from the application clock so an entry is effective immediately,
      // rather than depending on the database clock being in step.
      validFrom: input.validFrom ?? new Date(),
      validUntil: input.validUntil ?? null,
      createdById: adminUserId,
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.BLACKLIST_CREATED,
    targetType: 'BlacklistEntry',
    targetId: entry.id,
    actorUserId: adminUserId,
    metadata: {
      matchPolicy: input.matchPolicy,
      category: input.category,
      hasIdentity: Boolean(identityHmac),
      hasPhone: Boolean(matchPhone),
      hasEmail: Boolean(matchEmail),
    },
  });

  return entry.id;
}

export async function setBlacklistStatus(options: {
  entryId: string;
  status: BlacklistStatus;
  adminUserId: string;
  reviewNote?: string;
}): Promise<void> {
  const entry = await prisma.blacklistEntry.findUnique({ where: { id: options.entryId } });
  if (!entry) throw new AdminError('NOT_FOUND', 'That entry could not be found.');

  await prisma.blacklistEntry.update({
    where: { id: options.entryId },
    data: {
      status: options.status,
      reviewedById: options.adminUserId,
      reviewedAt: new Date(),
      reviewNote: options.reviewNote ?? entry.reviewNote,
    },
  });

  await recordAudit({
    action:
      options.status === BlacklistStatus.ACTIVE
        ? AUDIT_ACTIONS.BLACKLIST_UPDATED
        : AUDIT_ACTIONS.BLACKLIST_DEACTIVATED,
    targetType: 'BlacklistEntry',
    targetId: options.entryId,
    actorUserId: options.adminUserId,
    metadata: { from: entry.status, to: options.status },
  });
}

// ---------------------------------------------------------------------------
// Appointment review resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a request that a blacklist rule put on hold, either releasing it to
 * the host teacher or rejecting it outright.
 */
export async function resolveReview(options: {
  appointmentId: string;
  adminUserId: string;
  outcome: 'RELEASE' | 'REJECT';
  note?: string;
}): Promise<void> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: options.appointmentId },
  });

  if (!appointment) throw new AdminError('NOT_FOUND', 'That request could not be found.');
  if (appointment.status !== AppointmentStatus.REVIEW_REQUIRED) {
    throw new AdminError('WRONG_STATE', 'This request is not awaiting review.');
  }

  await prisma.appointment.update({
    where: { id: options.appointmentId },
    data:
      options.outcome === 'RELEASE'
        ? { status: AppointmentStatus.PENDING }
        : {
            status: AppointmentStatus.REJECTED,
            decisionNote: options.note ?? 'The school is unable to accommodate this visit.',
            decidedAt: new Date(),
            decidedById: options.adminUserId,
          },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.APPOINTMENT_REVIEW_RESOLVED,
    targetType: 'Appointment',
    targetId: options.appointmentId,
    actorUserId: options.adminUserId,
    metadata: { outcome: options.outcome, reference: appointment.referenceNumber },
  });
}

// ---------------------------------------------------------------------------
// Staff administration
// ---------------------------------------------------------------------------

async function countOtherActiveAdmins(excludeUserId: string): Promise<number> {
  return prisma.user.count({
    where: { role: Role.ADMIN, isActive: true, id: { not: excludeUserId } },
  });
}

/**
 * Activate or deactivate a staff account.
 *
 * Deactivation revokes every live session immediately, so the change takes
 * effect on the user's next request rather than whenever their session
 * happens to expire.
 *
 * The last active administrator cannot be deactivated: doing so would lock
 * everyone out of user management with no recovery path in the application.
 */
export async function setUserActive(options: {
  userId: string;
  isActive: boolean;
  adminUserId: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: options.userId } });
  if (!user) throw new AdminError('NOT_FOUND', 'That account could not be found.');

  if (!options.isActive && user.role === Role.ADMIN) {
    if ((await countOtherActiveAdmins(user.id)) === 0) {
      throw new AdminError(
        'LAST_ADMIN',
        'This is the last active administrator. Create or reactivate another administrator first.',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: options.userId }, data: { isActive: options.isActive } });

    if (!options.isActive) {
      await revokeAllSessionsForUser(options.userId, tx);
    }

    await recordAudit(
      {
        action: options.isActive ? AUDIT_ACTIONS.USER_REACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
        targetType: 'User',
        targetId: options.userId,
        actorUserId: options.adminUserId,
        metadata: { role: user.role },
      },
      tx,
    );
  });
}

/**
 * Reset a staff password.
 *
 * `passwordChangedAt` is advanced in the same transaction, which invalidates
 * every session issued before now even if a row somehow escapes revocation.
 */
export async function resetUserPassword(options: {
  userId: string;
  newPassword: string;
  adminUserId: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: options.userId } });
  if (!user) throw new AdminError('NOT_FOUND', 'That account could not be found.');

  const passwordHash = await hashPassword(options.newPassword);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: options.userId },
      data: { passwordHash, passwordChangedAt: now },
    });

    await revokeAllSessionsForUser(options.userId, tx);

    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
        targetType: 'User',
        targetId: options.userId,
        actorUserId: options.adminUserId,
        metadata: { role: user.role },
      },
      tx,
    );
  });
}

/**
 * Correct a staff member's details.
 *
 * Deliberately narrow. A name is a spelling correction and a marriage, and a
 * school will need both; a department and whether somebody is taking visitors
 * are the two facts that change while a person stays the same person.
 *
 * Three things are excluded on purpose, and each belongs in its own action
 * rather than hidden inside an edit form:
 *
 *   - The **email** is the credential someone signs in with. Changing it is a
 *     change of identity, not of detail, and it needs a deliberate flow.
 *   - The **role** is a privilege change. It has to revoke sessions so nobody
 *     keeps acting under the authority they just lost, and an edit form that
 *     quietly grants ADMIN is exactly the control this codebase avoids.
 *   - **Active or not** already has `setUserActive`, which knows to refuse the
 *     last administrator and to revoke sessions.
 *
 * Nothing here touches a session: none of these fields changes who the person
 * is or what they may do, so signing everybody out would be noise.
 */
export async function updateStaffUser(options: {
  userId: string;
  name: string;
  email?: string;
  department?: string;
  isAcceptingVisits?: boolean;
  adminUserId: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: options.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      teacherProfile: { select: { id: true } },
    },
  });
  if (!user) throw new AdminError('NOT_FOUND', 'That account could not be found.');

  const name = options.name.trim();
  if (name.length < 2) throw new AdminError('INVALID', 'Enter a name.');

  /*
   * The email is the credential, so it is handled separately from the rest.
   *
   * It was left out of this action at first on the grounds that changing it is
   * a change of identity rather than of detail. That is still true - which is
   * exactly why it belongs here rather than nowhere. An account whose name has
   * been changed to a different person is *already* a different identity, and
   * leaving the previous holder's address on it is the worse outcome: they
   * remain the one who can be found in the directory, and nothing warns
   * anybody that the two no longer agree.
   */
  const email = options.email === undefined ? null : normalizeEmail(options.email);
  if (options.email !== undefined) {
    if (!email || !email.includes('@')) {
      throw new AdminError('INVALID', 'Enter a valid email address.');
    }

    // The column is unique, so a clash would surface as a database error with
    // nothing useful to show an administrator. Caught here instead.
    const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (clash && clash.id !== user.id) {
      throw new AdminError('DUPLICATE', 'Another account already uses that email address.');
    }
  }

  const emailChanged = email !== null && email !== user.email;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { name, ...(emailChanged ? { email } : {}) },
    });

    /*
     * A changed address ends every session for the account.
     *
     * Not because the privileges changed - they have not - but because the
     * reason to change one is usually that the account now belongs to somebody
     * else. Leaving the previous holder signed in would hand the new person's
     * access to the old one, silently, for up to twelve hours.
     */
    if (emailChanged) {
      await revokeAllSessionsForUser(user.id, tx);
    }

    /*
     * The profile fields only exist for a host, and only when one was created.
     * An account whose role never had a profile is left alone rather than
     * having one invented for it.
     */
    if (user.teacherProfile) {
      const profile: { department?: string; isAcceptingVisits?: boolean } = {};
      if (options.department !== undefined) profile.department = options.department.trim() || 'General';
      if (options.isAcceptingVisits !== undefined) {
        profile.isAcceptingVisits = options.isAcceptingVisits;
      }

      if (Object.keys(profile).length > 0) {
        await tx.teacherProfile.update({ where: { id: user.teacherProfile.id }, data: profile });
      }
    }

    /*
     * The previous name is recorded because that is the whole value of auditing
     * a rename: a visit checked in by one name and reported under another is
     * otherwise impossible to reconcile. Only names - never a password, and
     * never anything the redactor would strip.
     */
    await recordAudit(
      {
        action: AUDIT_ACTIONS.USER_UPDATED,
        targetType: 'User',
        targetId: user.id,
        actorUserId: options.adminUserId,
        metadata: {
          role: user.role,
          previousName: user.name,
          newName: name,
          // Recorded for the same reason the names are: an account that
          // changes hands has to be traceable across the change.
          ...(emailChanged ? { previousEmail: user.email, newEmail: email } : {}),
          ...(options.isAcceptingVisits === undefined
            ? {}
            : { isAcceptingVisits: options.isAcceptingVisits }),
        },
      },
      tx,
    );
  });
}

export async function createStaffUser(options: {
  email: string;
  name: string;
  role: Role;
  password: string;
  department?: string;
  staffCode?: string;
  adminUserId: string;
}): Promise<string> {
  const email = normalizeEmail(options.email);
  if (!email) throw new AdminError('INVALID', 'Enter a valid email address.');

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AdminError('DUPLICATE', 'An account with that email already exists.');

  const passwordHash = await hashPassword(options.password);

  const user = await prisma.user.create({
    data: {
      email,
      name: options.name,
      role: options.role,
      passwordHash,
      ...(options.role === Role.TEACHER
        ? {
            teacherProfile: {
              create: {
                staffCode: options.staffCode?.trim() || `STAFF-${Date.now()}`,
                department: options.department?.trim() || 'General',
                isAcceptingVisits: true,
              },
            },
          }
        : {}),
    },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    targetType: 'User',
    targetId: user.id,
    actorUserId: options.adminUserId,
    metadata: { role: options.role },
  });

  return user.id;
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

/**
 * Mark past expected visits as no-shows.
 *
 * Only visits whose window closed more than an hour ago are touched, so a
 * visitor who is merely running late is never written off while they are still
 * walking up to the gate.
 */
export async function markPastVisitsAsNoShow(
  adminUserId: string,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - 60 * 60_000);

  const { count } = await prisma.visit.updateMany({
    where: { status: VisitStatus.EXPECTED, expectedEnd: { lt: cutoff } },
    data: { status: VisitStatus.NO_SHOW },
  });

  if (count > 0) {
    await recordAudit({
      action: AUDIT_ACTIONS.VISIT_NO_SHOW,
      targetType: 'Visit',
      actorUserId: adminUserId,
      metadata: { affected: count, cutoff: cutoff.toISOString() },
    });
  }

  return count;
}

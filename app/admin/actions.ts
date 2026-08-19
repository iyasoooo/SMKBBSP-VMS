'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { BlacklistCategory, BlacklistStatus, IdentityType, MatchPolicy, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { authorizeMutation, AuthorizationError } from '@/lib/auth/authorize';
import {
  AdminError,
  createBlacklistEntry,
  createStaffUser,
  markPastVisitsAsNoShow,
  resetUserPassword,
  resolveReview,
  revealIdentity,
  setBlacklistStatus,
  setUserActive,
} from '@/lib/domain/admin';
import { approveAppointment, DecisionError } from '@/lib/domain/decisions';
import { CredentialError, reissuePass, revokePass } from '@/lib/domain/credentials';
import {
  SETTING_DEFINITIONS,
  validateSettingValue,
  type SettingKey,
} from '@/lib/domain/settings';
import { retryNotification } from '@/lib/email/outbox';
import { flushNotificationsInBackground } from '@/lib/email/outbox';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS, PASSWORD_MIN_LENGTH_HINT } from '@/lib/constants';
import { getEnv } from '@/lib/env';
import { fail, ok, toFieldErrors, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';

const log = createLogger('admin');

async function admin() {
  return authorizeMutation(Role.ADMIN);
}

function handle(error: unknown, fallbackMessage: string): ActionResult<never> {
  if (error instanceof AuthorizationError) return fail(error.message);
  if (error instanceof AdminError) return fail(error.message, { code: error.code });
  if (error instanceof DecisionError) return fail(error.message, { code: error.code });
  if (error instanceof CredentialError) return fail(error.message, { code: error.code });
  log.error('action failed', undefined, error);
  return fail(fallbackMessage);
}

// ---------------------------------------------------------------------------
// Identity reveal
// ---------------------------------------------------------------------------

export async function revealIdentityAction(
  _previous: ActionResult<{ fullValue: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ fullValue: string }>> {
  try {
    const user = await admin();
    const visitorId = String(formData.get('visitorId') ?? '');
    const reason = String(formData.get('reason') ?? '');

    const result = await revealIdentity({ visitorId, adminUserId: user.id, reason });
    return ok({ fullValue: result.fullValue });
  } catch (error) {
    return handle(error, 'The identity could not be revealed.');
  }
}

// ---------------------------------------------------------------------------
// Blacklist
// ---------------------------------------------------------------------------

const blacklistSchema = z
  .object({
    displayName: z.string().trim().min(2, 'Enter a name for this entry.').max(120),
    identityType: z.enum(['NRIC', 'PASSPORT', 'DRIVING_LICENCE', 'OTHER']).optional(),
    identityNumber: z.string().trim().max(30).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(254).optional(),
    matchPolicy: z.enum(['BLOCK', 'REVIEW']),
    category: z.enum([
      'SECURITY_INCIDENT',
      'TRESPASS',
      'HARASSMENT',
      'COURT_ORDER',
      'CUSTODY_DISPUTE',
      'OTHER',
    ]),
    reason: z.string().trim().min(10, 'Record a clear internal reason.').max(1000),
    validUntil: z.string().trim().optional(),
  })
  .refine(
    (data) =>
      Boolean(data.identityNumber?.trim() || data.phone?.trim() || data.email?.trim()),
    {
      path: ['identityNumber'],
      message: 'Provide an identity number, phone or email. A name alone never matches.',
    },
  );

export async function createBlacklistAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();

    const parsed = blacklistSchema.safeParse({
      displayName: formData.get('displayName'),
      identityType: formData.get('identityType') || undefined,
      identityNumber: formData.get('identityNumber') || undefined,
      phone: formData.get('phone') || undefined,
      email: formData.get('email') || undefined,
      matchPolicy: formData.get('matchPolicy'),
      category: formData.get('category'),
      reason: formData.get('reason'),
      validUntil: formData.get('validUntil') || undefined,
    });

    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', {
        fieldErrors: toFieldErrors(parsed.error.issues),
      });
    }

    await createBlacklistEntry(
      {
        displayName: parsed.data.displayName,
        identityType: parsed.data.identityType
          ? IdentityType[parsed.data.identityType]
          : undefined,
        identityNumber: parsed.data.identityNumber,
        phone: parsed.data.phone,
        email: parsed.data.email,
        matchPolicy: MatchPolicy[parsed.data.matchPolicy],
        category: BlacklistCategory[parsed.data.category],
        reason: parsed.data.reason,
        validUntil: parsed.data.validUntil ? new Date(`${parsed.data.validUntil}T23:59:59Z`) : null,
      },
      user.id,
    );

    revalidatePath('/admin/blacklist');
    return ok();
  } catch (error) {
    return handle(error, 'The entry could not be created.');
  }
}

export async function setBlacklistStatusAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const entryId = String(formData.get('entryId') ?? '');
    const status = String(formData.get('status') ?? '');
    const reviewNote = String(formData.get('reviewNote') ?? '').trim() || undefined;

    if (!['ACTIVE', 'INACTIVE', 'EXPIRED'].includes(status)) {
      return fail('Choose a valid status.');
    }

    await setBlacklistStatus({
      entryId,
      status: BlacklistStatus[status as keyof typeof BlacklistStatus],
      adminUserId: user.id,
      reviewNote,
    });

    revalidatePath('/admin/blacklist');
    return ok();
  } catch (error) {
    return handle(error, 'The entry could not be updated.');
  }
}

// ---------------------------------------------------------------------------
// Appointment review
// ---------------------------------------------------------------------------

export async function resolveReviewAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const appointmentId = String(formData.get('appointmentId') ?? '');
    const outcome = formData.get('outcome') === 'REJECT' ? 'REJECT' : 'RELEASE';
    const note = String(formData.get('note') ?? '').trim() || undefined;

    await resolveReview({ appointmentId, adminUserId: user.id, outcome, note });

    revalidatePath('/admin/appointments');
    return ok();
  } catch (error) {
    return handle(error, 'The review could not be resolved.');
  }
}

/** Admin override approval, used for a released request the host has not acted on. */
export async function adminApproveAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const appointmentId = String(formData.get('appointmentId') ?? '');

    const result = await approveAppointment({
      appointmentId,
      actorUserId: user.id,
      actorRole: Role.ADMIN,
      appUrl: getEnv().APP_URL,
    });

    flushNotificationsInBackground(result.notificationIds);
    revalidatePath('/admin/appointments');
    return ok();
  } catch (error) {
    return handle(error, 'The request could not be approved.');
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function setUserActiveAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const userId = String(formData.get('userId') ?? '');
    const isActive = formData.get('isActive') === 'true';

    await setUserActive({ userId, isActive, adminUserId: user.id });

    revalidatePath('/admin/users');
    return ok();
  } catch (error) {
    return handle(error, 'The account could not be updated.');
  }
}

const passwordSchema = z.object({
  userId: z.string().trim().min(1),
  newPassword: z.string().min(10, PASSWORD_MIN_LENGTH_HINT).max(200),
});

export async function resetPasswordAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();

    const parsed = passwordSchema.safeParse({
      userId: formData.get('userId'),
      newPassword: formData.get('newPassword'),
    });

    if (!parsed.success) {
      return fail('Please correct the password.', {
        fieldErrors: toFieldErrors(parsed.error.issues),
      });
    }

    await resetUserPassword({
      userId: parsed.data.userId,
      newPassword: parsed.data.newPassword,
      adminUserId: user.id,
    });

    revalidatePath('/admin/users');
    return ok();
  } catch (error) {
    return handle(error, 'The password could not be reset.');
  }
}

const createUserSchema = z.object({
  email: z.email('Enter a valid email address.'),
  name: z.string().trim().min(2, 'Enter a name.').max(120),
  role: z.enum(['ADMIN', 'GUARD', 'TEACHER', 'PRINCIPAL']),
  password: z.string().min(10, PASSWORD_MIN_LENGTH_HINT).max(200),
  department: z.string().trim().max(80).optional(),
  staffCode: z.string().trim().max(40).optional(),
});

export async function createUserAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();

    const parsed = createUserSchema.safeParse({
      email: formData.get('email'),
      name: formData.get('name'),
      role: formData.get('role'),
      password: formData.get('password'),
      department: formData.get('department') || undefined,
      staffCode: formData.get('staffCode') || undefined,
    });

    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', {
        fieldErrors: toFieldErrors(parsed.error.issues),
      });
    }

    await createStaffUser({
      ...parsed.data,
      role: Role[parsed.data.role],
      adminUserId: user.id,
    });

    revalidatePath('/admin/users');
    return ok();
  } catch (error) {
    return handle(error, 'The account could not be created.');
  }
}

// ---------------------------------------------------------------------------
// Reference data and settings
// ---------------------------------------------------------------------------

export async function updateSettingAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const key = String(formData.get('key') ?? '') as SettingKey;
    const value = String(formData.get('value') ?? '');

    if (!(key in SETTING_DEFINITIONS)) return fail('Unknown setting.');

    const problem = validateSettingValue(key, value);
    if (problem) return fail(problem, { fieldErrors: { value: problem } });

    await prisma.setting.update({ where: { key }, data: { value } });

    await recordAudit({
      action: AUDIT_ACTIONS.SETTING_UPDATED,
      targetType: 'Setting',
      targetId: key,
      actorUserId: user.id,
      metadata: { settingKey: key, newValue: value.slice(0, 100) },
    });

    revalidatePath('/admin/settings');
    return ok();
  } catch (error) {
    return handle(error, 'The setting could not be saved.');
  }
}

const destinationSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,12}$/, 'Use 2-12 uppercase letters, digits or _.'),
  nameEn: z.string().trim().min(2).max(80),
  nameMs: z.string().trim().min(2).max(80),
  instructionsEn: z.string().trim().max(300).optional(),
  instructionsMs: z.string().trim().max(300).optional(),
});

export async function createDestinationAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();

    const parsed = destinationSchema.safeParse({
      code: String(formData.get('code') ?? '').toUpperCase(),
      nameEn: formData.get('nameEn'),
      nameMs: formData.get('nameMs'),
      instructionsEn: formData.get('instructionsEn') || undefined,
      instructionsMs: formData.get('instructionsMs') || undefined,
    });

    if (!parsed.success) {
      return fail('Please correct the highlighted fields.', {
        fieldErrors: toFieldErrors(parsed.error.issues),
      });
    }

    const existing = await prisma.destination.findUnique({ where: { code: parsed.data.code } });
    if (existing) return fail('A destination with that code already exists.');

    const destination = await prisma.destination.create({ data: parsed.data });

    await recordAudit({
      action: AUDIT_ACTIONS.DESTINATION_CREATED,
      targetType: 'Destination',
      targetId: destination.id,
      actorUserId: user.id,
      metadata: { code: destination.code },
    });

    revalidatePath('/admin/destinations');
    return ok();
  } catch (error) {
    return handle(error, 'The destination could not be created.');
  }
}

export async function toggleDestinationAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const id = String(formData.get('id') ?? '');
    const isActive = formData.get('isActive') === 'true';

    await prisma.destination.update({ where: { id }, data: { isActive } });

    await recordAudit({
      action: AUDIT_ACTIONS.DESTINATION_UPDATED,
      targetType: 'Destination',
      targetId: id,
      actorUserId: user.id,
      metadata: { isActive },
    });

    revalidatePath('/admin/destinations');
    return ok();
  } catch (error) {
    return handle(error, 'The destination could not be updated.');
  }
}

export async function toggleVisitTypeAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const id = String(formData.get('id') ?? '');
    const isActive = formData.get('isActive') === 'true';

    await prisma.visitType.update({ where: { id }, data: { isActive } });

    await recordAudit({
      action: AUDIT_ACTIONS.VISIT_TYPE_UPDATED,
      targetType: 'VisitType',
      targetId: id,
      actorUserId: user.id,
      metadata: { isActive },
    });

    revalidatePath('/admin/destinations');
    return ok();
  } catch (error) {
    return handle(error, 'The visit type could not be updated.');
  }
}

// ---------------------------------------------------------------------------
// Notifications and batch jobs
// ---------------------------------------------------------------------------

export async function retryNotificationAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const notificationId = String(formData.get('notificationId') ?? '');

    const delivered = await retryNotification(notificationId);

    await recordAudit({
      action: AUDIT_ACTIONS.NOTIFICATION_RETRIED,
      targetType: 'Notification',
      targetId: notificationId,
      actorUserId: user.id,
      metadata: { delivered },
    });

    revalidatePath('/admin/notifications');
    return delivered ? ok() : fail('Delivery failed again. Check that the mail server is running.');
  } catch (error) {
    return handle(error, 'The retry could not be completed.');
  }
}

/**
 * Revoke a visitor's active pass without replacing it.
 *
 * Kept separate from reissue so the destructive half can be used on its own -
 * for a pass that was forwarded to someone else, the right response is to kill
 * it immediately and decide about a replacement afterwards.
 */
export async function revokePassAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await admin();
    const appointmentId = String(formData.get('appointmentId') ?? '');
    if (!appointmentId) return fail('That appointment could not be found.');

    await revokePass({ appointmentId, actorUserId: user.id });

    revalidatePath(`/admin/appointments/${appointmentId}`);
    revalidatePath('/admin/appointments');
    return ok();
  } catch (error) {
    return handle(error, 'The pass could not be revoked.');
  }
}

/** Retire the current pass, issue a replacement, and email the new link. */
export async function reissuePassAction(
  _previous: ActionResult<{ emailed: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ emailed: boolean }>> {
  try {
    const user = await admin();
    const appointmentId = String(formData.get('appointmentId') ?? '');
    if (!appointmentId) return fail('That appointment could not be found.');

    const result = await reissuePass({
      appointmentId,
      actorUserId: user.id,
      appUrl: getEnv().APP_URL,
    });

    flushNotificationsInBackground(result.notificationIds);

    revalidatePath(`/admin/appointments/${appointmentId}`);
    revalidatePath('/admin/appointments');
    return ok({ emailed: result.emailed });
  } catch (error) {
    return handle(error, 'A new pass could not be issued.');
  }
}

export async function markNoShowsAction(
  _previous: ActionResult<{ count: number }> | null,
): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await admin();
    const count = await markPastVisitsAsNoShow(user.id);
    revalidatePath('/admin/visits');
    return ok({ count });
  } catch (error) {
    return handle(error, 'The batch update could not be completed.');
  }
}

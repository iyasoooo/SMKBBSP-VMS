'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authorizeMutation, AuthorizationError } from '@/lib/auth/authorize';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  checkInVisit,
  checkOutVisit,
  denyVisit,
  GateError,
  lookupPassByCode,
  lookupPassByToken,
  registerWalkIn,
  type PassLookupResult,
} from '@/lib/domain/gate';
import { walkInSchema } from '@/lib/validation/appointment';
import { flushNotificationsInBackground } from '@/lib/email/outbox';
import { DENIAL_CODES } from '@/lib/constants';
import { fail, ok, toFieldErrors, type ActionResult } from '@/lib/result';

const GUARD_ROLES = [Role.GUARD, Role.ADMIN];

async function authorizeGuard() {
  return authorizeMutation(GUARD_ROLES);
}

/** Serialisable subset of the lookup result, safe to return to the client. */
export interface PassLookupPayload {
  state: PassLookupResult['state'];
  visitId?: string;
  reference?: string;
  visitorName?: string;
  identityMasked?: string;
  hostName?: string;
  destinationName?: string;
  visitTypeName?: string;
  purpose?: string;
  partySize?: number;
  badgeNumber?: string;
  blacklist?: PassLookupResult['blacklist'];
  requiresIdSighted?: boolean;
  windowStart?: string;
  windowEnd?: string;
  validFrom?: string;
}

function toPayload(result: PassLookupResult): PassLookupPayload {
  return {
    state: result.state,
    visitId: result.visit?.id,
    reference: result.appointment?.referenceNumber,
    visitorName: result.visitor?.fullName,
    identityMasked: result.visitor?.identityMasked,
    hostName: result.hostName,
    destinationName: result.destinationName,
    visitTypeName: result.visitTypeName,
    purpose: result.appointment?.purpose,
    partySize: result.appointment?.partySize,
    badgeNumber: result.visit?.badgeNumber,
    blacklist: result.blacklist,
    requiresIdSighted: result.visit?.requiresIdSighted,
    windowStart: result.appointment?.scheduledStart.toISOString(),
    windowEnd: result.appointment?.scheduledEnd.toISOString(),
    validFrom: result.validFrom?.toISOString(),
  };
}

/**
 * Resolve a scanned QR token or a typed fallback code.
 *
 * The two paths have different limits: scanning is the hot path and is allowed
 * a generous rate, while the 8-character manual code is guessable and is
 * limited tightly.
 */
export async function lookupPassAction(
  _previous: ActionResult<PassLookupPayload> | null,
  formData: FormData,
): Promise<ActionResult<PassLookupPayload>> {
  let user;
  try {
    user = await authorizeGuard();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const mode = formData.get('mode') === 'code' ? 'code' : 'token';
  const value = String(formData.get('value') ?? '').trim();

  if (value.length === 0) return fail('Enter or scan a pass first.');

  const rule = mode === 'code' ? RATE_LIMITS.fallbackCode : RATE_LIMITS.passVerify;
  const rate = await consumeRateLimit(rule, user.id);
  if (!rate.allowed) {
    return fail(`Too many attempts. Try again in ${rate.retryAfterSeconds} seconds.`, {
      code: 'RATE_LIMITED',
    });
  }

  try {
    const result = mode === 'code' ? await lookupPassByCode(value) : await lookupPassByToken(value);
    return ok(toPayload(result));
  } catch (error) {
    console.error('[guard] lookup failed', error instanceof Error ? error.message : error);
    return fail('The lookup failed. Please try again.');
  }
}

const checkInSchema = z.object({
  visitId: z.string().trim().min(1),
  idSighted: z
    .string()
    .optional()
    .transform((value) => value === 'on' || value === 'true'),
});

export async function checkInAction(
  _previous: ActionResult<{ badgeNumber: string; visitId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ badgeNumber: string; visitId: string }>> {
  let user;
  try {
    user = await authorizeGuard();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = checkInSchema.safeParse({
    visitId: formData.get('visitId'),
    idSighted: formData.get('idSighted') ?? undefined,
  });

  if (!parsed.success) return fail('That request was not understood. Please try again.');

  try {
    const result = await checkInVisit({
      visitId: parsed.data.visitId,
      guardUserId: user.id,
      idSighted: parsed.data.idSighted,
    });

    flushNotificationsInBackground(result.notificationIds);
    revalidatePath('/guard');
    revalidatePath('/guard/active');
    revalidatePath('/guard/emergency');

    return ok({ badgeNumber: result.badgeNumber, visitId: result.visitId });
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    console.error('[guard] check-in failed', error instanceof Error ? error.message : error);
    return fail('The check-in did not complete. Please try again.');
  }
}

export async function checkOutAction(
  _previous: ActionResult<{ badgeNumber: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ badgeNumber: string }>> {
  let user;
  try {
    user = await authorizeGuard();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const visitId = String(formData.get('visitId') ?? '').trim();
  if (!visitId) return fail('That request was not understood. Please try again.');

  try {
    const result = await checkOutVisit({ visitId, guardUserId: user.id });

    flushNotificationsInBackground(result.notificationIds);
    revalidatePath('/guard');
    revalidatePath('/guard/active');
    revalidatePath('/guard/emergency');

    return ok({ badgeNumber: result.badgeNumber });
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    console.error('[guard] check-out failed', error instanceof Error ? error.message : error);
    return fail('The check-out did not complete. Please try again.');
  }
}

export async function denyEntryAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  let user;
  try {
    user = await authorizeGuard();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const visitId = String(formData.get('visitId') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim().slice(0, 300);
  if (!visitId) return fail('That request was not understood. Please try again.');

  try {
    await denyVisit({
      visitId,
      guardUserId: user.id,
      denialCode: DENIAL_CODES.GUARD_DECISION,
      note: note || undefined,
    });

    revalidatePath('/guard');
    return ok();
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    console.error('[guard] deny failed', error instanceof Error ? error.message : error);
    return fail('That did not work. Please try again.');
  }
}

/**
 * Walk-in registration.
 *
 * On success this redirects straight to the badge print view, because the
 * guard's very next action is always to hand the visitor their badge.
 */
export async function walkInAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  let user;
  try {
    user = await authorizeGuard();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = walkInSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email') || undefined,
    phone: formData.get('phone'),
    identityType: formData.get('identityType'),
    identityNumber: formData.get('identityNumber'),
    visitorCategory: formData.get('visitorCategory'),
    teacherId: formData.get('teacherId'),
    visitTypeId: formData.get('visitTypeId'),
    destinationId: formData.get('destinationId') || undefined,
    purpose: formData.get('purpose'),
    partySize: formData.get('partySize'),
    expectedDurationMinutes: formData.get('expectedDurationMinutes'),
    vehicleNumber: formData.get('vehicleNumber') || undefined,
    idSighted: formData.get('idSighted') ?? undefined,
  });

  if (!parsed.success) {
    return fail('Please correct the highlighted fields.', {
      fieldErrors: toFieldErrors(parsed.error.issues),
    });
  }

  let visitId: string;

  try {
    const result = await registerWalkIn({ input: parsed.data, guardUserId: user.id });
    visitId = result.visitId;
    flushNotificationsInBackground(result.notificationIds);
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    console.error('[guard] walk-in failed', error instanceof Error ? error.message : error);
    return fail('The registration did not complete. Please try again.');
  }

  revalidatePath('/guard');
  revalidatePath('/guard/active');
  redirect(`/guard/badge/${visitId}?new=1`);
}

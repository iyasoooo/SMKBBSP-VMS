'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CheckpointKind, CheckpointMethod, Role } from '@prisma/client';
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
import { CheckpointError, recordCheckpoint } from '@/lib/domain/checkpoints';
import { buildPassUrl, renderQrDataUrl } from '@/lib/qr';
import { getEnv } from '@/lib/env';
import { walkInSchema } from '@/lib/validation/appointment';
import { DENIAL_CODES } from '@/lib/constants';
import { fail, ok, toFieldErrors, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';

const log = createLogger('guard');

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
    log.error('lookup failed', undefined, error);
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

    revalidatePath('/guard');
    revalidatePath('/guard/active');
    revalidatePath('/guard/emergency');

    return ok({ badgeNumber: result.badgeNumber, visitId: result.visitId });
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    log.error('check-in failed', undefined, error);
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

    revalidatePath('/guard');
    revalidatePath('/guard/active');
    revalidatePath('/guard/emergency');

    return ok({ badgeNumber: result.badgeNumber });
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    log.error('check-out failed', undefined, error);
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
    log.error('deny failed', undefined, error);
    return fail('That did not work. Please try again.');
  }
}

/** What the guard is shown once a walk-in is registered and checked in. */
export interface WalkInSuccess {
  visitId: string;
  badgeNumber: string;
  /**
   * The visitor's pass, rendered here rather than handed over as a token.
   *
   * There is no email and no account, so the guard's screen is the only way
   * the link can reach the visitor: they photograph this QR. Rendering it
   * server-side keeps the raw token out of the redirect URL, out of browser
   * history and out of the logs - the client only ever receives an image.
   */
  passQrDataUrl: string;
  fallbackCode: string;
}

/**
 * Walk-in registration.
 *
 * This returns rather than redirects. The visitor cannot be sent their pass,
 * so the guard has to show it to them before the screen moves on.
 */
export async function walkInAction(
  _previous: ActionResult<WalkInSuccess> | null,
  formData: FormData,
): Promise<ActionResult<WalkInSuccess>> {
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

  let success: WalkInSuccess;

  try {
    const result = await registerWalkIn({ input: parsed.data, guardUserId: user.id });
    success = {
      visitId: result.visitId,
      badgeNumber: result.badgeNumber,
      passQrDataUrl: await renderQrDataUrl(
        buildPassUrl(getEnv().APP_URL, result.passToken),
        { width: 320 },
      ),
      fallbackCode: result.fallbackCode,
    };
  } catch (error) {
    if (error instanceof GateError) return fail(error.message, { code: error.code });
    log.error('walk-in failed', undefined, error);
    return fail('The registration did not complete. Please try again.');
  }

  revalidatePath('/guard');
  revalidatePath('/guard/active');
  return ok(success);
}

const guardSightingSchema = z.object({
  visitId: z.string().min(1),
  note: z.string().trim().max(200).optional(),
});

/**
 * Guard recording that they have seen a visitor during rounds.
 *
 * Distinct from a scan because nothing was scanned: the guard recognised the
 * badge in a corridor. The method is stored so a later reading of the timeline
 * can tell a credential that was resolved from a person who was recognised,
 * rather than presenting both as the same kind of fact.
 */
export async function recordSightingAction(
  _previous: ActionResult<{ visitorName: string; deduped: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ visitorName: string; deduped: boolean }>> {
  let user;
  try {
    user = await authorizeGuard();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = guardSightingSchema.safeParse({
    visitId: formData.get('visitId'),
    note: formData.get('note') ?? undefined,
  });

  if (!parsed.success) {
    return fail('That sighting could not be recorded.', {
      fieldErrors: toFieldErrors(parsed.error.issues),
    });
  }

  const limit = await consumeRateLimit(RATE_LIMITS.checkpoint, user.id);
  if (!limit.allowed) {
    return fail('Too many confirmations at once. Please wait a moment.', { code: 'RATE_LIMITED' });
  }

  try {
    const result = await recordCheckpoint({
      visitId: parsed.data.visitId,
      actor: { id: user.id, role: user.role },
      kind: CheckpointKind.PRESENCE,
      method: CheckpointMethod.GUARD_SIGHTING,
      note: parsed.data.note || null,
    });

    revalidatePath('/guard');
    revalidatePath('/guard/active');
    revalidatePath(`/guard/visits/${parsed.data.visitId}`);

    return ok({ visitorName: result.visitorName, deduped: result.deduped });
  } catch (error) {
    if (error instanceof CheckpointError) return fail(error.message, { code: error.code });
    log.error('sighting failed', undefined, error);
    return fail('We could not record that. Please try again.');
  }
}

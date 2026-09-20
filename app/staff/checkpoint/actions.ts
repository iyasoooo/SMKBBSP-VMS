'use server';

import { revalidatePath } from 'next/cache';
import { CheckpointKind, CheckpointMethod, Role } from '@prisma/client';
import { z } from 'zod';
import { authorizeMutation, AuthorizationError } from '@/lib/auth/authorize';
import { lookupPassByCode, lookupPassByToken } from '@/lib/domain/gate';
import { CheckpointError, recordCheckpoint } from '@/lib/domain/checkpoints';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { fail, ok, toFieldErrors, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';

const log = createLogger('checkpoint');

const CHECKPOINT_ROLES = [Role.GUARD, Role.ADMIN, Role.TEACHER];

const scanSchema = z
  .object({
    token: z.string().trim().optional(),
    code: z.string().trim().optional(),
    kind: z.enum([CheckpointKind.ARRIVAL, CheckpointKind.PRESENCE, CheckpointKind.DEPARTURE]),
    destinationId: z.string().trim().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((value) => Boolean(value.token) || Boolean(value.code), {
    message: 'Scan a pass or enter its code.',
    path: ['code'],
  });

export interface CheckpointScanPayload {
  visitorName: string;
  badgeNumber: string;
  destinationName: string | null;
  kind: CheckpointKind;
  deduped: boolean;
}

/**
 * Record a sighting from a scanned pass or a typed pass code.
 *
 * The lookup result is deliberately never returned to the caller. Resolving a
 * pass yields the visitor's full detail and their blacklist state, and this
 * screen is reachable by teachers - so only the fields a confirming member of
 * staff needs to see that they confirmed the right person cross the boundary.
 */
export async function recordCheckpointScanAction(
  _previous: ActionResult<CheckpointScanPayload> | null,
  formData: FormData,
): Promise<ActionResult<CheckpointScanPayload>> {
  let user;
  try {
    user = await authorizeMutation(CHECKPOINT_ROLES);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = scanSchema.safeParse({
    token: formData.get('token') ?? undefined,
    code: formData.get('code') ?? undefined,
    kind: formData.get('kind') ?? CheckpointKind.ARRIVAL,
    destinationId: formData.get('destinationId') ?? undefined,
    note: formData.get('note') ?? undefined,
  });

  if (!parsed.success) {
    return fail('Please check the form and try again.', {
      fieldErrors: toFieldErrors(parsed.error.issues),
    });
  }

  // The scanned path is the hot one; the typed code is guessable and is
  // limited far more tightly, exactly as the gate screen does it.
  const rule = parsed.data.token ? RATE_LIMITS.passVerify : RATE_LIMITS.fallbackCode;
  const limit = await consumeRateLimit(rule, user.id);
  if (!limit.allowed) {
    return fail('Too many attempts. Please wait a moment.', { code: 'RATE_LIMITED' });
  }

  const lookup = parsed.data.token
    ? await lookupPassByToken(parsed.data.token)
    : await lookupPassByCode(parsed.data.code ?? '');

  const visitId = lookup.visit?.id;
  if (!visitId) {
    return fail('That pass was not recognised.', { code: 'NOT_FOUND' });
  }

  try {
    const result = await recordCheckpoint({
      visitId,
      actor: { id: user.id, role: user.role },
      kind: parsed.data.kind,
      method: CheckpointMethod.SCAN,
      destinationId: parsed.data.destinationId || null,
      note: parsed.data.note || null,
    });

    revalidatePath('/guard');
    revalidatePath('/guard/active');

    return ok({
      visitorName: result.visitorName,
      badgeNumber: result.badgeNumber,
      destinationName: result.destinationName,
      kind: result.kind,
      deduped: result.deduped,
    });
  } catch (error) {
    if (error instanceof CheckpointError) return fail(error.message, { code: error.code });
    log.error('checkpoint scan failed', undefined, error);
    return fail('We could not record that. Please try again.');
  }
}

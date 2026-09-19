'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth/authorize';
import { hashToken } from '@/lib/crypto/tokens';
import { cancelAppointmentByToken } from '@/lib/domain/decisions';
import { fail, ok, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';

const log = createLogger('visitor-pass');

const cancelSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

/**
 * Visitor-initiated cancellation.
 *
 * Possession of the private token is the authorisation. Every failure returns
 * the same neutral message so the form cannot be used to probe which tokens
 * exist or what state they are in.
 */
export async function cancelRequestAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  await assertSameOrigin();

  const parsed = cancelSchema.safeParse({ token: formData.get('token') });
  if (!parsed.success) {
    return fail('This request could not be cancelled.');
  }

  try {
    const result = await cancelAppointmentByToken({ tokenHash: hashToken(parsed.data.token) });

    if (!result.cancelled) {
      return fail(
        'This request can no longer be cancelled. If your visit is already under way, please speak to the guard.',
      );
    }

  } catch (error) {
    log.error('cancel failed', undefined, error);
    return fail('We could not cancel the request just now. Please try again in a moment.');
  }

  revalidatePath(`/v/${parsed.data.token}`);
  return ok();
}

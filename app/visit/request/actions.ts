'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { assertSameOrigin } from '@/lib/auth/authorize';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { appointmentRequestSchema } from '@/lib/validation/appointment';
import {
  createAppointmentRequest,
  HostUnavailableError,
  ScheduleError,
} from '@/lib/domain/appointments';
import { fail, toFieldErrors, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';
import { MAX_PARTY_SIZE } from '@/lib/constants';

const log = createLogger('visit-request');

/**
 * How long to tell a blocked visitor to wait.
 *
 * `retryAfterSeconds` has always been calculated, and `peekRateLimit` exists
 * so a countdown could be shown without costing somebody an attempt. Neither
 * was ever used here, so the form said "a few minutes" and left the visitor to
 * guess. Guessing wrong means trying again, being refused again, and deciding
 * the site is broken - which is how somebody ends up at the guard house over a
 * five minute wait.
 *
 * Rounded up to the whole minute. A visitor is not watching a clock, and a
 * countdown to the second would be precision this number does not have: the
 * window ends on a fixed boundary, so the true wait is anything up to what is
 * quoted, never more.
 */
function waitMessage(seconds: number): string {
  if (seconds <= 60) return 'Please try again in less than a minute';
  const minutes = Math.ceil(seconds / 60);
  return `Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Public appointment submission.
 *
 * On success the visitor is redirected straight to their private page,
 * `/v/<token>`. There is no email, so this redirect is the only delivery of
 * the token, and the page it lands on is the thing they are told to save.
 *
 * The token therefore does enter the browser's history, exactly as it did when
 * visitors opened the link from an email, and a reverse proxy's access log
 * would record the path just as it did then. Beyond that the application keeps
 * it out of everything it controls: no query string, log line, notification or
 * audit record contains it, and the site's `strict-origin-when-cross-origin`
 * referrer policy stops it leaking to another origin in a Referer header.
 */
export async function submitAppointmentRequest(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  await assertSameOrigin();

  const headerList = await headers();
  const ip = (headerList.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local';

  const rate = await consumeRateLimit(RATE_LIMITS.publicRequest, ip);
  if (!rate.allowed) {
    return fail(
      `Too many requests have been submitted from this connection. ${waitMessage(rate.retryAfterSeconds)}, or come to the guard house.`,
      { code: 'RATE_LIMITED' },
    );
  }

  /*
   * Companion fields arrive as `companions.0.fullName` and so on. They are
   * collected by index rather than by a fixed count so the parse does not
   * depend on `partySize` being correct - the schema cross-checks the two and
   * reports a mismatch itself.
   */
  const companions: Array<Record<string, string>> = [];
  for (const [key, value] of formData.entries()) {
    const match = /^companions\.(\d+)\.(\w+)$/.exec(key);
    if (!match || typeof value !== 'string') continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTY_SIZE) continue;
    companions[index] ??= {};
    companions[index][match[2] as string] = value;
  }

  const parsed = appointmentRequestSchema.safeParse({
    companions: companions.filter(Boolean),
    fullName: formData.get('fullName'),
    email: formData.get('email') || undefined,
    phone: formData.get('phone'),
    identityType: formData.get('identityType'),
    identityNumber: formData.get('identityNumber'),
    visitorCategory: formData.get('visitorCategory'),
    teacherId: formData.get('teacherId'),
    visitTypeId: formData.get('visitTypeId'),
    destinationId: formData.get('destinationId') || undefined,
    visitDate: formData.get('visitDate'),
    visitTime: formData.get('visitTime'),
    purpose: formData.get('purpose'),
    partySize: formData.get('partySize'),
    vehicleNumber: formData.get('vehicleNumber') || undefined,
    consent: formData.get('consent') ?? undefined,
  });

  if (!parsed.success) {
    return fail('Please correct the highlighted fields and submit again.', {
      fieldErrors: toFieldErrors(parsed.error.issues),
    });
  }

  let rawToken: string;

  try {
    const result = await createAppointmentRequest(parsed.data);
    rawToken = result.rawToken;
  } catch (error) {
    if (error instanceof ScheduleError) {
      const field =
        error.code === 'INVALID_TIME' || error.code === 'BEFORE_HOURS' || error.code === 'AFTER_HOURS'
          ? 'visitTime'
          : 'visitDate';
      return fail(error.message, { fieldErrors: { [field]: error.message } });
    }

    if (error instanceof HostUnavailableError) {
      return fail(error.message, { fieldErrors: { teacherId: error.message } });
    }

    log.error('submission failed', undefined, error);
    return fail('We could not submit your request just now. Please try again in a moment.');
  }

  // `new=1` only switches on the "request submitted, save this link" banner.
  // It carries nothing: the page works identically without it.
  redirect(`/v/${rawToken}?new=1`);
}

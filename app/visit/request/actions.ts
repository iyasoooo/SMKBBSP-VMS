'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getEnv } from '@/lib/env';
import { assertSameOrigin } from '@/lib/auth/authorize';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { appointmentRequestSchema } from '@/lib/validation/appointment';
import {
  createAppointmentRequest,
  HostUnavailableError,
  ScheduleError,
} from '@/lib/domain/appointments';
import { flushNotificationsInBackground } from '@/lib/email/outbox';
import { fail, toFieldErrors, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';

const log = createLogger('visit-request');

/**
 * Public appointment submission.
 *
 * The success redirect carries only the reference number. The private token
 * never appears in a URL, browser history, or the Referer header of any later
 * navigation - it is delivered by email alone.
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
      `Too many requests have been submitted from this connection. Please try again in a few minutes, or come to the guard house.`,
      { code: 'RATE_LIMITED' },
    );
  }

  const parsed = appointmentRequestSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
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

  let reference: string;

  try {
    const result = await createAppointmentRequest(parsed.data, getEnv().APP_URL);
    reference = result.referenceNumber;

    // Delivery happens after the transaction committed. A slow or dead SMTP
    // server must not hold up the visitor's confirmation page.
    flushNotificationsInBackground(result.notificationIds);
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

  redirect(`/visit/request/success?ref=${encodeURIComponent(reference)}`);
}

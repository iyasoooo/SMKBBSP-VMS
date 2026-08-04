'use server';

import { revalidatePath } from 'next/cache';
import { Role } from '@prisma/client';
import { authorizeMutation, AuthorizationError } from '@/lib/auth/authorize';
import { decisionSchema } from '@/lib/validation/appointment';
import { approveAppointment, DecisionError, rejectAppointment } from '@/lib/domain/decisions';
import { flushNotificationsInBackground } from '@/lib/email/outbox';
import { getEnv } from '@/lib/env';
import { fail, ok, toFieldErrors, type ActionResult } from '@/lib/result';

/**
 * Teacher decision on their own pending request.
 *
 * Authorization is applied twice on purpose: `authorizeMutation` proves the
 * caller is a signed-in teacher, and the service re-scopes the appointment
 * query by `teacherId` so a valid teacher session still cannot act on another
 * teacher's request by passing its id.
 */
export async function decideRequestAction(
  _previous: ActionResult<{ decision: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ decision: string }>> {
  let user;
  try {
    user = await authorizeMutation(Role.TEACHER);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = decisionSchema.safeParse({
    appointmentId: formData.get('appointmentId'),
    decision: formData.get('decision'),
    note: formData.get('note') ?? undefined,
  });

  if (!parsed.success) {
    return fail('Please check the form and try again.', {
      fieldErrors: toFieldErrors(parsed.error.issues),
    });
  }

  try {
    if (parsed.data.decision === 'APPROVE') {
      const result = await approveAppointment({
        appointmentId: parsed.data.appointmentId,
        actorUserId: user.id,
        actorRole: Role.TEACHER,
        note: parsed.data.note,
        appUrl: getEnv().APP_URL,
      });

      flushNotificationsInBackground(result.notificationIds);
      revalidatePath('/teacher');
      revalidatePath(`/teacher/requests/${parsed.data.appointmentId}`);

      return ok({ decision: result.alreadyApproved ? 'ALREADY_APPROVED' : 'APPROVED' });
    }

    const result = await rejectAppointment({
      appointmentId: parsed.data.appointmentId,
      actorUserId: user.id,
      actorRole: Role.TEACHER,
      note: parsed.data.note ?? 'The school is unable to accommodate this visit.',
    });

    flushNotificationsInBackground(result.notificationIds);
    revalidatePath('/teacher');
    revalidatePath(`/teacher/requests/${parsed.data.appointmentId}`);

    return ok({ decision: result.alreadyRejected ? 'ALREADY_REJECTED' : 'REJECTED' });
  } catch (error) {
    if (error instanceof DecisionError) {
      return fail(error.message, { code: error.code });
    }
    console.error('[teacher] decision failed', error instanceof Error ? error.message : error);
    return fail('We could not record that decision. Please try again.');
  }
}

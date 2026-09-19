'use server';

import { revalidatePath } from 'next/cache';
import { CheckpointKind, CheckpointMethod, Role } from '@prisma/client';
import { z } from 'zod';
import { authorizeMutation, AuthorizationError } from '@/lib/auth/authorize';
import { decisionSchema } from '@/lib/validation/appointment';
import { approveAppointment, DecisionError, rejectAppointment } from '@/lib/domain/decisions';
import { CheckpointError, recordCheckpoint } from '@/lib/domain/checkpoints';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { fail, ok, toFieldErrors, type ActionResult } from '@/lib/result';
import { createLogger } from '@/lib/logger';

const log = createLogger('teacher');

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
      });

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

    revalidatePath('/teacher');
    revalidatePath(`/teacher/requests/${parsed.data.appointmentId}`);

    return ok({ decision: result.alreadyRejected ? 'ALREADY_REJECTED' : 'REJECTED' });
  } catch (error) {
    if (error instanceof DecisionError) {
      return fail(error.message, { code: error.code });
    }
    log.error('decision failed', undefined, error);
    return fail('We could not record that decision. Please try again.');
  }
}

const confirmVisitorSchema = z.object({
  visitId: z.string().min(1),
  kind: z.enum([CheckpointKind.ARRIVAL, CheckpointKind.DEPARTURE]),
});

export interface ConfirmVisitorPayload {
  kind: CheckpointKind;
  visitorName: string;
  deduped: boolean;
}

/**
 * Host confirmation that their visitor is with them.
 *
 * Deliberately a button rather than a scan. Scanning proves a credential was
 * present, but the pass is a URL a visitor can forward, so it barely raises the
 * cost of a false claim - while it does reliably stop busy staff from recording
 * anything at all. The integrity that matters here comes from elsewhere: the
 * service only accepts a visit a guard has already checked in, so a host is
 * confirming the second leg of a journey the gate verified, never inventing a
 * presence from nothing.
 */
export async function confirmVisitorAction(
  _previous: ActionResult<ConfirmVisitorPayload> | null,
  formData: FormData,
): Promise<ActionResult<ConfirmVisitorPayload>> {
  let user;
  try {
    user = await authorizeMutation(Role.TEACHER);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    throw error;
  }

  const parsed = confirmVisitorSchema.safeParse({
    visitId: formData.get('visitId'),
    kind: formData.get('kind'),
  });

  if (!parsed.success) {
    return fail('That confirmation could not be recorded.', {
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
      kind: parsed.data.kind,
      method: CheckpointMethod.HOST_CONFIRM,
    });

    revalidatePath('/teacher');
    revalidatePath('/teacher/visits');

    return ok({
      kind: parsed.data.kind,
      visitorName: result.visitorName,
      deduped: result.deduped,
    });
  } catch (error) {
    if (error instanceof CheckpointError) return fail(error.message, { code: error.code });
    log.error('checkpoint failed', undefined, error);
    return fail('We could not record that. Please try again.');
  }
}

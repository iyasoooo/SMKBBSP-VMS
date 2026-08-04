'use server';

import { revalidatePath } from 'next/cache';
import { Role } from '@prisma/client';
import { authorizeMutation, AuthorizationError } from '@/lib/auth/authorize';
import { markAllInAppRead, markInAppRead } from '@/lib/domain/in-app-notifications';
import { fail, ok, type ActionResult } from '@/lib/result';

/**
 * Every staff role has a notification centre, so these are open to all three.
 * Ownership is enforced inside the service by scoping the update to the
 * signed-in user's id, not by trusting the notification id in the form.
 */
const STAFF: Role[] = [Role.ADMIN, Role.GUARD, Role.TEACHER];

export async function markNotificationReadAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await authorizeMutation(STAFF);
    const id = String(formData.get('notificationId') ?? '');
    if (!id) return fail('That notification could not be found.');

    await markInAppRead(user.id, id);
    revalidatePath('/notifications');
    return ok();
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    console.error('[notifications] mark read failed', error instanceof Error ? error.message : error);
    return fail('That notification could not be updated.');
  }
}

export async function markAllNotificationsReadAction(
  _previous: ActionResult<{ count: number }> | null,
): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await authorizeMutation(STAFF);
    const count = await markAllInAppRead(user.id);
    revalidatePath('/notifications');
    return ok({ count });
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    console.error('[notifications] mark all failed', error instanceof Error ? error.message : error);
    return fail('The notifications could not be updated.');
  }
}

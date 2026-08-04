'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { attemptLogin } from '@/lib/auth/login';
import { destroyCurrentSession, getCurrentUser } from '@/lib/auth/session';
import { assertSameOrigin, homeForRole } from '@/lib/auth/authorize';
import { recordAuditSafely } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';
import { fail, ok, type ActionResult } from '@/lib/result';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
  next: z.string().optional(),
});

/**
 * Only same-origin relative paths are honoured as a post-login destination,
 * so `?next=https://evil.example` cannot turn the login form into an open
 * redirect.
 */
function safeNextPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  return value;
}

export async function loginAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  await assertSameOrigin();

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    // The form only has two fields; a single generic message is clearer than
    // per-field noise and reveals nothing.
    return fail('Enter your email address and password.');
  }

  const outcome = await attemptLogin(parsed.data.email, parsed.data.password);

  if (!outcome.ok || !outcome.role) {
    return fail(outcome.message ?? 'Incorrect email or password.', { code: outcome.code });
  }

  // redirect() throws, so it must sit outside any try/catch above.
  redirect(safeNextPath(parsed.data.next) ?? homeForRole(outcome.role));
}

export async function logoutAction(): Promise<never> {
  await assertSameOrigin();

  const user = await getCurrentUser();
  if (user) {
    await recordAuditSafely({
      action: AUDIT_ACTIONS.LOGOUT,
      targetType: 'User',
      targetId: user.id,
      actorUserId: user.id,
    });
  }

  await destroyCurrentSession();
  redirect('/login');
}

/** Exported for the tests that assert an unauthenticated call is rejected. */
export async function whoAmIAction(): Promise<ActionResult<{ role: string } | null>> {
  const user = await getCurrentUser();
  return ok(user ? { role: user.role } : null);
}

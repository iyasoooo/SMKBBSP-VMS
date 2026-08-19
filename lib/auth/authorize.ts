import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Role } from '@prisma/client';
import { getCurrentUser, type SessionUser } from '@/lib/auth/session';
import { getEnv } from '@/lib/env';

/**
 * Server-side authorization.
 *
 * Every protected page and every mutation calls one of these helpers. Hiding a
 * navigation link is presentation, not access control: the checks here are the
 * only thing that actually stops a Teacher from reading an Admin page or
 * invoking a Guard action directly.
 *
 * The helpers redirect or throw *before* any protected data is fetched, so a
 * denied request cannot briefly stream protected content to the client.
 */

/** Where each role lands after login and after a wrong-area redirect. */
export const ROLE_HOME: Record<Role, string> = {
  [Role.ADMIN]: '/admin',
  [Role.GUARD]: '/guard',
  [Role.TEACHER]: '/teacher',
  // The principal reads the administrator's screens; the difference is what
  // those screens offer, not where they live.
  [Role.PRINCIPAL]: '/admin',
};

/**
 * Roles allowed to *view* the administrative screens.
 *
 * The principal belongs here and nowhere near the mutation guards. Every
 * state-changing action in the admin area asks for Role.ADMIN specifically,
 * so a principal is refused by the server even if a control were ever left on
 * screen by mistake. Hiding the buttons is presentation; this is the actual
 * boundary.
 */
export const OVERSIGHT_ROLES: Role[] = [Role.ADMIN, Role.PRINCIPAL];

/** True when this user may change things, rather than only look at them. */
export function canAdminister(role: Role): boolean {
  return role === Role.ADMIN;
}

export function homeForRole(role: Role): string {
  return ROLE_HOME[role];
}

/** Thrown by mutation guards. Server actions convert it to a safe result. */
export class AuthorizationError extends Error {
  constructor(message = 'You are not allowed to perform this action.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** Require any signed-in user; otherwise send them to login. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login';
    redirect(target);
  }
  return user;
}

/**
 * Require one of `roles`.
 *
 * A signed-in user in the wrong area is sent to their own home rather than to
 * a dead end, and never sees whether the target page exists.
 */
export async function requireRole(roles: Role | Role[], returnTo?: string): Promise<SessionUser> {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const user = await requireUser(returnTo);

  if (!allowed.includes(user.role)) {
    redirect(homeForRole(user.role));
  }

  return user;
}

export const requireAdmin = (returnTo?: string): Promise<SessionUser> =>
  requireRole(Role.ADMIN, returnTo);

/** Read access to the administrative screens: administrator or principal. */
export const requireOversight = (returnTo?: string): Promise<SessionUser> =>
  requireRole(OVERSIGHT_ROLES, returnTo);

export const requireGuard = (returnTo?: string): Promise<SessionUser> =>
  requireRole(Role.GUARD, returnTo);

export const requireTeacher = (returnTo?: string): Promise<SessionUser> =>
  requireRole(Role.TEACHER, returnTo);

/** Guards and admins both work the gate; admins retain oversight access. */
export const requireGuardOrAdmin = (returnTo?: string): Promise<SessionUser> =>
  requireRole([Role.GUARD, Role.ADMIN], returnTo);

/**
 * Mutation-side role check.
 *
 * Throws instead of redirecting, because a server action must return a
 * structured failure rather than a navigation.
 */
export async function requireRoleForMutation(roles: Role | Role[]): Promise<SessionUser> {
  const allowed = Array.isArray(roles) ? roles : [roles];
  const user = await getCurrentUser();

  if (!user) throw new AuthorizationError('Your session has ended. Please sign in again.');
  if (!allowed.includes(user.role)) throw new AuthorizationError();

  return user;
}

/**
 * Reject cross-site form submissions.
 *
 * Next.js Server Actions are POST-only with a same-origin fetch and the
 * session cookie is `sameSite=lax`, which together already block the classic
 * cross-site form attack. This adds explicit Origin verification as a second,
 * independent layer for every state-changing call, as the spec requires.
 */
export async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get('origin');

  // Same-origin navigations may omit Origin entirely; only a *mismatch* is fatal.
  if (!origin) return;

  const expected = new URL(getEnv().APP_URL).origin;
  const forwardedHost = headerList.get('x-forwarded-host') ?? headerList.get('host');

  if (origin === expected) return;
  if (forwardedHost && origin === `https://${forwardedHost}`) return;
  if (forwardedHost && origin === `http://${forwardedHost}`) return;

  throw new AuthorizationError('Request rejected: unrecognised origin.');
}

/**
 * Standard preamble for every mutating server action: verify the origin, then
 * verify the role. Ordered so a cross-site probe is rejected before it can
 * learn anything about the session.
 */
export async function authorizeMutation(roles: Role | Role[]): Promise<SessionUser> {
  await assertSameOrigin();
  return requireRoleForMutation(roles);
}

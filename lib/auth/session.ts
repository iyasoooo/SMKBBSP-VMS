import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import type { Role, User } from '@prisma/client';
import { prisma, type Db } from '@/lib/db/prisma';
import { generateToken, hashSessionToken } from '@/lib/crypto/tokens';
import { SESSION_COOKIE } from '@/lib/constants';

/**
 * Database-backed sessions.
 *
 * The cookie holds a random 256-bit token; the database stores only its keyed
 * hash. That makes every session independently revocable (an admin can kill
 * one device), bulk-revocable (deactivation or password reset), and
 * verifiable server-side on each request. No role, id, or expiry is encoded
 * in the cookie, so a client cannot alter what it is.
 */

const SESSION_TTL_HOURS = 12;

/** The subset of the user record that request handlers actually need. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  preferredLocale: string;
}

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    preferredLocale: user.preferredLocale,
  };
}

/**
 * Coarse, non-tracking request context stored beside a session so an admin can
 * tell one device from another. Deliberately lossy: the full user-agent string
 * and full IP address are never persisted.
 */
export async function describeRequestContext(): Promise<{
  userAgentLabel: string | null;
  ipPrefix: string | null;
}> {
  const headerList = await headers();

  const userAgent = headerList.get('user-agent') ?? '';
  let label: string | null = null;
  if (/tablet|ipad/i.test(userAgent)) label = 'Tablet';
  else if (/mobile|android|iphone/i.test(userAgent)) label = 'Mobile';
  else if (userAgent) label = 'Desktop';

  const forwarded = headerList.get('x-forwarded-for') ?? '';
  const rawIp = forwarded.split(',')[0]?.trim() ?? '';
  let ipPrefix: string | null = null;
  if (rawIp.includes(':')) {
    // IPv6: keep the routing prefix only.
    ipPrefix = `${rawIp.split(':').slice(0, 3).join(':')}::/48`;
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rawIp)) {
    ipPrefix = `${rawIp.split('.').slice(0, 3).join('.')}.0/24`;
  }

  return { userAgentLabel: label, ipPrefix };
}

/**
 * Whether *this request* arrived over TLS.
 *
 * Deliberately not `NODE_ENV === 'production'`. A `Secure` cookie is silently
 * discarded by the browser when the page was served over plain http, so keying
 * the flag on the build type breaks sign-in entirely for a production build
 * reached over http - a LAN address during testing, say. The symptom is a
 * login page that reappears immediately after a successful login, because the
 * session was created but its cookie was never stored.
 *
 * Same reasoning the middleware already applies to
 * `upgrade-insecure-requests`, and `next.config.ts` to HSTS: a transport
 * decision belongs to the transport, not the build.
 *
 * The forwarded header is trusted first so the flag stays correct behind a TLS
 * terminating proxy, where the request reaches Next over http by design.
 */
async function isSecureRequest(): Promise<boolean> {
  const headerList = await headers();

  const forwardedProto = headerList.get('x-forwarded-proto');
  if (forwardedProto) return forwardedProto.split(',')[0]?.trim() === 'https';

  // Set by middleware.ts, which can see the request URL scheme directly.
  return headerList.get('x-request-secure') === '1';
}

/**
 * Issue a session and set its cookie.
 *
 * Returns the raw token only so tests can assert on it; production callers
 * ignore the return value because the cookie is already set.
 */
export async function createSession(userId: string): Promise<string> {
  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  const context = await describeRequestContext();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(rawToken),
      expiresAt,
      userAgentLabel: context.userAgentLabel,
      ipPrefix: context.ipPrefix,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isSecureRequest(),
    path: '/',
    expires: expiresAt,
  });

  return rawToken;
}

/**
 * Resolve the signed-in user for the current request, or null.
 *
 * Wrapped in React's `cache` so several Server Components in one render share
 * a single database round trip.
 *
 * A session is only accepted when it is unexpired, unrevoked, belongs to an
 * active user, and was issued *after* that user's last password change. The
 * last condition is what makes a password reset invalidate existing devices
 * without having to find and delete their rows first.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(rawToken) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;
  if (session.createdAt.getTime() < session.user.passwordChangedAt.getTime()) return null;

  return toSessionUser(session.user);
});

/** Revoke the current request's session and clear its cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE)?.value;

  if (rawToken) {
    await prisma.session.updateMany({
      where: { tokenHash: hashSessionToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Revoke every active session for a user.
 * Used on deactivation, password reset, and explicit admin action.
 */
export async function revokeAllSessionsForUser(userId: string, db: Db = prisma): Promise<number> {
  const { count } = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/** Housekeeping for expired rows. Safe to call at any time. */
export async function purgeExpiredSessions(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

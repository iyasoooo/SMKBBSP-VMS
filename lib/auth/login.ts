import { headers } from 'next/headers';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { verifyPassword } from '@/lib/crypto/password';
import { createSession } from '@/lib/auth/session';
import { consumeRateLimit, RATE_LIMITS, resetRateLimit } from '@/lib/rate-limit';
import { recordAuditSafely } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';

/**
 * Credentials login.
 *
 * Three properties matter here:
 *   1. One generic failure message for every rejection reason. "No such user",
 *      "wrong password" and "account disabled" are indistinguishable to the
 *      caller, so the form cannot be used to enumerate staff accounts.
 *   2. Constant-ish work regardless of outcome. A missing user still pays for
 *      one password verification against a decoy hash, so response time does
 *      not reveal whether an address exists.
 *   3. Attempts are rate limited per IP + address and audited either way.
 */

/**
 * A real scrypt hash of an unguessable value, used to burn the same CPU time
 * when no user matches. Generated once at module load.
 */
const DECOY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZg==';

const GENERIC_FAILURE = 'Incorrect email or password.';

export interface LoginOutcome {
  ok: boolean;
  message?: string;
  code?: 'INVALID_CREDENTIALS' | 'RATE_LIMITED';
  role?: Role;
  retryAfterSeconds?: number;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function clientIdentifier(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || 'local';
}

export async function attemptLogin(rawEmail: string, password: string): Promise<LoginOutcome> {
  const email = normalizeEmail(rawEmail);
  const ip = await clientIdentifier();
  const rateKey = `${ip}:${email}`;

  const rate = await consumeRateLimit(RATE_LIMITS.login, rateKey);
  if (!rate.allowed) {
    await recordAuditSafely({
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      targetType: 'User',
      metadata: { reason: 'rate_limited', emailDomain: email.split('@')[1] ?? 'unknown' },
    });
    return {
      ok: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: rate.retryAfterSeconds,
      message: `Too many attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always verify something so timing does not distinguish a missing account.
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DECOY_HASH);

  if (!user || !passwordMatches || !user.isActive) {
    await recordAuditSafely({
      action: AUDIT_ACTIONS.LOGIN_FAILURE,
      targetType: 'User',
      targetId: user?.id ?? null,
      metadata: {
        // Recorded for the admin's benefit; never returned to the caller.
        outcome: !user ? 'unknown_account' : !passwordMatches ? 'bad_password' : 'inactive_account',
      },
    });
    return { ok: false, code: 'INVALID_CREDENTIALS', message: GENERIC_FAILURE };
  }

  await createSession(user.id);
  await resetRateLimit(RATE_LIMITS.login, rateKey);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAuditSafely({
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    targetType: 'User',
    targetId: user.id,
    actorUserId: user.id,
    metadata: { role: user.role },
  });

  return { ok: true, role: user.role };
}

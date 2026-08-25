import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';

/**
 * Fixed-window rate limiting for public and authentication endpoints.
 *
 * Backed by the database rather than process memory so the limit still holds
 * when Next.js serves requests from more than one worker. Known limitation,
 * documented in the README: a fixed window allows a burst across a boundary,
 * and a multi-instance deployment would want shared storage with atomic
 * counters (Redis) or a sliding window. For a single-instance school
 * deployment this is sufficient and has no external dependency.
 */

export interface RateLimitRule {
  /** Stable name, e.g. `login` or `public.request`. */
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  /** Staff login attempts, keyed by IP + submitted email. */
  login: { name: 'login', limit: 8, windowSeconds: 300 },
  /** Public appointment submissions, keyed by IP. */
  publicRequest: { name: 'public.request', limit: 5, windowSeconds: 900 },
  /** Private status-link reads, keyed by IP. */
  tokenLookup: { name: 'public.token', limit: 60, windowSeconds: 300 },
  /** Guard pass verification, keyed by user. Generous: this is the hot path. */
  passVerify: { name: 'guard.verify', limit: 120, windowSeconds: 60 },
  /** Manual fallback-code attempts, keyed by user. Tight: it is guessable. */
  fallbackCode: { name: 'guard.fallback', limit: 15, windowSeconds: 300 },
  /*
   * Card reads, keyed by IP.
   *
   * Tighter than it looks, and deliberately so. This is the one public endpoint
   * that costs real CPU per call - a model host answering a scan is busy for
   * seconds, not milliseconds - so an unthrottled endpoint is both a denial of
   * service against the gate and a free vision model for anyone who finds it.
   * Ten is comfortable for a visitor retaking a photo a few times and useless
   * to anyone batching images through it.
   */
  ocrScan: { name: 'public.ocr', limit: 10, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
  retryAfterSeconds: number;
}

/**
 * Identifiers are hashed before storage so the rate-limit table never becomes
 * a secondary log of IP addresses and email addresses.
 */
function bucketKey(rule: RateLimitRule, identifier: string): string {
  const digest = createHash('sha256').update(`${rule.name}:${identifier}`).digest('hex');
  return `${rule.name}:${digest.slice(0, 32)}`;
}

function windowStartFor(rule: RateLimitRule, now: Date): Date {
  const windowMs = rule.windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Count one attempt against the rule and report whether it is allowed.
 *
 * The upsert is atomic at the database level, so concurrent requests cannot
 * both read a stale count and slip past the limit together.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const bucket = bucketKey(rule, identifier);
  const windowStart = windowStartFor(rule, now);
  const resetAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);

  const counter = await prisma.rateLimitCounter.upsert({
    where: { bucket_windowStart: { bucket, windowStart } },
    create: {
      bucket,
      windowStart,
      count: 1,
      // Kept a full window beyond reset so the sweeper has a clear cutoff.
      expiresAt: new Date(resetAt.getTime() + rule.windowSeconds * 1000),
    },
    update: { count: { increment: 1 } },
  });

  const allowed = counter.count <= rule.limit;

  return {
    allowed,
    remaining: Math.max(0, rule.limit - counter.count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Read the current state without consuming an attempt. Used to render a
 * "try again in N seconds" message without penalising the user for looking.
 */
export async function peekRateLimit(
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const bucket = bucketKey(rule, identifier);
  const windowStart = windowStartFor(rule, now);
  const resetAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);

  const counter = await prisma.rateLimitCounter.findUnique({
    where: { bucket_windowStart: { bucket, windowStart } },
  });

  const count = counter?.count ?? 0;
  return {
    allowed: count < rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Clear a bucket after a successful login so one typo does not cost a window. */
export async function resetRateLimit(
  rule: RateLimitRule,
  identifier: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.rateLimitCounter.deleteMany({
    where: { bucket: bucketKey(rule, identifier), windowStart: windowStartFor(rule, now) },
  });
}

/** Delete expired counters. Called opportunistically; safe to run at any time. */
export async function sweepRateLimits(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}

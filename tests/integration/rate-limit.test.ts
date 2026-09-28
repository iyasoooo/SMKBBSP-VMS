import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDb } from '../helpers/db';
import {
  consumeRateLimit,
  peekRateLimit,
  resetRateLimit,
  sweepRateLimits,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * The public submission limit.
 *
 * This had no tests at all, which for the one unauthenticated endpoint that
 * writes to the database is the wrong thing to have no tests for. It is also
 * the kind of setting somebody loosens in a hurry during a demonstration and
 * forgets to put back, so the numbers themselves are asserted: changing them
 * should mean editing a test and thinking about it, not watching a suite stay
 * green.
 *
 * `consumeRateLimit` takes an explicit `now`, so none of this sleeps.
 */

/** Exactly a window boundary, which keeps the arithmetic below obvious. */
const BASE = new Date('2026-10-01T02:00:00.000Z');

const rule = RATE_LIMITS.publicRequest;

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('the configured limit', () => {
  /*
   * Pinned deliberately. The pairing is the point: fifteen is what a shared
   * school connection needs, five minutes is what being wrong about it should
   * cost, and one without the other is a different decision.
   */
  it('is fifteen submissions per five minutes', () => {
    expect(rule.limit).toBe(15);
    expect(rule.windowSeconds).toBe(300);
  });
});

describe('consumeRateLimit', () => {
  it('allows the whole allowance and refuses the one after it', async () => {
    for (let attempt = 1; attempt <= rule.limit; attempt += 1) {
      const result = await consumeRateLimit(rule, '203.0.113.7', BASE);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(rule.limit - attempt);
    }

    const blocked = await consumeRateLimit(rule, '203.0.113.7', BASE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  /*
   * The case that prompted the change. Five in a row is a family group, or one
   * person who mistyped their phone number and submitted again, and it must
   * not come near the limit.
   */
  it('does not blink at five submissions back to back', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await consumeRateLimit(rule, '203.0.113.8', BASE);
      expect(result.allowed).toBe(true);
    }

    const after = await peekRateLimit(rule, '203.0.113.8', BASE);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(10);
  });

  /*
   * One connection flooding must not lock out another. Without this the limit
   * would be a denial of service against the school rather than a defence of
   * it.
   */
  it('counts each connection separately', async () => {
    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await consumeRateLimit(rule, '203.0.113.9', BASE);
    }

    const other = await consumeRateLimit(rule, '198.51.100.4', BASE);
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(rule.limit - 1);
  });

  it('does not let one rule spend another rule’s allowance', async () => {
    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await consumeRateLimit(rule, '203.0.113.10', BASE);
    }

    const login = await consumeRateLimit(RATE_LIMITS.login, '203.0.113.10', BASE);
    expect(login.allowed).toBe(true);
  });
});

describe('the window', () => {
  it('opens again at the next boundary', async () => {
    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await consumeRateLimit(rule, '203.0.113.11', BASE);
    }
    expect((await peekRateLimit(rule, '203.0.113.11', BASE)).allowed).toBe(false);

    const next = new Date(BASE.getTime() + rule.windowSeconds * 1000);
    const result = await consumeRateLimit(rule, '203.0.113.11', next);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(rule.limit - 1);
  });

  /*
   * Fixed, not rolling. The reset is pinned to the clock, so being refused
   * late in a window costs seconds rather than a fresh five minutes - and
   * retrying while blocked cannot push the reset further away.
   */
  it('counts down to the boundary rather than from the last attempt', async () => {
    const quarter = new Date(BASE.getTime() + 60_000);

    const first = await consumeRateLimit(rule, '203.0.113.12', quarter);
    expect(first.resetAt.getTime()).toBe(BASE.getTime() + rule.windowSeconds * 1000);
    expect(first.retryAfterSeconds).toBe(240);

    const later = await consumeRateLimit(rule, '203.0.113.12', new Date(BASE.getTime() + 240_000));
    expect(later.resetAt.getTime()).toBe(first.resetAt.getTime());
    expect(later.retryAfterSeconds).toBe(60);
  });

  it('never quotes a wait longer than the window', async () => {
    const result = await consumeRateLimit(rule, '203.0.113.13', BASE);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(rule.windowSeconds);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('peekRateLimit', () => {
  /*
   * The whole reason it exists. Rendering "try again in four minutes" must not
   * itself cost an attempt, or looking at the page would extend the block.
   */
  it('reports the state without spending an attempt', async () => {
    await consumeRateLimit(rule, '203.0.113.14', BASE);

    const first = await peekRateLimit(rule, '203.0.113.14', BASE);
    const second = await peekRateLimit(rule, '203.0.113.14', BASE);

    expect(first.remaining).toBe(rule.limit - 1);
    expect(second.remaining).toBe(rule.limit - 1);
  });

  it('reports a full allowance for a connection that has not been seen', async () => {
    const result = await peekRateLimit(rule, '203.0.113.15', BASE);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(rule.limit);
  });
});

describe('housekeeping', () => {
  it('clears a bucket on request', async () => {
    for (let attempt = 0; attempt <= rule.limit; attempt += 1) {
      await consumeRateLimit(rule, '203.0.113.16', BASE);
    }

    await resetRateLimit(rule, '203.0.113.16', BASE);

    const result = await peekRateLimit(rule, '203.0.113.16', BASE);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(rule.limit);
  });

  it('sweeps counters that have expired and keeps the live one', async () => {
    await consumeRateLimit(rule, '203.0.113.17', BASE);

    // Expiry is set a full window past the reset, so nothing is swept until
    // two windows have passed.
    const swept = await sweepRateLimits(new Date(BASE.getTime() + rule.windowSeconds * 3000));
    expect(swept).toBe(1);

    const remaining = await testDb.rateLimitCounter.count();
    expect(remaining).toBe(0);
  });

  it('leaves a counter inside its window alone', async () => {
    await consumeRateLimit(rule, '203.0.113.18', BASE);

    const swept = await sweepRateLimits(new Date(BASE.getTime() + 1000));
    expect(swept).toBe(0);
    expect(await testDb.rateLimitCounter.count()).toBe(1);
  });
});

/**
 * The identifier is hashed before storage, so the counter table does not
 * quietly become a second log of who visited the site from where.
 */
describe('stored identifiers', () => {
  it('does not keep the address in the clear', async () => {
    await consumeRateLimit(rule, '203.0.113.19', BASE);

    const rows = await testDb.rateLimitCounter.findMany();
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row?.bucket).not.toContain('203.0.113.19');
    expect(row?.bucket.startsWith(`${rule.name}:`)).toBe(true);
  });
});

import { generateBadgeNumber } from '@/lib/crypto/tokens';
import type { Db } from '@/lib/db/prisma';

/**
 * Allocate a badge number that is not already taken.
 *
 * `Visit.badgeNumber` is unique, but the generated tail is only random within
 * a single day, so two visits on a busy day can collide. Left unhandled that
 * surfaces as a unique-constraint error at the worst possible moment - the
 * guard pressing "check in" with the visitor standing at the gate.
 *
 * The first attempts keep the short, human-friendly four-digit form that a
 * guard can read off a printed badge. Only if those collide does the tail
 * widen, so the readable format is preserved in every realistic case while
 * correctness never depends on luck.
 *
 * Call inside the same transaction as the visit insert: the check and the
 * write then see a consistent snapshot.
 */
export async function allocateBadgeNumber(
  db: Db,
  prefix: string,
  timeZoneDay: string,
): Promise<string> {
  const SHORT_ATTEMPTS = 6;
  const TOTAL_ATTEMPTS = 12;

  for (let attempt = 0; attempt < TOTAL_ATTEMPTS; attempt += 1) {
    const digits = attempt < SHORT_ATTEMPTS ? 4 : 7;
    const candidate = generateBadgeNumber(prefix, timeZoneDay, digits);

    const existing = await db.visit.findUnique({
      where: { badgeNumber: candidate },
      select: { id: true },
    });

    if (!existing) return candidate;
  }

  // 10^7 values exhausted for one day is not a real scenario; failing loudly
  // beats returning a duplicate that violates the constraint downstream.
  throw new Error(`Could not allocate a unique badge number for ${timeZoneDay}`);
}

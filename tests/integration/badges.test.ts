import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VisitStatus } from '@prisma/client';
import {
  createTestVisitor,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import { allocateBadgeNumber } from '@/lib/domain/badges';
import { generateBadgeNumber } from '@/lib/crypto/tokens';

/**
 * Badge numbers must be unique, and the generated tail is only random within a
 * single day. This regression suite exists because a real seed run collided:
 * `Unique constraint failed on the fields: (badgeNumber)`. In production the
 * same collision would surface as a failed check-in with the visitor already
 * standing at the gate.
 */

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function createVisitWithBadge(badgeNumber: string, visitorId: string): Promise<void> {
  const now = new Date();
  await testDb.visit.create({
    data: {
      visitorId,
      teacherId: fixtures.teacher.id,
      status: VisitStatus.CHECKED_OUT,
      badgeNumber,
      expectedStart: now,
      expectedEnd: new Date(now.getTime() + 30 * 60_000),
    },
  });
}

describe('allocateBadgeNumber', () => {
  it('never returns a badge number that already exists', async () => {
    const visitor = await createTestVisitor({});
    const day = '2026-08-03';

    // Occupy a large share of the four-digit space for this day, so a naive
    // generator would collide almost immediately.
    const taken = new Set<string>();
    while (taken.size < 400) {
      taken.add(generateBadgeNumber('V', day));
    }
    for (const badge of taken) {
      await createVisitWithBadge(badge, visitor.id);
    }

    for (let i = 0; i < 40; i += 1) {
      const allocated = await allocateBadgeNumber(testDb, 'V', day);
      expect(taken.has(allocated)).toBe(false);

      // Allocating and then inserting must not violate the constraint.
      await createVisitWithBadge(allocated, visitor.id);
      taken.add(allocated);
    }
  });

  it('produces unique badges across a burst on the same day', async () => {
    const visitor = await createTestVisitor({});
    const day = '2026-08-04';
    const allocated: string[] = [];

    for (let i = 0; i < 60; i += 1) {
      const badge = await allocateBadgeNumber(testDb, 'V', day);
      await createVisitWithBadge(badge, visitor.id);
      allocated.push(badge);
    }

    expect(new Set(allocated).size).toBe(allocated.length);
    expect(await testDb.visit.count()).toBe(60);
  });

  it('keeps the short readable format when the day is quiet', async () => {
    const badge = await allocateBadgeNumber(testDb, 'V', '2026-08-05');
    expect(badge).toMatch(/^V-260805-\d{4}$/);
  });

  it('honours a configured badge prefix', async () => {
    const badge = await allocateBadgeNumber(testDb, 'VP', '2026-08-05');
    expect(badge.startsWith('VP-260805-')).toBe(true);
  });
});

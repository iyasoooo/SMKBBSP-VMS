import { describe, expect, it } from 'vitest';
import { attentionFlags, isAwaitingArrival, type LastSeen } from '@/lib/domain/presenters';

/**
 * The arrival signal, at its boundaries.
 *
 * These are the tests that decide whether the guard dashboard is worth
 * reading. An alert that fires a minute early, or one that fires for a visitor
 * somebody has already confirmed, teaches guards to dismiss the panel - and it
 * is the same panel that carries the overdue warnings.
 */

const GRACE = 15;
const CHECKED_IN_AT = new Date('2026-09-02T02:00:00.000Z');

function visit(overrides: Partial<Parameters<typeof isAwaitingArrival>[0]> = {}) {
  return {
    status: 'CHECKED_IN',
    checkedInAt: CHECKED_IN_AT,
    checkedOutAt: null,
    ...overrides,
  };
}

function seen(at: Date): LastSeen {
  return {
    at,
    destinationName: 'General Office',
    confirmedBy: 'Cikgu Aminah',
    method: 'HOST_CONFIRM',
    kind: 'ARRIVAL',
  };
}

/** `minutes` after check-in. */
function at(minutes: number): Date {
  return new Date(CHECKED_IN_AT.getTime() + minutes * 60_000);
}

describe('isAwaitingArrival', () => {
  it('stays silent inside the grace window', () => {
    expect(isAwaitingArrival(visit(), null, GRACE, at(14))).toBe(false);
  });

  it('stays silent exactly on the boundary', () => {
    // Strictly greater than, so the alert owes the visitor the full window.
    expect(isAwaitingArrival(visit(), null, GRACE, at(15))).toBe(false);
  });

  it('fires one minute past the window', () => {
    expect(isAwaitingArrival(visit(), null, GRACE, at(16))).toBe(true);
  });

  it('never fires once somebody has confirmed the visitor', () => {
    expect(isAwaitingArrival(visit(), seen(at(5)), GRACE, at(600))).toBe(false);
  });

  it('is silent for a visitor who is only expected, not admitted', () => {
    expect(
      isAwaitingArrival({ status: 'EXPECTED', checkedInAt: null, checkedOutAt: null }, null, GRACE, at(600)),
    ).toBe(false);
  });

  it('is silent once the visitor has checked out', () => {
    expect(
      isAwaitingArrival(
        visit({ status: 'CHECKED_OUT', checkedOutAt: at(30) }),
        null,
        GRACE,
        at(600),
      ),
    ).toBe(false);
  });

  it('is silent for a checked-in row with no check-in time', () => {
    // Defensive: without an instant to measure from there is no window, and
    // guessing one would invent an alert out of a data fault.
    expect(isAwaitingArrival(visit({ checkedInAt: null }), null, GRACE, at(600))).toBe(false);
  });
});

describe('attentionFlags', () => {
  const expectedEnd = new Date('2026-09-02T03:00:00.000Z');

  const base = {
    status: 'CHECKED_IN',
    expectedEnd,
    checkedInAt: CHECKED_IN_AT,
    checkedOutAt: null,
  };

  const options = {
    overdueGraceMinutes: 30,
    arrivalGraceMinutes: GRACE,
    arrivalAlertsEnabled: true,
  };

  it('reports nothing for a freshly admitted visitor', () => {
    expect(attentionFlags(base, { ...options, now: at(5) })).toEqual([]);
  });

  it('withholds the arrival flag while alerts are switched off', () => {
    // The rollout default. Adoption comes first; alarms come after.
    expect(
      attentionFlags(base, { ...options, arrivalAlertsEnabled: false, now: at(600) }),
    ).toEqual(['OVERDUE']);
  });

  it('ranks an unaccounted-for arrival above a late departure', () => {
    expect(attentionFlags(base, { ...options, now: at(600) })).toEqual([
      'AWAITING_ARRIVAL',
      'OVERDUE',
    ]);
  });

  it('reports only overdue when the visitor was confirmed', () => {
    expect(
      attentionFlags(base, { ...options, lastSeen: seen(at(5)), now: at(600) }),
    ).toEqual(['OVERDUE']);
  });

  it('does not flag a confirmed visitor who wandered off to the canteen', () => {
    // The case that killed the original stale-timer design: an hour with no
    // sighting is ordinary behaviour, not an incident.
    const withinWindow = new Date(expectedEnd.getTime() - 60_000);
    expect(
      attentionFlags(base, { ...options, lastSeen: seen(at(5)), now: withinWindow }),
    ).toEqual([]);
  });
});

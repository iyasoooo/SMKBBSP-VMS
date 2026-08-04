import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIME_ZONE,
  addDays,
  diffMinutes,
  endOfZonedDay,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  formatTimeRange,
  getZonedParts,
  minutesSinceZonedMidnight,
  parseIsoDayString,
  parseTimeString,
  startOfZonedDay,
  toIsoDayString,
  toTimeString,
  zonedDayOfWeek,
  zonedDayRangeToUtc,
  zonedTimeToUtc,
} from '@/lib/time';

describe('getZonedParts', () => {
  it('renders a UTC instant in Kuala Lumpur wall-clock terms', () => {
    // 2026-03-14T01:30Z is 09:30 on the same day in KL (UTC+8).
    expect(getZonedParts(new Date('2026-03-14T01:30:00Z'))).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 9,
      minute: 30,
      second: 0,
    });
  });

  it('rolls into the next Malaysian day for late-evening UTC instants', () => {
    // 2026-03-14T17:00Z is 01:00 on 15 March in KL - the case that silently
    // corrupts date filters if the server timezone is used instead.
    const parts = getZonedParts(new Date('2026-03-14T17:00:00Z'));
    expect(parts.day).toBe(15);
    expect(parts.hour).toBe(1);
  });

  it('represents midnight as hour 0, not 24', () => {
    expect(getZonedParts(new Date('2026-03-13T16:00:00Z')).hour).toBe(0);
  });
});

describe('zonedTimeToUtc', () => {
  it('converts Malaysian wall-clock fields back to the correct instant', () => {
    const utc = zonedTimeToUtc({ year: 2026, month: 3, day: 14, hour: 9, minute: 30 });
    expect(utc.toISOString()).toBe('2026-03-14T01:30:00.000Z');
  });

  it('round trips with getZonedParts', () => {
    const original = new Date('2026-07-01T06:45:00Z');
    const parts = getZonedParts(original);
    expect(zonedTimeToUtc(parts).toISOString()).toBe(original.toISOString());
  });

  it('handles a zone with daylight saving correctly', () => {
    // London is UTC+1 in July; 12:00 local is 11:00Z.
    const utc = zonedTimeToUtc(
      { year: 2026, month: 7, day: 1, hour: 12, minute: 0 },
      'Europe/London',
    );
    expect(utc.toISOString()).toBe('2026-07-01T11:00:00.000Z');
  });
});

describe('startOfZonedDay / endOfZonedDay', () => {
  it('bounds the Malaysian calendar day, not the UTC day', () => {
    const middleOfDay = new Date('2026-03-14T09:00:00Z'); // 17:00 KL
    expect(startOfZonedDay(middleOfDay).toISOString()).toBe('2026-03-13T16:00:00.000Z');
    expect(endOfZonedDay(middleOfDay).toISOString()).toBe('2026-03-14T16:00:00.000Z');
  });

  it('produces an exactly 24 hour window for a fixed-offset zone', () => {
    const start = startOfZonedDay(new Date('2026-03-14T09:00:00Z'));
    const end = endOfZonedDay(new Date('2026-03-14T09:00:00Z'));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('is idempotent', () => {
    const start = startOfZonedDay(new Date('2026-03-14T09:00:00Z'));
    expect(startOfZonedDay(start).toISOString()).toBe(start.toISOString());
  });

  it('keeps a 23 hour day correct when a DST transition shortens it', () => {
    // London springs forward on 29 March 2026.
    const start = startOfZonedDay(new Date('2026-03-29T12:00:00Z'), 'Europe/London');
    const end = endOfZonedDay(new Date('2026-03-29T12:00:00Z'), 'Europe/London');
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

describe('zonedDayRangeToUtc', () => {
  it('returns a half-open range covering both endpoint days inclusively', () => {
    const { start, end } = zonedDayRangeToUtc('2026-03-01', '2026-03-31');
    expect(start.toISOString()).toBe('2026-02-28T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-31T16:00:00.000Z');
  });

  it('covers a single day when both endpoints match', () => {
    const { start, end } = zonedDayRangeToUtc('2026-03-14', '2026-03-14');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('includes a visit at 23:59 Malaysian time on the final day', () => {
    const { start, end } = zonedDayRangeToUtc('2026-03-14', '2026-03-14');
    const lateVisit = zonedTimeToUtc({ year: 2026, month: 3, day: 14, hour: 23, minute: 59 });
    expect(lateVisit.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(lateVisit.getTime()).toBeLessThan(end.getTime());
  });

  it('rejects malformed input', () => {
    expect(() => zonedDayRangeToUtc('14-03-2026', '2026-03-14')).toThrow(/YYYY-MM-DD/);
  });
});

describe('parseIsoDayString', () => {
  it('accepts valid dates', () => {
    expect(parseIsoDayString('2026-03-14')).toEqual({ year: 2026, month: 3, day: 14 });
  });

  it('rejects impossible and malformed dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-04-31', '2026-3-14', 'nope', '']) {
      expect(parseIsoDayString(bad)).toBeNull();
    }
  });

  it('accepts a leap day in a leap year and rejects it otherwise', () => {
    expect(parseIsoDayString('2028-02-29')).not.toBeNull();
    expect(parseIsoDayString('2026-02-29')).toBeNull();
  });
});

describe('parseTimeString', () => {
  it('accepts 24-hour values and rejects out-of-range ones', () => {
    expect(parseTimeString('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeString('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeString('23:59')).toEqual({ hour: 23, minute: 59 });
    for (const bad of ['24:00', '09:60', '9:30', 'noon', '']) {
      expect(parseTimeString(bad)).toBeNull();
    }
  });
});

describe('day helpers', () => {
  it('formats the Malaysian day and time of an instant', () => {
    const instant = new Date('2026-03-14T17:00:00Z'); // 01:00 on 15 March KL
    expect(toIsoDayString(instant)).toBe('2026-03-15');
    expect(toTimeString(instant)).toBe('01:00');
  });

  it('computes minutes since Malaysian midnight for school-hours checks', () => {
    expect(minutesSinceZonedMidnight(new Date('2026-03-14T01:30:00Z'))).toBe(9 * 60 + 30);
  });

  it('reports the Malaysian weekday', () => {
    // 14 March 2026 is a Saturday in KL.
    expect(zonedDayOfWeek(new Date('2026-03-14T02:00:00Z'))).toBe(6);
    // Still Sunday-side of the boundary in KL terms.
    expect(zonedDayOfWeek(new Date('2026-03-14T17:00:00Z'))).toBe(0);
  });
});

describe('arithmetic', () => {
  it('adds days and computes minute differences', () => {
    const base = new Date('2026-03-14T01:30:00Z');
    expect(addDays(base, 2).toISOString()).toBe('2026-03-16T01:30:00.000Z');
    expect(diffMinutes(base, new Date('2026-03-14T03:00:00Z'))).toBe(90);
    expect(diffMinutes(new Date('2026-03-14T03:00:00Z'), base)).toBe(-90);
  });
});

describe('presentation', () => {
  const instant = new Date('2026-03-14T01:30:00Z');

  it('renders Malaysian-format dates with a textual month', () => {
    expect(formatDate(instant)).toBe('14 Mar 2026');
    expect(formatTime(instant)).toBe('09:30');
    expect(formatDateTime(instant)).toBe('14 Mar 2026, 09:30');
  });

  it('renders a time range', () => {
    expect(formatTimeRange(instant, new Date('2026-03-14T02:30:00Z'))).toBe('09:30 - 10:30');
  });

  it('always presents in Kuala Lumpur regardless of process timezone', () => {
    expect(formatTime(instant, DEFAULT_TIME_ZONE)).toBe('09:30');
    expect(formatTime(instant, 'UTC')).toBe('01:30');
  });

  it('formats durations compactly and clamps negatives', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(85)).toBe('1h 25m');
    expect(formatDuration(-10)).toBe('0m');
  });
});

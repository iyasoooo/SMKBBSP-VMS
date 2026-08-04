/**
 * Timezone utilities.
 *
 * Invariant for the whole application: instants are stored in UTC and are
 * presented in `Asia/Kuala_Lumpur`. Every "today", "date range" and
 * "school hours" decision must be evaluated against the Malaysian calendar
 * day, not the server's local day, or a visit that happened at 08:00 in
 * Kuala Lumpur lands on the previous date in reports.
 *
 * Malaysia has observed a fixed UTC+08:00 with no daylight saving since 1982,
 * but nothing here hard-codes that: the offset is derived from the IANA
 * database through `Intl`, so the code stays correct if the app is ever
 * re-pointed at another zone via `APP_TIMEZONE`.
 */

export const DEFAULT_TIME_ZONE = 'Asia/Kuala_Lumpur';

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Break a UTC instant into the wall-clock fields seen in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string = DEFAULT_TIME_ZONE): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = Number(part.value);
    }
  }
  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = lookup.hour === 24 ? 0 : (lookup.hour ?? 0);
  return {
    year: lookup.year ?? 1970,
    month: lookup.month ?? 1,
    day: lookup.day ?? 1,
    hour,
    minute: lookup.minute ?? 0,
    second: lookup.second ?? 0,
  };
}

/** Offset of `timeZone` from UTC, in milliseconds, at the given instant. */
function getOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Discard sub-second noise so the offset is a whole number of seconds.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Convert wall-clock fields in `timeZone` to the corresponding UTC instant.
 *
 * Two passes converge on zones with DST transitions: the first guess uses the
 * offset at the naive instant, the second re-reads the offset at the corrected
 * instant. For a fixed-offset zone the second pass is a no-op.
 */
export function zonedTimeToUtc(
  parts: Partial<ZonedParts> & Pick<ZonedParts, 'year' | 'month' | 'day'>,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  let instant = naive - getOffsetMs(new Date(naive), timeZone);
  instant = naive - getOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** First instant (inclusive) of the zone-local calendar day containing `date`. */
export function startOfZonedDay(date: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const { year, month, day } = getZonedParts(date, timeZone);
  return zonedTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** First instant (exclusive) of the next zone-local calendar day. */
export function endOfZonedDay(date: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const start = startOfZonedDay(date, timeZone);
  // Step by 36h then re-truncate so the result is right across any transition.
  return startOfZonedDay(new Date(start.getTime() + 36 * 60 * 60 * 1000), timeZone);
}

/**
 * Half-open UTC range `[start, end)` covering the zone-local days from
 * `fromDay` through `toDay` inclusive. Both inputs are `YYYY-MM-DD` strings as
 * produced by an `<input type="date">`.
 */
export function zonedDayRangeToUtc(
  fromDay: string,
  toDay: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): { start: Date; end: Date } {
  const from = parseIsoDayString(fromDay);
  const to = parseIsoDayString(toDay);
  if (!from || !to) {
    throw new Error('Invalid date range: expected YYYY-MM-DD values');
  }
  const start = zonedTimeToUtc({ ...from, hour: 0, minute: 0, second: 0 }, timeZone);
  const endInclusiveStart = zonedTimeToUtc({ ...to, hour: 0, minute: 0, second: 0 }, timeZone);
  const end = startOfZonedDay(
    new Date(endInclusiveStart.getTime() + 36 * 60 * 60 * 1000),
    timeZone,
  );
  return { start, end };
}

/** Parse `YYYY-MM-DD` strictly; returns null for malformed or impossible dates. */
export function parseIsoDayString(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject 31 April, 30 February, and similar.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Parse `HH:MM` (24h) strictly. */
export function parseTimeString(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** `YYYY-MM-DD` for the zone-local day containing `date`. */
export function toIsoDayString(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** `HH:MM` for the zone-local time of `date`. */
export function toTimeString(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const { hour, minute } = getZonedParts(date, timeZone);
  return `${pad(hour, 2)}:${pad(minute, 2)}`;
}

/** Minutes since zone-local midnight, useful for school-hours comparisons. */
export function minutesSinceZonedMidnight(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  const { hour, minute } = getZonedParts(date, timeZone);
  return hour * 60 + minute;
}

/** Day of week in the zone: 0 = Sunday .. 6 = Saturday. */
export function zonedDayOfWeek(date: Date, timeZone: string = DEFAULT_TIME_ZONE): number {
  const { year, month, day } = getZonedParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Whole minutes between two instants (`to - from`), truncated. */
export function diffMinutes(from: Date, to: Date): number {
  return Math.trunc((to.getTime() - from.getTime()) / 60_000);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const DISPLAY_LOCALE = 'en-GB'; // day-before-month, matching Malaysian usage.

/** e.g. `14 Mar 2026` - month is text to remove day/month ambiguity. */
export function formatDate(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** e.g. `Sat, 14 Mar 2026`. */
export function formatDateWithWeekday(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** e.g. `09:30`. */
export function formatTime(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** e.g. `14 Mar 2026, 09:30`. */
export function formatDateTime(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return `${formatDate(date, timeZone)}, ${formatTime(date, timeZone)}`;
}

/** e.g. `09:30 - 10:30` collapsing a same-day window. */
export function formatTimeRange(
  start: Date,
  end: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return `${formatTime(start, timeZone)} - ${formatTime(end, timeZone)}`;
}

/** e.g. `1h 25m`, `45m`, `0m`. Negative durations clamp to `0m`. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.trunc(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

import { AppointmentStatus, VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSettings } from '@/lib/domain/settings';
import {
  endOfZonedDay,
  getZonedParts,
  startOfZonedDay,
  toIsoDayString,
  zonedDayRangeToUtc,
} from '@/lib/time';

/**
 * Dashboard analytics.
 *
 * Every number here is computed from a database query over the selected range.
 * Nothing is hard-coded, estimated, or padded to make a chart look fuller -
 * an empty range renders empty charts, which is the honest outcome.
 *
 * Day bucketing uses Malaysian calendar days, so a visit at 08:00 local time
 * is counted on the day it actually happened rather than the previous UTC day.
 */

export interface DashboardRange {
  /** Inclusive `YYYY-MM-DD` in Asia/Kuala_Lumpur. */
  from: string;
  to: string;
}

export interface TodayCounts {
  expected: number;
  pending: number;
  checkedIn: number;
  checkedOut: number;
  overdue: number;
  denied: number;
}

export interface DashboardMetrics {
  range: DashboardRange;
  today: TodayCounts;
  totals: {
    appointments: number;
    completedVisits: number;
    approvals: number;
    rejections: number;
    noShows: number;
    /** Approvals / (approvals + rejections), 0-100. Null when no decisions. */
    approvalRatePercent: number | null;
    noShowRatePercent: number | null;
    /** Mean minutes on site, completed visits only. Null when none. */
    averageDurationMinutes: number | null;
  };
  visitsByDay: Array<{ day: string; count: number }>;
  visitTypeDistribution: Array<{ label: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
  topDestinations: Array<{ label: string; count: number }>;
}

/** Default range: the last 30 Malaysian calendar days, ending today. */
export function defaultRange(now: Date = new Date()): DashboardRange {
  const to = toIsoDayString(now);
  const from = toIsoDayString(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  return { from, to };
}

export async function getDashboardMetrics(
  range: DashboardRange,
  now: Date = new Date(),
): Promise<DashboardMetrics> {
  const settings = await getSettings();
  const { start, end } = zonedDayRangeToUtc(range.from, range.to);

  const dayStart = startOfZonedDay(now);
  const dayEnd = endOfZonedDay(now);
  const overdueCutoff = new Date(now.getTime() - settings.overdueGraceMinutes * 60_000);

  const [
    todayExpected,
    todayPending,
    todayCheckedIn,
    todayCheckedOut,
    todayOverdue,
    todayDenied,
    appointmentsInRange,
    approvals,
    rejections,
    noShows,
    completedVisits,
    visitTypeRows,
    destinationRows,
  ] = await Promise.all([
    prisma.visit.count({
      where: { status: VisitStatus.EXPECTED, expectedStart: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.appointment.count({ where: { status: AppointmentStatus.PENDING } }),
    prisma.visit.count({ where: { status: VisitStatus.CHECKED_IN, checkedOutAt: null } }),
    prisma.visit.count({
      where: { status: VisitStatus.CHECKED_OUT, checkedOutAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.visit.count({
      where: {
        status: VisitStatus.CHECKED_IN,
        checkedOutAt: null,
        expectedEnd: { lt: overdueCutoff },
      },
    }),
    prisma.visit.count({
      where: { status: VisitStatus.DENIED, updatedAt: { gte: dayStart, lt: dayEnd } },
    }),

    prisma.appointment.count({ where: { scheduledStart: { gte: start, lt: end } } }),
    prisma.appointment.count({
      where: { scheduledStart: { gte: start, lt: end }, status: AppointmentStatus.APPROVED },
    }),
    prisma.appointment.count({
      where: { scheduledStart: { gte: start, lt: end }, status: AppointmentStatus.REJECTED },
    }),
    prisma.visit.count({
      where: { expectedStart: { gte: start, lt: end }, status: VisitStatus.NO_SHOW },
    }),

    prisma.visit.findMany({
      where: {
        status: VisitStatus.CHECKED_OUT,
        checkedInAt: { gte: start, lt: end, not: null },
        checkedOutAt: { not: null },
      },
      select: { checkedInAt: true, checkedOutAt: true },
    }),

    prisma.appointment.groupBy({
      by: ['visitTypeId'],
      where: { scheduledStart: { gte: start, lt: end } },
      _count: { _all: true },
    }),

    prisma.visit.groupBy({
      by: ['destinationId'],
      where: { expectedStart: { gte: start, lt: end }, destinationId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  // --- Average duration: completed visits only ----------------------------
  // No-shows, denials and visits still in progress are excluded by the query
  // above, so an unclosed visit cannot inflate the mean.
  const durations = completedVisits
    .filter((visit) => visit.checkedInAt && visit.checkedOutAt)
    .map((visit) => (visit.checkedOutAt!.getTime() - visit.checkedInAt!.getTime()) / 60_000)
    .filter((minutes) => minutes >= 0);

  const averageDurationMinutes =
    durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null;

  const decisions = approvals + rejections;

  // --- Per-day and per-hour buckets ---------------------------------------
  const checkIns = await prisma.visit.findMany({
    where: { checkedInAt: { gte: start, lt: end } },
    select: { checkedInAt: true },
  });

  const dayCounts = new Map<string, number>();
  for (
    let cursor = new Date(start);
    cursor < end;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    dayCounts.set(toIsoDayString(cursor), 0);
  }

  const hourCounts = new Map<number, number>();
  for (let hour = 6; hour <= 19; hour += 1) hourCounts.set(hour, 0);

  for (const visit of checkIns) {
    if (!visit.checkedInAt) continue;
    const day = toIsoDayString(visit.checkedInAt);
    if (dayCounts.has(day)) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);

    const { hour } = getZonedParts(visit.checkedInAt);
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }

  // --- Label lookups -------------------------------------------------------
  const [visitTypes, destinations] = await Promise.all([
    prisma.visitType.findMany({ select: { id: true, nameEn: true } }),
    prisma.destination.findMany({ select: { id: true, nameEn: true } }),
  ]);

  const visitTypeNames = new Map(visitTypes.map((type) => [type.id, type.nameEn]));
  const destinationNames = new Map(destinations.map((d) => [d.id, d.nameEn]));

  return {
    range,
    today: {
      expected: todayExpected,
      pending: todayPending,
      checkedIn: todayCheckedIn,
      checkedOut: todayCheckedOut,
      overdue: todayOverdue,
      denied: todayDenied,
    },
    totals: {
      appointments: appointmentsInRange,
      completedVisits: durations.length,
      approvals,
      rejections,
      noShows,
      approvalRatePercent: decisions > 0 ? Math.round((approvals / decisions) * 100) : null,
      noShowRatePercent: approvals > 0 ? Math.round((noShows / approvals) * 100) : null,
      averageDurationMinutes,
    },
    visitsByDay: [...dayCounts.entries()].map(([day, count]) => ({ day, count })),
    visitTypeDistribution: visitTypeRows
      .map((row) => ({
        label: visitTypeNames.get(row.visitTypeId) ?? 'Unknown',
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    peakHours: [...hourCounts.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour),
    topDestinations: destinationRows
      .map((row) => ({
        label: row.destinationId ? (destinationNames.get(row.destinationId) ?? 'Unknown') : 'Unassigned',
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

/**
 * Operational alerts derived from explicit rules, not inference.
 * Each one names a condition a human can verify by looking at the data.
 */
export interface OperationalAlert {
  id: string;
  severity: 'info' | 'warning' | 'danger';
  title: string;
  detail: string;
  href?: string;
}

export async function getOperationalAlerts(now: Date = new Date()): Promise<OperationalAlert[]> {
  const settings = await getSettings();
  const alerts: OperationalAlert[] = [];

  const overdueCutoff = new Date(now.getTime() - settings.overdueGraceMinutes * 60_000);

  const [overdue, reviewRequired, stalePending] = await Promise.all([
    prisma.visit.count({
      where: {
        status: VisitStatus.CHECKED_IN,
        checkedOutAt: null,
        expectedEnd: { lt: overdueCutoff },
      },
    }),
    prisma.appointment.count({ where: { status: AppointmentStatus.REVIEW_REQUIRED } }),
    prisma.appointment.count({
      where: {
        status: AppointmentStatus.PENDING,
        scheduledStart: { lt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  if (overdue > 0) {
    alerts.push({
      id: 'overdue',
      severity: 'danger',
      title: `${overdue} visitor${overdue === 1 ? '' : 's'} overdue`,
      detail: `Still on site more than ${settings.overdueGraceMinutes} minutes past the expected end.`,
      href: '/guard/active',
    });
  }

  if (reviewRequired > 0) {
    alerts.push({
      id: 'review',
      severity: 'warning',
      title: `${reviewRequired} request${reviewRequired === 1 ? '' : 's'} awaiting review`,
      detail: 'Held by a blacklist rule and not yet released to the host teacher.',
      href: '/admin/appointments?status=REVIEW_REQUIRED',
    });
  }

  if (stalePending > 0) {
    alerts.push({
      id: 'stale-pending',
      severity: 'warning',
      title: `${stalePending} request${stalePending === 1 ? '' : 's'} undecided within 24 hours`,
      detail: 'The visit starts soon and the host has not yet approved or rejected it.',
      href: '/admin/appointments?status=PENDING',
    });
  }

  /*
   * There is no delivery alert any more. Nothing is sent, so nothing can fail:
   * in-app notifications are written inside their business transaction and are
   * complete on write. Any FAILED rows left in the table are email history from
   * before that change, and an alert about them would link to a screen that no
   * longer exists.
   */

  return alerts;
}

import { AppointmentSource, VisitStatus, VisitorCategory, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { SAFE_VISITOR_SELECT, toSafeVisitor } from '@/lib/domain/presenters';
import { defaultRange } from '@/lib/domain/analytics';
import {
  diffMinutes,
  formatDate,
  formatDateTime,
  formatTime,
  parseIsoDayString,
  zonedDayRangeToUtc,
} from '@/lib/time';
import { MAX_PAGE_SIZE } from '@/lib/constants';

/**
 * The single report query used by the on-screen table, the PDF export and the
 * XLSX export.
 *
 * Sharing one function is what makes AT-021 hold: a file that "reflects the
 * same filters and records" as the screen cannot drift, because there is only
 * one filter translation and one row projection. The exporters differ only in
 * how they draw the rows.
 */

export interface ReportFilters {
  from: string;
  to: string;
  status?: VisitStatus | 'ALL';
  teacherId?: string;
  destinationId?: string;
  visitTypeId?: string;
  source?: AppointmentSource | 'ALL';
  category?: VisitorCategory | 'ALL';
}

/** A single exportable row. Identity is already masked. */
export interface ReportRow {
  reference: string;
  visitorName: string;
  identityMasked: string;
  category: string;
  hostName: string;
  destinationName: string;
  visitTypeName: string;
  source: string;
  scheduledDate: string;
  scheduledWindow: string;
  actualIn: string;
  actualOut: string;
  durationMinutes: number | null;
  status: VisitStatus;
}

export interface ReportResult {
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: ReportFilters;
  /** Human-readable filter summary, printed on exports and audited. */
  summary: string[];
}

/** Normalise raw query params into safe, validated filters. */
export function parseReportFilters(params: Record<string, string | undefined>): ReportFilters {
  const fallback = defaultRange();
  const from = params.from && parseIsoDayString(params.from) ? params.from : fallback.from;
  const to = params.to && parseIsoDayString(params.to) ? params.to : fallback.to;

  const statusValues = Object.values(VisitStatus) as string[];
  const sourceValues = Object.values(AppointmentSource) as string[];
  const categoryValues = Object.values(VisitorCategory) as string[];

  return {
    from: from <= to ? from : fallback.from,
    to: from <= to ? to : fallback.to,
    status:
      params.status && statusValues.includes(params.status)
        ? (params.status as VisitStatus)
        : 'ALL',
    teacherId: params.teacherId || undefined,
    destinationId: params.destinationId || undefined,
    visitTypeId: params.visitTypeId || undefined,
    source:
      params.source && sourceValues.includes(params.source)
        ? (params.source as AppointmentSource)
        : 'ALL',
    category:
      params.category && categoryValues.includes(params.category)
        ? (params.category as VisitorCategory)
        : 'ALL',
  };
}

function buildWhere(filters: ReportFilters): Prisma.VisitWhereInput {
  const { start, end } = zonedDayRangeToUtc(filters.from, filters.to);

  const where: Prisma.VisitWhereInput = {
    // Ranges are bounded by Malaysian calendar days so an 08:00 local visit is
    // counted on the day it happened, not the previous UTC day.
    expectedStart: { gte: start, lt: end },
  };

  if (filters.status && filters.status !== 'ALL') where.status = filters.status;
  if (filters.teacherId) where.teacherId = filters.teacherId;
  if (filters.destinationId) where.destinationId = filters.destinationId;

  const appointmentFilter: Prisma.AppointmentWhereInput = {};
  if (filters.visitTypeId) appointmentFilter.visitTypeId = filters.visitTypeId;
  if (filters.source && filters.source !== 'ALL') appointmentFilter.source = filters.source;
  if (Object.keys(appointmentFilter).length > 0) where.appointment = appointmentFilter;

  if (filters.category && filters.category !== 'ALL') {
    where.visitor = { visitorCategory: filters.category };
  }

  return where;
}

const SOURCE_LABELS: Record<string, string> = {
  ONLINE: 'Online',
  WALK_IN: 'Walk-in',
};

/**
 * Run the report.
 *
 * `pageSize = 0` returns every matching row, which is what the exporters use
 * so a PDF is never silently truncated to one page of results.
 */
export async function runReport(
  filters: ReportFilters,
  options: { page?: number; pageSize?: number } = {},
): Promise<ReportResult> {
  const where = buildWhere(filters);
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(options.pageSize ?? 25, MAX_PAGE_SIZE);
  const exportAll = options.pageSize === 0;

  const [total, visits, teachers, destinations, visitTypes] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where,
      include: {
        visitor: { select: SAFE_VISITOR_SELECT },
        teacher: { select: { name: true } },
        destination: { select: { nameEn: true } },
        appointment: {
          select: {
            referenceNumber: true,
            source: true,
            visitType: { select: { nameEn: true } },
          },
        },
      },
      orderBy: { expectedStart: 'desc' },
      ...(exportAll ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    }),
    filters.teacherId
      ? prisma.user.findUnique({ where: { id: filters.teacherId }, select: { name: true } })
      : Promise.resolve(null),
    filters.destinationId
      ? prisma.destination.findUnique({
          where: { id: filters.destinationId },
          select: { nameEn: true },
        })
      : Promise.resolve(null),
    filters.visitTypeId
      ? prisma.visitType.findUnique({
          where: { id: filters.visitTypeId },
          select: { nameEn: true },
        })
      : Promise.resolve(null),
  ]);

  const rows: ReportRow[] = visits.map((visit) => {
    const visitor = toSafeVisitor(visit.visitor);
    const duration =
      visit.checkedInAt && visit.checkedOutAt
        ? diffMinutes(visit.checkedInAt, visit.checkedOutAt)
        : null;

    return {
      reference: visit.appointment?.referenceNumber ?? visit.badgeNumber,
      visitorName: visitor.fullName,
      identityMasked: visitor.identityMasked,
      category: visitor.category,
      hostName: visit.teacher.name,
      destinationName: visit.destination?.nameEn ?? '-',
      visitTypeName: visit.appointment?.visitType.nameEn ?? '-',
      source: SOURCE_LABELS[visit.appointment?.source ?? 'ONLINE'] ?? 'Online',
      scheduledDate: formatDate(visit.expectedStart),
      scheduledWindow: `${formatTime(visit.expectedStart)} - ${formatTime(visit.expectedEnd)}`,
      actualIn: visit.checkedInAt ? formatDateTime(visit.checkedInAt) : '-',
      actualOut: visit.checkedOutAt ? formatDateTime(visit.checkedOutAt) : '-',
      durationMinutes: duration,
      status: visit.status,
    };
  });

  const summary = [
    `Date range: ${filters.from} to ${filters.to}`,
    `Status: ${filters.status === 'ALL' || !filters.status ? 'All' : filters.status}`,
    `Host: ${teachers?.name ?? 'All'}`,
    `Destination: ${destinations?.nameEn ?? 'All'}`,
    `Visit type: ${visitTypes?.nameEn ?? 'All'}`,
    `Source: ${filters.source === 'ALL' || !filters.source ? 'All' : SOURCE_LABELS[filters.source]}`,
    `Category: ${filters.category === 'ALL' || !filters.category ? 'All' : filters.category}`,
  ];

  return { rows, total, page, pageSize, filters, summary };
}

/** Column order shared by both exporters and the on-screen table. */
export const REPORT_COLUMNS = [
  { key: 'reference', label: 'Reference', width: 16 },
  { key: 'visitorName', label: 'Visitor', width: 26 },
  { key: 'identityMasked', label: 'Identity (masked)', width: 18 },
  { key: 'category', label: 'Category', width: 12 },
  { key: 'hostName', label: 'Host teacher', width: 26 },
  { key: 'destinationName', label: 'Destination', width: 22 },
  { key: 'visitTypeName', label: 'Visit type', width: 20 },
  { key: 'source', label: 'Source', width: 10 },
  { key: 'scheduledDate', label: 'Date', width: 14 },
  { key: 'scheduledWindow', label: 'Scheduled', width: 16 },
  { key: 'actualIn', label: 'Checked in', width: 20 },
  { key: 'actualOut', label: 'Checked out', width: 20 },
  { key: 'durationMinutes', label: 'Minutes', width: 10 },
  { key: 'status', label: 'Status', width: 14 },
] as const satisfies ReadonlyArray<{ key: keyof ReportRow; label: string; width: number }>;

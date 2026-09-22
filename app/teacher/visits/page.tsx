import type { Metadata } from 'next';
import { VisitStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireTeacher } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { formatDate, formatDateTime, formatDuration, formatTimeRange, diffMinutes } from '@/lib/time';
import { SAFE_VISITOR_SELECT, isOverdue, toSafeVisitor } from '@/lib/domain/presenters';
import { hostConfirmationsFor, type HostConfirmationState } from '@/lib/domain/checkpoints';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { VisitStatusPill } from '@/components/status-pill';
import { Pagination } from '@/components/pagination';
import { ConfirmArrival } from './confirm-arrival';
import Link from 'next/link';

export const metadata: Metadata = { title: 'My visits' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  {
    key: 'upcoming',
    label: 'Upcoming',
    statuses: [VisitStatus.EXPECTED],
    order: 'asc' as const,
  },
  {
    key: 'active',
    label: 'On site now',
    statuses: [VisitStatus.CHECKED_IN],
    order: 'asc' as const,
  },
  {
    key: 'history',
    label: 'History',
    statuses: [VisitStatus.CHECKED_OUT, VisitStatus.NO_SHOW, VisitStatus.DENIED, VisitStatus.CANCELLED],
    order: 'desc' as const,
  },
] as const;

export default async function TeacherVisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const user = await requireTeacher();
  const [params, settings, locale] = await Promise.all([searchParams, getSettings(), getLocale()]);
  const t = getDictionary(locale);

  const filter = FILTERS.find((f) => f.key === params.filter) ?? FILTERS[0];
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const where: Prisma.VisitWhereInput = {
    teacherId: user.id,
    status: { in: [...filter.statuses] },
  };

  const [total, visits] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where,
      include: {
        visitor: { select: SAFE_VISITOR_SELECT },
        destination: true,
        appointment: { select: { referenceNumber: true } },
      },
      orderBy: { expectedStart: filter.order },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
  ]);

  const now = new Date();

  /*
   * Confirmation state is only fetched for visitors currently on site. It is
   * the only case where the button is offered, and a history page has no use
   * for it.
   */
  const showConfirm = settings.checkpointEnabled && filter.key === 'active';

  const confirmations: Map<string, HostConfirmationState> = showConfirm
    ? await hostConfirmationsFor(visits.map((visit) => visit.id))
    : new Map();

  return (
    <>
      <PageHeading title="My visits" description="Visits where you are the host." />

      <nav aria-label="Filter visits" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const active = option.key === filter.key;
          return (
            <Link
              key={option.key}
              href={`/teacher/visits?filter=${option.key}`}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${
                active
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--line-strong)] bg-[var(--surface-card)] text-[var(--text-body)] hover:bg-[var(--surface-muted)]'
              }`}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      <Card>
        {visits.length === 0 ? (
          <EmptyState
            title="Nothing to show"
            description={
              filter.key === 'upcoming'
                ? 'Approved visits will appear here once a visitor is expected.'
                : filter.key === 'active'
                  ? 'None of your visitors are on site right now.'
                  : 'Completed visits will appear here.'
            }
          />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Your visits, {filter.label.toLowerCase()}</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Visitor</th>
                  <th scope="col" className="px-5 py-3 font-medium">Scheduled</th>
                  <th scope="col" className="px-5 py-3 font-medium">Destination</th>
                  <th scope="col" className="px-5 py-3 font-medium">Actual</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  {showConfirm ? (
                    <th scope="col" className="px-5 py-3 font-medium">
                      {t.confirmedBy}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {visits.map((visit) => {
                  const visitor = toSafeVisitor(visit.visitor);
                  const overdue = isOverdue(visit, settings.overdueGraceMinutes, now);

                  return (
                    <tr key={visit.id}>
                      <td className="px-5 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {visitor.fullName}
                        </span>
                        <span className="block font-mono text-xs text-muted">
                          {visit.appointment?.referenceNumber ?? visit.badgeNumber}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="block">{formatDate(visit.expectedStart)}</span>
                        <span className="block text-xs text-muted">
                          {formatTimeRange(visit.expectedStart, visit.expectedEnd)}
                        </span>
                      </td>
                      <td className="px-5 py-3">{visit.destination?.nameEn ?? '-'}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {visit.checkedInAt ? (
                          <>
                            <span className="block text-xs">
                              In {formatDateTime(visit.checkedInAt)}
                            </span>
                            {visit.checkedOutAt ? (
                              <span className="block text-xs text-muted">
                                {formatDuration(diffMinutes(visit.checkedInAt, visit.checkedOutAt))}{' '}
                                on site
                              </span>
                            ) : (
                              <span className="block text-xs text-muted">Still on site</span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <VisitStatusPill status={visit.status} overdue={overdue} />
                      </td>
                      {showConfirm ? (
                        <td className="px-5 py-3">
                          <ConfirmArrival
                            visitId={visit.id}
                            confirmedAt={
                              confirmations.get(visit.id)?.arrivedAt?.toISOString() ?? null
                            }
                            departedAt={
                              confirmations.get(visit.id)?.departedAt?.toISOString() ?? null
                            }
                            labels={{
                              confirmArrival: t.confirmArrival,
                              confirmDeparture: t.confirmDeparture,
                              arrivalConfirmed: t.arrivalConfirmed,
                              departureConfirmed: t.departureConfirmed,
                              alreadyConfirmed: t.alreadyConfirmed,
                              loading: t.loading,
                            }}
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Pagination
        page={page}
        total={total}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/teacher/visits"
        query={{ filter: filter.key }}
      />
    </>
  );
}

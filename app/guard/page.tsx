import type { Metadata } from 'next';
import Link from 'next/link';
import { VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { endOfZonedDay, formatDate, formatTime, formatTimeRange, startOfZonedDay } from '@/lib/time';
import {
  SAFE_VISITOR_SELECT,
  attentionFlags,
  isOverdue,
  toSafeVisitor,
  type LastSeen,
} from '@/lib/domain/presenters';
import { latestCheckpointsFor } from '@/lib/domain/checkpoints';
import { searchGateVisits } from '@/lib/domain/gate';
import { Alert, Card, CardHeader, EmptyState, PageHeading, Pill } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';
import { VisitStatusPill } from '@/components/status-pill';
import { GateSearch } from './gate-search';

export const metadata: Metadata = { title: 'Today at the gate' };
export const dynamic = 'force-dynamic';

export default async function GuardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireGuardOrAdmin();
  const [settings, locale, params] = await Promise.all([getSettings(), getLocale(), searchParams]);
  const t = getDictionary(locale);

  const now = new Date();
  const dayStart = startOfZonedDay(now);
  const dayEnd = endOfZonedDay(now);

  const query = (params.q ?? '').trim();

  const [expected, onSite, recent, searchResults] = await Promise.all([
    prisma.visit.findMany({
      where: {
        status: VisitStatus.EXPECTED,
        expectedStart: { gte: dayStart, lt: dayEnd },
      },
      include: {
        visitor: { select: SAFE_VISITOR_SELECT },
        teacher: { select: { name: true } },
        destination: true,
      },
      orderBy: { expectedStart: 'asc' },
    }),
    prisma.visit.findMany({
      where: { status: VisitStatus.CHECKED_IN, checkedOutAt: null },
      include: {
        visitor: { select: SAFE_VISITOR_SELECT },
        teacher: { select: { name: true } },
        destination: true,
      },
      orderBy: { checkedInAt: 'asc' },
    }),
    prisma.visit.findMany({
      where: {
        status: { in: [VisitStatus.CHECKED_OUT, VisitStatus.DENIED] },
        checkedInAt: { gte: dayStart, lt: dayEnd },
      },
      include: { visitor: { select: SAFE_VISITOR_SELECT }, teacher: { select: { name: true } } },
      orderBy: { checkedOutAt: 'desc' },
      take: 8,
    }),
    query.length >= 2 ? searchGateVisits(query) : Promise.resolve([]),
  ]);

  const overdue = onSite.filter((visit) => isOverdue(visit, settings.overdueGraceMinutes, now));
  const peopleOnSite = onSite.length;

  /*
   * Last-seen data is only fetched when confirmations are switched on, so a
   * school that has not adopted them pays nothing for the feature.
   */
  const lastSeenByVisit: Map<string, LastSeen> = settings.checkpointEnabled
    ? await latestCheckpointsFor(onSite.map((visit) => visit.id))
    : new Map();

  const flagsFor = (visit: (typeof onSite)[number]) =>
    attentionFlags(visit, {
      lastSeen: lastSeenByVisit.get(visit.id),
      overdueGraceMinutes: settings.overdueGraceMinutes,
      arrivalGraceMinutes: settings.checkpointArrivalGraceMinutes,
      arrivalAlertsEnabled: settings.checkpointEnabled && settings.checkpointAlertsEnabled,
      now,
    });

  /*
   * A visitor nobody can place outranks one who is simply staying late: the
   * first is unaccounted for, the second is somewhere known with an expired
   * clock.
   */
  const awaitingArrival = onSite.filter((visit) => flagsFor(visit).includes('AWAITING_ARRIVAL'));

  return (
    <>
      <PageHeading
        title={t.todayHeading}
        description={`${formatDate(now)} · ${t.todaySubtitle}`}
        action={
          <div className="flex gap-2">
            <ButtonLink href="/guard/scan" size="lg">
              {t.scan}
            </ButtonLink>
            <ButtonLink href="/guard/walk-in" variant="secondary" size="lg">
              {t.walkIn}
            </ButtonLink>
          </div>
        }
      />

      {awaitingArrival.length > 0 ? (
        <div className="mb-5">
          <Alert
            tone="danger"
            title={`${awaitingArrival.length} ${t.awaitingArrival.toLowerCase()}`}
          >
            <p>{t.awaitingArrivalHelp}</p>
            <ul className="mt-2 space-y-1">
              {awaitingArrival.map((visit) => (
                <li key={visit.id}>
                  <strong>{toSafeVisitor(visit.visitor).fullName}</strong>
                  {' — '}
                  {t.checkInTime.toLowerCase()}{' '}
                  {visit.checkedInAt ? formatTime(visit.checkedInAt) : '-'}
                  {' · '}
                  {visit.teacher.name}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {overdue.length > 0 ? (
        <div className="mb-5">
          <Alert tone="warning" title={`${overdue.length} ${t.overdue.toLowerCase()}`}>
            {overdue.map((visit) => toSafeVisitor(visit.visitor).fullName).join(', ')}
          </Alert>
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile label={t.expected} value={expected.length} tone="info" />
        <StatTile label={t.checkedIn} value={peopleOnSite} tone="success" />
        <StatTile label={t.overdue} value={overdue.length} tone={overdue.length > 0 ? 'danger' : 'neutral'} />
      </div>

      <div className="mb-5">
        <GateSearch defaultValue={query} label={t.search} placeholder={t.searchPlaceholder} />
      </div>

      {query.length >= 2 ? (
        <Card className="mb-5">
          <CardHeader
            title={`${t.search}: "${query}"`}
            description={`${searchResults.length} result(s)`}
          />
          {searchResults.length === 0 ? (
            <EmptyState title="No matching visitor" description="Check the spelling, or scan the pass instead." />
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {searchResults.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  overdue={isOverdue(visit, settings.overdueGraceMinutes, now)}
                />
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={t.checkedIn} description={`${peopleOnSite} on site`} />
          {onSite.length === 0 ? (
            <EmptyState title={t.noOnSite} />
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {onSite.map((visit) => (
                <VisitRow
                  key={visit.id}
                  visit={visit}
                  overdue={isOverdue(visit, settings.overdueGraceMinutes, now)}
                  lastSeen={settings.checkpointEnabled ? lastSeenByVisit.get(visit.id) ?? null : null}
                  showLastSeen={settings.checkpointEnabled}
                  awaiting={flagsFor(visit).includes('AWAITING_ARRIVAL')}
                  labels={{ lastSeen: t.lastSeen, lastSeenNever: t.lastSeenNever, awaitingArrival: t.awaitingArrival }}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t.expected} description={formatDate(now)} />
          {expected.length === 0 ? (
            <EmptyState title={t.noExpected} />
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {expected.map((visit) => (
                <VisitRow key={visit.id} visit={visit} overdue={false} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title={t.recentlyCompleted} />
        {recent.length === 0 ? (
          <EmptyState title={t.noRecent} />
        ) : (
          <ul className="divide-y divide-[var(--line-soft)]">
            {recent.map((visit) => (
              <li key={visit.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                    {toSafeVisitor(visit.visitor).fullName}
                  </span>
                  <span className="block text-xs text-muted">
                    {visit.checkedOutAt ? formatTime(visit.checkedOutAt) : '-'} &middot;{' '}
                    {visit.teacher.name}
                  </span>
                </span>
                <VisitStatusPill status={visit.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'info' | 'success' | 'danger' | 'neutral';
}) {
  const colors = {
    info: 'var(--info)',
    success: 'var(--ok)',
    danger: 'var(--danger)',
    neutral: 'var(--text-muted)',
  } as const;

  return (
    <div className="surface-card rounded-xl px-5 py-4">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-3xl font-semibold" style={{ color: colors[tone] }}>
        {value}
      </p>
    </div>
  );
}

interface VisitRowData {
  id: string;
  status: VisitStatus;
  badgeNumber: string;
  expectedStart: Date;
  expectedEnd: Date;
  checkedInAt: Date | null;
  visitor: Parameters<typeof toSafeVisitor>[0];
  teacher: { name: string };
  destination: { nameEn: string } | null;
}

function VisitRow({
  visit,
  overdue,
  lastSeen = null,
  showLastSeen = false,
  awaiting = false,
  labels,
}: {
  visit: VisitRowData;
  overdue: boolean;
  lastSeen?: LastSeen | null;
  showLastSeen?: boolean;
  awaiting?: boolean;
  labels?: { lastSeen: string; lastSeenNever: string; awaitingArrival: string };
}) {
  const visitor = toSafeVisitor(visit.visitor);

  return (
    <li>
      <Link
        href={`/guard/visits/${visit.id}`}
        className="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--surface-muted)]"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--text-strong)]">
            {visitor.fullName}
          </span>
          <span className="block truncate text-xs text-muted">
            {visit.teacher.name}
            {visit.destination ? ` · ${visit.destination.nameEn}` : ''}
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {visit.checkedInAt
              ? `In ${formatTime(visit.checkedInAt)}`
              : formatTimeRange(visit.expectedStart, visit.expectedEnd)}
            {' · '}
            <span className="font-mono">{visit.badgeNumber}</span>
          </span>
          {showLastSeen && labels ? (
            <span className="mt-0.5 block truncate text-xs text-muted">
              {labels.lastSeen}:{' '}
              {lastSeen ? (
                <>
                  {lastSeen.destinationName ?? '-'} · {formatTime(lastSeen.at)} ·{' '}
                  {lastSeen.confirmedBy}
                </>
              ) : (
                labels.lastSeenNever
              )}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <VisitStatusPill status={visit.status} overdue={overdue} />
          {awaiting && labels ? <Pill tone="danger">{labels.awaitingArrival}</Pill> : null}
          {overdue ? <Pill tone="warning">late</Pill> : null}
        </span>
      </Link>
    </li>
  );
}

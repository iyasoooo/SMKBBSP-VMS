import type { Metadata } from 'next';
import Link from 'next/link';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { listOnSiteVisits } from '@/lib/domain/gate';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { isOverdue, toSafeVisitor } from '@/lib/domain/presenters';
import { formatTime, diffMinutes, formatDuration } from '@/lib/time';
import { Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';
import { VisitStatusPill } from '@/components/status-pill';

export const metadata: Metadata = { title: 'On site now' };
export const dynamic = 'force-dynamic';

export default async function ActiveVisitorsPage() {
  await requireGuardOrAdmin('/guard/active');
  const [visits, settings, locale] = await Promise.all([
    listOnSiteVisits(),
    getSettings(),
    getLocale(),
  ]);
  const t = getDictionary(locale);

  const now = new Date();
  const totalPeople = visits.reduce((sum, visit) => sum + (visit.appointment?.partySize ?? 1), 0);

  return (
    <>
      <PageHeading
        title={t.onSite}
        description={`${visits.length} visitor record(s), ${totalPeople} ${t.totalPeople.toLowerCase()}`}
        action={
          <ButtonLink href="/guard/emergency" variant="secondary" size="lg">
            {t.emergency}
          </ButtonLink>
        }
      />

      <Card>
        {visits.length === 0 ? (
          <EmptyState title={t.noOnSite} description={t.noExpected} />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t.onSite}</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">{t.visitor}</th>
                  <th scope="col" className="px-5 py-3 font-medium">{t.badgeNumber}</th>
                  <th scope="col" className="px-5 py-3 font-medium">{t.host}</th>
                  <th scope="col" className="px-5 py-3 font-medium">{t.checkInTime}</th>
                  <th scope="col" className="px-5 py-3 font-medium">{t.expectedEnd}</th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {visits.map((visit) => {
                  const overdue = isOverdue(visit, settings.overdueGraceMinutes, now);
                  return (
                    <tr key={visit.id} className="hover:bg-[var(--surface-muted)]">
                      <td className="px-5 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {toSafeVisitor(visit.visitor).fullName}
                        </span>
                        <span className="block text-xs text-muted">
                          {visit.destination?.nameEn ?? '-'}
                          {(visit.appointment?.partySize ?? 1) > 1
                            ? ` · ${visit.appointment?.partySize} people`
                            : ''}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">{visit.badgeNumber}</td>
                      <td className="px-5 py-3">{visit.teacher.name}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {visit.checkedInAt ? (
                          <>
                            <span className="block">{formatTime(visit.checkedInAt)}</span>
                            <span className="block text-xs text-muted">
                              {formatDuration(diffMinutes(visit.checkedInAt, now))} ago
                            </span>
                          </>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="block">{formatTime(visit.expectedEnd)}</span>
                        <VisitStatusPill status={visit.status} overdue={overdue} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/guard/visits/${visit.id}`}
                          className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          {t.checkOut}
                          <span className="sr-only"> {visit.badgeNumber}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </>
  );
}

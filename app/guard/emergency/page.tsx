import type { Metadata } from 'next';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { listOnSiteVisits } from '@/lib/domain/gate';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { isOverdue, toSafeVisitor } from '@/lib/domain/presenters';
import { formatDateTime, formatTime } from '@/lib/time';
import { EmptyState } from '@/components/ui/surface';
import { PrintButton } from '@/components/print-button';

export const metadata: Metadata = { title: 'Emergency visitor list' };
export const dynamic = 'force-dynamic';

/**
 * Emergency on-site list.
 *
 * Deliberately excluded from this page, per the specification: identity
 * numbers, contact details, and the detailed purpose of each visit. In an
 * evacuation this sheet gets carried around and read aloud by whoever is
 * holding it, so it carries only what a headcount needs.
 *
 * The people total sums party sizes, not rows: one visit with a party of three
 * is three people to account for.
 */
export default async function EmergencyListPage() {
  await requireGuardOrAdmin('/guard/emergency');
  const [visits, settings, locale] = await Promise.all([
    listOnSiteVisits(),
    getSettings(),
    getLocale(),
  ]);
  const t = getDictionary(locale);

  const now = new Date();
  const totalPeople = visits.reduce(
    (sum, visit) => sum + (visit.appointment?.partySize ?? 1),
    0,
  );
  const overdueCount = visits.filter((visit) =>
    isOverdue(visit, settings.overdueGraceMinutes, now),
  ).length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.emergencyHeading}</h1>
          <p className="mt-1 text-sm text-muted">{t.emergencySubtitle}</p>
          <p className="mt-1 text-sm">
            {t.generatedAt}: <strong>{formatDateTime(now)}</strong>
          </p>
        </div>
        <div className="no-print">
          <PrintButton label={t.print} />
        </div>
      </div>

      {/* High-contrast totals: the two numbers that matter in an evacuation. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div
          className="rounded-xl px-5 py-4 print-avoid-break"
          style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}
        >
          <p className="text-xs tracking-wide uppercase opacity-90">{t.totalPeople}</p>
          <p className="text-4xl font-bold">{totalPeople}</p>
        </div>
        <div className="surface-card rounded-xl px-5 py-4">
          <p className="text-xs tracking-wide text-muted uppercase">{t.totalVisitors}</p>
          <p className="text-4xl font-bold">{visits.length}</p>
        </div>
        <div className="surface-card rounded-xl px-5 py-4">
          <p className="text-xs tracking-wide text-muted uppercase">{t.overdue}</p>
          <p
            className="text-4xl font-bold"
            style={{ color: overdueCount > 0 ? 'var(--danger)' : undefined }}
          >
            {overdueCount}
          </p>
        </div>
      </div>

      {visits.length === 0 ? (
        <div className="surface-card rounded-xl">
          <EmptyState title={t.noOneOnSite} />
        </div>
      ) : (
        <div className="surface-card min-w-0 overflow-x-auto rounded-xl">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {t.emergencyHeading} - {formatDateTime(now)}
            </caption>
            <thead className="border-b-2 border-[var(--line-strong)] text-xs tracking-wide uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">{t.visitor}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t.badgeNumber}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t.host}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t.destination}</th>
                <th scope="col" className="px-4 py-3 text-center font-semibold">{t.partySize}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t.checkInTime}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t.expectedEnd}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line-soft)]">
              {visits.map((visit) => {
                const overdue = isOverdue(visit, settings.overdueGraceMinutes, now);
                return (
                  <tr
                    key={visit.id}
                    className="print-avoid-break"
                    style={overdue ? { background: 'var(--danger-soft)' } : undefined}
                  >
                    <td className="px-4 py-3 font-semibold">
                      {toSafeVisitor(visit.visitor).fullName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{visit.badgeNumber}</td>
                    <td className="px-4 py-3">{visit.teacher.name}</td>
                    <td className="px-4 py-3">{visit.destination?.nameEn ?? '-'}</td>
                    <td className="px-4 py-3 text-center font-semibold">
                      {visit.appointment?.partySize ?? 1}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {visit.checkedInAt ? formatTime(visit.checkedInAt) : '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatTime(visit.expectedEnd)}
                      {overdue ? (
                        <strong className="ml-2 uppercase" style={{ color: 'var(--danger-text)' }}>
                          {t.overdue}
                        </strong>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-muted">
        {settings.schoolName} &middot; {t.generatedAt} {formatDateTime(now)}. Identity numbers,
        contact details and visit purposes are intentionally omitted from this list.
      </p>
    </div>
  );
}

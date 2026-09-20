import type { Metadata } from 'next';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { parseReportFilters, runReport } from '@/lib/reports/query';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getLocale } from '@/lib/theme';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { PageHeading } from '@/components/ui/surface';
import { Pagination } from '@/components/pagination';
import { ReportFilterBar } from '@/components/report-filters';
import { ReportTable } from '@/components/report-table';

export const metadata: Metadata = { title: 'Visitor history' };
export const dynamic = 'force-dynamic';

/**
 * Visitor history for the gate.
 *
 * The same query and the same table the administrator sees, so the two cannot
 * disagree about what a visit record says. What differs is the export: it is
 * absent here by deliberate decision, because the gate terminal is a shared
 * device that is often left signed in, and one click that downloads every visit
 * the school has ever recorded does not belong on it. The button is not merely
 * hidden - `/admin/reports/export` answers 404 to a guard, since hiding a link
 * is not access control.
 *
 * Identity numbers arrive masked from `runReport`. Nothing on this screen
 * reveals one, and the audited administrator reveal is not reachable from here.
 */
export default async function GuardReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireGuardOrAdmin('/guard/reports');
  const t = getDictionary(await getLocale());
  const params = await searchParams;

  const filters = parseReportFilters(params);
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const [report, teachers, destinations, visitTypes] = await Promise.all([
    runReport(filters, { page, pageSize: DEFAULT_PAGE_SIZE }),
    prisma.user.findMany({
      where: { role: Role.TEACHER },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.destination.findMany({ select: { id: true, nameEn: true }, orderBy: { nameEn: 'asc' } }),
    prisma.visitType.findMany({ select: { id: true, nameEn: true }, orderBy: { nameEn: 'asc' } }),
  ]);

  const queryForPaging: Record<string, string | undefined> = {
    from: filters.from,
    to: filters.to,
    status: filters.status === 'ALL' ? undefined : filters.status,
    teacherId: filters.teacherId,
    destinationId: filters.destinationId,
    visitTypeId: filters.visitTypeId,
    source: filters.source === 'ALL' ? undefined : filters.source,
    category: filters.category === 'ALL' ? undefined : filters.category,
  };

  return (
    <>
      <PageHeading title={t.historyHeading} description={t.historySubtitle} />

      <ReportFilterBar filters={filters} options={{ teachers, destinations, visitTypes }} />

      <ReportTable report={report} emptyDescription={t.historyEmpty} />

      <Pagination
        page={page}
        total={report.total}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/guard/reports"
        query={queryForPaging}
      />
    </>
  );
}

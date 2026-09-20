import type { Metadata } from 'next';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireOversight } from '@/lib/auth/authorize';
import { parseReportFilters, runReport } from '@/lib/reports/query';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { PageHeading } from '@/components/ui/surface';
import { Pagination } from '@/components/pagination';
import { ReportFilterBar } from '@/components/report-filters';
import { ReportTable } from '@/components/report-table';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireOversight('/admin/reports');
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
      <PageHeading
        title="Reports"
        description="Filter visit history and export it. Identity numbers are masked in every export."
      />

      <ReportFilterBar
        filters={filters}
        options={{ teachers, destinations, visitTypes }}
        canExport
      />

      <ReportTable
        report={report}
        emptyDescription="Try widening the date range or clearing a filter. Exporting now produces an empty file with the same filter summary."
      />

      <Pagination
        page={page}
        total={report.total}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/admin/reports"
        query={queryForPaging}
      />
    </>
  );
}

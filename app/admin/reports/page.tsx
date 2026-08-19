import type { Metadata } from 'next';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireOversight } from '@/lib/auth/authorize';
import { parseReportFilters, REPORT_COLUMNS, runReport } from '@/lib/reports/query';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { VisitStatusPill } from '@/components/status-pill';
import { Pagination } from '@/components/pagination';
import { ReportFilterBar } from './filters';

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

      <ReportFilterBar filters={filters} options={{ teachers, destinations, visitTypes }} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-5 py-3">
          <p className="text-sm font-medium">
            {report.total} record{report.total === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-muted">
            {filters.from} to {filters.to}
          </p>
        </div>

        {report.rows.length === 0 ? (
          <EmptyState
            title="No records match these filters"
            description="Try widening the date range or clearing a filter. Exporting now produces an empty file with the same filter summary."
          />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Visit report, {filters.from} to {filters.to}
              </caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  {REPORT_COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className="px-3 py-3 font-medium whitespace-nowrap">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {report.rows.map((row) => (
                  <tr key={`${row.reference}-${row.scheduledDate}-${row.visitorName}`}>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.reference}</td>
                    <td className="px-3 py-2 font-medium">{row.visitorName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.identityMasked}</td>
                    <td className="px-3 py-2">{row.category}</td>
                    <td className="px-3 py-2">{row.hostName}</td>
                    <td className="px-3 py-2">{row.destinationName}</td>
                    <td className="px-3 py-2">{row.visitTypeName}</td>
                    <td className="px-3 py-2">{row.source}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.scheduledDate}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.scheduledWindow}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.actualIn}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.actualOut}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.durationMinutes ?? '-'}
                    </td>
                    <td className="px-3 py-2">
                      <VisitStatusPill status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

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

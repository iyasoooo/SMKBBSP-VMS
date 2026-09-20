import type { Metadata } from 'next';
import Link from 'next/link';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAdminister, requireOversight } from '@/lib/auth/authorize';
import { parseReportFilters, runReport } from '@/lib/reports/query';
import { markNoShowsAction } from '@/app/admin/actions';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { VisitStatusPill } from '@/components/status-pill';
import { Pagination } from '@/components/pagination';
import { ActionForm } from '@/components/action-form';
import { ReportFilterBar } from '@/components/report-filters';

export const metadata: Metadata = { title: 'Visit history' };
export const dynamic = 'force-dynamic';

/**
 * Visit history.
 *
 * Uses exactly the same filter parsing and query as the reports screen, so the
 * two can never disagree about what a filter means.
 */
export default async function AdminVisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireOversight('/admin/visits');
  // Marking no-shows changes records, so it belongs to the administrator.
  const mayAct = canAdminister(user.role);
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

  return (
    <>
      <PageHeading
        title="Visit history"
        description="Search and filter every recorded visit. Identity numbers are masked."
      />

      <ReportFilterBar
        filters={filters}
        options={{ teachers, destinations, visitTypes }}
        canExport
      />

      <Card className="mb-5 p-4">
        <h2 className="text-sm font-semibold">Housekeeping</h2>
        <p className="mt-1 mb-3 text-sm text-muted">
          Mark expected visits as no-shows once their window closed more than an hour ago.
        </p>
        {mayAct ? (
          <ActionForm
            action={markNoShowsAction}
            submitLabel="Mark past visits as no-show"
            variant="secondary"
            confirm="Mark all overdue expected visits as no-shows?"
            successMessage="Past expected visits have been marked as no-shows."
          />
        ) : (
          <p className="text-sm text-muted">
            An administrator carries this out; you are viewing these records only.
          </p>
        )}
      </Card>

      <Card>
        {report.rows.length === 0 ? (
          <EmptyState title="No visits match these filters" />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Visit history</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Reference</th>
                  <th scope="col" className="px-4 py-3 font-medium">Visitor</th>
                  <th scope="col" className="px-4 py-3 font-medium">Host</th>
                  <th scope="col" className="px-4 py-3 font-medium">Date</th>
                  <th scope="col" className="px-4 py-3 font-medium">In / out</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {report.rows.map((row) => (
                  <tr key={`${row.reference}-${row.visitorName}-${row.scheduledDate}`}>
                    <td className="px-4 py-3 font-mono text-xs">{row.reference}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-[var(--text-strong)]">
                        {row.visitorName}
                      </span>
                      <span className="block font-mono text-xs text-muted">
                        {row.identityMasked}
                      </span>
                    </td>
                    <td className="px-4 py-3">{row.hostName}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="block">{row.scheduledDate}</span>
                      <span className="block text-xs text-muted">{row.scheduledWindow}</span>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className="block">{row.actualIn}</span>
                      <span className="block text-muted">{row.actualOut}</span>
                    </td>
                    <td className="px-4 py-3">
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
        basePath="/admin/visits"
        query={{
          from: filters.from,
          to: filters.to,
          status: filters.status === 'ALL' ? undefined : filters.status,
          teacherId: filters.teacherId,
          destinationId: filters.destinationId,
          visitTypeId: filters.visitTypeId,
          source: filters.source === 'ALL' ? undefined : filters.source,
          category: filters.category === 'ALL' ? undefined : filters.category,
        }}
      />

      <p className="mt-4 text-xs text-muted">
        Need a file?{' '}
        <Link href="/admin/reports" className="underline underline-offset-2">
          Export these results as PDF or Excel
        </Link>
        .
      </p>
    </>
  );
}

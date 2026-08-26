import { REPORT_COLUMNS, type ReportResult } from '@/lib/reports/query';
import { Card, EmptyState, TableScroll } from '@/components/ui/surface';
import { VisitStatusPill } from '@/components/status-pill';

/**
 * The rendered result of a report query.
 *
 * Shared by the administrator and guard screens for the same reason
 * `runReport` is shared: two copies of this markup would drift, and the first
 * symptom would be one role quietly seeing a column the other does not. There
 * is one projection of a row and one way to draw it.
 *
 * Identity numbers arrive already masked from `runReport`, so nothing here can
 * widen what a viewer sees. The audited administrator reveal is a different
 * screen entirely and is not reachable from this table.
 */
export function ReportTable({
  report,
  emptyDescription,
}: {
  report: ReportResult;
  /** Differs by screen, because only one of them can export. */
  emptyDescription: string;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-5 py-3">
        <p className="text-sm font-medium">
          {report.total} record{report.total === 1 ? '' : 's'}
        </p>
        <p className="text-xs text-muted">
          {report.filters.from} to {report.filters.to}
        </p>
      </div>

      {report.rows.length === 0 ? (
        <EmptyState title="No records match these filters" description={emptyDescription} />
      ) : (
        <TableScroll>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Visit report, {report.filters.from} to {report.filters.to}
            </caption>
            <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
              <tr>
                {REPORT_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-3 py-3 font-medium whitespace-nowrap"
                  >
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
                  <td className="px-3 py-2 text-right tabular-nums">{row.durationMinutes ?? '-'}</td>
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
  );
}

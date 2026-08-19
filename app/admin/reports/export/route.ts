import { NextResponse, type NextRequest } from 'next/server';
import { OVERSIGHT_ROLES } from '@/lib/auth/authorize';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/domain/settings';
import { parseReportFilters, runReport } from '@/lib/reports/query';
import { buildReportWorkbook, safeFilename } from '@/lib/reports/xlsx';
import { buildReportPdf } from '@/lib/reports/pdf';
import { recordAudit } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';

/**
 * Report download endpoint.
 *
 * A route handler rather than a server action because the response is a binary
 * file with its own Content-Type and Content-Disposition.
 *
 * Authorization is enforced here, not by the admin layout: a route handler is
 * reachable directly by URL and never renders inside that layout.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();

  /*
   * Administrators and the principal. Exporting reads data rather than
   * changing it, and reporting upward is the principal's job; the export is
   * audited against whoever ran it either way.
   *
   * Deliberately 404 rather than 403 for anyone else: the existence of the
   * export endpoint is not something a guard or teacher needs to learn.
   */
  if (!user || !OVERSIGHT_ROLES.includes(user.role)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const format = params.format === 'pdf' ? 'pdf' : 'xlsx';
  const filters = parseReportFilters(params);

  // pageSize 0 = every matching row, so an export is never truncated to the
  // page the admin happened to be viewing.
  const report = await runReport(filters, { pageSize: 0 });
  const settings = await getSettings();

  const generatedAt = new Date();
  const filename = safeFilename(
    `visitorpass-report-${filters.from}-to-${filters.to}`,
    format === 'pdf' ? 'pdf' : 'xlsx',
  );

  const body =
    format === 'pdf'
      ? await buildReportPdf(report, { schoolName: settings.schoolName, generatedAt })
      : await buildReportWorkbook(report, { schoolName: settings.schoolName, generatedAt });

  await recordAudit({
    action: AUDIT_ACTIONS.REPORT_EXPORTED,
    targetType: 'Report',
    actorUserId: user.id,
    metadata: {
      format,
      rowCount: report.total,
      from: filters.from,
      to: filters.to,
      status: filters.status,
      source: filters.source,
      category: filters.category,
    },
  });

  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type':
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    },
  });
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { AppointmentStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { expireLapsedRequests } from '@/lib/domain/decisions';
import { requireOversight } from '@/lib/auth/authorize';
import { SAFE_VISITOR_SELECT, toSafeVisitor } from '@/lib/domain/presenters';
import { formatDate, formatTimeRange } from '@/lib/time';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { AppointmentStatusPill } from '@/components/status-pill';
import { Pagination } from '@/components/pagination';

export const metadata: Metadata = { title: 'Appointments' };
export const dynamic = 'force-dynamic';

const STATUS_TABS = [
  { key: 'REVIEW_REQUIRED', label: 'Needs review' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
] as const;

export default async function AdminAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  await requireOversight('/admin/appointments');
  await expireLapsedRequests();
  const params = await searchParams;

  const activeTab =
    STATUS_TABS.find((tab) => tab.key === params.status) ?? STATUS_TABS[4];
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const where: Prisma.AppointmentWhereInput =
    activeTab.key === 'ALL'
      ? {}
      : { status: AppointmentStatus[activeTab.key as keyof typeof AppointmentStatus] };

  const [total, appointments, reviewCount] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: {
        visitor: { select: SAFE_VISITOR_SELECT },
        teacher: { select: { name: true } },
        visitType: { select: { nameEn: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.appointment.count({ where: { status: AppointmentStatus.REVIEW_REQUIRED } }),
  ]);

  return (
    <>
      <PageHeading
        title="Appointments"
        description="Every visit request, across all staff."
      />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = tab.key === activeTab.key;
          return (
            <Link
              key={tab.key}
              href={`/admin/appointments?status=${tab.key}`}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${
                active
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--line-strong)] bg-[var(--surface-card)] hover:bg-[var(--surface-muted)]'
              }`}
            >
              {tab.label}
              {tab.key === 'REVIEW_REQUIRED' && reviewCount > 0 ? (
                <span
                  className="rounded-full px-1.5 text-xs font-bold"
                  style={{ background: 'var(--danger)', color: '#fff' }}
                >
                  {reviewCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <Card>
        {appointments.length === 0 ? (
          <EmptyState title="No appointments match this filter" />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Appointments, {activeTab.label}</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Reference</th>
                  <th scope="col" className="px-4 py-3 font-medium">Visitor</th>
                  <th scope="col" className="px-4 py-3 font-medium">Host</th>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Type</th>
                  <th scope="col" className="px-4 py-3 font-medium">Source</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {appointments.map((appointment) => {
                  const visitor = toSafeVisitor(appointment.visitor);
                  return (
                    <tr key={appointment.id} className="hover:bg-[var(--surface-muted)]">
                      <td className="px-4 py-3 font-mono text-xs">{appointment.referenceNumber}</td>
                      <td className="px-4 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {visitor.fullName}
                        </span>
                        <span className="block font-mono text-xs text-muted">
                          {visitor.identityMasked}
                        </span>
                      </td>
                      <td className="px-4 py-3">{appointment.teacher.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="block">{formatDate(appointment.scheduledStart)}</span>
                        <span className="block text-xs text-muted">
                          {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}
                        </span>
                      </td>
                      <td className="px-4 py-3">{appointment.visitType.nameEn}</td>
                      <td className="px-4 py-3">
                        {appointment.source === 'WALK_IN' ? 'Walk-in' : 'Online'}
                      </td>
                      <td className="px-4 py-3">
                        <AppointmentStatusPill status={appointment.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/appointments/${appointment.id}`}
                          className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          Open
                          <span className="sr-only"> {appointment.referenceNumber}</span>
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

      <Pagination
        page={page}
        total={total}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/admin/appointments"
        query={{ status: activeTab.key }}
      />
    </>
  );
}

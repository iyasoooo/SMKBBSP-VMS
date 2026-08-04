import type { Metadata } from 'next';
import Link from 'next/link';
import { AppointmentStatus, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireTeacher } from '@/lib/auth/authorize';
import { formatDate, formatTimeRange } from '@/lib/time';
import { SAFE_VISITOR_SELECT, toSafeVisitor } from '@/lib/domain/presenters';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { AppointmentStatusPill } from '@/components/status-pill';
import { Pagination } from '@/components/pagination';

export const metadata: Metadata = { title: 'My requests' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'pending', label: 'Pending', statuses: [AppointmentStatus.PENDING] },
  { key: 'approved', label: 'Approved', statuses: [AppointmentStatus.APPROVED] },
  { key: 'rejected', label: 'Rejected', statuses: [AppointmentStatus.REJECTED] },
  {
    key: 'closed',
    label: 'Cancelled / expired',
    statuses: [AppointmentStatus.CANCELLED, AppointmentStatus.EXPIRED],
  },
  { key: 'all', label: 'All', statuses: [] },
] as const;

export default async function TeacherRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const user = await requireTeacher();
  const params = await searchParams;

  const filter = FILTERS.find((f) => f.key === params.filter) ?? FILTERS[0];
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  // teacherId is always part of the WHERE clause, so pagination and filters
  // can never widen the result set beyond this teacher's own queue.
  const where: Prisma.AppointmentWhereInput = {
    teacherId: user.id,
    ...(filter.statuses.length > 0 ? { status: { in: [...filter.statuses] } } : {}),
  };

  const [total, appointments] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: { visitor: { select: SAFE_VISITOR_SELECT }, visitType: true, destination: true },
      orderBy: [{ scheduledStart: 'desc' }],
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
  ]);

  return (
    <>
      <PageHeading
        title="My requests"
        description="Visit requests where you are the host teacher."
      />

      <nav aria-label="Filter requests" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const active = option.key === filter.key;
          return (
            <Link
              key={option.key}
              href={`/teacher/requests?filter=${option.key}`}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${
                active
                  ? 'border-transparent bg-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--line-strong)] bg-[var(--surface-card)] text-[var(--text-body)] hover:bg-[var(--surface-muted)]'
              }`}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      <Card>
        {appointments.length === 0 ? (
          <EmptyState
            title="Nothing to show"
            description={
              filter.key === 'pending'
                ? 'You have no requests waiting for a decision.'
                : 'No requests match this filter.'
            }
          />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Your visit requests, {filter.label.toLowerCase()}
              </caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Visitor</th>
                  <th scope="col" className="px-5 py-3 font-medium">When</th>
                  <th scope="col" className="px-5 py-3 font-medium">Type</th>
                  <th scope="col" className="px-5 py-3 font-medium">Reference</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {appointments.map((appointment) => {
                  const visitor = toSafeVisitor(appointment.visitor);
                  return (
                    <tr key={appointment.id} className="hover:bg-[var(--surface-muted)]">
                      <td className="px-5 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {visitor.fullName}
                        </span>
                        <span className="block text-xs text-muted">{visitor.identityMasked}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="block">{formatDate(appointment.scheduledStart)}</span>
                        <span className="block text-xs text-muted">
                          {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}
                        </span>
                      </td>
                      <td className="px-5 py-3">{appointment.visitType.nameEn}</td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {appointment.referenceNumber}
                      </td>
                      <td className="px-5 py-3">
                        <AppointmentStatusPill status={appointment.status} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          href={`/teacher/requests/${appointment.id}`}
                          className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          {appointment.status === AppointmentStatus.PENDING ? 'Decide' : 'View'}
                          <span className="sr-only"> request {appointment.referenceNumber}</span>
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
        basePath="/teacher/requests"
        query={{ filter: filter.key }}
      />
    </>
  );
}

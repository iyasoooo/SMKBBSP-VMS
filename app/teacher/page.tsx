import type { Metadata } from 'next';
import Link from 'next/link';
import { AppointmentStatus, VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireTeacher } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { endOfZonedDay, formatDate, formatTimeRange, startOfZonedDay } from '@/lib/time';
import { SAFE_VISITOR_SELECT, toSafeVisitor } from '@/lib/domain/presenters';
import { Card, CardHeader, EmptyState, PageHeading } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';
import { AppointmentStatusPill, VisitStatusPill } from '@/components/status-pill';

export const metadata: Metadata = { title: 'Teacher overview' };
export const dynamic = 'force-dynamic';

export default async function TeacherHomePage() {
  const user = await requireTeacher();
  const settings = await getSettings();

  const now = new Date();
  const dayStart = startOfZonedDay(now);
  const dayEnd = endOfZonedDay(now);

  // Every query is scoped by teacherId at the database level.
  const [pendingCount, pending, todayVisits, recentDecisions] = await Promise.all([
    prisma.appointment.count({
      where: { teacherId: user.id, status: AppointmentStatus.PENDING },
    }),
    prisma.appointment.findMany({
      where: { teacherId: user.id, status: AppointmentStatus.PENDING },
      include: { visitor: { select: SAFE_VISITOR_SELECT }, visitType: true },
      orderBy: { scheduledStart: 'asc' },
      take: 5,
    }),
    prisma.visit.findMany({
      where: {
        teacherId: user.id,
        expectedStart: { gte: dayStart, lt: dayEnd },
        status: { in: [VisitStatus.EXPECTED, VisitStatus.CHECKED_IN, VisitStatus.CHECKED_OUT] },
      },
      include: { visitor: { select: SAFE_VISITOR_SELECT }, destination: true },
      orderBy: { expectedStart: 'asc' },
    }),
    prisma.appointment.findMany({
      where: {
        teacherId: user.id,
        status: { in: [AppointmentStatus.APPROVED, AppointmentStatus.REJECTED] },
        decidedAt: { not: null },
      },
      include: { visitor: { select: SAFE_VISITOR_SELECT } },
      orderBy: { decidedAt: 'desc' },
      take: 5,
    }),
  ]);

  return (
    <>
      <PageHeading
        title={`Good day, ${user.name.split(' ').slice(0, 2).join(' ')}`}
        description={`${formatDate(now)} at ${settings.schoolShortName}`}
        action={
          pendingCount > 0 ? (
            <ButtonLink href="/teacher/requests">
              Review {pendingCount} pending request{pendingCount === 1 ? '' : 's'}
            </ButtonLink>
          ) : null
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Waiting for your decision"
            description={
              pendingCount === 0
                ? 'Nothing needs your attention.'
                : `${pendingCount} request${pendingCount === 1 ? '' : 's'} pending.`
            }
            action={
              pendingCount > 0 ? (
                <ButtonLink href="/teacher/requests" variant="secondary">
                  View all
                </ButtonLink>
              ) : null
            }
          />

          {pending.length === 0 ? (
            <EmptyState
              title="No pending requests"
              description="When a visitor asks to meet you, it will appear here for approval."
            />
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {pending.map((appointment) => (
                <li key={appointment.id}>
                  <Link
                    href={`/teacher/requests/${appointment.id}`}
                    className="flex min-h-16 items-center justify-between gap-3 px-5 py-3 hover:bg-[var(--surface-muted)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                        {toSafeVisitor(appointment.visitor).fullName}
                      </span>
                      <span className="block text-xs text-muted">
                        {formatDate(appointment.scheduledStart)} &middot;{' '}
                        {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}{' '}
                        &middot; {appointment.visitType.nameEn}
                      </span>
                    </span>
                    <AppointmentStatusPill status={appointment.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Your visitors today" description={formatDate(now)} />

          {todayVisits.length === 0 ? (
            <EmptyState
              title="No visitors scheduled today"
              description="Approved visits for today will be listed here."
            />
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {todayVisits.map((visit) => (
                <li key={visit.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                      {toSafeVisitor(visit.visitor).fullName}
                    </span>
                    <span className="block text-xs text-muted">
                      {formatTimeRange(visit.expectedStart, visit.expectedEnd)}
                      {visit.destination ? ` · ${visit.destination.nameEn}` : ''}
                    </span>
                  </span>
                  <VisitStatusPill status={visit.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Your recent decisions"
          action={
            <ButtonLink href="/teacher/visits" variant="secondary">
              Visit history
            </ButtonLink>
          }
        />

        {recentDecisions.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            description="Requests you approve or reject will be listed here."
          />
        ) : (
          <ul className="divide-y divide-[var(--line-soft)]">
            {recentDecisions.map((appointment) => (
              <li key={appointment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[var(--text-strong)]">
                    {toSafeVisitor(appointment.visitor).fullName}
                  </span>
                  <span className="block font-mono text-xs text-muted">
                    {appointment.referenceNumber}
                  </span>
                </span>
                <AppointmentStatusPill status={appointment.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

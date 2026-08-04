import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { SAFE_VISITOR_SELECT, identityTypeLabel, toSafeVisitor } from '@/lib/domain/presenters';
import { formatDate, formatDateTime, formatDuration, formatTimeRange, diffMinutes } from '@/lib/time';
import { Card, DetailRow, EmptyState, PageHeading } from '@/components/ui/surface';
import { VisitStatusPill } from '@/components/status-pill';

export const metadata: Metadata = { title: 'Visit detail' };
export const dynamic = 'force-dynamic';

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Visit created',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  DENIED: 'Entry denied',
  CANCELLED: 'Cancelled',
  MARKED_NO_SHOW: 'Marked no-show',
  ID_SIGHTED: 'Physical ID sighted',
  BADGE_PRINTED: 'Badge printed',
  NOTE_ADDED: 'Note added',
};

export default async function AdminVisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      teacher: { select: { name: true } },
      destination: true,
      checkedInBy: { select: { name: true } },
      checkedOutBy: { select: { name: true } },
      idSightedBy: { select: { name: true } },
      appointment: { select: { id: true, referenceNumber: true, purpose: true, partySize: true } },
      events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
    },
  });

  if (!visit) notFound();

  const visitor = toSafeVisitor(visit.visitor);
  const duration =
    visit.checkedInAt && visit.checkedOutAt
      ? diffMinutes(visit.checkedInAt, visit.checkedOutAt)
      : null;

  return (
    <>
      <div className="mb-4">
        <Link href="/admin/visits" className="text-sm text-muted underline-offset-2 hover:underline">
          &larr; Visit history
        </Link>
      </div>

      <PageHeading
        title={visitor.fullName}
        description={`Badge ${visit.badgeNumber}`}
        action={<VisitStatusPill status={visit.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Visit</h2>
          </div>
          <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
            <DetailRow label="Reference">
              {visit.appointment ? (
                <Link
                  href={`/admin/appointments/${visit.appointment.id}`}
                  className="font-mono text-[var(--accent)] underline underline-offset-2"
                >
                  {visit.appointment.referenceNumber}
                </Link>
              ) : (
                '-'
              )}
            </DetailRow>
            <DetailRow label="Identity">
              <span className="font-mono">
                {identityTypeLabel(visitor.identityType)} {visitor.identityMasked}
              </span>
            </DetailRow>
            <DetailRow label="Host">{visit.teacher.name}</DetailRow>
            <DetailRow label="Destination">{visit.destination?.nameEn ?? '-'}</DetailRow>
            <DetailRow label="Scheduled">
              {formatDate(visit.expectedStart)} &middot;{' '}
              {formatTimeRange(visit.expectedStart, visit.expectedEnd)}
            </DetailRow>
            <DetailRow label="People">{visit.appointment?.partySize ?? 1}</DetailRow>
            {visit.appointment ? (
              <DetailRow label="Purpose">{visit.appointment.purpose}</DetailRow>
            ) : null}
            <DetailRow label="Checked in">
              {visit.checkedInAt
                ? `${formatDateTime(visit.checkedInAt)}${visit.checkedInBy ? ` · ${visit.checkedInBy.name}` : ''}`
                : '-'}
            </DetailRow>
            <DetailRow label="Checked out">
              {visit.checkedOutAt
                ? `${formatDateTime(visit.checkedOutAt)}${visit.checkedOutBy ? ` · ${visit.checkedOutBy.name}` : ''}`
                : '-'}
            </DetailRow>
            <DetailRow label="Time on site">
              {duration === null ? '-' : formatDuration(duration)}
            </DetailRow>
            <DetailRow label="ID sighted">
              {visit.idSightedAt
                ? `${formatDateTime(visit.idSightedAt)}${visit.idSightedBy ? ` · ${visit.idSightedBy.name}` : ''}`
                : 'Not recorded'}
            </DetailRow>
            {visit.denialCode ? (
              <DetailRow label="Denial code">{visit.denialCode}</DetailRow>
            ) : null}
            {visit.guardNote ? <DetailRow label="Guard note">{visit.guardNote}</DetailRow> : null}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Timeline</h2>
            <p className="mt-0.5 text-sm text-muted">
              Recorded events for this visit, oldest first.
            </p>
          </div>

          {visit.events.length === 0 ? (
            <EmptyState title="No events recorded" />
          ) : (
            <ol className="divide-y divide-[var(--line-soft)]">
              {visit.events.map((event) => (
                <li key={event.id} className="flex items-start gap-3 px-5 py-3">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--text-strong)]">
                      {EVENT_LABELS[event.type] ?? event.type}
                    </span>
                    <span className="block text-xs text-muted">
                      {formatDateTime(event.createdAt)}
                      {event.actor ? ` · ${event.actor.name}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

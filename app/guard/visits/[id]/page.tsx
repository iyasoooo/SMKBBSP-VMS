import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { blacklistStateForVisit } from '@/lib/domain/gate';
import {
  SAFE_VISITOR_SELECT,
  identityTypeLabel,
  isOverdue,
  toSafeVisitor,
} from '@/lib/domain/presenters';
import { formatDate, formatDateTime, formatTimeRange } from '@/lib/time';
import { Alert, Card, DetailRow, PageHeading, Pill } from '@/components/ui/surface';
import { buttonClasses } from '@/components/ui/button';
import { VisitStatusPill } from '@/components/status-pill';
import { CheckInPanel, CheckOutPanel, DenyPanel } from './gate-actions';

export const metadata: Metadata = { title: 'Visit detail' };
export const dynamic = 'force-dynamic';

export default async function GuardVisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireGuardOrAdmin();
  const { id } = await params;
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = getDictionary(locale);

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      teacher: { select: { name: true } },
      destination: true,
      checkedInBy: { select: { name: true } },
      checkedOutBy: { select: { name: true } },
      appointment: { include: { visitType: true } },
    },
  });

  if (!visit) notFound();

  const visitor = toSafeVisitor(visit.visitor);
  const now = new Date();
  const overdue = isOverdue(visit, settings.overdueGraceMinutes, now);

  // Re-evaluated on every render: an administrator may have added a blacklist
  // entry since the pass was scanned.
  const blacklist = await blacklistStateForVisit(visit.id, now);
  const requiresIdSighted = visit.appointment?.visitType.requiresIdSighted ?? true;

  return (
    <>
      <div className="mb-4">
        <Link href="/guard" className="text-sm text-muted underline-offset-2 hover:underline">
          &larr; {t.today}
        </Link>
      </div>

      <PageHeading
        title={visitor.fullName}
        description={`${t.badgeNumber} ${visit.badgeNumber}`}
        action={<VisitStatusPill status={visit.status} overdue={overdue} />}
      />

      {blacklist === 'BLOCKED' ? (
        <div className="mb-5">
          <Alert tone="danger" title={t.statusBlocked}>
            {t.blockedInstruction}
          </Alert>
        </div>
      ) : blacklist === 'REVIEW' ? (
        <div className="mb-5">
          <Alert tone="warning" title={t.statusReview}>
            {t.reviewInstruction}
          </Alert>
        </div>
      ) : null}

      {overdue ? (
        <div className="mb-5">
          <Alert tone="warning" title={t.overdue}>
            This visitor was expected to leave by {formatDateTime(visit.expectedEnd)}.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">{t.visitor}</h2>
          </div>
          <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
            <DetailRow label={t.visitor}>{visitor.fullName}</DetailRow>
            <DetailRow label={identityTypeLabel(visitor.identityType)}>
              <span className="font-mono">{visitor.identityMasked}</span>
            </DetailRow>
            <DetailRow label={t.host}>{visit.teacher.name}</DetailRow>
            <DetailRow label={t.destination}>{visit.destination?.nameEn ?? '-'}</DetailRow>
            <DetailRow label={t.appointmentWindow}>
              {formatDate(visit.expectedStart)} &middot;{' '}
              {formatTimeRange(visit.expectedStart, visit.expectedEnd)}
            </DetailRow>
            <DetailRow label={t.partySize}>{visit.appointment?.partySize ?? 1}</DetailRow>
            {visit.appointment?.vehicleNumber ? (
              <DetailRow label={t.vehicle}>{visit.appointment.vehicleNumber}</DetailRow>
            ) : null}
            {visit.appointment ? (
              <DetailRow label={t.purpose}>{visit.appointment.purpose}</DetailRow>
            ) : null}
            <DetailRow label={t.reference}>
              <span className="font-mono text-xs">
                {visit.appointment?.referenceNumber ?? visit.badgeNumber}
              </span>
            </DetailRow>
            <DetailRow label="Check">
              <Pill
                tone={
                  blacklist === 'BLOCKED' ? 'danger' : blacklist === 'REVIEW' ? 'warning' : 'success'
                }
              >
                {blacklist === 'BLOCKED'
                  ? t.statusBlocked
                  : blacklist === 'REVIEW'
                    ? t.statusReview
                    : t.statusClear}
              </Pill>
            </DetailRow>
          </dl>

          {visit.checkedInAt ? (
            <dl className="divide-y divide-[var(--line-soft)] border-t border-[var(--line-soft)] px-5 py-2">
              <DetailRow label={t.checkInTime}>
                {formatDateTime(visit.checkedInAt)}
                {visit.checkedInBy ? ` · ${visit.checkedInBy.name}` : ''}
              </DetailRow>
              {visit.idSightedAt ? (
                <DetailRow label="ID sighted">{formatDateTime(visit.idSightedAt)}</DetailRow>
              ) : null}
              {visit.checkedOutAt ? (
                <DetailRow label="Checked out">
                  {formatDateTime(visit.checkedOutAt)}
                  {visit.checkedOutBy ? ` · ${visit.checkedOutBy.name}` : ''}
                </DetailRow>
              ) : null}
            </dl>
          ) : null}

          {visit.guardNote ? (
            <div className="border-t border-[var(--line-soft)] px-5 py-4">
              <p className="text-xs text-muted">Guard note</p>
              <p className="mt-1 text-sm">{visit.guardNote}</p>
            </div>
          ) : null}
        </Card>

        <div className="flex flex-col gap-4">
          {visit.status === VisitStatus.EXPECTED ? (
            <>
              <CheckInPanel
                visitId={visit.id}
                requiresIdSighted={requiresIdSighted}
                blocked={blacklist === 'BLOCKED'}
                t={t}
              />
              <DenyPanel visitId={visit.id} t={t} />
            </>
          ) : null}

          {visit.status === VisitStatus.CHECKED_IN ? (
            <>
              <CheckOutPanel visitId={visit.id} t={t} />
              <Link href={`/guard/badge/${visit.id}`} className={buttonClasses('secondary', 'lg')}>
                {t.reprintBadge}
              </Link>
            </>
          ) : null}

          {visit.status === VisitStatus.CHECKED_OUT ? (
            <Alert tone="info" title={t.passAlreadyOut}>
              {visit.checkedOutAt ? formatDateTime(visit.checkedOutAt) : ''}
            </Alert>
          ) : null}

          {visit.status === VisitStatus.DENIED ? (
            <Alert tone="danger" title={t.deniedSuccess}>
              {visit.guardNote ?? ''}
            </Alert>
          ) : null}

          {visit.status === VisitStatus.NO_SHOW || visit.status === VisitStatus.CANCELLED ? (
            <Alert tone="info" title={t.alreadyProcessed} />
          ) : null}
        </div>
      </div>
    </>
  );
}

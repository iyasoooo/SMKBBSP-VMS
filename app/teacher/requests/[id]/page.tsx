import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppointmentStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { CompanionList, COMPANION_SELECT } from '@/components/companion-list';
import { requireTeacher } from '@/lib/auth/authorize';
import { formatDate, formatDateTime, formatTimeRange } from '@/lib/time';
import {
  SAFE_VISITOR_SELECT,
  identityTypeLabel,
  toSafeVisitor,
  visitorCategoryLabel,
} from '@/lib/domain/presenters';
import { Alert, Card, DetailRow, PageHeading } from '@/components/ui/surface';
import { AppointmentStatusPill, VisitStatusPill } from '@/components/status-pill';
import { DecisionForm } from './decision-form';

export const metadata: Metadata = { title: 'Request detail' };
export const dynamic = 'force-dynamic';

export default async function TeacherRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireTeacher();
  const { id } = await params;

  /*
   * The `teacherId` filter is the authorization check.
   *
   * Another teacher's request id therefore returns null and renders the same
   * 404 as a genuinely missing record - it never reveals that the request
   * exists but belongs to someone else.
   */
  const appointment = await prisma.appointment.findFirst({
    where: { id, teacherId: user.id },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      visitType: true,
      destination: true,
      visit: true,
      companions: { select: COMPANION_SELECT },
      decidedBy: { select: { name: true } },
    },
  });

  if (!appointment) notFound();

  const visitor = toSafeVisitor(appointment.visitor);
  const isPending = appointment.status === AppointmentStatus.PENDING;
  const isUnderReview = appointment.status === AppointmentStatus.REVIEW_REQUIRED;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/teacher/requests"
          className="text-sm text-muted underline-offset-2 hover:underline"
        >
          &larr; Back to my requests
        </Link>
      </div>

      <PageHeading
        title={visitor.fullName}
        description={`Reference ${appointment.referenceNumber}`}
        action={<AppointmentStatusPill status={appointment.status} />}
      />

      {isUnderReview ? (
        <div className="mb-5">
          <Alert tone="warning" title="Held for office review">
            This request is with the school office and is not yet available for your decision. You
            will be notified if it is released for approval.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">Visit</h2>
            </div>
            <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
              <DetailRow label="Date">{formatDate(appointment.scheduledStart)}</DetailRow>
              <DetailRow label="Time">
                {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}
              </DetailRow>
              <DetailRow label="Type">{appointment.visitType.nameEn}</DetailRow>
              <DetailRow label="Destination">
                {appointment.destination?.nameEn ?? 'To be advised'}
              </DetailRow>
              <DetailRow label="People attending">{appointment.partySize}</DetailRow>
              {appointment.vehicleNumber ? (
                <DetailRow label="Vehicle">{appointment.vehicleNumber}</DetailRow>
              ) : null}
              <DetailRow label="Purpose">{appointment.purpose}</DetailRow>
              <DetailRow label="Submitted">{formatDateTime(appointment.createdAt)}</DetailRow>
            </dl>
          </Card>

          <CompanionList companions={appointment.companions} />

          <Card>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">Visitor</h2>
            </div>
            <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
              <DetailRow label="Name">{visitor.fullName}</DetailRow>
              <DetailRow label="Visiting as">{visitorCategoryLabel(visitor.category)}</DetailRow>
              <DetailRow label={identityTypeLabel(visitor.identityType)}>
                <span className="font-mono">{visitor.identityMasked}</span>
              </DetailRow>
              <DetailRow label="Email">{visitor.emailMasked}</DetailRow>
              <DetailRow label="Phone">{visitor.phoneMasked}</DetailRow>
            </dl>
            <p className="border-t border-[var(--line-soft)] px-5 py-3 text-xs text-muted">
              Contact and identity details are masked. Full values are available only to
              administrators, through an action that is recorded in the audit log.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {isPending ? (
            <DecisionForm appointmentId={appointment.id} />
          ) : (
            <Card className="p-5">
              <h2 className="text-base font-semibold">Decision</h2>
              <dl className="mt-2 divide-y divide-[var(--line-soft)]">
                <DetailRow label="Outcome">
                  <AppointmentStatusPill status={appointment.status} />
                </DetailRow>
                {appointment.decidedAt ? (
                  <DetailRow label="Decided">{formatDateTime(appointment.decidedAt)}</DetailRow>
                ) : null}
                {appointment.decidedBy ? (
                  <DetailRow label="Decided by">{appointment.decidedBy.name}</DetailRow>
                ) : null}
              </dl>
              {appointment.decisionNote ? (
                <div className="mt-3 rounded-lg bg-[var(--surface-inset)] p-3">
                  <p className="text-xs text-muted">Note sent to the visitor</p>
                  <p className="mt-1 text-sm">{appointment.decisionNote}</p>
                </div>
              ) : null}
            </Card>
          )}

          {appointment.visit ? (
            <Card className="p-5">
              <h2 className="text-base font-semibold">Gate status</h2>
              <dl className="mt-2 divide-y divide-[var(--line-soft)]">
                <DetailRow label="Status">
                  <VisitStatusPill status={appointment.visit.status} />
                </DetailRow>
                <DetailRow label="Badge">{appointment.visit.badgeNumber}</DetailRow>
                {appointment.visit.checkedInAt ? (
                  <DetailRow label="Arrived">
                    {formatDateTime(appointment.visit.checkedInAt)}
                  </DetailRow>
                ) : null}
                {appointment.visit.checkedOutAt ? (
                  <DetailRow label="Left">
                    {formatDateTime(appointment.visit.checkedOutAt)}
                  </DetailRow>
                ) : null}
              </dl>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

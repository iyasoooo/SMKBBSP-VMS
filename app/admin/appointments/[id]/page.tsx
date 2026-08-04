import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppointmentStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { adminApproveAction, resolveReviewAction } from '@/app/admin/actions';
import {
  SAFE_VISITOR_SELECT,
  identityTypeLabel,
  toSafeVisitor,
  visitorCategoryLabel,
} from '@/lib/domain/presenters';
import { formatDate, formatDateTime, formatTimeRange } from '@/lib/time';
import { Alert, Card, DetailRow, PageHeading } from '@/components/ui/surface';
import { AppointmentStatusPill, VisitStatusPill } from '@/components/status-pill';
import { ActionForm } from '@/components/action-form';
import { RevealIdentity } from './reveal-identity';

export const metadata: Metadata = { title: 'Appointment detail' };
export const dynamic = 'force-dynamic';

export default async function AdminAppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      teacher: { select: { name: true, email: true } },
      destination: true,
      visitType: true,
      visit: true,
      decidedBy: { select: { name: true } },
      credentials: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!appointment) notFound();

  const visitor = toSafeVisitor(appointment.visitor);
  const underReview = appointment.status === AppointmentStatus.REVIEW_REQUIRED;
  const activeCredential = appointment.credentials.find((c) => !c.revokedAt);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/appointments"
          className="text-sm text-muted underline-offset-2 hover:underline"
        >
          &larr; All appointments
        </Link>
      </div>

      <PageHeading
        title={visitor.fullName}
        description={`Reference ${appointment.referenceNumber}`}
        action={<AppointmentStatusPill status={appointment.status} />}
      />

      {underReview ? (
        <div className="mb-5">
          <Alert tone="warning" title="Held for review">
            A blacklist rule matched this submission, so it was not sent to the host teacher.
            Release it only after checking the blacklist entry. The visitor has not been told.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">Request</h2>
            </div>
            <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
              <DetailRow label="Date">{formatDate(appointment.scheduledStart)}</DetailRow>
              <DetailRow label="Time">
                {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}
              </DetailRow>
              <DetailRow label="Host">{appointment.teacher.name}</DetailRow>
              <DetailRow label="Type">{appointment.visitType.nameEn}</DetailRow>
              <DetailRow label="Destination">
                {appointment.destination?.nameEn ?? 'To be advised'}
              </DetailRow>
              <DetailRow label="Source">
                {appointment.source === 'WALK_IN' ? 'Walk-in' : 'Online'}
              </DetailRow>
              <DetailRow label="People">{appointment.partySize}</DetailRow>
              {appointment.vehicleNumber ? (
                <DetailRow label="Vehicle">{appointment.vehicleNumber}</DetailRow>
              ) : null}
              <DetailRow label="Purpose">{appointment.purpose}</DetailRow>
              <DetailRow label="Submitted">{formatDateTime(appointment.createdAt)}</DetailRow>
              {appointment.decidedAt ? (
                <DetailRow label="Decided">
                  {formatDateTime(appointment.decidedAt)}
                  {appointment.decidedBy ? ` · ${appointment.decidedBy.name}` : ''}
                </DetailRow>
              ) : null}
              {appointment.decisionNote ? (
                <DetailRow label="Note to visitor">{appointment.decisionNote}</DetailRow>
              ) : null}
            </dl>
          </Card>

          <Card>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">Visitor</h2>
            </div>
            <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
              <DetailRow label="Name">{visitor.fullName}</DetailRow>
              <DetailRow label="Category">{visitorCategoryLabel(visitor.category)}</DetailRow>
              <DetailRow label={identityTypeLabel(visitor.identityType)}>
                <span className="font-mono">{visitor.identityMasked}</span>
              </DetailRow>
              <DetailRow label="Email">{visitor.emailMasked}</DetailRow>
              <DetailRow label="Phone">{visitor.phoneMasked}</DetailRow>
            </dl>
          </Card>

          {appointment.visit ? (
            <Card>
              <div className="border-b border-[var(--line-soft)] px-5 py-4">
                <h2 className="text-base font-semibold">Visit</h2>
              </div>
              <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
                <DetailRow label="Status">
                  <VisitStatusPill status={appointment.visit.status} />
                </DetailRow>
                <DetailRow label="Badge">{appointment.visit.badgeNumber}</DetailRow>
                {appointment.visit.checkedInAt ? (
                  <DetailRow label="Checked in">
                    {formatDateTime(appointment.visit.checkedInAt)}
                  </DetailRow>
                ) : null}
                {appointment.visit.checkedOutAt ? (
                  <DetailRow label="Checked out">
                    {formatDateTime(appointment.visit.checkedOutAt)}
                  </DetailRow>
                ) : null}
                {appointment.visit.denialCode ? (
                  <DetailRow label="Denial code">{appointment.visit.denialCode}</DetailRow>
                ) : null}
              </dl>
              <div className="border-t border-[var(--line-soft)] px-5 py-3">
                <Link
                  href={`/admin/visits/${appointment.visit.id}`}
                  className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Open full visit timeline
                </Link>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {underReview ? (
            <Card className="p-5">
              <h2 className="text-base font-semibold">Resolve review</h2>
              <p className="mt-1 text-sm text-muted">
                Releasing sends the request to the host teacher for a normal decision.
              </p>

              <div className="mt-4 flex flex-col gap-3">
                <ActionForm
                  action={resolveReviewAction}
                  hidden={{ appointmentId: appointment.id, outcome: 'RELEASE' }}
                  submitLabel="Release to host teacher"
                  variant="success"
                  confirm="Release this request to the host teacher?"
                  successMessage="Released. The host teacher can now decide."
                />
                <ActionForm
                  action={resolveReviewAction}
                  hidden={{ appointmentId: appointment.id, outcome: 'REJECT' }}
                  submitLabel="Reject request"
                  variant="danger"
                  confirm="Reject this request? The visitor will be notified."
                  successMessage="Rejected."
                />
              </div>
            </Card>
          ) : null}

          {appointment.status === AppointmentStatus.PENDING ? (
            <Card className="p-5">
              <h2 className="text-base font-semibold">Administrator override</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                Approve on the host teacher&apos;s behalf if they are unavailable.
              </p>
              <ActionForm
                action={adminApproveAction}
                hidden={{ appointmentId: appointment.id }}
                submitLabel="Approve now"
                confirm="Approve this request on the teacher's behalf?"
                successMessage="Approved and the pass has been emailed."
              />
            </Card>
          ) : null}

          <RevealIdentity visitorId={visitor.id} maskedValue={visitor.identityMasked} />

          <Card className="p-5">
            <h2 className="text-base font-semibold">Pass</h2>
            {activeCredential ? (
              <dl className="mt-2 divide-y divide-[var(--line-soft)]">
                <DetailRow label="Valid from">
                  {formatDateTime(activeCredential.validFrom)}
                </DetailRow>
                <DetailRow label="Expires">{formatDateTime(activeCredential.expiresAt)}</DetailRow>
                <DetailRow label="First used">
                  {activeCredential.firstUsedAt
                    ? formatDateTime(activeCredential.firstUsedAt)
                    : 'Not yet used'}
                </DetailRow>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No active pass. {appointment.credentials.length > 0 ? 'All passes have been withdrawn.' : ''}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

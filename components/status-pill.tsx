import { AppointmentStatus, VisitStatus } from '@prisma/client';
import { Pill, type PillTone } from '@/components/ui/surface';

/**
 * Single source of truth for how each lifecycle status is coloured and named.
 *
 * Centralised so a status cannot read "Approved" in green on one screen and
 * "Accepted" in blue on another - at a gate, inconsistent status vocabulary
 * causes real mistakes.
 */

const APPOINTMENT_PRESENTATION: Record<AppointmentStatus, { label: string; tone: PillTone }> = {
  [AppointmentStatus.PENDING]: { label: 'Pending', tone: 'warning' },
  [AppointmentStatus.REVIEW_REQUIRED]: { label: 'Needs review', tone: 'danger' },
  [AppointmentStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [AppointmentStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [AppointmentStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [AppointmentStatus.EXPIRED]: { label: 'Expired', tone: 'neutral' },
};

const VISIT_PRESENTATION: Record<VisitStatus, { label: string; tone: PillTone }> = {
  [VisitStatus.EXPECTED]: { label: 'Expected', tone: 'info' },
  [VisitStatus.CHECKED_IN]: { label: 'On site', tone: 'success' },
  [VisitStatus.CHECKED_OUT]: { label: 'Completed', tone: 'neutral' },
  [VisitStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [VisitStatus.NO_SHOW]: { label: 'No show', tone: 'warning' },
  [VisitStatus.DENIED]: { label: 'Denied', tone: 'danger' },
};

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return APPOINTMENT_PRESENTATION[status].label;
}

export function visitStatusLabel(status: VisitStatus): string {
  return VISIT_PRESENTATION[status].label;
}

export function AppointmentStatusPill({ status }: { status: AppointmentStatus }) {
  const presentation = APPOINTMENT_PRESENTATION[status];
  return <Pill tone={presentation.tone}>{presentation.label}</Pill>;
}

export function VisitStatusPill({ status, overdue }: { status: VisitStatus; overdue?: boolean }) {
  // Overdue is a derived condition, not a stored status, so it is shown as a
  // modifier on the real status rather than replacing it.
  if (overdue && status === VisitStatus.CHECKED_IN) {
    return <Pill tone="danger">Overdue</Pill>;
  }
  const presentation = VISIT_PRESENTATION[status];
  return <Pill tone={presentation.tone}>{presentation.label}</Pill>;
}

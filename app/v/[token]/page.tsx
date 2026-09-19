import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { AppointmentStatus, VisitStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { deriveFallbackCode, formatFallbackCode, hashToken } from '@/lib/crypto/tokens';
import { buildPassUrl, renderQrDataUrl } from '@/lib/qr';
import { getSettings } from '@/lib/domain/settings';
import { DEFAULT_ORIGIN_CODE } from '@/lib/map/campus-plan';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getEnv } from '@/lib/env';
import { formatDate, formatDateTime, formatTimeRange } from '@/lib/time';
import { Alert, Card, DetailRow, Pill } from '@/components/ui/surface';
import { CancelRequestForm } from './cancel-form';

export const metadata: Metadata = { title: 'Your visit request', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Private visitor status and pass page.
 *
 * Access control is possession of the 256-bit token in the URL. Consequences
 * that shape this page:
 *
 *   - Every failure mode (unknown, expired, revoked, altered token) renders
 *     the exact same "unavailable" panel. Distinguishing them would let
 *     someone probe for valid tokens.
 *   - The query is by `publicTokenHash`, so only this appointment can ever be
 *     returned. There is no id parameter to tamper with.
 *   - Lookups are rate limited by IP.
 */
export default async function VisitorStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const settings = await getSettings();

  const headerList = await headers();
  const ip = (headerList.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local';
  const rate = await consumeRateLimit(RATE_LIMITS.tokenLookup, ip);

  if (!rate.allowed) {
    return (
      <Unavailable
        title="Too many requests"
        body="Please wait a moment and refresh the page."
        schoolName={settings.schoolName}
      />
    );
  }

  const tokenHash = hashToken(token);
  const now = new Date();

  const appointment = await prisma.appointment.findUnique({
    where: { publicTokenHash: tokenHash },
    include: {
      visitor: { select: { fullName: true, identityType: true, identityLast4: true } },
      teacher: { select: { name: true } },
      destination: { include: { mapNode: { select: { code: true } } } },
      visitType: true,
      visit: true,
      credentials: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!appointment || appointment.publicTokenExpiresAt.getTime() < now.getTime()) {
    return <Unavailable schoolName={settings.schoolName} />;
  }

  const credential = appointment.credentials[0] ?? null;
  const visit = appointment.visit;

  const statusPresentation = describeStatus(appointment.status, visit?.status ?? null);

  // The QR is generated here, from the token in this request's own URL. It is
  // never stored, so a database leak yields no scannable pass.
  const isApproved = appointment.status === AppointmentStatus.APPROVED;
  const passUrl = buildPassUrl(getEnv().APP_URL, token);
  const qrDataUrl = isApproved && credential && !credential.revokedAt
    ? await renderQrDataUrl(passUrl, { width: 320 })
    : null;
  const fallbackCode = credential && !credential.revokedAt
    ? formatFallbackCode(deriveFallbackCode(tokenHash))
    : null;

  /*
   * Show the "pass appears here" placeholder only while a decision is still
   * outstanding. REVIEW_REQUIRED is deliberately folded in with PENDING: the
   * visitor is never told their request was flagged, so both states must read
   * identically here as well as in `describeStatus`.
   */
  const isAwaitingDecision =
    (appointment.status === AppointmentStatus.PENDING ||
      appointment.status === AppointmentStatus.REVIEW_REQUIRED) &&
    !visit;

  const canCancel =
    (appointment.status === AppointmentStatus.PENDING ||
      appointment.status === AppointmentStatus.REVIEW_REQUIRED ||
      appointment.status === AppointmentStatus.APPROVED) &&
    (!visit || visit.status === VisitStatus.EXPECTED) &&
    appointment.scheduledEnd.getTime() > now.getTime();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Your visit request</h1>
          <Pill tone={statusPresentation.tone}>{statusPresentation.label}</Pill>
        </div>
        <p className="mt-2 font-mono text-sm text-muted">{appointment.referenceNumber}</p>
      </header>

      <Alert tone={statusPresentation.tone === 'success' ? 'success' : statusPresentation.alertTone}>
        {statusPresentation.description}
      </Alert>

      {/* ---------------- Pass ---------------- */}
      {qrDataUrl && credential ? (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Your visitor pass</h2>
            <p className="mt-0.5 text-sm text-muted">
              Show this on your phone at the guard house. There is nothing to print. Screen
              brightness helps the scanner.
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`QR visitor pass for reference ${appointment.referenceNumber}`}
              width={280}
              height={280}
              className="rounded-lg border border-[var(--line-soft)] bg-white p-3"
            />

            {fallbackCode ? (
              <div className="text-center">
                <p className="text-xs tracking-wide text-muted uppercase">
                  If the scanner does not work
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-widest text-[var(--text-strong)]">
                  {fallbackCode}
                </p>
                <p className="mt-1 text-xs text-muted">Read this code to the guard.</p>
              </div>
            ) : null}

            <div className="w-full rounded-lg bg-[var(--surface-inset)] px-4 py-3 text-center">
              <p className="text-xs text-muted">Pass valid</p>
              <p className="text-sm font-semibold text-[var(--text-strong)]">
                {formatTimeRange(credential.validFrom, credential.expiresAt)} on{' '}
                {formatDate(credential.validFrom)}
              </p>
            </div>
          </div>
        </Card>
      ) : isAwaitingDecision ? (
        /*
         * The pass and this page share one token, so the visitor is already
         * holding the link their QR will appear in. Saying so is the whole
         * point of this card: without it the page looks like a dead end and
         * the link reads as a receipt rather than something worth keeping.
         *
         * It deliberately promises nothing about the outcome - an approval
         * that has not happened must not be implied by the pass slot existing.
         */
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Your visitor pass</h2>
            <p className="mt-0.5 text-sm text-muted">Not ready yet.</p>
          </div>

          <div className="flex flex-col items-center gap-4 p-6">
            <div
              aria-hidden="true"
              className="flex h-[200px] w-[200px] items-center justify-center rounded-lg border-2 border-dashed border-[var(--line-soft)] bg-[var(--surface-inset)]"
            >
              <span className="text-sm text-muted">QR pass</span>
            </div>

            {/*
             * Approval rotates the private token (see `lib/domain/decisions.ts`),
             * which retires this URL and emails a fresh one. So this must not
             * tell the visitor to keep *this* link - it points them at the newest
             * email instead, which is the one that will still work.
             */}
            <p className="max-w-sm text-center text-sm leading-relaxed text-muted">
              If your request is approved, we will email you a{' '}
              <strong className="font-semibold text-[var(--text-strong)]">new link</strong> that
              carries your QR pass. Always open the most recent email from the school.
            </p>

            <p className="max-w-sm text-center text-xs text-muted">
              The pass becomes scannable shortly before your visit time, not straight away.
            </p>
          </div>
        </Card>
      ) : null}

      {/* ---------------- Details ---------------- */}
      <Card>
        <div className="border-b border-[var(--line-soft)] px-5 py-4">
          <h2 className="text-base font-semibold">Visit details</h2>
        </div>
        <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
          <DetailRow label="Visitor">{appointment.visitor.fullName}</DetailRow>
          <DetailRow label="Host teacher">{appointment.teacher.name}</DetailRow>
          <DetailRow label="Date">{formatDate(appointment.scheduledStart)}</DetailRow>
          <DetailRow label="Time">
            {formatTimeRange(appointment.scheduledStart, appointment.scheduledEnd)}
          </DetailRow>
          <DetailRow label="Visit type">{appointment.visitType.nameEn}</DetailRow>
          {appointment.destination ? (
            <DetailRow label="Destination">{appointment.destination.nameEn}</DetailRow>
          ) : null}
          <DetailRow label="People attending">{appointment.partySize}</DetailRow>
          {appointment.vehicleNumber ? (
            <DetailRow label="Vehicle">{appointment.vehicleNumber}</DetailRow>
          ) : null}
          <DetailRow label="Purpose">{appointment.purpose}</DetailRow>
        </dl>
      </Card>

      {appointment.decisionNote ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Message from the school</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{appointment.decisionNote}</p>
        </Card>
      ) : null}

      {isApproved && (appointment.destination?.instructionsEn || appointment.destination?.mapNode) ? (
        <Alert tone="info" title="Finding your way">
          {appointment.destination.instructionsEn}
          {/* The written instruction stays; the map is an extra way to read it,
              not a replacement. A visitor on a bad connection at the gate still
              gets the sentence. */}
          {appointment.destination.mapNode ? (
            <p className="mt-2">
              <Link
                href={{
                  pathname: '/map',
                  query: { from: DEFAULT_ORIGIN_CODE, to: appointment.destination.mapNode.code },
                }}
                className="font-semibold underline underline-offset-2"
              >
                See the walking route from the guard house
              </Link>
            </p>
          ) : null}
        </Alert>
      ) : null}

      {isApproved ? (
        <Alert tone="warning" title="Please bring your identification">
          This pass authorises your approved appointment. It does not verify who you are, so the
          guard will also check your physical identification at the gate.
        </Alert>
      ) : null}

      {/* ---------------- Visit progress ---------------- */}
      {visit && visit.status !== VisitStatus.EXPECTED ? (
        <Card>
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Your visit</h2>
          </div>
          <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
            <DetailRow label="Badge number">{visit.badgeNumber}</DetailRow>
            {visit.checkedInAt ? (
              <DetailRow label="Checked in">{formatDateTime(visit.checkedInAt)}</DetailRow>
            ) : null}
            {visit.checkedOutAt ? (
              <DetailRow label="Checked out">{formatDateTime(visit.checkedOutAt)}</DetailRow>
            ) : null}
          </dl>
        </Card>
      ) : null}

      {canCancel ? <CancelRequestForm token={token} /> : null}

      <p className="text-center text-xs text-muted">
        Keep this page private. Anyone with this link can see and cancel your request.{' '}
        <Link href="/" className="underline underline-offset-2">
          {settings.schoolName}
        </Link>
      </p>
    </div>
  );
}

/**
 * The single response for every "you cannot see this" case.
 * It deliberately does not say whether the request existed.
 */
function Unavailable({
  schoolName,
  title = 'This link is not available',
  body = 'The link may have expired, been cancelled, or been typed incorrectly. Please check the most recent email from the school, or submit a new request.',
}: {
  schoolName: string;
  title?: string;
  body?: string;
}) {
  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="surface-card rounded-xl p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-6">
          <Link
            href="/visit/request"
            className="text-sm font-medium text-[var(--accent)] underline underline-offset-2"
          >
            Submit a new visit request
          </Link>
        </div>
      </div>
      <p className="mt-6 text-xs text-muted">{schoolName}</p>
    </div>
  );
}

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

function describeStatus(
  status: AppointmentStatus,
  visitStatus: VisitStatus | null,
): { label: string; tone: StatusTone; alertTone: 'info' | 'success' | 'warning' | 'danger'; description: string } {
  if (visitStatus === VisitStatus.CHECKED_IN) {
    return {
      label: 'On site',
      tone: 'success',
      alertTone: 'success',
      description: 'You are checked in. Please return your badge at the guard house when you leave.',
    };
  }

  if (visitStatus === VisitStatus.CHECKED_OUT) {
    return {
      label: 'Completed',
      tone: 'neutral',
      alertTone: 'info',
      description: 'This visit is complete. Thank you for visiting.',
    };
  }

  if (visitStatus === VisitStatus.DENIED) {
    return {
      label: 'Not admitted',
      tone: 'danger',
      alertTone: 'danger',
      description:
        'Entry was not completed at the gate. Please contact the school office if you need help.',
    };
  }

  if (visitStatus === VisitStatus.NO_SHOW) {
    return {
      label: 'Missed',
      tone: 'warning',
      alertTone: 'warning',
      description: 'This appointment was not attended. You are welcome to submit a new request.',
    };
  }

  switch (status) {
    // A request held for review is shown as pending. Telling the visitor it
    // was flagged would disclose restricted information.
    case AppointmentStatus.PENDING:
    case AppointmentStatus.REVIEW_REQUIRED:
      return {
        label: 'Awaiting approval',
        tone: 'warning',
        alertTone: 'info',
        description:
          'Your request has been received and is waiting for a decision. We will email you as soon as it is reviewed.',
      };

    case AppointmentStatus.APPROVED:
      return {
        label: 'Approved',
        tone: 'success',
        alertTone: 'success',
        description:
          'Your visit is approved. Show the QR pass below at the guard house when you arrive.',
      };

    case AppointmentStatus.REJECTED:
      return {
        label: 'Not approved',
        tone: 'danger',
        alertTone: 'danger',
        description:
          'Your host was not able to approve this request. You may submit a new request for another time.',
      };

    case AppointmentStatus.CANCELLED:
      return {
        label: 'Cancelled',
        tone: 'neutral',
        alertTone: 'info',
        description: 'This request has been cancelled.',
      };

    case AppointmentStatus.EXPIRED:
      return {
        label: 'Expired',
        tone: 'neutral',
        alertTone: 'warning',
        description:
          'This request expired before it was decided. Please submit a new request if you still wish to visit.',
      };

    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled appointment status: ${String(exhaustive)}`);
    }
  }
}

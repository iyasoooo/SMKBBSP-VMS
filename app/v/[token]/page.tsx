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
import { Crest } from '@/components/ui/crest';
import { CancelRequestForm } from './cancel-form';
import { CopyLinkButton } from './copy-link';

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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  // Set only by the submission redirect. It changes a banner, nothing else.
  const justSubmitted = query.new === '1';
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

  /*
   * Ask the visitor to save the link for as long as they still need it: from
   * submission until they arrive. After check-in the printed badge takes over,
   * and a closed request has nothing left to come back for.
   */
  const stillNeedsLink =
    (isAwaitingDecision || appointment.status === AppointmentStatus.APPROVED) &&
    (!visit || visit.status === VisitStatus.EXPECTED);

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

      {justSubmitted ? (
        <Alert tone="success" title="Request submitted">
          Your request has been sent to your host teacher. This page is your request.
        </Alert>
      ) : null}

      {/*
        There is no email and no account, so this page is the visitor's only
        way back. Saying so plainly, and early, is the whole defence against a
        lost link - there is no recovery once it is gone.
      */}
      {stillNeedsLink ? (
        <Card className="border-2 border-[var(--accent)] p-5">
          <h2 className="text-base font-semibold">Save this page now</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            This link is the only way back to your request.{' '}
            <strong className="font-semibold text-[var(--text-strong)]">
              Nothing will be emailed or texted to you
            </strong>
            , and the school cannot look it up for you. Bookmark it, copy it somewhere safe, or take
            a screenshot.
          </p>
          <div className="mt-4 max-w-xs">
            <CopyLinkButton />
          </div>
        </Card>
      ) : null}

      <Alert tone={statusPresentation.tone === 'success' ? 'success' : statusPresentation.alertTone}>
        {statusPresentation.description}
      </Alert>

      {/* ---------------- Pass ---------------- */}
      {qrDataUrl && credential ? (
        /*
         * Styled as the printed badge the guard will hand over on arrival, so
         * the pass on the phone and the badge on the lanyard read as one
         * document. It is deliberately black on white in both themes: the pass
         * is a thing to be shown and scanned, and a dark card would both break
         * that resemblance and give the scanner less to work with.
         *
         * It carries only what the badge carries. No identity number, no phone,
         * no purpose - a pass is held up to strangers at a gate.
         */
        <section
          aria-label="Your visitor pass"
          className="overflow-hidden rounded-xl border-2 border-black bg-white p-5 text-black sm:p-6"
        >
          <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
            <div className="flex items-start gap-3">
              <Crest size={44} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.2em] uppercase">
                  {settings.schoolName}
                </p>
                <p className="mt-1 text-2xl leading-none font-black tracking-tight sm:text-3xl">
                  VISITOR
                </p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] tracking-wide uppercase">Reference</p>
              <p className="font-mono text-sm font-bold sm:text-base">
                {appointment.referenceNumber}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-5 sm:flex-row">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] tracking-wide uppercase">Name</p>
              <p className="text-xl leading-tight font-bold break-words sm:text-2xl">
                {appointment.visitor.fullName}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <p className="text-[10px] tracking-wide uppercase">Host</p>
                  <p className="font-semibold">{appointment.teacher.name}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-wide uppercase">Destination</p>
                  <p className="font-semibold">
                    {appointment.destination?.nameEn ?? 'General Office'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] tracking-wide uppercase">Date</p>
                  <p className="font-semibold">{formatDate(credential.validFrom)}</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-wide uppercase">Valid</p>
                  <p className="font-semibold">
                    {formatTimeRange(credential.validFrom, credential.expiresAt)}
                  </p>
                </div>
              </div>
            </div>

            {/* Centred while stacked on a phone, pinned beside the details on a
                wider screen, exactly as on the printed badge. */}
            <div className="shrink-0 self-center text-center sm:self-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`QR visitor pass for reference ${appointment.referenceNumber}`}
                width={180}
                height={180}
                className="rounded border border-black p-1"
              />
              <p className="mt-1 text-[9px]">Scan at the guard house</p>

              {fallbackCode ? (
                <div className="mt-3 border-t border-black pt-2">
                  <p className="text-[9px] tracking-wide uppercase">If the scanner fails</p>
                  <p className="font-mono text-lg font-bold tracking-widest">{fallbackCode}</p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 border-t-2 border-black pt-2">
            <p className="text-[11px] font-semibold">
              Show this on your phone at the guard house. There is nothing to print, and screen
              brightness helps the scanner.
            </p>
            {appointment.partySize > 1 ? (
              <p className="mt-1 text-[11px]">Party of {appointment.partySize} people.</p>
            ) : null}
          </div>
        </section>
      ) : isAwaitingDecision ? (
        /*
         * The pass and this page share one token, so the visitor is already
         * holding the link their QR will appear in. Saying so is the whole
         * point of this card: without it the page looks like a dead end.
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
             * True because approval binds the pass to this page's own token
             * rather than rotating it (see `lib/domain/decisions.ts`). If that
             * ever changes, this sentence becomes a lie that strands visitors.
             */}
            <p className="max-w-sm text-center text-sm leading-relaxed text-muted">
              If your request is approved, your QR pass will appear{' '}
              <strong className="font-semibold text-[var(--text-strong)]">here, on this page</strong>.
              Come back to this same link to check.
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
  body = 'The link may have expired, been cancelled, or been typed incorrectly. If you have lost your link, please submit a new request, or ask at the guard house when you arrive.',
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
          'Your request has been received and is waiting for your host teacher to decide. Come back to this page to see the decision.',
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

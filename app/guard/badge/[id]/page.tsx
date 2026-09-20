import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { renderQrSvg } from '@/lib/qr';
import { getEnv } from '@/lib/env';
import { SAFE_VISITOR_SELECT, toSafeVisitor } from '@/lib/domain/presenters';
import { formatDate, formatTime } from '@/lib/time';
import { recordAuditSafely } from '@/lib/audit';
import { AUDIT_ACTIONS } from '@/lib/constants';
import { PrintButton } from '@/components/print-button';
import { Crest } from '@/components/ui/crest';

export const metadata: Metadata = { title: 'Visitor badge', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Printable A4 visitor badge.
 *
 * Contents are constrained by the specification. The badge carries the
 * visitor's name, badge number, host, destination, date, expected end and a
 * QR for check-out. It deliberately omits the identity number, phone, email,
 * the detailed purpose, and any blacklist state - a badge is worn in public
 * and is routinely left on desks.
 *
 * The QR encodes a badge-scoped lookup URL, not the visitor's private pass
 * token, so a photographed badge cannot be used to open their status page.
 */
export default async function BadgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireGuardOrAdmin();
  const [{ id }, query, settings] = await Promise.all([params, searchParams, getSettings()]);

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      visitor: { select: SAFE_VISITOR_SELECT },
      teacher: { select: { name: true } },
      destination: true,
      appointment: { select: { referenceNumber: true, partySize: true } },
    },
  });

  if (!visit) notFound();

  const visitor = toSafeVisitor(visit.visitor);

  // The badge QR points at the guard's own visit screen; opening it requires a
  // guard or admin session, so the badge alone grants nothing.
  const badgeQrTarget = `${getEnv().APP_URL.replace(/\/$/, '')}/guard/visits/${visit.id}`;
  const qrSvg = await renderQrSvg(badgeQrTarget, { width: 150, margin: 1 });

  await recordAuditSafely({
    action: AUDIT_ACTIONS.VISIT_BADGE_PRINTED,
    targetType: 'Visit',
    targetId: visit.id,
    actorUserId: user.id,
    metadata: { badgeNumber: visit.badgeNumber },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Visitor badge</h1>
          <p className="mt-1 text-sm text-muted">
            {query.new === '1'
              ? 'Registration complete. Print the badge and hand it to the visitor.'
              : 'Reprint of an existing badge.'}
          </p>
        </div>
        <div className="flex gap-2">
          <PrintButton />
          <Link
            href={`/guard/visits/${visit.id}`}
            className="flex min-h-12 items-center rounded-lg border border-[var(--line-strong)] px-4 text-sm font-medium hover:bg-[var(--surface-muted)]"
          >
            Back to visit
          </Link>
        </div>
      </div>

      {/* The printed artefact. Fixed millimetre sizing so it lands the same on
          any printer, and forced black-on-white so a dark-mode screen does not
          produce an unreadable page. */}
      <div
        className="print-avoid-break mx-auto rounded-xl border-2 border-black bg-white p-6 text-black"
        style={{ width: '148mm', minHeight: '105mm' }}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <div className="flex items-start gap-3">
            {/* The crest is what makes the printed badge read as school issue
                rather than as an anonymous slip of paper. */}
            <Crest size={52} className="mt-0.5" />
            <div>
              <p className="text-[10px] font-semibold tracking-[0.2em] uppercase">
                {settings.schoolName}
              </p>
              <p className="mt-1 text-3xl font-black tracking-tight">VISITOR</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] tracking-wide uppercase">Badge</p>
            <p className="font-mono text-lg font-bold">{visit.badgeNumber}</p>
          </div>
        </div>

        <div className="mt-4 flex gap-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] tracking-wide uppercase">Name</p>
            <p className="text-2xl leading-tight font-bold break-words">{visitor.fullName}</p>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-[10px] tracking-wide uppercase">Host</p>
                <p className="font-semibold">{visit.teacher.name}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-wide uppercase">Destination</p>
                <p className="font-semibold">{visit.destination?.nameEn ?? 'General Office'}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-wide uppercase">Date</p>
                <p className="font-semibold">{formatDate(visit.expectedStart)}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-wide uppercase">Expected until</p>
                <p className="font-semibold">{formatTime(visit.expectedEnd)}</p>
              </div>
            </div>
          </div>

          <div className="shrink-0 text-center">
            <div
              className="rounded border border-black p-1"
              // The SVG is produced by the qrcode library from a URL we built;
              // no user-supplied markup reaches this.
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="mt-1 text-[9px]">Scan at exit</p>
          </div>
        </div>

        <div className="mt-4 border-t-2 border-black pt-2">
          <p className="text-[11px] font-semibold">
            Please wear this badge at all times and return it to the guard house when you leave.
          </p>
          {visit.appointment && visit.appointment.partySize > 1 ? (
            <p className="mt-1 text-[11px]">
              Party of {visit.appointment.partySize} people.
            </p>
          ) : null}
        </div>
      </div>

      <p className="no-print mt-5 text-center text-xs text-muted">
        This badge intentionally omits identity numbers, contact details and the visit purpose.
      </p>
    </div>
  );
}

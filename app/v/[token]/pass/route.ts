import { NextResponse, type NextRequest } from 'next/server';
import { AppointmentStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { deriveFallbackCode, formatFallbackCode, hashToken } from '@/lib/crypto/tokens';
import { buildPassUrl, renderQrDataUrl } from '@/lib/qr';
import { getSettings } from '@/lib/domain/settings';
import { getEnv } from '@/lib/env';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { buildPassPdf } from '@/lib/passes/pass-pdf';

export const dynamic = 'force-dynamic';

/**
 * The visitor's pass, as a file they can keep.
 *
 * A route handler rather than a server action because the response is a binary
 * file with its own Content-Type and Content-Disposition.
 *
 * Authorization is possession of the token in the path, exactly as for the page
 * at `/v/[token]`, and the checks are deliberately identical. This endpoint is
 * reachable directly by URL and renders inside no layout, so it repeats them
 * rather than inheriting them:
 *
 *   - every failure answers 404, so a guessed token cannot be told from a real
 *     one that is not approved yet;
 *   - lookups are rate limited by IP on the same budget as the page, so this
 *     cannot be used as a cheaper oracle for probing tokens;
 *   - a pass is produced only for an approved appointment holding a credential
 *     that has not been revoked. A withdrawn pass stops downloading at once.
 *
 * `no-store` matters more here than elsewhere: a cached pass is a pass that
 * outlives its revocation in somebody's browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local';
  const rate = await consumeRateLimit(RATE_LIMITS.tokenLookup, ip);
  if (!rate.allowed) return notFound();

  const tokenHash = hashToken(token);
  const now = new Date();

  const appointment = await prisma.appointment.findUnique({
    where: { publicTokenHash: tokenHash },
    include: {
      visitor: { select: { fullName: true } },
      teacher: { select: { name: true } },
      destination: { select: { nameEn: true } },
      credentials: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!appointment || appointment.publicTokenExpiresAt.getTime() < now.getTime()) {
    return notFound();
  }

  const credential = appointment.credentials[0] ?? null;

  if (appointment.status !== AppointmentStatus.APPROVED || !credential || credential.revokedAt) {
    return notFound();
  }

  const settings = await getSettings();

  const pdf = await buildPassPdf({
    schoolName: settings.schoolName,
    referenceNumber: appointment.referenceNumber,
    visitorName: appointment.visitor.fullName,
    hostName: appointment.teacher.name,
    destinationName: appointment.destination?.nameEn ?? 'General Office',
    validFrom: credential.validFrom,
    expiresAt: credential.expiresAt,
    // The same URL the page renders, so a saved pass and the page on screen
    // scan identically.
    qrDataUrl: await renderQrDataUrl(buildPassUrl(getEnv().APP_URL, token), { width: 320 }),
    fallbackCode: formatFallbackCode(deriveFallbackCode(tokenHash)),
    partySize: appointment.partySize,
  });

  // The reference, never the visitor's name: a filename is the one part of a
  // download that shows up in a shared folder listing.
  const filename = `visitor-pass-${appointment.referenceNumber}.pdf`;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
    },
  });
}

function notFound(): NextResponse {
  return new NextResponse('Not found', { status: 404 });
}

/**
 * Mint one approved visit whose pass is valid *right now*.
 *
 * Why this exists: the seed anchors its passes to school hours, so if you
 * rehearse the walkthrough in the evening every seeded pass has already
 * expired and the guard scan step cannot be demonstrated. This creates a
 * single approved appointment with a credential window straddling the current
 * time, then prints the pass URL and the manual fallback code.
 *
 *   npx tsx scripts/demo-live-pass.ts
 *
 * This is a local demonstration utility, not part of the application. It
 * writes directly to the database and deliberately bypasses the public form's
 * school-hours rule, which is exactly why it lives in scripts/ and is never
 * imported by the app. It refuses to run against NODE_ENV=production.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppointmentSource, AppointmentStatus, PrismaClient, Role, VisitStatus } from '@prisma/client';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Safe below the env load: these modules read configuration lazily, at call
// time rather than at import time.
import {
  deriveFallbackCode,
  formatFallbackCode,
  generateReferenceNumber,
  generateToken,
  hashFallbackCode,
  hashToken,
} from '@/lib/crypto/tokens';
import { allocateBadgeNumber } from '@/lib/domain/badges';
import { getSettings } from '@/lib/domain/settings';
import { addDays, formatTime, toIsoDayString } from '@/lib/time';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create demonstration data with NODE_ENV=production.');
  }

  const settings = await getSettings();
  const now = new Date();

  const teacher = await prisma.user.findFirst({
    where: { role: Role.TEACHER, isActive: true, teacherProfile: { isAcceptingVisits: true } },
  });
  const visitType = await prisma.visitType.findFirst({ where: { isActive: true } });
  const destination = await prisma.destination.findFirst({ where: { isActive: true } });
  const visitor = await prisma.visitor.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!teacher || !visitType || !destination || !visitor) {
    throw new Error('Reference data missing. Run `npm run db:seed` first.');
  }

  // A window wide enough that the pass stays valid for the whole rehearsal.
  const scheduledStart = new Date(now.getTime() - 15 * 60_000);
  const scheduledEnd = new Date(now.getTime() + 60 * 60_000);
  const validFrom = new Date(scheduledStart.getTime() - settings.qrGraceBeforeMinutes * 60_000);
  const expiresAt = new Date(scheduledEnd.getTime() + settings.qrGraceAfterMinutes * 60_000);

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const fallbackCode = deriveFallbackCode(tokenHash);
  const referenceNumber = generateReferenceNumber(now);

  const appointment = await prisma.appointment.create({
    data: {
      referenceNumber,
      source: AppointmentSource.ONLINE,
      visitorId: visitor.id,
      teacherId: teacher.id,
      destinationId: destination.id,
      visitTypeId: visitType.id,
      scheduledStart,
      scheduledEnd,
      purpose: 'Demonstration walkthrough - guard scan and check-in.',
      partySize: 1,
      status: AppointmentStatus.APPROVED,
      decidedAt: now,
      decidedById: teacher.id,
      publicTokenHash: tokenHash,
      publicTokenExpiresAt: addDays(scheduledEnd, 7),
    },
  });

  await prisma.qrCredential.create({
    data: {
      appointmentId: appointment.id,
      tokenHash,
      fallbackCodeHash: hashFallbackCode(fallbackCode),
      validFrom,
      expiresAt,
    },
  });

  const badgeNumber = await allocateBadgeNumber(prisma, settings.badgePrefix, toIsoDayString(now));

  await prisma.visit.create({
    data: {
      appointmentId: appointment.id,
      visitorId: visitor.id,
      teacherId: teacher.id,
      destinationId: destination.id,
      status: VisitStatus.EXPECTED,
      badgeNumber,
      expectedStart: scheduledStart,
      expectedEnd: scheduledEnd,
    },
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  console.log('\nA live visitor pass has been created.\n');
  console.log(`  Visitor        ${visitor.fullName}`);
  console.log(`  Host           ${teacher.name}`);
  console.log(`  Reference      ${referenceNumber}`);
  console.log(`  Badge          ${badgeNumber}`);
  console.log(`  Valid          ${formatTime(validFrom)} - ${formatTime(expiresAt)}`);
  console.log('');
  console.log(`  Pass page      ${appUrl}/v/${rawToken}`);
  console.log(`  Manual code    ${formatFallbackCode(fallbackCode)}`);
  console.log('');
  console.log('  Open the pass page to show the QR, or type the manual code at');
  console.log(`  ${appUrl}/guard/scan to demonstrate the camera-denied fallback.\n`);
}

main()
  .catch((error: unknown) => {
    console.error('Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

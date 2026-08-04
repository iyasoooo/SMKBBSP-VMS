/**
 * Print the live demonstration data needed to rehearse a walkthrough.
 *
 * Everything printed here comes from the seeded database, so the reference
 * numbers, badge numbers and fallback codes are the real ones the running app
 * will accept. Run it after `npm run db:seed`:
 *
 *   npx tsx scripts/demo-facts.ts
 *
 * The fallback codes it prints are live credentials for seeded, fictional
 * visitors on a local database. Do not run this against anything but a local
 * demonstration instance.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppointmentStatus, PrismaClient, VisitStatus } from '@prisma/client';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Safe below the env load: these modules read configuration lazily, at call
// time rather than at import time.
import { deriveFallbackCode, formatFallbackCode } from '@/lib/crypto/tokens';
import { formatDateTime, formatTime } from '@/lib/time';
import { SEED_BLACKLIST_SUBJECT } from '../prisma/seed-data';

const prisma = new PrismaClient();

function heading(text: string): void {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

async function main(): Promise<void> {
  heading('1. Teacher queue - pending requests for teacher@smkbbsp.test');
  const pending = await prisma.appointment.findMany({
    where: { status: AppointmentStatus.PENDING, teacher: { email: 'teacher@smkbbsp.test' } },
    include: { visitor: true },
    orderBy: { scheduledStart: 'asc' },
    take: 5,
  });
  if (pending.length === 0) {
    console.log('  (none - re-run `npm run db:seed`)');
  }
  for (const appointment of pending) {
    console.log(
      `  ${appointment.referenceNumber}  ${appointment.visitor.fullName.padEnd(34)} ${formatDateTime(appointment.scheduledStart)}`,
    );
  }

  heading('2. Guard scan - live passes valid right now (manual fallback codes)');
  const now = new Date();
  const credentials = await prisma.qrCredential.findMany({
    where: { revokedAt: null, validFrom: { lte: now }, expiresAt: { gte: now } },
    include: { appointment: { include: { visitor: true, teacher: true } } },
    orderBy: { validFrom: 'asc' },
  });

  if (credentials.length === 0) {
    console.log('  No pass is inside its validity window at this moment.');
    const upcoming = await prisma.qrCredential.findMany({
      where: { revokedAt: null, validFrom: { gt: now } },
      include: { appointment: { include: { visitor: true } } },
      orderBy: { validFrom: 'asc' },
      take: 3,
    });
    for (const credential of upcoming) {
      console.log(
        `  ${formatFallbackCode(deriveFallbackCode(credential.tokenHash))}  ${credential.appointment.visitor.fullName.padEnd(34)} opens ${formatTime(credential.validFrom)}`,
      );
    }
  }

  for (const credential of credentials) {
    console.log(
      `  ${formatFallbackCode(deriveFallbackCode(credential.tokenHash))}  ${credential.appointment.visitor.fullName.padEnd(34)} ${credential.appointment.referenceNumber}  valid until ${formatTime(credential.expiresAt)}`,
    );
  }

  heading('3. Emergency list - visitors currently on site');
  const onSite = await prisma.visit.findMany({
    where: { status: VisitStatus.CHECKED_IN },
    include: { visitor: true, appointment: true, teacher: true },
    orderBy: { checkedInAt: 'asc' },
  });
  let people = 0;
  for (const visit of onSite) {
    const party = visit.appointment?.partySize ?? 1;
    people += party;
    const overdue = visit.expectedEnd.getTime() < now.getTime() ? '  <-- OVERDUE' : '';
    console.log(
      `  ${visit.badgeNumber}  ${visit.visitor.fullName.padEnd(34)} party ${party}  in ${formatTime(visit.checkedInAt ?? now)}${overdue}`,
    );
  }
  console.log(`  TOTAL PEOPLE ON SITE: ${people}`);

  heading('4. Blocked walk-in - identity number that triggers a hard block');
  console.log(`  Name : ${SEED_BLACKLIST_SUBJECT.fullName}`);
  console.log(`  NRIC : ${SEED_BLACKLIST_SUBJECT.nric}`);
  console.log(`  Phone: ${SEED_BLACKLIST_SUBJECT.phone}`);
  console.log('  Expect: neutral "contact an administrator" message, no reason shown.');

  heading('5. Admin - a visit with full history for the detail/timeline screen');
  const completed = await prisma.visit.findFirst({
    where: { status: VisitStatus.CHECKED_OUT },
    include: { visitor: true, appointment: true },
    orderBy: { checkedOutAt: 'desc' },
  });
  if (completed) {
    console.log(`  Badge ${completed.badgeNumber}  ${completed.visitor.fullName}`);
    console.log(`  Reference ${completed.appointment?.referenceNumber ?? '-'}`);
  }

  heading('Counts');
  console.log(`  appointments : ${await prisma.appointment.count()}`);
  console.log(`  visits       : ${await prisma.visit.count()}`);
  console.log(`  live passes  : ${credentials.length}`);
}

main()
  .catch((error: unknown) => {
    console.error('Failed:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

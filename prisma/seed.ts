/**
 * Deterministic demonstration seed.
 *
 * Run with `npm run db:seed`. Safe to re-run: it clears the operational tables
 * first, then rebuilds the same dataset.
 *
 * "Deterministic" here means the *choices* are reproducible - a fixed PRNG seed
 * drives every selection, so two machines produce identical data. The calendar
 * is anchored to the current date on purpose, so the guard's "Today at the
 * Gate" screen and the dashboard always have live-looking data whenever the
 * project is demonstrated.
 */
import {
  AppointmentSource,
  AppointmentStatus,
  BlacklistCategory,
  BlacklistStatus,
  IdentityType,
  MatchPolicy,
  NotificationChannel,
  NotificationStatus,
  PrismaClient,
  Role,
  VisitEventType,
  VisitStatus,
  VisitorCategory,
  type Destination,
  type User,
  type VisitType,
} from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The seed runs outside Next.js, so .env must be loaded explicitly.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

 
import { buildIdentityFields, computeIdentityHmac, normalizeIdentity } from '@/lib/crypto/identity';
import { hashPassword } from '@/lib/crypto/password';
import {
  generateFallbackCode,
  generateReferenceNumber,
  generateToken,
  hashFallbackCode,
  hashToken,
} from '@/lib/crypto/tokens';
import { allocateBadgeNumber } from '@/lib/domain/badges';
import { ensureSettingDefaults } from '@/lib/domain/settings';
import { CONSENT_VERSION } from '@/lib/constants';
import { addDays, toIsoDayString, zonedTimeToUtc, getZonedParts } from '@/lib/time';
import {
  SEED_BLACKLIST_REVIEW_SUBJECT,
  SEED_BLACKLIST_SUBJECT,
  SEED_DESTINATIONS,
  SEED_PURPOSES,
  SEED_TEACHERS,
  SEED_VEHICLES,
  SEED_VISITORS,
  SEED_VISIT_TYPES,
} from './seed-data';

const prisma = new PrismaClient();

/** Mulberry32: small, fast, and reproducible from a fixed seed. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260803);

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick() called with an empty array');
  return item;
}

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Build a UTC instant for a Malaysian wall-clock time on a given day offset. */
function schoolTime(dayOffset: number, hour: number, minute: number): Date {
  const day = addDays(new Date(), dayOffset);
  const { year, month, day: dayOfMonth } = getZonedParts(day);
  return zonedTimeToUtc({ year, month, day: dayOfMonth, hour, minute });
}

function isWeekend(date: Date): boolean {
  const { year, month, day } = getZonedParts(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

async function clearOperationalData(): Promise<void> {
  // Ordered so foreign keys never block a delete.
  await prisma.visitEvent.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.qrCredential.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.visitor.deleteMany();
  await prisma.blacklistEntry.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.rateLimitCounter.deleteMany();
  await prisma.session.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUsers(): Promise<{
  admin: User;
  guard: User;
  guards: User[];
  teachers: User[];
}> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin#Demo2025';
  const guardPassword = process.env.SEED_GUARD_PASSWORD ?? 'Guard#Demo2025';
  const teacherPassword = process.env.SEED_TEACHER_PASSWORD ?? 'Teacher#Demo2025';

  const [adminHash, guardHash, teacherHash] = await Promise.all([
    hashPassword(adminPassword),
    hashPassword(guardPassword),
    hashPassword(teacherPassword),
  ]);

  const admin = await prisma.user.create({
    data: {
      email: 'admin@smkbbsp.test',
      name: 'Encik Hasrul bin Idris (Pentadbir)',
      passwordHash: adminHash,
      role: Role.ADMIN,
      preferredLocale: 'en',
    },
  });

  const guard = await prisma.user.create({
    data: {
      email: 'guard@smkbbsp.test',
      name: 'Encik Samad bin Osman (Pengawal)',
      passwordHash: guardHash,
      role: Role.GUARD,
      preferredLocale: 'ms',
    },
  });

  const guard2 = await prisma.user.create({
    data: {
      email: 'guard2@smkbbsp.test',
      name: 'Encik Ravi a/l Chandran (Pengawal)',
      passwordHash: guardHash,
      role: Role.GUARD,
      preferredLocale: 'ms',
    },
  });

  const teachers: User[] = [];
  for (const spec of SEED_TEACHERS) {
    const user = await prisma.user.create({
      data: {
        email: spec.email,
        name: spec.name,
        passwordHash: teacherHash,
        role: Role.TEACHER,
        preferredLocale: 'en',
        teacherProfile: {
          create: {
            staffCode: spec.staffCode,
            department: spec.department,
            phone: spec.phone,
            isAcceptingVisits: spec.isAcceptingVisits,
          },
        },
      },
    });
    teachers.push(user);
  }

  return { admin, guard, guards: [guard, guard2], teachers };
}

async function seedReferenceData(): Promise<{
  destinations: Destination[];
  visitTypes: VisitType[];
}> {
  const destinations: Destination[] = [];
  for (const spec of SEED_DESTINATIONS) {
    destinations.push(
      await prisma.destination.upsert({
        where: { code: spec.code },
        create: spec,
        update: spec,
      }),
    );
  }

  const visitTypes: VisitType[] = [];
  for (const spec of SEED_VISIT_TYPES) {
    visitTypes.push(
      await prisma.visitType.upsert({
        where: { code: spec.code },
        create: spec,
        update: spec,
      }),
    );
  }

  return { destinations, visitTypes };
}

async function seedVisitors(): Promise<string[]> {
  const ids: string[] = [];

  for (const spec of SEED_VISITORS) {
    const identity = buildIdentityFields(IdentityType.NRIC, spec.nric);
    const visitor = await prisma.visitor.create({
      data: {
        fullName: spec.fullName,
        email: spec.email,
        phone: spec.phone,
        visitorCategory: VisitorCategory[spec.category],
        identityType: IdentityType.NRIC,
        identityCiphertext: identity.ciphertext,
        identityIv: identity.iv,
        identityTag: identity.tag,
        identityKeyVersion: identity.keyVersion,
        identityHmac: identity.hmac,
        identityLast4: identity.last4,
        consentVersion: CONSENT_VERSION,
        consentedAt: new Date(),
      },
    });
    ids.push(visitor.id);
  }

  return ids;
}

async function seedBlacklist(adminId: string): Promise<void> {
  await prisma.blacklistEntry.create({
    data: {
      status: BlacklistStatus.ACTIVE,
      identityHmac: computeIdentityHmac(
        IdentityType.NRIC,
        normalizeIdentity(IdentityType.NRIC, SEED_BLACKLIST_SUBJECT.nric),
      ),
      matchPhone: SEED_BLACKLIST_SUBJECT.phone,
      matchEmail: SEED_BLACKLIST_SUBJECT.email,
      displayName: SEED_BLACKLIST_SUBJECT.fullName,
      matchPolicy: MatchPolicy.BLOCK,
      category: BlacklistCategory.SECURITY_INCIDENT,
      reason: SEED_BLACKLIST_SUBJECT.reason,
      validFrom: addDays(new Date(), -120),
      createdById: adminId,
    },
  });

  await prisma.blacklistEntry.create({
    data: {
      status: BlacklistStatus.ACTIVE,
      matchPhone: SEED_BLACKLIST_REVIEW_SUBJECT.phone,
      matchEmail: SEED_BLACKLIST_REVIEW_SUBJECT.email,
      displayName: SEED_BLACKLIST_REVIEW_SUBJECT.fullName,
      matchPolicy: MatchPolicy.REVIEW,
      category: BlacklistCategory.OTHER,
      reason: SEED_BLACKLIST_REVIEW_SUBJECT.reason,
      validFrom: addDays(new Date(), -60),
      createdById: adminId,
    },
  });

  // An expired entry, so the admin list has something to show in every status.
  await prisma.blacklistEntry.create({
    data: {
      status: BlacklistStatus.INACTIVE,
      matchEmail: 'lapsed.entry@contoh.test',
      displayName: 'Lapsed demonstration entry',
      matchPolicy: MatchPolicy.REVIEW,
      category: BlacklistCategory.OTHER,
      reason: 'Demonstration entry that has been deactivated after review.',
      validFrom: addDays(new Date(), -300),
      validUntil: addDays(new Date(), -30),
      createdById: adminId,
      reviewedById: adminId,
      reviewedAt: addDays(new Date(), -30),
      reviewNote: 'Reviewed and stood down; retained for the audit trail.',
    },
  });
}

interface HistoryContext {
  visitorIds: string[];
  teachers: User[];
  guards: User[];
  destinations: Destination[];
  visitTypes: VisitType[];
  badgePrefix: string;
}

/**
 * Build 90 days of history plus today's and the coming week's activity.
 *
 * The mix is chosen so every dashboard metric, filter and operational alert
 * has something real to display: completed visits for average duration,
 * rejections for the approval rate, no-shows, denials, an overdue visitor,
 * and pending requests awaiting a teacher decision.
 */
async function seedHistory(context: HistoryContext): Promise<void> {
  const { visitorIds, teachers, guards, destinations, visitTypes, badgePrefix } = context;
  const activeTeachers = teachers.filter((_, index) => SEED_TEACHERS[index]?.isAcceptingVisits);
  const activeDestinations = destinations.filter((d) => d.isActive);
  const activeVisitTypes = visitTypes.filter((t) => t.isActive);

  let completed = 0;
  let noShow = 0;
  let rejected = 0;

  // --- Past 90 days -------------------------------------------------------
  for (let dayOffset = -90; dayOffset <= -1; dayOffset += 1) {
    const probe = addDays(new Date(), dayOffset);
    if (isWeekend(probe)) continue;

    const visitsToday = randomInt(2, 7);

    for (let i = 0; i < visitsToday; i += 1) {
      const visitType = pick(activeVisitTypes);
      const teacher = pick(activeTeachers);
      const destination = pick(activeDestinations);
      const visitorId = pick(visitorIds);

      const hour = randomInt(8, 15);
      const minute = pick([0, 15, 30, 45]);
      const scheduledStart = schoolTime(dayOffset, hour, minute);
      const scheduledEnd = new Date(
        scheduledStart.getTime() + visitType.defaultDurationMinutes * 60_000,
      );

      const roll = random();
      // ~8% rejected, ~7% no-show, the rest completed.
      const outcome = roll < 0.08 ? 'REJECTED' : roll < 0.15 ? 'NO_SHOW' : 'COMPLETED';

      const token = generateToken();
      const appointment = await prisma.appointment.create({
        data: {
          referenceNumber: generateReferenceNumber(scheduledStart),
          source: random() < 0.25 ? AppointmentSource.WALK_IN : AppointmentSource.ONLINE,
          visitorId,
          teacherId: teacher.id,
          destinationId: destination.id,
          visitTypeId: visitType.id,
          scheduledStart,
          scheduledEnd,
          purpose: pick(SEED_PURPOSES),
          partySize: random() < 0.8 ? 1 : randomInt(2, 4),
          vehicleNumber: pick(SEED_VEHICLES),
          status: outcome === 'REJECTED' ? AppointmentStatus.REJECTED : AppointmentStatus.APPROVED,
          decisionNote:
            outcome === 'REJECTED'
              ? 'The requested time falls during an examination session. Please choose another day.'
              : null,
          decidedAt: new Date(scheduledStart.getTime() - 24 * 60 * 60 * 1000),
          decidedById: teacher.id,
          publicTokenHash: hashToken(token),
          publicTokenExpiresAt: addDays(scheduledEnd, 7),
          createdAt: new Date(scheduledStart.getTime() - 48 * 60 * 60 * 1000),
        },
      });

      if (outcome === 'REJECTED') {
        rejected += 1;
        continue;
      }

      const checkedInGuard = pick(guards);

      if (outcome === 'NO_SHOW') {
        noShow += 1;
        await prisma.visit.create({
          data: {
            appointmentId: appointment.id,
            visitorId,
            teacherId: teacher.id,
            destinationId: destination.id,
            status: VisitStatus.NO_SHOW,
            badgeNumber: await allocateBadgeNumber(
              prisma,
              badgePrefix,
              toIsoDayString(scheduledStart),
            ),
            expectedStart: scheduledStart,
            expectedEnd: scheduledEnd,
            createdAt: appointment.createdAt,
          },
        });
        continue;
      }

      // Completed: arrive a little early or late, stay roughly the planned time.
      const checkedInAt = new Date(scheduledStart.getTime() + randomInt(-10, 20) * 60_000);
      const checkedOutAt = new Date(
        checkedInAt.getTime() +
          Math.max(10, visitType.defaultDurationMinutes + randomInt(-15, 35)) * 60_000,
      );

      const visit = await prisma.visit.create({
        data: {
          appointmentId: appointment.id,
          visitorId,
          teacherId: teacher.id,
          destinationId: destination.id,
          status: VisitStatus.CHECKED_OUT,
          badgeNumber: await allocateBadgeNumber(
            prisma,
            badgePrefix,
            toIsoDayString(scheduledStart),
          ),
          expectedStart: scheduledStart,
          expectedEnd: scheduledEnd,
          checkedInAt,
          checkedInById: checkedInGuard.id,
          checkedOutAt,
          checkedOutById: pick(guards).id,
          idSightedAt: visitType.requiresIdSighted ? checkedInAt : null,
          idSightedById: visitType.requiresIdSighted ? checkedInGuard.id : null,
          createdAt: appointment.createdAt,
        },
      });

      await prisma.visitEvent.createMany({
        data: [
          {
            visitId: visit.id,
            type: VisitEventType.CHECKED_IN,
            actorUserId: checkedInGuard.id,
            createdAt: checkedInAt,
          },
          {
            visitId: visit.id,
            type: VisitEventType.CHECKED_OUT,
            actorUserId: visit.checkedOutById,
            createdAt: checkedOutAt,
          },
        ],
      });

      completed += 1;
    }
  }

  // --- Today --------------------------------------------------------------
  const today = new Date();

  // 1. A completed visit earlier today.
  await createTodayVisit({
    context,
    startHour: 8,
    status: VisitStatus.CHECKED_OUT,
    label: 'completed-today',
  });

  // 2. A normal visitor currently on site, party size 1.
  await createTodayVisit({
    context,
    startHour: Math.max(8, getZonedParts(today).hour - 1),
    status: VisitStatus.CHECKED_IN,
    partySize: 1,
    label: 'active-normal',
  });

  // 3. An overdue visitor still on site, party size 3.
  await createTodayVisit({
    context,
    startHour: Math.max(7, getZonedParts(today).hour - 4),
    durationMinutes: 30,
    status: VisitStatus.CHECKED_IN,
    partySize: 3,
    label: 'active-overdue',
  });

  // 4. Approved arrivals still expected later today, with live QR passes.
  for (let i = 0; i < 3; i += 1) {
    await createTodayVisit({
      context,
      startHour: Math.min(16, getZonedParts(today).hour + 1 + i),
      status: VisitStatus.EXPECTED,
      withCredential: true,
      label: `expected-${i}`,
    });
  }

  // 5. A denied arrival, so the guard history shows that branch.
  await createTodayVisit({
    context,
    startHour: 9,
    status: VisitStatus.DENIED,
    label: 'denied-today',
  });

  // --- Pending decisions and upcoming week --------------------------------
  for (let i = 0; i < 6; i += 1) {
    const dayOffset = randomInt(1, 7);
    const visitType = pick(activeVisitTypes);
    const teacher = pick(activeTeachers);
    const scheduledStart = schoolTime(dayOffset, randomInt(8, 15), pick([0, 30]));
    const token = generateToken();

    await prisma.appointment.create({
      data: {
        referenceNumber: generateReferenceNumber(scheduledStart),
        source: AppointmentSource.ONLINE,
        visitorId: pick(visitorIds),
        teacherId: teacher.id,
        destinationId: pick(activeDestinations).id,
        visitTypeId: visitType.id,
        scheduledStart,
        scheduledEnd: new Date(
          scheduledStart.getTime() + visitType.defaultDurationMinutes * 60_000,
        ),
        purpose: pick(SEED_PURPOSES),
        partySize: random() < 0.75 ? 1 : randomInt(2, 3),
        vehicleNumber: pick(SEED_VEHICLES),
        status: AppointmentStatus.PENDING,
        publicTokenHash: hashToken(token),
        publicTokenExpiresAt: addDays(scheduledStart, 14),
      },
    });
  }

  // The first demo teacher always has pending work waiting on login.
  const primaryTeacher = teachers[0];
  if (primaryTeacher) {
    for (let i = 0; i < 3; i += 1) {
      const visitType = pick(activeVisitTypes);
      const scheduledStart = schoolTime(i + 1, 9 + i, 0);
      const token = generateToken();
      await prisma.appointment.create({
        data: {
          referenceNumber: generateReferenceNumber(scheduledStart),
          source: AppointmentSource.ONLINE,
          visitorId: pick(visitorIds),
          teacherId: primaryTeacher.id,
          destinationId: pick(activeDestinations).id,
          visitTypeId: visitType.id,
          scheduledStart,
          scheduledEnd: new Date(
            scheduledStart.getTime() + visitType.defaultDurationMinutes * 60_000,
          ),
          purpose: pick(SEED_PURPOSES),
          partySize: 1,
          status: AppointmentStatus.PENDING,
          publicTokenHash: hashToken(token),
          publicTokenExpiresAt: addDays(scheduledStart, 14),
        },
      });
    }
  }

  console.log(
    `  history: ${completed} completed, ${noShow} no-show, ${rejected} rejected (past 90 days)`,
  );
}

interface TodayVisitOptions {
  context: HistoryContext;
  startHour: number;
  status: VisitStatus;
  partySize?: number;
  durationMinutes?: number;
  withCredential?: boolean;
  label: string;
}

async function createTodayVisit(options: TodayVisitOptions): Promise<void> {
  const { context, startHour, status, partySize = 1, withCredential = false } = options;
  const { visitorIds, teachers, guards, destinations, visitTypes, badgePrefix } = context;

  const activeTeachers = teachers.filter((_, index) => SEED_TEACHERS[index]?.isAcceptingVisits);
  const visitType = pick(visitTypes.filter((t) => t.isActive));
  const teacher = pick(activeTeachers);
  const destination = pick(destinations.filter((d) => d.isActive));
  const visitorId = pick(visitorIds);
  const guard = pick(guards);

  const durationMinutes = options.durationMinutes ?? visitType.defaultDurationMinutes;
  const scheduledStart = schoolTime(0, startHour, 0);
  const scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60_000);

  const rawToken = generateToken();
  const appointment = await prisma.appointment.create({
    data: {
      referenceNumber: generateReferenceNumber(scheduledStart),
      source: AppointmentSource.ONLINE,
      visitorId,
      teacherId: teacher.id,
      destinationId: destination.id,
      visitTypeId: visitType.id,
      scheduledStart,
      scheduledEnd,
      purpose: pick(SEED_PURPOSES),
      partySize,
      vehicleNumber: pick(SEED_VEHICLES),
      status: AppointmentStatus.APPROVED,
      decidedAt: new Date(scheduledStart.getTime() - 12 * 60 * 60 * 1000),
      decidedById: teacher.id,
      publicTokenHash: hashToken(rawToken),
      publicTokenExpiresAt: addDays(scheduledEnd, 7),
    },
  });

  if (withCredential) {
    await prisma.qrCredential.create({
      data: {
        appointmentId: appointment.id,
        tokenHash: hashToken(rawToken),
        fallbackCodeHash: hashFallbackCode(generateFallbackCode()),
        validFrom: new Date(scheduledStart.getTime() - 30 * 60_000),
        expiresAt: new Date(scheduledEnd.getTime() + 30 * 60_000),
      },
    });
  }

  const badgeNumber = await allocateBadgeNumber(
    prisma,
    badgePrefix,
    toIsoDayString(scheduledStart),
  );

  const checkedInAt =
    status === VisitStatus.CHECKED_IN || status === VisitStatus.CHECKED_OUT
      ? new Date(scheduledStart.getTime() + 5 * 60_000)
      : null;

  const checkedOutAt =
    status === VisitStatus.CHECKED_OUT
      ? new Date(scheduledStart.getTime() + (durationMinutes + 10) * 60_000)
      : null;

  const visit = await prisma.visit.create({
    data: {
      appointmentId: appointment.id,
      visitorId,
      teacherId: teacher.id,
      destinationId: destination.id,
      status,
      badgeNumber,
      expectedStart: scheduledStart,
      expectedEnd: scheduledEnd,
      checkedInAt,
      checkedInById: checkedInAt ? guard.id : null,
      checkedOutAt,
      checkedOutById: checkedOutAt ? guard.id : null,
      idSightedAt: checkedInAt && visitType.requiresIdSighted ? checkedInAt : null,
      idSightedById: checkedInAt && visitType.requiresIdSighted ? guard.id : null,
      denialCode: status === VisitStatus.DENIED ? 'GUARD_DECISION' : null,
      guardNote:
        status === VisitStatus.DENIED
          ? 'Visitor could not present physical identification. Advised to return with ID.'
          : null,
    },
  });

  const events: Array<{
    visitId: string;
    type: VisitEventType;
    actorUserId: string;
    createdAt: Date;
  }> = [];

  if (checkedInAt) {
    events.push({
      visitId: visit.id,
      type: VisitEventType.CHECKED_IN,
      actorUserId: guard.id,
      createdAt: checkedInAt,
    });
  }
  if (checkedOutAt) {
    events.push({
      visitId: visit.id,
      type: VisitEventType.CHECKED_OUT,
      actorUserId: guard.id,
      createdAt: checkedOutAt,
    });
  }
  if (status === VisitStatus.DENIED) {
    events.push({
      visitId: visit.id,
      type: VisitEventType.DENIED,
      actorUserId: guard.id,
      createdAt: scheduledStart,
    });
  }

  if (events.length > 0) await prisma.visitEvent.createMany({ data: events });
}

async function seedNotifications(): Promise<void> {
  const now = new Date();

  await prisma.notification.createMany({
    data: [
      {
        type: 'visitor.request_received',
        channel: NotificationChannel.EMAIL,
        recipient: 'nurul.huda@contoh.test',
        templateKey: 'visitor-request-received',
        payload: { reference: 'VP-26C4-9XQT' },
        status: NotificationStatus.SENT,
        attempts: 1,
        sentAt: addDays(now, -2),
      },
      {
        type: 'teacher.new_request',
        channel: NotificationChannel.EMAIL,
        recipient: 'teacher@smkbbsp.test',
        templateKey: 'teacher-new-request',
        payload: { reference: 'VP-26C4-9XQT' },
        status: NotificationStatus.SENT,
        attempts: 1,
        sentAt: addDays(now, -2),
      },
      {
        // A realistic failure so the admin retry screen has something to act on.
        type: 'visitor.approved',
        channel: NotificationChannel.EMAIL,
        recipient: 'kamarul.ariffin@contoh.test',
        templateKey: 'visitor-approved',
        payload: { reference: 'VP-26C4-2LMN' },
        status: NotificationStatus.FAILED,
        attempts: 3,
        lastErrorCode: 'ECONNREFUSED',
      },
    ],
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demonstration data with NODE_ENV=production.');
  }

  console.log('Seeding SMKBBSP VisitorPass demonstration data ...');

  await clearOperationalData();
  console.log('  cleared operational tables');

  await ensureSettingDefaults(prisma);
  console.log('  settings ready');

  const { admin, guards, teachers } = await seedUsers();
  console.log(`  users: 1 admin, ${guards.length} guards, ${teachers.length} teachers`);

  const { destinations, visitTypes } = await seedReferenceData();
  console.log(`  reference: ${destinations.length} destinations, ${visitTypes.length} visit types`);

  const visitorIds = await seedVisitors();
  console.log(`  visitors: ${visitorIds.length}`);

  await seedBlacklist(admin.id);
  console.log('  blacklist: 3 entries (1 block, 1 review, 1 inactive)');

  await seedHistory({
    visitorIds,
    teachers,
    guards,
    destinations,
    visitTypes,
    badgePrefix: 'V',
  });

  await seedNotifications();

  const counts = {
    appointments: await prisma.appointment.count(),
    visits: await prisma.visit.count(),
    credentials: await prisma.qrCredential.count(),
  };
  console.log(
    `  totals: ${counts.appointments} appointments, ${counts.visits} visits, ${counts.credentials} live passes`,
  );

  console.log('\nDone. Demo accounts (local development only):');
  console.log('  admin@smkbbsp.test    /  ' + (process.env.SEED_ADMIN_PASSWORD ?? 'Admin#Demo2025'));
  console.log('  guard@smkbbsp.test    /  ' + (process.env.SEED_GUARD_PASSWORD ?? 'Guard#Demo2025'));
  console.log(
    '  teacher@smkbbsp.test  /  ' + (process.env.SEED_TEACHER_PASSWORD ?? 'Teacher#Demo2025'),
  );
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

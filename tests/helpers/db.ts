import { IdentityType, PrismaClient, Role, type Destination, type User, type VisitType } from '@prisma/client';
import { buildIdentityFields } from '@/lib/crypto/identity';
import { hashPassword } from '@/lib/crypto/password';
import { ensureSettingDefaults } from '@/lib/domain/settings';
import { CONSENT_VERSION } from '@/lib/constants';

/**
 * Integration-test database helpers.
 *
 * Tests run against a real PostgreSQL database (`visitorpass_test`, chosen by
 * tests/setup.ts) rather than mocks, because the behaviour under test *is* the
 * transactional behaviour: rollback, uniqueness, and idempotency cannot be
 * demonstrated against an in-memory fake.
 */

export const testDb = new PrismaClient();

/** Delete every row, in foreign-key-safe order. Call in `beforeEach`. */
export async function resetDatabase(): Promise<void> {
  await testDb.visitEvent.deleteMany();
  await testDb.visit.deleteMany();
  await testDb.qrCredential.deleteMany();
  await testDb.appointment.deleteMany();
  await testDb.visitor.deleteMany();
  await testDb.blacklistEntry.deleteMany();
  await testDb.notification.deleteMany();
  await testDb.auditLog.deleteMany();
  await testDb.rateLimitCounter.deleteMany();
  await testDb.session.deleteMany();
  await testDb.teacherProfile.deleteMany();
  await testDb.user.deleteMany();
  // Reference data is recreated per test too, so unique codes stay free.
  await testDb.destination.deleteMany();
  await testDb.visitType.deleteMany();
}

export interface BaseFixtures {
  admin: User;
  guard: User;
  teacher: User;
  otherTeacher: User;
  destination: Destination;
  visitType: VisitType;
  /** A visit type that does not require the guard to sight physical ID. */
  visitTypeNoId: VisitType;
}

/** The minimum cast of users and reference data most tests need. */
export async function seedBaseFixtures(): Promise<BaseFixtures> {
  await ensureSettingDefaults(testDb);

  const passwordHash = await hashPassword('TestPassword#1');

  const admin = await testDb.user.create({
    data: { email: 'admin@test.test', name: 'Test Admin', passwordHash, role: Role.ADMIN },
  });

  const guard = await testDb.user.create({
    data: { email: 'guard@test.test', name: 'Test Guard', passwordHash, role: Role.GUARD },
  });

  const teacher = await testDb.user.create({
    data: {
      email: 'teacher@test.test',
      name: 'Test Teacher',
      passwordHash,
      role: Role.TEACHER,
      teacherProfile: {
        create: { staffCode: 'T-001', department: 'Science', isAcceptingVisits: true },
      },
    },
  });

  const otherTeacher = await testDb.user.create({
    data: {
      email: 'other@test.test',
      name: 'Other Teacher',
      passwordHash,
      role: Role.TEACHER,
      teacherProfile: {
        create: { staffCode: 'T-002', department: 'History', isAcceptingVisits: true },
      },
    },
  });

  const destination = await testDb.destination.create({
    data: {
      code: 'OFFICE',
      nameEn: 'General Office',
      nameMs: 'Pejabat Am',
      instructionsEn: 'Ground floor, Block A.',
      instructionsMs: 'Aras bawah, Blok A.',
    },
  });

  const visitType = await testDb.visitType.create({
    data: {
      code: 'PARENT',
      nameEn: 'Parent meeting',
      nameMs: 'Pertemuan ibu bapa',
      requiresIdSighted: true,
      defaultDurationMinutes: 30,
    },
  });

  const visitTypeNoId = await testDb.visitType.create({
    data: {
      code: 'DELIVERY',
      nameEn: 'Delivery',
      nameMs: 'Penghantaran',
      requiresIdSighted: false,
      defaultDurationMinutes: 20,
    },
  });

  return { admin, guard, teacher, otherTeacher, destination, visitType, visitTypeNoId };
}

/** Create a visitor with correctly derived identity columns. */
export async function createTestVisitor(options: {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  nric?: string;
}) {
  const nric = options.nric ?? '990101145523';
  const identity = buildIdentityFields(IdentityType.NRIC, nric);

  return testDb.visitor.create({
    data: {
      fullName: options.fullName ?? 'Test Visitor',
      email: options.email === undefined ? 'visitor@contoh.test' : options.email,
      phone: options.phone === undefined ? '+60121110001' : options.phone,
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
}

/**
 * A future date/time that always falls on a weekday inside school hours,
 * so schedule validation is never the thing that fails a test by accident.
 */
export function nextSchoolSlot(daysAhead = 2): { visitDate: string; visitTime: string } {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + daysAhead);

  // Nudge forward off Saturday/Sunday in Malaysian terms (UTC+8).
  for (let i = 0; i < 7; i += 1) {
    const klDay = new Date(target.getTime() + 8 * 60 * 60 * 1000).getUTCDay();
    if (klDay !== 0 && klDay !== 6) break;
    target.setUTCDate(target.getUTCDate() + 1);
  }

  const kl = new Date(target.getTime() + 8 * 60 * 60 * 1000);
  const visitDate = `${kl.getUTCFullYear()}-${String(kl.getUTCMonth() + 1).padStart(2, '0')}-${String(kl.getUTCDate()).padStart(2, '0')}`;

  return { visitDate, visitTime: '10:00' };
}

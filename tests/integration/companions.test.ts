import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentStatus, BlacklistStatus, IdentityType, MatchPolicy } from '@prisma/client';
import { resetDatabase, seedBaseFixtures, testDb, nextSchoolSlot, type BaseFixtures } from '../helpers/db';
import { createAppointmentRequest } from '@/lib/domain/appointments';
import { appointmentRequestSchema } from '@/lib/validation/appointment';
import { computeIdentityHmac, decryptIdentity, normalizeIdentity } from '@/lib/crypto/identity';

/**
 * Accompanying visitors.
 *
 * A party larger than one now names every attendee, so the school knows who is
 * on the grounds rather than only how many people are. Companion identity data
 * is held to the same standard as the main visitor's: encrypted at rest, keyed
 * for matching, and never stored in the clear.
 */

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function buildInput(overrides: Record<string, unknown> = {}) {
  const slot = nextSchoolSlot();
  return {
    fullName: 'Nurul Huda binti Ismail',
    email: 'nurul.huda@contoh.test',
    phone: '012-345 6789',
    identityType: IdentityType.NRIC,
    identityNumber: '880101145523',
    visitorCategory: 'PARENT',
    teacherId: fixtures.teacher.id,
    visitTypeId: fixtures.visitType.id,
    destinationId: fixtures.destination.id,
    visitDate: slot.visitDate,
    visitTime: slot.visitTime,
    purpose: 'Discuss my child term results',
    partySize: 1,
    consent: 'on',
    companions: [],
    ...overrides,
  };
}

const companion = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Kamarul Ariffin bin Jaafar',
  relation: 'Spouse',
  phone: '012-345 6790',
  identityType: IdentityType.NRIC,
  identityNumber: '829912085502',
  ...overrides,
});

describe('validation', () => {
  it('accepts a lone visitor with no companions', () => {
    expect(appointmentRequestSchema.safeParse(buildInput()).success).toBe(true);
  });

  it('requires a companion for every extra person', () => {
    const result = appointmentRequestSchema.safeParse(buildInput({ partySize: 3, companions: [companion()] }));
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path.join('.') === 'partySize');
    expect(issue?.message).toMatch(/all 2 other people/i);
  });

  it('rejects companions listed without raising the party size', () => {
    const result = appointmentRequestSchema.safeParse(buildInput({ partySize: 1, companions: [companion()] }));
    expect(result.success).toBe(false);
  });

  it('accepts a matching party size and companion count', () => {
    expect(
      appointmentRequestSchema.safeParse(buildInput({ partySize: 2, companions: [companion()] })).success,
    ).toBe(true);
  });

  it('rejects a companion whose identity number is malformed', () => {
    const result = appointmentRequestSchema.safeParse(
      buildInput({ partySize: 2, companions: [companion({ identityNumber: '123' })] }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join('.') === 'companions.0.identityNumber')).toBe(true);
  });

  it('rejects the visitor listing themselves as their own companion', () => {
    const result = appointmentRequestSchema.safeParse(
      buildInput({ partySize: 2, companions: [companion({ identityNumber: '880101-14-5523' })] }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path.join('.') === 'companions.0.identityNumber');
    expect(issue?.message).toMatch(/your own/i);
  });

  it('rejects the same companion twice, however it was formatted', () => {
    const result = appointmentRequestSchema.safeParse(
      buildInput({
        partySize: 3,
        companions: [companion(), companion({ identityNumber: '829912-08-5502' })],
      }),
    );
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path.join('.') === 'companions.1.identityNumber');
    expect(issue?.message).toMatch(/already been added/i);
  });

  it('treats a companion phone number as optional', () => {
    expect(
      appointmentRequestSchema.safeParse(
        buildInput({ partySize: 2, companions: [companion({ phone: '' })] }),
      ).success,
    ).toBe(true);
  });
});

describe('storage', () => {
  it('stores each companion against the appointment', async () => {
    const parsed = appointmentRequestSchema.parse(
      buildInput({ partySize: 3, companions: [companion(), companion({ identityNumber: '889912105503', fullName: 'Devi a/p Subramaniam', relation: 'Sister' })] }),
    );
    const result = await createAppointmentRequest(parsed);

    const appointment = await testDb.appointment.findUniqueOrThrow({
      where: { referenceNumber: result.referenceNumber },
      include: { companions: true },
    });

    expect(appointment.partySize).toBe(3);
    expect(appointment.companions).toHaveLength(2);
    expect(appointment.companions.map((c) => c.relation).sort()).toEqual(['Sister', 'Spouse']);
  });

  it('encrypts a companion identity exactly as a visitor identity is', async () => {
    const parsed = appointmentRequestSchema.parse(
      buildInput({ partySize: 2, companions: [companion()] }),
    );
    const result = await createAppointmentRequest(parsed);

    const stored = await testDb.companion.findFirstOrThrow({
      where: { appointment: { referenceNumber: result.referenceNumber } },
    });

    // No column holds the plaintext, and the round trip still works.
    expect(JSON.stringify(stored)).not.toContain('829912085502');
    expect(
      decryptIdentity({
        ciphertext: stored.identityCiphertext,
        iv: stored.identityIv,
        tag: stored.identityTag,
        keyVersion: stored.identityKeyVersion,
      }),
    ).toBe('829912085502');
    expect(stored.identityLast4).toBe('5502');
    expect(stored.identityHmac).toBe(
      computeIdentityHmac(IdentityType.NRIC, normalizeIdentity(IdentityType.NRIC, '829912085502')),
    );
  });

  it('normalises a companion phone number', async () => {
    const parsed = appointmentRequestSchema.parse(
      buildInput({ partySize: 2, companions: [companion({ phone: '012-345 6790' })] }),
    );
    const result = await createAppointmentRequest(parsed);

    const stored = await testDb.companion.findFirstOrThrow({
      where: { appointment: { referenceNumber: result.referenceNumber } },
    });
    expect(stored.phone).toBe('+60123456790');
  });

  it('removes companions with their appointment', async () => {
    const parsed = appointmentRequestSchema.parse(
      buildInput({ partySize: 2, companions: [companion()] }),
    );
    const result = await createAppointmentRequest(parsed);

    await testDb.appointment.delete({ where: { referenceNumber: result.referenceNumber } });
    expect(await testDb.companion.count()).toBe(0);
  });
});

describe('blacklist screening', () => {
  it('holds the request for review when a companion is blocked', async () => {
    // The main visitor is clear; only the person travelling with them is not.
    await testDb.blacklistEntry.create({
      data: {
        status: BlacklistStatus.ACTIVE,
        identityHmac: computeIdentityHmac(
          IdentityType.NRIC,
          normalizeIdentity(IdentityType.NRIC, '829912085502'),
        ),
        displayName: 'Blocked companion',
        matchPolicy: MatchPolicy.BLOCK,
        reason: 'Test entry',
        // Set explicitly rather than taking the database default: the database
        // clock can run ahead of this process, which would leave the entry
        // not yet in force when screening runs a moment later.
        validFrom: new Date(Date.now() - 60_000),
        createdById: fixtures.admin.id,
      },
    });

    const parsed = appointmentRequestSchema.parse(
      buildInput({ partySize: 2, companions: [companion()] }),
    );
    const result = await createAppointmentRequest(parsed);

    // Screening only the form-filler would leave an obvious way past the
    // blacklist: arrive as somebody else's guest.
    expect(result.status).toBe(AppointmentStatus.REVIEW_REQUIRED);
  });

  it('leaves a clear party pending as usual', async () => {
    const parsed = appointmentRequestSchema.parse(
      buildInput({ partySize: 2, companions: [companion()] }),
    );
    const result = await createAppointmentRequest(parsed);
    expect(result.status).toBe(AppointmentStatus.PENDING);
  });
});

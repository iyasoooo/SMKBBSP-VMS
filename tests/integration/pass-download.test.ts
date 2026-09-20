import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppointmentStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import {
  createApprovedAppointment,
  resetDatabase,
  seedBaseFixtures,
  testDb,
  type BaseFixtures,
} from '../helpers/db';
import { GET } from '@/app/v/[token]/pass/route';
import { generateToken } from '@/lib/crypto/tokens';

/**
 * Downloading the pass as a file.
 *
 * This endpoint is reachable by URL with no session, so its checks cannot be
 * inherited from a layout and cannot be assumed. What matters here is that it
 * is no weaker than the page it mirrors: a token that would not render a pass
 * must not download one either, and every refusal must look the same so the
 * endpoint cannot be used to sort real tokens from guesses.
 */

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function request(token: string): [NextRequest, { params: Promise<{ token: string }> }] {
  return [
    new NextRequest(`http://localhost/v/${token}/pass`),
    { params: Promise.resolve({ token }) },
  ];
}

describe('visitor pass download', () => {
  it('returns a PDF for an approved appointment holding a live credential', async () => {
    const { rawToken } = await createApprovedAppointment(fixtures);

    const response = await GET(...request(rawToken));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="visitor-pass-VP-TEST-[A-Z0-9]{4}\.pdf"$/,
    );

    // A cached pass would outlive its own revocation in the browser.
    expect(response.headers.get('cache-control')).toContain('no-store');

    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  it('puts the reference in the filename and the visitor name nowhere near it', async () => {
    const { rawToken, appointmentId } = await createApprovedAppointment(fixtures);
    const appointment = await testDb.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { visitor: true },
    });

    const response = await GET(...request(rawToken));
    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toContain(appointment.referenceNumber);
    expect(disposition).not.toContain(appointment.visitor.fullName);
  });

  it('refuses an unknown token', async () => {
    const response = await GET(...request(generateToken()));
    expect(response.status).toBe(404);
  });

  it('refuses a token whose appointment is not approved', async () => {
    const { rawToken, appointmentId } = await createApprovedAppointment(fixtures);
    await testDb.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.PENDING },
    });

    const response = await GET(...request(rawToken));
    expect(response.status).toBe(404);
  });

  it('stops downloading the moment the pass is revoked', async () => {
    const { rawToken, appointmentId } = await createApprovedAppointment(fixtures);

    expect((await GET(...request(rawToken))).status).toBe(200);

    await testDb.qrCredential.updateMany({
      where: { appointmentId },
      data: { revokedAt: new Date() },
    });

    expect((await GET(...request(rawToken))).status).toBe(404);
  });

  it('refuses once the private link itself has expired', async () => {
    const { rawToken, appointmentId } = await createApprovedAppointment(fixtures);
    await testDb.appointment.update({
      where: { id: appointmentId },
      data: { publicTokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await GET(...request(rawToken));
    expect(response.status).toBe(404);
  });

  it('answers every refusal identically, so a guess cannot be told from a real token', async () => {
    const { rawToken, appointmentId } = await createApprovedAppointment(fixtures);
    await testDb.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.REJECTED },
    });

    const rejected = await GET(...request(rawToken));
    const unknown = await GET(...request(generateToken()));

    expect(rejected.status).toBe(unknown.status);
    expect(await rejected.text()).toBe(await unknown.text());
  });
});

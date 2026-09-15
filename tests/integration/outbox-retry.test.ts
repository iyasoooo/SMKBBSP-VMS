import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { resetDatabase, testDb } from '../helpers/db';
import { deliverNotification, processPendingNotifications } from '@/lib/email/outbox';

/**
 * The outbox's second chance.
 *
 * Three things were wrong here at once, and each hid the next:
 *
 *   1. Nothing ever ran the sweep. `processPendingNotifications` existed and
 *      was documented "exposed for a scheduled command"; no scheduled command
 *      was ever written, so the only delivery attempt a notification ever got
 *      was the inline one fired by the action that queued it.
 *   2. The sweep looked only for `PENDING`, but a transport failure records
 *      `FAILED` immediately - so even once something did call it, the rows
 *      that actually needed retrying were invisible to it.
 *   3. Delivery claimed nothing before sending, so adding a sweep alongside
 *      the inline flush would have let both pick up the same row and send a
 *      visitor their pass twice.
 *
 * These tests pin all three. They assert on attempt counts rather than on
 * anything arriving, deliberately: whether the local Mailpit container happens
 * to be up changes whether a delivery succeeds, and none of the properties
 * being tested here depend on that. `attempts` is the ledger either way.
 */

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function queueRow(overrides: Partial<{ status: NotificationStatus; attempts: number }> = {}) {
  return testDb.notification.create({
    data: {
      channel: NotificationChannel.EMAIL,
      status: overrides.status ?? NotificationStatus.PENDING,
      attempts: overrides.attempts ?? 0,
      recipient: 'parent@contoh.test',
      templateKey: 'visitor-approved',
      type: 'visitor.approved',
      payload: { reference: 'VP-TEST-0001', visitorName: 'Test Visitor' },
    },
  });
}

describe('claiming a notification before sending', () => {
  it('counts exactly one attempt per delivery, not two', async () => {
    const row = await queueRow();
    await deliverNotification(row.id);

    const after = await testDb.notification.findUniqueOrThrow({ where: { id: row.id } });
    // The claim increments; the outcome must not increment again.
    expect(after.attempts).toBe(1);
  });

  it('lets only one of two concurrent deliveries take the row', async () => {
    const row = await queueRow();

    // Both read the same starting state, as a sweep and an inline flush would.
    const [a, b] = await Promise.all([
      deliverNotification(row.id),
      deliverNotification(row.id),
    ]);

    /*
     * At most one may report having sent it. Both reporting success would mean
     * the visitor received the same pass twice - the exact duplicate the claim
     * exists to prevent - and whether either succeeds depends only on whether a
     * mail server is listening, which is not what this is testing.
     */
    expect([a, b].filter(Boolean).length).toBeLessThanOrEqual(1);

    // The ledger is the real assertion: the row was spent exactly once.
    const after = await testDb.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(1);
  });

  it('never re-sends something already delivered', async () => {
    const row = await queueRow({ status: NotificationStatus.SENT });
    await expect(deliverNotification(row.id)).resolves.toBe(true);

    const after = await testDb.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.attempts).toBe(0);
  });
});

describe('the sweep', () => {
  /*
   * The bug that made the whole mechanism inert. A row only sits in `PENDING`
   * for the instant between the business transaction committing and the inline
   * flush running; by the time anybody would want to retry it, it is `FAILED`.
   */
  it('picks up rows a transport failure left behind', async () => {
    await queueRow({ status: NotificationStatus.FAILED, attempts: 1 });

    await processPendingNotifications(10);

    const after = await testDb.notification.findFirstOrThrow();
    expect(after.attempts).toBe(2);
  });

  it('still picks up rows that were never attempted', async () => {
    await queueRow({ status: NotificationStatus.PENDING, attempts: 0 });

    await processPendingNotifications(10);

    const after = await testDb.notification.findFirstOrThrow();
    expect(after.attempts).toBe(1);
  });

  it('gives up once a row has used its attempts', async () => {
    // Five is the cap; a row at the cap must not be retried forever.
    await queueRow({ status: NotificationStatus.FAILED, attempts: 5 });

    await processPendingNotifications(10);

    const after = await testDb.notification.findFirstOrThrow();
    expect(after.attempts).toBe(5);
  });

  it('leaves delivered notifications alone', async () => {
    await queueRow({ status: NotificationStatus.SENT, attempts: 1 });

    await processPendingNotifications(10);

    const after = await testDb.notification.findFirstOrThrow();
    expect(after.status).toBe(NotificationStatus.SENT);
    expect(after.attempts).toBe(1);
  });

  it('honours the batch size so one sweep cannot run away', async () => {
    for (let i = 0; i < 5; i += 1) await queueRow();

    await processPendingNotifications(2);

    const attempted = await testDb.notification.count({ where: { attempts: { gt: 0 } } });
    expect(attempted).toBe(2);
  });

  it('works through the oldest first', async () => {
    const first = await queueRow();
    // Make the second unambiguously newer than the first.
    await testDb.notification.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await queueRow();

    await processPendingNotifications(1);

    const after = await testDb.notification.findUniqueOrThrow({ where: { id: first.id } });
    expect(after.attempts).toBe(1);
  });
});

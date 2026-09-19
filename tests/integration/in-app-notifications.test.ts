import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { resetDatabase, seedBaseFixtures, testDb, type BaseFixtures } from '../helpers/db';
import {
  countUnreadInApp,
  listInAppNotifications,
  markAllInAppRead,
  markInAppRead,
  queueInAppNotification,
} from '@/lib/domain/in-app-notifications';

/**
 * In-app notifications.
 *
 * The property that matters most is isolation: one member of staff must never
 * be able to read or alter another's notifications, even holding a valid
 * notification id. The service scopes every query and update by `userId`
 * rather than trusting the id it is handed, and these tests hold it to that.
 */

let fixtures: BaseFixtures;

beforeEach(async () => {
  await resetDatabase();
  fixtures = await seedBaseFixtures();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function notify(userId: string, title = 'Test notification'): Promise<string> {
  return queueInAppNotification({ userId, type: 'test', title, link: '/teacher' });
}

describe('queueInAppNotification', () => {
  it('writes an IN_APP row that needs no delivery attempt', async () => {
    const id = await notify(fixtures.teacher.id);

    const row = await testDb.notification.findUniqueOrThrow({ where: { id } });
    expect(row.channel).toBe(NotificationChannel.IN_APP);
    expect(row.status).toBe(NotificationStatus.SENT);
    expect(row.sentAt).not.toBeNull();
    expect(row.userId).toBe(fixtures.teacher.id);
    expect(row.readAt).toBeNull();
  });

  it('is unread on creation and counted', async () => {
    await notify(fixtures.teacher.id);
    await notify(fixtures.teacher.id);
    expect(await countUnreadInApp(fixtures.teacher.id)).toBe(2);
  });
});

describe('listInAppNotifications', () => {
  it('returns only the owner rows', async () => {
    await notify(fixtures.teacher.id, 'For the teacher');
    await notify(fixtures.admin.id, 'For the admin');

    const teacherList = await listInAppNotifications(fixtures.teacher.id);
    expect(teacherList).toHaveLength(1);
    expect(teacherList[0]?.title).toBe('For the teacher');

    const adminList = await listInAppNotifications(fixtures.admin.id);
    expect(adminList).toHaveLength(1);
    expect(adminList[0]?.title).toBe('For the admin');
  });

  // Rows written before email was removed are still EMAIL-channel. They are
  // history, and must never surface in anyone's in-app list.
  it('does not surface legacy email rows', async () => {
    await testDb.notification.create({
      data: {
        type: 'visitor.approved',
        channel: NotificationChannel.EMAIL,
        recipient: 'someone@contoh.test',
        templateKey: 'visitor-approved',
        payload: { reference: 'VP-TEST-0001' },
        userId: fixtures.teacher.id,
      },
    });

    expect(await listInAppNotifications(fixtures.teacher.id)).toHaveLength(0);
    expect(await countUnreadInApp(fixtures.teacher.id)).toBe(0);
  });

  it('returns newest first', async () => {
    const first = await notify(fixtures.teacher.id, 'Older');
    await testDb.notification.update({
      where: { id: first },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await notify(fixtures.teacher.id, 'Newer');

    const list = await listInAppNotifications(fixtures.teacher.id);
    expect(list[0]?.title).toBe('Newer');
  });
});

describe('markInAppRead', () => {
  it('marks the owner own notification read', async () => {
    const id = await notify(fixtures.teacher.id);

    expect(await markInAppRead(fixtures.teacher.id, id)).toBe(1);
    expect(await countUnreadInApp(fixtures.teacher.id)).toBe(0);
  });

  it('refuses to mark another user notification, even with a valid id', async () => {
    const id = await notify(fixtures.teacher.id);

    // The other teacher holds a real, current notification id.
    expect(await markInAppRead(fixtures.otherTeacher.id, id)).toBe(0);

    // It must still be unread for its actual owner.
    const row = await testDb.notification.findUniqueOrThrow({ where: { id } });
    expect(row.readAt).toBeNull();
    expect(await countUnreadInApp(fixtures.teacher.id)).toBe(1);
  });

  it('is idempotent', async () => {
    const id = await notify(fixtures.teacher.id);
    expect(await markInAppRead(fixtures.teacher.id, id)).toBe(1);
    expect(await markInAppRead(fixtures.teacher.id, id)).toBe(0);
  });

  it('ignores an unknown id', async () => {
    expect(await markInAppRead(fixtures.teacher.id, 'no-such-id')).toBe(0);
  });
});

describe('markAllInAppRead', () => {
  it('clears only the caller unread rows', async () => {
    await notify(fixtures.teacher.id);
    await notify(fixtures.teacher.id);
    await notify(fixtures.otherTeacher.id);

    expect(await markAllInAppRead(fixtures.teacher.id)).toBe(2);
    expect(await countUnreadInApp(fixtures.teacher.id)).toBe(0);
    // The other teacher is untouched.
    expect(await countUnreadInApp(fixtures.otherTeacher.id)).toBe(1);
  });
});

describe('content safety', () => {
  it('stores no identity value or token in the payload', async () => {
    const id = await queueInAppNotification({
      userId: fixtures.teacher.id,
      type: 'teacher.new_request',
      title: 'New visit request awaiting your decision',
      body: 'Nurul Huda binti Ismail has asked to meet you on 14 Mar 2026, 09:30.',
      link: '/teacher/requests/abc',
    });

    const row = await testDb.notification.findUniqueOrThrow({ where: { id } });
    const serialized = JSON.stringify(row.payload);
    expect(serialized).not.toMatch(/\d{12}/);
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{43,}/);
  });
});

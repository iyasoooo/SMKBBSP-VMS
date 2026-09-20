import { NotificationChannel, NotificationStatus, type Prisma } from '@prisma/client';
import { prisma, type Db } from '@/lib/db/prisma';

/**
 * In-app notifications.
 *
 * The only way the system tells anyone anything. There is no email: staff see
 * these when signed in, and visitors - who have no account - read their
 * private page instead.
 *
 * They use the `Notification` table. An in-app row is one whose channel is
 * IN_APP and which is owned by a `userId`; it needs no delivery attempt, so it
 * is written already SENT. EMAIL rows in the same table are history from
 * before email was removed, and are never listed here.
 *
 * Title and body are rendered from safe values only, never a raw identity
 * number or token.
 */

export interface InAppNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  /** In-app route to open when selected. */
  link?: string;
}

/**
 * Queue an in-app notification. Call inside the business transaction, so it
 * cannot survive a rolled-back change.
 */
export async function queueInAppNotification(
  input: InAppNotificationInput,
  db: Db = prisma,
): Promise<string> {
  const notification = await db.notification.create({
    data: {
      type: input.type,
      channel: NotificationChannel.IN_APP,
      // No delivery step exists for in-app, so it is complete on write.
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      recipient: 'in-app',
      templateKey: 'in-app',
      userId: input.userId,
      link: input.link ?? null,
      payload: {
        title: input.title,
        body: input.body ?? '',
      } satisfies Prisma.InputJsonObject,
    },
    select: { id: true },
  });

  return notification.id;
}

export interface InAppNotificationView {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
}

function toView(row: {
  id: string;
  payload: Prisma.JsonValue;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
}): InAppNotificationView {
  const payload = (row.payload ?? {}) as { title?: unknown; body?: unknown };

  return {
    id: row.id,
    title: typeof payload.title === 'string' ? payload.title : 'Notification',
    body: typeof payload.body === 'string' ? payload.body : '',
    link: row.link,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

/** Notifications belonging to one user, newest first. */
export async function listInAppNotifications(
  userId: string,
  limit = 30,
  db: Db = prisma,
): Promise<InAppNotificationView[]> {
  const rows = await db.notification.findMany({
    where: { userId, channel: NotificationChannel.IN_APP },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, payload: true, link: true, createdAt: true, readAt: true },
  });

  return rows.map(toView);
}

export async function countUnreadInApp(userId: string, db: Db = prisma): Promise<number> {
  return db.notification.count({
    where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
  });
}

/**
 * Mark one notification read.
 *
 * Scoped by `userId` in the same statement, so a crafted id belonging to
 * another user matches nothing rather than being updated.
 */
export async function markInAppRead(
  userId: string,
  notificationId: string,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.notification.updateMany({
    where: {
      id: notificationId,
      userId,
      channel: NotificationChannel.IN_APP,
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  return count;
}

export async function markAllInAppRead(userId: string, db: Db = prisma): Promise<number> {
  const { count } = await db.notification.updateMany({
    where: { userId, channel: NotificationChannel.IN_APP, readAt: null },
    data: { readAt: new Date() },
  });

  return count;
}

import nodemailer, { type Transporter } from 'nodemailer';
import { NotificationChannel, NotificationStatus, type Prisma } from '@prisma/client';
import { prisma, type Db } from '@/lib/db/prisma';
import { getEnv } from '@/lib/env';
import { renderEmail, type TemplateKey, type TemplatePayload } from '@/lib/email/templates';
import { createLogger } from '@/lib/logger';

const log = createLogger('outbox');

/**
 * Transactional outbox.
 *
 * The notification row is written inside the same transaction as the business
 * change that triggered it. That gives two guarantees:
 *
 *   - An approval that rolls back cannot leave a "you are approved" email
 *     queued for a visitor whose appointment was never approved.
 *   - An SMTP outage cannot roll back an approval. Delivery happens *after*
 *     commit, and a failure only marks the row FAILED for later retry.
 *
 * This is why nothing in this module sends mail inside a transaction.
 */

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;

  const env = getEnv();
  cachedTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // Mailpit accepts anonymous mail; credentials are only sent when provided.
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10_000,
  });

  return cachedTransport;
}

/** Test seam so integration tests can assert without a live SMTP server. */
export function __setTransportForTesting(transport: Transporter | null): void {
  cachedTransport = transport;
}

export interface QueueEmailInput {
  type: string;
  templateKey: TemplateKey;
  recipient: string;
  payload: TemplatePayload;
}

/**
 * Add an email to the outbox. Call inside the business transaction.
 * Returns the notification id so the caller can process it after commit.
 */
export async function queueEmail(input: QueueEmailInput, db: Db = prisma): Promise<string> {
  const notification = await db.notification.create({
    data: {
      type: input.type,
      channel: NotificationChannel.EMAIL,
      recipient: input.recipient,
      templateKey: input.templateKey,
      payload: input.payload as Prisma.InputJsonObject,
      status: NotificationStatus.PENDING,
    },
    select: { id: true },
  });

  return notification.id;
}

const MAX_ATTEMPTS = 5;

/**
 * Attempt delivery of one notification.
 *
 * Never throws. A transport failure records a short error *code* - not the
 * provider's message, which can include host names and credentials - and
 * leaves the row retryable.
 */
export async function deliverNotification(notificationId: string): Promise<boolean> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return false;
  if (notification.status === NotificationStatus.SENT) return true;
  if (notification.attempts >= MAX_ATTEMPTS) return false;

  const env = getEnv();
  const payload = (notification.payload ?? {}) as TemplatePayload;

  try {
    const rendered = renderEmail(notification.templateKey as TemplateKey, payload);

    await getTransport().sendMail({
      from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_ADDRESS },
      to: notification.recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastErrorCode: null,
      },
    });

    return true;
  } catch (error) {
    const code = toSafeErrorCode(error);

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: NotificationStatus.FAILED,
        attempts: { increment: 1 },
        lastErrorCode: code,
      },
    });

    // Logged without the recipient address or message body.
    log.error('delivery failed', {
      notificationId: notification.id,
      templateKey: notification.templateKey,
      code,
    });

    return false;
  }
}

/**
 * Reduce any transport error to a short, non-sensitive code.
 * Raw SMTP errors routinely embed the server host, port and auth state.
 */
function toSafeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code.slice(0, 40);
  }
  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) return 'ETIMEDOUT';
    if (/auth/i.test(error.message)) return 'EAUTH';
  }
  return 'EUNKNOWN';
}

/**
 * Deliver a batch of queued notifications after their transaction committed.
 * Failures are swallowed by design: the business change already succeeded.
 */
export async function flushNotifications(ids: string[]): Promise<void> {
  for (const id of ids) {
    await deliverNotification(id);
  }
}

/**
 * Fire-and-forget flush.
 *
 * Used by request handlers that should not make a visitor wait for SMTP. The
 * promise is deliberately detached, with a catch so an unhandled rejection
 * cannot take the process down.
 */
export function flushNotificationsInBackground(ids: string[]): void {
  if (ids.length === 0) return;
  void flushNotifications(ids).catch((error: unknown) => {
    log.error('background flush failed', undefined, error);
  });
}

/** Requeue a FAILED notification. Used by the admin delivery screen. */
export async function retryNotification(notificationId: string): Promise<boolean> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: { status: NotificationStatus.PENDING, lastErrorCode: null },
  });
  return deliverNotification(notificationId);
}

/** Process everything still pending. Exposed for a scheduled command. */
export async function processPendingNotifications(limit = 50): Promise<number> {
  const pending = await prisma.notification.findMany({
    where: { status: NotificationStatus.PENDING, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let delivered = 0;
  for (const row of pending) {
    if (await deliverNotification(row.id)) delivered += 1;
  }
  return delivered;
}

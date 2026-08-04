import type { Metadata } from 'next';
import { NotificationStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { retryNotificationAction } from '@/app/admin/actions';
import { formatDateTime } from '@/lib/time';
import { maskEmail } from '@/lib/domain/contact';
import { getEnv } from '@/lib/env';
import { Alert, Card, EmptyState, PageHeading, Pill, TableScroll } from '@/components/ui/surface';
import { ActionForm } from '@/components/action-form';

export const metadata: Metadata = { title: 'Email delivery' };
export const dynamic = 'force-dynamic';

const STATUS_TONE = {
  SENT: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
} as const;

/**
 * Outbox viewer.
 *
 * Recipient addresses are masked here too: this screen is a delivery
 * diagnostic, not a contact directory, and an administrator does not need to
 * read a visitor's full email address to see whether a message went out.
 */
export default async function NotificationsPage() {
  await requireAdmin('/admin/notifications');
  const env = getEnv();

  const [notifications, counts] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.notification.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const countFor = (status: NotificationStatus): number =>
    counts.find((row) => row.status === status)?._count._all ?? 0;

  const failed = countFor(NotificationStatus.FAILED);

  return (
    <>
      <PageHeading
        title="Email delivery"
        description="Outbox status for every message the system has queued."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Sent" value={countFor(NotificationStatus.SENT)} tone="var(--ok)" />
        <Stat label="Pending" value={countFor(NotificationStatus.PENDING)} tone="var(--warn)" />
        <Stat label="Failed" value={failed} tone="var(--danger)" />
      </div>

      {failed > 0 ? (
        <div className="mb-5">
          <Alert tone="warning" title="Some messages could not be delivered">
            The business action still completed - a check-in or approval is never rolled back
            because email failed. Confirm the mail server at{' '}
            <code className="font-mono">
              {env.SMTP_HOST}:{env.SMTP_PORT}
            </code>{' '}
            is running, then retry.
          </Alert>
        </div>
      ) : null}

      <Card>
        {notifications.length === 0 ? (
          <EmptyState title="No messages have been queued yet" />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Email delivery log</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Queued</th>
                  <th scope="col" className="px-4 py-3 font-medium">Type</th>
                  <th scope="col" className="px-4 py-3 font-medium">Recipient</th>
                  <th scope="col" className="px-4 py-3 font-medium">Attempts</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {notifications.map((notification) => (
                  <tr key={notification.id}>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {formatDateTime(notification.createdAt)}
                      {notification.sentAt ? (
                        <span className="block text-muted">
                          sent {formatDateTime(notification.sentAt)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{notification.type}</td>
                    <td className="px-4 py-3 text-xs">{maskEmail(notification.recipient)}</td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      {notification.attempts}
                      {notification.lastErrorCode ? (
                        <span className="block font-mono text-xs text-muted">
                          {notification.lastErrorCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={STATUS_TONE[notification.status]}>{notification.status}</Pill>
                    </td>
                    <td className="px-4 py-3">
                      {notification.status !== NotificationStatus.SENT ? (
                        <ActionForm
                          action={retryNotificationAction}
                          hidden={{ notificationId: notification.id }}
                          submitLabel="Retry"
                          variant="secondary"
                          successMessage="Delivered."
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="surface-card rounded-xl px-5 py-4">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" style={{ color: tone }}>
        {value}
      </p>
    </div>
  );
}

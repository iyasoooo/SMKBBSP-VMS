import type { Metadata } from 'next';
import Link from 'next/link';
import { Role } from '@prisma/client';
import { requireRole, homeForRole } from '@/lib/auth/authorize';
import { listInAppNotifications, countUnreadInApp } from '@/lib/domain/in-app-notifications';
import { formatDateTime } from '@/lib/time';
import { Card, EmptyState, PageHeading, Pill } from '@/components/ui/surface';
import { ActionForm } from '@/components/action-form';
import { markAllNotificationsReadAction, markNotificationReadAction } from './actions';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

/**
 * The notification centre, shared by all three staff roles.
 *
 * It reads only the signed-in user's own rows - there is no id parameter to
 * tamper with, so one member of staff cannot read another's notifications.
 */
export default async function NotificationsPage() {
  const user = await requireRole([Role.ADMIN, Role.GUARD, Role.TEACHER], '/notifications');

  const [notifications, unread] = await Promise.all([
    listInAppNotifications(user.id),
    countUnreadInApp(user.id),
  ]);

  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-4">
        <Link
          href={homeForRole(user.role)}
          className="text-sm text-muted underline-offset-2 hover:underline"
        >
          &larr; Back to my dashboard
        </Link>
      </div>

      <PageHeading
        title="Notifications"
        description={
          unread > 0 ? `${unread} unread` : 'You are up to date.'
        }
        action={
          unread > 0 ? (
            <ActionForm
              action={markAllNotificationsReadAction}
              submitLabel="Mark all as read"
              busyLabel="Updating..."
              variant="secondary"
            />
          ) : null
        }
      />

      <Card>
        {notifications.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            description="You will be notified here when a visit request needs your attention or your visitor arrives. This is the only place notifications appear - nothing is emailed."
          />
        ) : (
          <ul className="divide-y divide-[var(--line-soft)]">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex flex-col gap-2 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-strong)]">
                      {notification.title}
                      {notification.readAt ? null : (
                        <Pill tone="info" className="ml-2">
                          New
                        </Pill>
                      )}
                    </p>
                    {notification.body ? (
                      <p className="mt-0.5 text-sm text-muted">{notification.body}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted">
                      {formatDateTime(notification.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {notification.link ? (
                    <Link
                      href={notification.link}
                      className="text-sm font-medium text-[var(--accent)] underline underline-offset-2"
                    >
                      Open
                    </Link>
                  ) : null}

                  {notification.readAt ? null : (
                    <ActionForm
                      action={markNotificationReadAction}
                      submitLabel="Mark as read"
                      busyLabel="Updating..."
                      variant="ghost"
                      hidden={{ notificationId: notification.id }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

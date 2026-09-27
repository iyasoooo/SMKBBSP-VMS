import Link from 'next/link';
import type { ReactNode } from 'react';
import { Role } from '@prisma/client';
import type { Locale } from '@/lib/constants';
import { getTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import { logoutAction } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { CrestTile } from '@/components/ui/crest';
import { countUnreadInApp } from '@/lib/domain/in-app-notifications';

/**
 * Roles that can receive an in-app notification, and therefore the roles the
 * link is shown to. Mirrors the guard in `app/notifications/page.tsx`; that
 * page is what actually refuses anybody else.
 */
const NOTIFIED_ROLES: Role[] = [Role.ADMIN, Role.GUARD, Role.TEACHER];

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Shared shell for every authenticated area.
 *
 * The navigation shown here is derived from the user's role, but that is
 * presentation only - each page independently re-checks authorization on the
 * server. Removing a link never grants or denies access.
 */
export async function StaffShell({
  user,
  nav,
  roleLabel,
  schoolShortName,
  locale,
  showLocaleToggle = false,
  wide = false,
  notificationsLabel = 'Notifications',
  children,
}: {
  // `id` is needed for the unread count; every caller already has it.
  user: { id: string; name: string; role: Role };
  nav: NavItem[];
  roleLabel: string;
  schoolShortName: string;
  locale: Locale;
  showLocaleToggle?: boolean;
  wide?: boolean;
  /** Guard screens pass the Bahasa Melayu label; everywhere else is English. */
  notificationsLabel?: string;
  children: ReactNode;
}) {
  const theme = await getTheme();
  const container = wide ? 'max-w-[1400px]' : 'max-w-6xl';

  /*
   * Null for a role that has no notifications rather than zero, so the link is
   * absent rather than present-and-empty. The principal is the case: oversight
   * without authority means nothing is ever addressed to them, and a permanent
   * "0" would invite a click that the page itself would refuse.
   */
  const unread = NOTIFIED_ROLES.includes(user.role) ? await countUnreadInApp(user.id) : null;

  return (
    <div className="min-h-screen">
      <header
        data-app-header
        className="sticky top-0 z-20 border-b border-[var(--line-soft)] bg-[var(--surface-card)]"
      >
        <div className={`mx-auto flex ${container} flex-wrap items-center gap-3 px-4 py-3`}>
          <div className="flex min-w-0 items-center gap-3">
            <CrestTile size={30} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-[var(--text-strong)]">
                {roleLabel}
              </p>
              <p className="truncate text-xs text-muted">
                {user.name} &middot; {schoolShortName}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/*
              The only way in to the notifications page.

              It existed for weeks with nothing linking to it, reachable only by
              typing the URL - which in a system that sends no email meant staff
              had no way to learn a request was waiting for them. The count is
              the point: a page nobody has a reason to open is barely better
              than no page, so the header has to say when something is unread.

              Rendered here rather than in each area's navigation so there is
              one implementation, and skipped for a role that cannot open it.
            */}
            {unread === null ? null : (
              <Link
                href="/notifications"
                aria-label={
                  unread > 0 ? `${notificationsLabel}, ${unread} unread` : notificationsLabel
                }
                className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-[var(--text-body)] hover:bg-[var(--surface-muted)]"
              >
                <span className="relative flex">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    className="h-5 w-5"
                  >
                    <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
                    <path d="M10.5 19a2 2 0 0 0 3 0" />
                  </svg>
                  {/*
                    The dot sits on the bell itself, not only beside the label,
                    because the label is hidden on a narrow screen and a count
                    that only appears next to hidden text is a count nobody
                    sees. The ring is the header's own background, so the dot
                    reads as sitting on top of the bell rather than as part of
                    its outline.

                    Decorative: `aria-hidden`, since the link's `aria-label`
                    already says how many are unread. A screen reader hearing
                    "seven unread" does not also need to hear about a dot.
                  */}
                  {unread > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--danger)] ring-2 ring-[var(--surface-card)]"
                    />
                  ) : null}
                </span>
                <span className="hidden sm:inline">{notificationsLabel}</span>
                {/*
                  The count takes the same soft fill the rest of the interface
                  gives a pill, rather than solid red with white on it: in dark
                  mode `--danger` is a pale pink, so white sat on it was barely
                  legible. The dot above is what carries the urgency now, which
                  leaves this free to simply be readable.
                */}
                {unread > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--danger-soft)] px-1.5 text-xs font-semibold text-[var(--danger-text)] tabular-nums">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </Link>
            )}

            {showLocaleToggle ? <LocaleToggle initialLocale={locale} /> : null}
            <ThemeToggle initialTheme={theme} />
            <form action={logoutAction}>
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          </div>
        </div>

        <nav aria-label="Primary" className="border-t border-[var(--line-soft)]">
          <ul
            className={`relative mx-auto flex ${container} min-w-0 gap-1 overflow-x-auto px-2 py-1`}
          >
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-[var(--text-body)] hover:bg-[var(--surface-muted)]"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main" className={`mx-auto ${container} px-4 py-6`}>
        {children}
      </main>
    </div>
  );
}

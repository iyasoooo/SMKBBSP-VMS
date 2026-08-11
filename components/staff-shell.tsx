import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Role } from '@prisma/client';
import type { Locale } from '@/lib/constants';
import { getTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import { logoutAction } from '@/app/login/actions';
import { Button } from '@/components/ui/button';

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
  children,
}: {
  user: { name: string; role: Role };
  nav: NavItem[];
  roleLabel: string;
  schoolShortName: string;
  locale: Locale;
  showLocaleToggle?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const theme = await getTheme();
  const container = wide ? 'max-w-[1400px]' : 'max-w-6xl';

  return (
    <div className="min-h-screen">
      <header
        data-app-header
        className="sticky top-0 z-20 border-b border-[var(--line-soft)] bg-[var(--surface-card)]"
      >
        <div className={`mx-auto flex ${container} flex-wrap items-center gap-3 px-4 py-3`}>
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)] text-sm font-bold text-[var(--brand-text)]"
            >
              VP
            </span>
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

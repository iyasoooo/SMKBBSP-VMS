import Link from 'next/link';
import { getSettings } from '@/lib/domain/settings';
import { getTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';


/** Shell for the public, account-free visitor journey. */
export default async function VisitLayout({ children }: { children: React.ReactNode }) {
  const [settings, theme] = await Promise.all([getSettings(), getTheme()]);

  return (
    <div className="min-h-screen">
      <header
        data-app-header
        className="border-b border-[var(--line-soft)] bg-[var(--surface-card)]"
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-[var(--brand)] text-sm font-bold text-[var(--brand-text)]"
            >
              VP
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-[var(--text-strong)]">
                VisitorPass
              </span>
              <span className="block text-xs text-muted">{settings.schoolShortName}</span>
            </span>
          </Link>
          <ThemeToggle initialTheme={theme} />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        {children}
      </main>

      <footer
        data-app-footer
        className="border-t border-[var(--line-soft)] px-5 py-6 text-center text-xs text-muted"
      >
        {settings.schoolName}
      </footer>
    </div>
  );
}

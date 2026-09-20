import Link from 'next/link';
import { getSettings } from '@/lib/domain/settings';
import { getTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
import { Crest } from '@/components/ui/crest';

/**
 * Shell for every public, account-free page.
 *
 * Shared rather than copied into each layout because the pass page originally
 * had no layout of its own: it rendered straight onto the root layout, so it
 * lost the header and ran the full width of a desktop window. One shell means
 * a new public route cannot quietly miss the header again.
 *
 * The crest is a link home. A visitor holding only a token URL has no other
 * way back to the site, and tapping the school badge is what they try first.
 *
 * `max-w-3xl` is deliberate and matches the header. Visit details are short
 * label/value pairs; stretched across a wide monitor the eye has to travel
 * from a label on the left to its value far to the right.
 */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const [settings, theme] = await Promise.all([getSettings(), getTheme()]);

  return (
    <div className="min-h-screen">
      <header
        data-app-header
        className="border-b border-[var(--line-soft)] bg-[var(--surface-card)]"
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Crest size={56} className="h-11 w-auto sm:h-14" />
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] leading-snug font-semibold text-[var(--text-strong)] sm:text-sm">
                Visitor Management System
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

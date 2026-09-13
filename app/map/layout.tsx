import Link from 'next/link';
import { getSettings } from '@/lib/domain/settings';
import { getLocale, getTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import { Crest } from '@/components/ui/crest';

/**
 * Shell for the school map.
 *
 * Wider than the visitor journey's shell because a floor plan squeezed into a
 * reading column is unusable, and it carries the language toggle in the header:
 * the map is the one public screen a guard operates on a visitor's behalf, so
 * it follows the gate screens' rule rather than the marketing pages'.
 */
export const dynamic = 'force-dynamic';

export default async function MapLayout({ children }: { children: React.ReactNode }) {
  const [settings, theme, locale] = await Promise.all([getSettings(), getTheme(), getLocale()]);

  return (
    <div className="min-h-screen">
      <header
        data-app-header
        className="border-b border-[var(--line-soft)] bg-[var(--surface-card)]"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Crest size={56} className="h-11 w-auto sm:h-14" />
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] leading-snug font-semibold text-[var(--text-strong)] sm:text-sm">
                Visitor Management System
              </span>
              <span className="block text-xs text-muted">{settings.schoolShortName}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <LocaleToggle initialLocale={locale} />
            <ThemeToggle initialTheme={theme} />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-5 py-6">
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

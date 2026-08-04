'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, type Locale } from '@/lib/constants';
import { LOCALE_LABELS } from '@/lib/i18n/dictionary';
import { buttonClasses } from '@/components/ui/button';

/**
 * English / Bahasa Melayu toggle for the guard workflow.
 *
 * The preference is stored in a cookie so it survives navigation and reload,
 * and the page is refreshed so server-rendered strings switch immediately.
 */
export function LocaleToggle({ initialLocale }: { initialLocale: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const router = useRouter();

  function switchTo(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label={locale === 'ms' ? 'Pilih bahasa' : 'Choose language'}
      className="inline-flex overflow-hidden rounded-lg border border-[var(--line-strong)]"
    >
      {(['en', 'ms'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => switchTo(option)}
          aria-pressed={locale === option}
          title={LOCALE_LABELS[option]}
          className={buttonClasses(
            locale === option ? 'primary' : 'ghost',
            'md',
            'rounded-none border-0 px-3 min-w-11',
          )}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

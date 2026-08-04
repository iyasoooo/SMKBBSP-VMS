'use client';

import { useState } from 'react';
import { THEME_COOKIE } from '@/lib/constants';
import { buttonClasses } from '@/components/ui/button';

/**
 * Light/dark toggle.
 *
 * Writes the preference straight to a cookie and flips the class on <html>,
 * so the change is instant and the server renders the correct theme on the
 * next request without a flash. No server round trip is needed for a purely
 * presentational preference.
 */
export function ThemeToggle({ initialTheme }: { initialTheme: 'light' | 'dark' }) {
  const [theme, setTheme] = useState(initialTheme);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={buttonClasses('secondary', 'md', 'w-11 px-0')}
      aria-pressed={theme === 'dark'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <span className="sr-only">
        {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      </span>
      <span aria-hidden="true" className="text-base">
        {theme === 'dark' ? '☀' : '☾'}
      </span>
    </button>
  );
}

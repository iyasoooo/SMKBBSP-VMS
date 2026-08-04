import { cookies } from 'next/headers';
import { LOCALE_COOKIE, THEME_COOKIE, DEFAULT_LOCALE, LOCALES, type Locale } from '@/lib/constants';

/**
 * Theme and locale preferences.
 *
 * Both are read on the server from a cookie and applied to the initial HTML.
 * That avoids the usual flash-of-wrong-theme without an inline bootstrap
 * script, which matters because the app ships a strict CSP that does not allow
 * inline scripts in production.
 */

export type Theme = 'light' | 'dark';

export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === 'dark' ? 'dark' : 'light';
}

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}

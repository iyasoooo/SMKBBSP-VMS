import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { homeForRole } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getTheme } from '@/lib/theme';
import { ThemeToggle } from '@/components/theme-toggle';
import { LoginForm } from './login-form';
/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';


export const metadata: Metadata = { title: 'Staff login' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role));

  const [settings, theme, params] = await Promise.all([getSettings(), getTheme(), searchParams]);

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="text-sm text-muted underline-offset-2 hover:underline">
            &larr; Back to home
          </Link>
          <ThemeToggle initialTheme={theme} />
        </div>

        <div className="surface-card rounded-xl p-6">
          <div className="mb-6">
            <h1 className="text-xl font-semibold">Staff login</h1>
            <p className="mt-1 text-sm text-muted">
              For {settings.schoolShortName} administrators, guards and teachers. Visitors do not
              need an account.
            </p>
          </div>

          <LoginForm next={params.next} />
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Visiting the school?{' '}
          <Link href="/visit/request" className="underline underline-offset-2">
            Request a visit
          </Link>
        </p>
      </div>
    </main>
  );
}

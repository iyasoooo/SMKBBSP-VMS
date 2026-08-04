import Link from 'next/link';
import { getSettings } from '@/lib/domain/settings';
import { getCurrentUser } from '@/lib/auth/session';
import { homeForRole } from '@/lib/auth/authorize';
import { getTheme } from '@/lib/theme';
import { ButtonLink } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

export default async function HomePage() {
  const [settings, user, theme] = await Promise.all([getSettings(), getCurrentUser(), getTheme()]);

  return (
    <div className="min-h-screen">
      <header
        data-app-header
        className="border-b border-[var(--line-soft)] bg-[var(--surface-card)]"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-[var(--accent-text)]"
            >
              VP
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[var(--text-strong)]">VisitorPass</p>
              <p className="text-xs text-muted">{settings.schoolShortName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle initialTheme={theme} />
            {user ? (
              <ButtonLink href={homeForRole(user.role)} variant="secondary">
                Go to my dashboard
              </ButtonLink>
            ) : (
              <ButtonLink href="/login" variant="secondary">
                Staff login
              </ButtonLink>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-[var(--accent)] uppercase">
            {settings.schoolName}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Request a school visit, and collect your pass at the gate.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Choose the teacher you want to meet and a time that suits you. The teacher reviews your
            request, and once it is approved you will receive a QR visitor pass by email. Show it at
            the guard house on the day of your visit.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/visit/request" size="lg">
              Request a visit
            </ButtonLink>
            <ButtonLink href="/visit/status" variant="secondary" size="lg">
              Check my request
            </ButtonLink>
          </div>
        </div>

        <ol className="mt-14 grid gap-4 sm:grid-cols-3">
          {[
            {
              step: '1',
              title: 'Submit a request',
              body: 'Tell us who you are visiting, when, and why. No account is needed.',
            },
            {
              step: '2',
              title: 'Teacher approves',
              body: 'Your host teacher reviews the request and you are notified by email either way.',
            },
            {
              step: '3',
              title: 'Scan in at the gate',
              body: 'The guard scans your pass, checks your physical ID, and prints your badge.',
            },
          ].map((item) => (
            <li key={item.step} className="surface-card rounded-xl p-5">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]"
              >
                {item.step}
              </span>
              <h2 className="mt-3 text-sm font-semibold">{item.title}</h2>
              <p className="mt-1 text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ol>

        <section className="mt-12 rounded-xl border border-[var(--line-soft)] bg-[var(--surface-inset)] p-5">
          <h2 className="text-sm font-semibold">Your privacy</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            We collect only what the school needs to authorise and record your visit. Your identity
            number is encrypted and shown to staff in masked form only. Your pass contains a random
            code, never your personal details. The QR pass authorises an approved appointment; it
            does not verify your identity, which is why the guard also checks your physical
            identification at the gate.
          </p>
        </section>
      </main>

      <footer
        data-app-footer
        className="border-t border-[var(--line-soft)] px-5 py-6 text-center text-xs text-muted"
      >
        <p>
          {settings.schoolName} &middot; VisitorPass{' '}
          <Link href="/login" className="underline underline-offset-2">
            Staff login
          </Link>
        </p>
      </footer>
    </div>
  );
}

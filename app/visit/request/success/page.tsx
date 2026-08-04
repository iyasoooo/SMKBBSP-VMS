import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/domain/settings';
import { REFERENCE_NUMBER_PATTERN } from '@/lib/crypto/tokens';
import { Alert } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Request submitted' };

/**
 * Confirmation page.
 *
 * Shows the reference number only. The private status token is never placed in
 * a URL, so this page cannot leak it through browser history, a shared screen,
 * or the Referer header of an outbound link.
 *
 * The reference is echoed after being constrained to the known format, so a
 * crafted query string cannot inject arbitrary text into the page.
 */
export default async function RequestSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const [settings, params] = await Promise.all([getSettings(), searchParams]);

  const raw = params.ref ?? '';
  const reference = REFERENCE_NUMBER_PATTERN.test(raw) ? raw : null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="surface-card rounded-xl p-6 text-center sm:p-8">
        <span
          aria-hidden="true"
          className="mx-auto flex size-12 items-center justify-center rounded-full text-2xl"
          style={{ background: 'var(--ok-soft)', color: 'var(--ok-text)' }}
        >
          ✓
        </span>

        <h1 className="mt-4 text-2xl font-semibold">Request submitted</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Thank you. Your request has been sent to {settings.schoolName} for approval.
        </p>

        {reference ? (
          <div className="mt-6 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-inset)] px-4 py-4">
            <p className="text-xs tracking-wide text-muted uppercase">Your reference number</p>
            <p className="mt-1 font-mono text-xl font-semibold text-[var(--text-strong)]">
              {reference}
            </p>
          </div>
        ) : null}

        <div className="mt-6 text-left">
          <Alert tone="info" title="What happens next">
            <ol className="mt-1 list-decimal space-y-1 pl-4">
              <li>We have emailed you a private link to track this request.</li>
              <li>Your host teacher will approve or decline it.</li>
              <li>
                If it is approved, the same link becomes your QR visitor pass. Show it at the guard
                house on the day of your visit.
              </li>
            </ol>
          </Alert>
        </div>

        <p className="mt-6 text-sm text-muted">
          Keep that email. The link is private to you, and it is the only way to view or cancel your
          request. If it has not arrived within a few minutes, check your spam folder.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/visit/request" variant="secondary">
            Submit another request
          </ButtonLink>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        Did not receive the email?{' '}
        <Link href="/visit/status" className="underline underline-offset-2">
          Here is what to do
        </Link>
        .
      </p>
    </div>
  );
}

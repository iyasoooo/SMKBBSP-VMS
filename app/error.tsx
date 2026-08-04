'use client';

import { useEffect } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';

const log = createLogger('app');

/**
 * Root error boundary.
 *
 * Renders a generic message only. The raw error text may contain database or
 * file-system detail, so it is logged to the server console and never shown to
 * the browser; the digest is surfaced so a developer can correlate a user
 * report with the server log.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log.error('unhandled error', { digest: error.digest }, error);
  }, [error]);

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted">
          The page could not be loaded. Please try again. If the problem continues, contact the
          school office and quote the reference below.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-muted">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/" variant="secondary">
            Back to home
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}

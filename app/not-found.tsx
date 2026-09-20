import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <p className="text-sm font-semibold text-[var(--accent)]">404</p>
        <h1 className="mt-2 text-2xl font-semibold">We could not find that page</h1>
        <p className="mt-3 text-sm text-muted">
          The link may be out of date, or the page may have moved. If you saved a link to your
          visit request, please check that you copied the whole address.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/login" variant="secondary">
            Staff login
          </ButtonLink>
        </div>
        <p className="mt-8 text-xs text-muted">
          Visiting the school?{' '}
          <Link href="/visit/request" className="underline underline-offset-2">
            Request a visit
          </Link>
        </p>
      </div>
    </main>
  );
}

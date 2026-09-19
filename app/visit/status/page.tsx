import type { Metadata } from 'next';
import { getSettings } from '@/lib/domain/settings';
import { Alert, Card } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';
/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';


export const metadata: Metadata = { title: 'Check your request' };

/**
 * There is deliberately no lookup form here.
 *
 * A page that accepted a reference number, name or phone number and reported
 * whether a matching request exists would be an enumeration oracle: anyone
 * could confirm that a particular person had visited the school. The private
 * link shown at submission is the only way in, so this page explains that
 * instead - and, since nothing is ever emailed, what to do when it is lost.
 */
export default async function VisitStatusHelpPage() {
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Checking your request</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Your visit request is tracked through a private link, not a login.
      </p>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold">Where to find your link</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            When you submitted your request, you were taken to a private page for it. That page&apos;s
            address is your link.
          </li>
          <li>
            Open it wherever you saved it - a bookmark, a note, a message to yourself, or a
            screenshot of the address.
          </li>
          <li>
            The page shows the current status. Once your host approves the visit, your QR pass
            appears on that same page.
          </li>
        </ol>
      </Card>

      <div className="mt-6">
        <Alert tone="info" title="Lost your link?">
          {settings.schoolShortName} does not send emails or text messages, so the link cannot be
          sent to you again. Please submit a new request, or come to the guard house during visiting
          hours and the guard can register you there.
        </Alert>
      </div>

      <div className="mt-6">
        <Alert tone="warning" title="Why we cannot look it up here">
          We do not offer a public search by name or reference number. If we did, anyone could
          check whether a particular person had arranged to visit the school. Keeping the private
          link as the only route protects every visitor&apos;s privacy.
        </Alert>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/visit/request">Submit a new request</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}

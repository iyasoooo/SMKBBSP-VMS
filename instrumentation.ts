/**
 * Server startup hook.
 *
 * Next.js calls `register` once per server process, which is the only place in
 * this application where something can be started that outlives a request.
 */

/**
 * How often the outbox is swept.
 *
 * Every notification is already attempted inline, the moment the transaction
 * that queued it commits, so this is the safety net rather than the delivery
 * path: nothing waits two minutes for an email in the normal case. It exists
 * for the cases the inline attempt cannot cover - the mail server was down for
 * a minute, or the container was replaced between the commit and the send -
 * where the alternative is a visitor who never receives their pass and a row
 * nobody looks at until an administrator notices the dashboard.
 */
const SWEEP_INTERVAL_MS = 120_000;

/** Wait before the first sweep so a restart does not compete with its own boot. */
const FIRST_SWEEP_DELAY_MS = 30_000;

/** How many are attempted per sweep. */
const BATCH = 25;

export async function register(): Promise<void> {
  /*
   * Node runtime only. `register` also runs in the edge runtime, which has no
   * database client and no mail transport, and importing them there fails the
   * build rather than producing a useful error.
   */
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  /*
   * Not during tests. Vitest imports application modules directly, and a timer
   * started here would keep sending real mail after a test file finished and
   * hold the process open.
   */
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;

  // Imported lazily so the edge and test paths above never pull the mail
  // transport or the database client into a bundle that cannot use them.
  const { processPendingNotifications } = await import('@/lib/email/outbox');
  const { createLogger } = await import('@/lib/logger');

  const log = createLogger('outbox:sweep');

  let running = false;

  const sweep = async (): Promise<void> => {
    // A slow mail server must not stack sweeps on top of each other.
    if (running) return;
    running = true;

    try {
      const delivered = await processPendingNotifications(BATCH);
      // Only worth a line when it actually did something; an empty sweep every
      // two minutes is log noise that hides the sweeps that mattered.
      if (delivered > 0) log.info('delivered queued notifications', { delivered });
    } catch (error) {
      // Never throw out of a timer: an unhandled rejection here would take the
      // server down over an email.
      log.error('sweep failed', undefined, error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  const first = setTimeout(() => void sweep(), FIRST_SWEEP_DELAY_MS);

  // Neither timer should keep the process alive on its own; a container being
  // shut down must be free to exit rather than wait out an interval.
  timer.unref?.();
  first.unref?.();

  log.info('outbox sweep scheduled', { everySeconds: SWEEP_INTERVAL_MS / 1000 });
}

/**
 * Deliver every notification the outbox still owes.
 *
 *   npm run mail:drain
 *
 * The running server already sweeps on a timer, so this is for the cases a
 * timer cannot serve: an operator who has just fixed the mail server and does
 * not want to wait, a deployment that runs the application somewhere the
 * process is recycled between requests, or an external scheduler that would
 * rather own the cadence itself.
 *
 * Safe to run at any time, and safe to run while the server is running: every
 * delivery claims its row first, so a notification the server is already
 * sending is skipped here rather than sent twice.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Runs outside Next.js, so .env has to be loaded explicitly.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

import { processPendingNotifications } from '@/lib/email/outbox';

const BATCH = 50;

async function main(): Promise<void> {
  let total = 0;

  /*
   * Keep going while a full batch comes back, because a full batch means there
   * were probably more behind it. A short batch is the end of the queue.
   */
  for (;;) {
    const delivered = await processPendingNotifications(BATCH);
    total += delivered;
    if (delivered < BATCH) break;
  }

  console.log(total === 0 ? 'Nothing was waiting.' : `Delivered ${total} notification(s).`);
}

main()
  .catch((error: unknown) => {
    console.error('Drain failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Without this the pooled database connection keeps the process alive.
    void import('@/lib/db/prisma').then(({ prisma }) => prisma.$disconnect());
  });

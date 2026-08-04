/**
 * No-Docker PostgreSQL 16 for local development.
 *
 * `docker compose up` (npm run db:up) is the primary, documented path. This
 * script is the fallback for machines without a working Docker daemon: it
 * runs the same PostgreSQL 16 server from the `embedded-postgres` package,
 * on the same port, with the same credentials as docker-compose.yml, so
 * DATABASE_URL does not change between the two.
 *
 *   npm run local:pg      start (foreground, Ctrl+C to stop)
 *   npm run local:pg -- --reset   delete the data directory first
 *
 * Data lives in ./.local/pgdata and is git-ignored. It is development state,
 * not a backup.
 */
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const DATA_DIR = resolve(process.cwd(), '.local', 'pgdata');
const USER = 'visitorpass';
const PASSWORD = 'visitorpass_local_dev';
const DATABASE = 'visitorpass';
const PORT = 5432;

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');

  if (reset && existsSync(DATA_DIR)) {
    console.log(`Removing ${DATA_DIR} ...`);
    rmSync(DATA_DIR, { recursive: true, force: true });
  }

  const isFirstRun = !existsSync(DATA_DIR);

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {
      /* PostgreSQL's own chatter is suppressed; errors still surface below. */
    },
  });

  if (isFirstRun) {
    console.log('Initialising a new PostgreSQL 16 cluster (first run only) ...');
    await pg.initialise();
  }

  await pg.start();
  console.log(`PostgreSQL 16 listening on localhost:${PORT}`);

  if (isFirstRun) {
    await pg.createDatabase(DATABASE);
    console.log(`Created database "${DATABASE}".`);
  }

  console.log('');
  console.log(`  DATABASE_URL="postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DATABASE}?schema=public"`);
  console.log('');
  console.log('Leave this running. In a second terminal: npm run db:migrate && npm run db:seed');
  console.log('Press Ctrl+C to stop.');

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`\nReceived ${signal}, stopping PostgreSQL ...`);
    try {
      await pg.stop();
    } catch (error) {
      console.error('Failed to stop cleanly:', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Hold the event loop open for the lifetime of the server.
  await new Promise<never>(() => {});
}

main().catch((error: unknown) => {
  console.error('Failed to start local PostgreSQL:', error);
  process.exit(1);
});

/**
 * Create, migrate and seed the end-to-end database.
 *
 * This runs *before* `playwright test`, not from Playwright's `globalSetup`,
 * because Playwright starts its `webServer` first: the app would boot against
 * a database that does not exist yet and fail every health check.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://visitorpass:visitorpass_local_dev@localhost:5432/visitorpass_e2e?schema=public';

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'development',
  NEXT_TELEMETRY_DISABLED: '1',
};

console.log('[e2e] preparing database ...');

// `migrate deploy` creates the database when it is absent, then applies every
// migration, so a fresh machine needs no manual createdb step.
execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });

console.log('[e2e] database ready');

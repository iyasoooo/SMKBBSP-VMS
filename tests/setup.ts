/**
 * Vitest global setup.
 *
 * Crypto keys are pinned to fixed, obviously-fake test values so that hashing
 * and encryption assertions are deterministic and never depend on a
 * developer's local `.env`. The database URL is the one exception: integration
 * tests need a real PostgreSQL instance, and it must be a *separate* database
 * from development so a test run can truncate tables safely.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env first (for DATABASE_URL), then override the secrets below.
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // A malformed .env should not stop unit tests, which supply their own keys.
  }
}

// `NODE_ENV` is declared read-only by @types/node; widen to the underlying
// string map so the test environment can still be pinned.
(process.env as Record<string, string | undefined>)['NODE_ENV'] = 'test';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.APP_TIMEZONE = 'Asia/Kuala_Lumpur';

// 32-byte base64 test keys. These are committed on purpose: they protect
// nothing, and pinning them keeps HMAC expectations stable across machines.
process.env.SESSION_SECRET = 'dGVzdC1zZXNzaW9uLXNlY3JldC0zMi1ieXRlcy1rZXk=';
process.env.IDENTITY_ENCRYPTION_KEY = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy0xMjM=';
process.env.IDENTITY_HMAC_KEY = 'dGVzdC1obWFjLWtleS0zMi1ieXRlcy1sb25nLTEyMzQ=';
process.env.IDENTITY_KEY_VERSION = '1';

process.env.MAIL_FROM_ADDRESS ??= 'visitorpass@smkbbsp.test';
process.env.MAIL_FROM_NAME ??= 'SMKBBSP VisitorPass';

// Point integration tests at a dedicated database unless one is given.
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('visitorpass_test')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\/visitorpass(\?|$)/,
    '/visitorpass_test$1',
  );
}

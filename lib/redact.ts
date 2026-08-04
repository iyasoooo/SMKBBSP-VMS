import type { Prisma } from '@prisma/client';

/**
 * Metadata redaction, shared by the audit trail and the logger.
 *
 * Deliberately in its own module with no runtime Prisma import. The logger is
 * used from client components as well as the server, and importing it from
 * `lib/audit.ts` would pull the Prisma client into the browser bundle. The
 * `Prisma` import here is type-only and erased at compile time.
 *
 * The rule this enforces: anything unsafe to persist in an audit row is also
 * unsafe to print to a log, so both paths go through exactly one implementation
 * and cannot drift apart.
 */

/**
 * Keys whose values are never safe to keep. Matched case-insensitively as
 * substrings after separators are stripped, so `qrToken`, `raw_token` and
 * `passwordHash` are all caught.
 */
const FORBIDDEN_KEY_PATTERNS = [
  'password',
  'token',
  'secret',
  'sessionid',
  'cookie',
  'authorization',
  'identitynumber',
  'nric',
  'passportnumber',
  'ciphertext',
  'hmac',
  'key',
  'image',
  'reason', // blacklist reasons are restricted text
];

const MAX_STRING_LENGTH = 300;
const MAX_KEYS = 40;

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Reduce arbitrary metadata to values safe to keep indefinitely.
 *
 * Unknown structures are dropped rather than coerced, because a value nobody
 * anticipated is exactly the kind that leaks something.
 */
export function sanitizeMetadata(input: Record<string, unknown>): Prisma.InputJsonObject {
  // Built as a mutable record; `InputJsonObject` itself is read-only.
  const output: Record<string, Prisma.InputJsonValue> = {};

  for (const [key, value] of Object.entries(input).slice(0, MAX_KEYS)) {
    if (isForbiddenKey(key)) {
      output[key] = '[redacted]';
      continue;
    }

    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      output[key] =
        value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
    } else if (value instanceof Date) {
      output[key] = value.toISOString();
    } else if (Array.isArray(value)) {
      output[key] = value
        .slice(0, 20)
        .filter(
          (item): item is string | number | boolean =>
            typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
        );
    } else if (typeof value === 'object') {
      output[key] = sanitizeMetadata(value as Record<string, unknown>);
    }
  }

  return output;
}

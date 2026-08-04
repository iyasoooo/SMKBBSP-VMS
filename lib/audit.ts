import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '@/lib/db/prisma';
import type { AuditAction } from '@/lib/constants';

/**
 * Append-oriented audit trail.
 *
 * Two rules make the log trustworthy:
 *   1. Nothing here ever updates or deletes a row, and no UI exposes a path
 *      that would. The table is written and read, never edited.
 *   2. Metadata is scrubbed before it is written. Callers pass ordinary
 *      objects, and `sanitizeMetadata` drops anything whose key looks like a
 *      secret and truncates long strings, so a careless call site cannot leak
 *      a password, raw token, or full identity number into the log.
 */

export interface AuditInput {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Keys whose values are never safe to persist. Matched case-insensitively as
 * substrings, so `qrToken`, `raw_token` and `passwordHash` are all caught.
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
 * Reduce arbitrary metadata to values that are safe to keep indefinitely.
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

/**
 * Write one audit entry.
 *
 * Accepts a transaction client so the entry commits atomically with the
 * business change it describes: an approval that rolls back must not leave an
 * audit row claiming it happened.
 */
export async function recordAudit(input: AuditInput, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      actorUserId: input.actorUserId ?? null,
      metadata: input.metadata ? sanitizeMetadata(input.metadata) : undefined,
    },
  });
}

/**
 * Write an audit entry without letting a logging failure break the request.
 *
 * Used only outside transactions, for observations such as a failed login
 * where the surrounding operation has no state to roll back.
 */
export async function recordAuditSafely(input: AuditInput, db: Db = prisma): Promise<void> {
  try {
    await recordAudit(input, db);
  } catch (error) {
    console.error('[audit] failed to write entry', {
      action: input.action,
      targetType: input.targetType,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

import { prisma, type Db } from '@/lib/db/prisma';
import { sanitizeMetadata } from '@/lib/redact';
import { createLogger } from '@/lib/logger';

import type { AuditAction } from '@/lib/constants';

export { sanitizeMetadata } from '@/lib/redact';

const log = createLogger('audit');

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
    log.error('failed to write entry', {
      action: input.action,
      targetType: input.targetType,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

import { BlacklistStatus, MatchPolicy, type BlacklistEntry, type IdentityType } from '@prisma/client';
import { prisma, type Db } from '@/lib/db/prisma';
import { computeIdentityHmac } from '@/lib/crypto/identity';
import { normalizeEmail, normalizePhone } from '@/lib/domain/contact';

/**
 * Blacklist matching.
 *
 * The decision matrix required by the specification:
 *
 *   identity HMAC + BLOCK   -> BLOCKED   (strongest signal; stops everything)
 *   identity HMAC + REVIEW  -> REVIEW
 *   phone/email   + BLOCK   -> BLOCKED   (only when an admin set BLOCK explicitly)
 *   phone/email   + REVIEW  -> REVIEW
 *   name only               -> never matched automatically
 *
 * Name is deliberately excluded from matching. Malaysian naming conventions
 * produce very common name strings, and an automatic block on a name alone
 * would deny entry to the wrong person on a regular basis.
 */

export type BlacklistDecision = 'CLEAR' | 'REVIEW' | 'BLOCKED';

export interface BlacklistMatchInput {
  identityType: IdentityType;
  /** Already normalized, as produced by `normalizeIdentity`. */
  normalizedIdentity: string;
  email?: string | null;
  phone?: string | null;
}

export interface BlacklistCheckResult {
  decision: BlacklistDecision;
  /** Entry ids only. Reasons never leave this module for guard/teacher use. */
  matchedEntryIds: string[];
  /** Which field produced the strongest match, for the admin review screen. */
  matchedOn: Array<'identity' | 'phone' | 'email'>;
}

/** Entries that are ACTIVE and inside their effective period right now. */
function effectiveWhere(now: Date) {
  return {
    status: BlacklistStatus.ACTIVE,
    validFrom: { lte: now },
    OR: [{ validUntil: null }, { validUntil: { gte: now } }],
  };
}

/**
 * Evaluate a visitor against the active blacklist.
 *
 * Returns the *strongest* decision found. A BLOCK on any matching field wins
 * over a REVIEW on another, and the absence of any match is CLEAR.
 */
export async function checkBlacklist(
  input: BlacklistMatchInput,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<BlacklistCheckResult> {
  const identityHmac = computeIdentityHmac(input.identityType, input.normalizedIdentity);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);

  const orClauses: Array<Record<string, unknown>> = [{ identityHmac }];
  if (phone) orClauses.push({ matchPhone: phone });
  if (email) orClauses.push({ matchEmail: email });

  const candidates = await db.blacklistEntry.findMany({
    where: { AND: [effectiveWhere(now), { OR: orClauses }] },
    select: {
      id: true,
      matchPolicy: true,
      identityHmac: true,
      matchPhone: true,
      matchEmail: true,
    },
  });

  if (candidates.length === 0) {
    return { decision: 'CLEAR', matchedEntryIds: [], matchedOn: [] };
  }

  const matchedOn = new Set<'identity' | 'phone' | 'email'>();
  let decision: BlacklistDecision = 'CLEAR';

  for (const entry of candidates) {
    const identityMatch = entry.identityHmac === identityHmac;
    const phoneMatch = Boolean(phone && entry.matchPhone === phone);
    const emailMatch = Boolean(email && entry.matchEmail === email);

    if (identityMatch) matchedOn.add('identity');
    if (phoneMatch) matchedOn.add('phone');
    if (emailMatch) matchedOn.add('email');

    if (!identityMatch && !phoneMatch && !emailMatch) continue;

    if (entry.matchPolicy === MatchPolicy.BLOCK) {
      decision = 'BLOCKED';
    } else if (decision !== 'BLOCKED') {
      decision = 'REVIEW';
    }
  }

  return {
    decision,
    matchedEntryIds: candidates.map((entry) => entry.id),
    matchedOn: [...matchedOn],
  };
}

/**
 * Guard-facing summary.
 *
 * Guards see the operational state and nothing more: no category, no reason,
 * no matched field, no entry id. Anything beyond CLEAR/REVIEW/BLOCKED would
 * disclose restricted information at the gate.
 */
export function toGuardVisibleState(result: BlacklistCheckResult): BlacklistDecision {
  return result.decision;
}

/** At least one match value is required; a name-only entry can never match. */
export function hasUsableMatchValue(entry: {
  identityHmac?: string | null;
  matchPhone?: string | null;
  matchEmail?: string | null;
}): boolean {
  return Boolean(entry.identityHmac || entry.matchPhone || entry.matchEmail);
}

/**
 * Recompute the derived status of entries whose validity window has passed.
 * Called opportunistically by the admin blacklist screen.
 */
export async function expireLapsedEntries(db: Db = prisma, now: Date = new Date()): Promise<number> {
  const { count } = await db.blacklistEntry.updateMany({
    where: { status: BlacklistStatus.ACTIVE, validUntil: { lt: now } },
    data: { status: BlacklistStatus.EXPIRED },
  });
  return count;
}

export type BlacklistEntryRecord = BlacklistEntry;

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { FALLBACK_CODE_ALPHABET, FALLBACK_CODE_LENGTH, TOKEN_BYTES } from '@/lib/constants';

/**
 * Opaque token generation and hashing.
 *
 * Rules that hold for every token in this system:
 *   - at least 256 bits of CSPRNG output
 *   - only the hash is persisted; the raw value exists in a cookie, an email
 *     link, or a QR image and nowhere else
 *   - lookups compare hashes, so a database read cannot reveal a live token
 *   - no token encodes any information about its subject
 */

/** URL-safe raw token. Appears in `/v/<token>` links and QR pass URLs. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash for public/QR tokens.
 *
 * Plain SHA-256 is appropriate here (unlike for passwords or NRIC values):
 * the input is 256 bits of uniform randomness, so there is no smaller
 * keyspace to search and no benefit from a slow KDF on the hot scan path.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Hash for session tokens, keyed with SESSION_SECRET.
 *
 * The extra key means that a leaked database backup alone does not let an
 * attacker verify guessed session tokens offline.
 */
export function hashSessionToken(rawToken: string): string {
  return createHmac('sha256', Buffer.from(getEnv().SESSION_SECRET, 'base64'))
    .update(rawToken, 'utf8')
    .digest('hex');
}

/**
 * Human-readable fallback code for when the camera fails.
 *
 * `randomInt` is used rather than `randomBytes % alphabet.length` because the
 * modulo form is biased when the alphabet size does not divide 256 evenly.
 * At 30 symbols and 8 characters this is ~39 bits, which is why the lookup
 * endpoint is rate-limited and the code expires with its visit window.
 */
export function generateFallbackCode(): string {
  let code = '';
  for (let i = 0; i < FALLBACK_CODE_LENGTH; i += 1) {
    code += FALLBACK_CODE_ALPHABET[randomInt(FALLBACK_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Derive the fallback code deterministically from the pass token's *hash*.
 *
 * This resolves a real tension in the spec: the database must store only a
 * hash of the code, yet both the approval transaction and the visitor's pass
 * page need the code itself.
 *
 * Deriving from `tokenHash` rather than the raw token is what makes that work.
 * At approval time the server holds only the stored hash; the visitor's page
 * holds the raw token and can hash it to reach the same input. Both arrive at
 * the same code without the raw token ever being stored, and the database
 * still keeps nothing but `fallbackCodeHash`.
 *
 * Rejection sampling is used rather than `byte % alphabet.length`, which would
 * bias the first 16 symbols of a 30-symbol alphabet.
 */
export function deriveFallbackCode(tokenHash: string): string {
  const key = Buffer.from(getEnv().SESSION_SECRET, 'base64');
  const limit = 256 - (256 % FALLBACK_CODE_ALPHABET.length);

  let code = '';
  let counter = 0;

  while (code.length < FALLBACK_CODE_LENGTH) {
    const digest = createHmac('sha256', key)
      .update(`fallback-code:${counter}:${tokenHash}`, 'utf8')
      .digest();

    for (const byte of digest) {
      if (code.length >= FALLBACK_CODE_LENGTH) break;
      // Discard the biased tail of the byte range.
      if (byte >= limit) continue;
      code += FALLBACK_CODE_ALPHABET[byte % FALLBACK_CODE_ALPHABET.length];
    }

    counter += 1;
  }

  return code;
}

/**
 * Canonicalise a code typed by a guard: uppercase, strip separators, and map
 * the glyphs people habitually substitute for the excluded characters.
 */
export function normalizeFallbackCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/U/g, 'V')
    // 0 and 1 are not in the alphabet at all; anything mapping onto them is a
    // typo that will simply fail to match.
    .replace(/[^A-Z0-9]/g, '');
}

export function hashFallbackCode(code: string): string {
  return createHash('sha256').update(normalizeFallbackCode(code), 'utf8').digest('hex');
}

/** Format for display on a badge or pass: `ABCD-EFGH`. */
export function formatFallbackCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

/**
 * Timing-safe comparison of two hex digests.
 *
 * Non-hex input is rejected up front: `Buffer.from(x, 'hex')` parses leniently
 * and yields an empty buffer for garbage, which would make any two
 * equal-length non-hex strings compare as equal.
 */
export function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (!isHexDigest(a) || !isHexDigest(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function isHexDigest(value: string): boolean {
  return value.length % 2 === 0 && value.length > 0 && /^[0-9a-fA-F]+$/.test(value);
}

/**
 * Human-friendly appointment reference, e.g. `VP-26H3-7KQD`.
 *
 * Shown publicly and used in email subjects, so it must carry no personal
 * information. The random tail is not a secret and is never accepted as
 * authentication on its own.
 */
export function generateReferenceNumber(now: Date = new Date()): string {
  // Layout: VP-<YY><month><rand> - <rand x4>, i.e. two four-character groups.
  // Anything that echoes a reference back (the public success page) validates
  // against exactly this shape, so the two must not drift apart.
  const year = String(now.getUTCFullYear() % 100).padStart(2, '0');
  const month = FALLBACK_CODE_ALPHABET[now.getUTCMonth()] ?? 'X';

  let tail = '';
  for (let i = 0; i < 5; i += 1) {
    tail += FALLBACK_CODE_ALPHABET[randomInt(FALLBACK_CODE_ALPHABET.length)];
  }

  return `VP-${year}${month}${tail.slice(0, 1)}-${tail.slice(1)}`;
}

/** The canonical reference shape, shared by the generator and any validator. */
export const REFERENCE_NUMBER_PATTERN = /^VP-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/**
 * Badge number, e.g. `V-260803-0417`.
 *
 * The date segment lets a guard sort a stack of printed badges by hand; the
 * random tail keeps the sequence non-guessable, so one badge number cannot be
 * used to infer another.
 *
 * `badgeNumber` is a unique column, and the tail is only unique *within a day*.
 * Four digits gives 10,000 values per day, which sounds ample but collides
 * surprisingly often once a day has several visits - by the birthday bound,
 * seven visits a day carries roughly a 0.2% chance per day, which becomes a
 * near-certainty across a year. A collision would mean a failed check-in for a
 * real visitor, so callers must allocate through
 * `allocateBadgeNumber` (lib/domain/badges.ts), which checks for collisions and
 * widens the tail when one occurs.
 */
export function generateBadgeNumber(prefix: string, timeZoneDay: string, digits = 4): string {
  const compactDay = timeZoneDay.replace(/-/g, '').slice(2); // YYMMDD
  const tail = String(randomInt(10 ** digits)).padStart(digits, '0');
  return `${prefix}-${compactDay}-${tail}`;
}

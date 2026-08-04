import { describe, expect, it } from 'vitest';
import {
  formatFallbackCode,
  generateBadgeNumber,
  generateFallbackCode,
  generateReferenceNumber,
  generateToken,
  hashEquals,
  hashFallbackCode,
  hashSessionToken,
  hashToken,
  normalizeFallbackCode,
  REFERENCE_NUMBER_PATTERN,
} from '@/lib/crypto/tokens';
import { FALLBACK_CODE_ALPHABET, FALLBACK_CODE_LENGTH } from '@/lib/constants';

describe('generateToken', () => {
  it('produces a URL-safe token with at least 256 bits of entropy', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('does not repeat across many draws', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateToken));
    expect(tokens.size).toBe(500);
  });
});

describe('hashToken', () => {
  it('is deterministic and hides the raw token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it('differs for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('hashSessionToken', () => {
  it('is keyed, so it differs from a plain SHA-256 of the same token', () => {
    const token = generateToken();
    expect(hashSessionToken(token)).not.toBe(hashToken(token));
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });
});

describe('generateFallbackCode', () => {
  it('uses only unambiguous characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateFallbackCode();
      expect(code).toHaveLength(FALLBACK_CODE_LENGTH);
      for (const char of code) {
        expect(FALLBACK_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('excludes the characters guards most often misread', () => {
    for (const ambiguous of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(FALLBACK_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });
});

describe('normalizeFallbackCode', () => {
  it('is case-insensitive and ignores separators', () => {
    expect(normalizeFallbackCode(' 2b3c-4d5e ')).toBe('2B3C4D5E');
  });

  it('maps commonly confused glyphs onto a single canonical form', () => {
    // A guard typing O for 0 or I/L for 1 lands on the same normalized string.
    expect(normalizeFallbackCode('O')).toBe(normalizeFallbackCode('0'));
    expect(normalizeFallbackCode('I')).toBe(normalizeFallbackCode('1'));
    expect(normalizeFallbackCode('L')).toBe(normalizeFallbackCode('1'));
    expect(normalizeFallbackCode('U')).toBe('V');
  });

  it('hashes equally for equivalent typings', () => {
    expect(hashFallbackCode('2b3c-4d5e')).toBe(hashFallbackCode('2B3C4D5E'));
  });
});

describe('formatFallbackCode', () => {
  it('splits into two readable halves', () => {
    expect(formatFallbackCode('2B3C4D5E')).toBe('2B3C-4D5E');
  });
});

describe('hashEquals', () => {
  it('compares hex digests safely', () => {
    const digest = hashToken('x');
    expect(hashEquals(digest, digest)).toBe(true);
    expect(hashEquals(digest, hashToken('y'))).toBe(false);
    expect(hashEquals(digest, 'abc')).toBe(false);
  });
});

describe('generateReferenceNumber', () => {
  it('matches the public reference format and carries no personal data', () => {
    const reference = generateReferenceNumber(new Date('2026-03-14T02:00:00Z'));
    expect(reference).toMatch(/^VP-\d{2}[A-Z0-9]{2}-[A-Z0-9]{4}$/);
  });

  it('is accepted by the shared pattern the success page validates against', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(generateReferenceNumber()).toMatch(REFERENCE_NUMBER_PATTERN);
    }
  });

  it('is unique across many draws', () => {
    const now = new Date('2026-03-14T02:00:00Z');
    const refs = new Set(Array.from({ length: 300 }, () => generateReferenceNumber(now)));
    expect(refs.size).toBeGreaterThan(295);
  });
});

describe('generateBadgeNumber', () => {
  it('embeds the visit day and a non-sequential tail', () => {
    const badge = generateBadgeNumber('V', '2026-08-03');
    expect(badge).toMatch(/^V-260803-\d{4}$/);
  });

  it('widens the tail on request, for collision recovery', () => {
    expect(generateBadgeNumber('V', '2026-08-03', 7)).toMatch(/^V-260803-\d{7}$/);
  });

  it('is random enough that a day of badges rarely repeats', () => {
    // A reminder of why allocateBadgeNumber exists: four digits is only 10,000
    // values per day, so duplicates within one day are entirely possible and
    // must be resolved against the database rather than assumed away.
    const badges = Array.from({ length: 100 }, () => generateBadgeNumber('V', '2026-08-03'));
    expect(new Set(badges).size).toBeGreaterThan(90);
  });
});

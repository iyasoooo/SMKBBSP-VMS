import { describe, expect, it } from 'vitest';
import { IdentityType } from '@prisma/client';
import {
  buildIdentityFields,
  computeIdentityHmac,
  decryptIdentity,
  encryptIdentity,
  hmacEquals,
  identityLast4,
  maskIdentity,
  maskNormalizedIdentity,
  normalizeIdentity,
  validateNormalizedIdentity,
} from '@/lib/crypto/identity';

describe('normalizeIdentity', () => {
  it('strips NRIC formatting so equivalent inputs match', () => {
    const variants = ['880101-14-5523', '880101 14 5523', '  880101145523  ', '880101-145523'];
    const normalized = variants.map((v) => normalizeIdentity(IdentityType.NRIC, v));
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('880101145523');
  });

  it('uppercases and strips separators from passports', () => {
    expect(normalizeIdentity(IdentityType.PASSPORT, ' a-1234 567 ')).toBe('A1234567');
  });
});

describe('validateNormalizedIdentity', () => {
  it('requires exactly 12 digits for NRIC', () => {
    expect(validateNormalizedIdentity(IdentityType.NRIC, '880101145523').ok).toBe(true);
    expect(validateNormalizedIdentity(IdentityType.NRIC, '88010114552')).toEqual({
      ok: false,
      code: 'NRIC_LENGTH',
    });
    expect(validateNormalizedIdentity(IdentityType.NRIC, '8801011455AB')).toEqual({
      ok: false,
      code: 'NRIC_DIGITS',
    });
  });

  it('applies length bounds to non-NRIC identifiers', () => {
    expect(validateNormalizedIdentity(IdentityType.PASSPORT, 'A12').code).toBe('TOO_SHORT');
    expect(validateNormalizedIdentity(IdentityType.PASSPORT, 'A'.repeat(25)).code).toBe('TOO_LONG');
    expect(validateNormalizedIdentity(IdentityType.PASSPORT, 'A1234567').ok).toBe(true);
    expect(validateNormalizedIdentity(IdentityType.OTHER, '').code).toBe('EMPTY');
  });
});

describe('masking', () => {
  it('reveals only the last four characters', () => {
    expect(identityLast4('880101145523')).toBe('5523');
    expect(maskIdentity(IdentityType.NRIC, '5523')).toBe('******-**-5523');
    expect(maskIdentity(IdentityType.PASSPORT, '4567')).toBe('****4567');
  });

  it('never contains the leading digits of the source value', () => {
    const masked = maskNormalizedIdentity(IdentityType.NRIC, '880101145523');
    expect(masked).not.toContain('880101');
    expect(masked).not.toContain('14');
  });

  it('pads short values rather than exposing them whole', () => {
    expect(identityLast4('12')).toBe('**12');
  });
});

describe('computeIdentityHmac', () => {
  it('is deterministic for the same normalized value', () => {
    const a = computeIdentityHmac(IdentityType.NRIC, '880101145523');
    const b = computeIdentityHmac(IdentityType.NRIC, '880101145523');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not contain the source value', () => {
    const hmac = computeIdentityHmac(IdentityType.NRIC, '880101145523');
    expect(hmac).not.toContain('880101145523');
  });

  it('separates namespaces so identical digits under different types differ', () => {
    const asNric = computeIdentityHmac(IdentityType.NRIC, '123456789012');
    const asOther = computeIdentityHmac(IdentityType.OTHER, '123456789012');
    expect(asNric).not.toBe(asOther);
  });

  it('produces different digests for different values', () => {
    expect(computeIdentityHmac(IdentityType.NRIC, '880101145523')).not.toBe(
      computeIdentityHmac(IdentityType.NRIC, '880101145524'),
    );
  });
});

describe('hmacEquals', () => {
  it('compares equal and unequal digests correctly', () => {
    const digest = computeIdentityHmac(IdentityType.NRIC, '880101145523');
    expect(hmacEquals(digest, digest)).toBe(true);
    expect(hmacEquals(digest, digest.replace(/.$/, '0'))).toBe(false);
    expect(hmacEquals(digest, 'short')).toBe(false);
    expect(hmacEquals('zz', 'zz')).toBe(false); // non-hex input
  });
});

describe('encryptIdentity / decryptIdentity', () => {
  it('round trips', () => {
    const encrypted = encryptIdentity('880101145523');
    expect(decryptIdentity(encrypted)).toBe('880101145523');
  });

  it('never stores the plaintext in any field', () => {
    const encrypted = encryptIdentity('880101145523');
    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain('880101145523');
  });

  it('uses a fresh IV for every call so identical values differ at rest', () => {
    const a = encryptIdentity('880101145523');
    const b = encryptIdentity('880101145523');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptIdentity('880101145523');
    const flipped = Buffer.from(encrypted.ciphertext, 'base64');
    flipped.writeUInt8(flipped.readUInt8(0) ^ 0xff, 0);
    expect(() =>
      decryptIdentity({ ...encrypted, ciphertext: flipped.toString('base64') }),
    ).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const encrypted = encryptIdentity('880101145523');
    const tag = Buffer.from(encrypted.tag, 'base64');
    tag.writeUInt8(tag.readUInt8(0) ^ 0xff, 0);
    expect(() => decryptIdentity({ ...encrypted, tag: tag.toString('base64') })).toThrow();
  });

  it('refuses to decrypt a record written under a different key version', () => {
    const encrypted = encryptIdentity('880101145523');
    expect(() => decryptIdentity({ ...encrypted, keyVersion: 2 })).toThrow(/key version/i);
  });
});

describe('buildIdentityFields', () => {
  it('derives every persisted column consistently', () => {
    const fields = buildIdentityFields(IdentityType.NRIC, '880101-14-5523');

    expect(fields.last4).toBe('5523');
    expect(fields.hmac).toBe(computeIdentityHmac(IdentityType.NRIC, '880101145523'));
    expect(decryptIdentity(fields)).toBe('880101145523');
    expect(JSON.stringify(fields)).not.toContain('880101145523');
  });

  it('produces the same HMAC regardless of how the user formatted the input', () => {
    const a = buildIdentityFields(IdentityType.NRIC, '880101-14-5523');
    const b = buildIdentityFields(IdentityType.NRIC, '880101 145523');
    expect(a.hmac).toBe(b.hmac);
  });

  it('rejects an invalid value instead of storing it', () => {
    expect(() => buildIdentityFields(IdentityType.NRIC, '123')).toThrow(/NRIC_LENGTH/);
  });
});

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, PASSWORD_MIN_LENGTH } from '@/lib/crypto/password';

describe('hashPassword', () => {
  it('produces a parameterised scrypt string that does not contain the password', async () => {
    const hash = await hashPassword('Correct#Horse2026');

    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(hash).not.toContain('Correct#Horse2026');
    expect(hash.split('$')).toHaveLength(6);
  });

  it('salts each hash so identical passwords differ at rest', async () => {
    const a = await hashPassword('Correct#Horse2026');
    const b = await hashPassword('Correct#Horse2026');
    expect(a).not.toBe(b);
  });

  it('rejects passwords below the policy minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(
      new RegExp(`at least ${PASSWORD_MIN_LENGTH}`),
    );
  });

  it('rejects unbounded input rather than truncating it', async () => {
    await expect(hashPassword('a'.repeat(201))).rejects.toThrow(/at most/);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('Correct#Horse2026');
    await expect(verifyPassword('Correct#Horse2026', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Correct#Horse2026');
    await expect(verifyPassword('Correct#Horse2027', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });

  it('is unicode-stable across equivalent normalisations', async () => {
    // U+00E9 vs e + U+0301 render identically; NFKC makes them verify alike.
    const hash = await hashPassword('caféPassword1');
    await expect(verifyPassword('caféPassword1', hash)).resolves.toBe(true);
  });

  it('returns false for malformed stored hashes instead of throwing', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$32768$8$1$c2FsdA==$aGFzaA==']) {
      await expect(verifyPassword('Correct#Horse2026', bad)).resolves.toBe(false);
    }
  });

  it('refuses stored parameters that demand absurd memory', async () => {
    const hostile = 'scrypt$99999999$8$1$c2FsdA==$aGFzaA==';
    await expect(verifyPassword('Correct#Horse2026', hostile)).resolves.toBe(false);
  });
});

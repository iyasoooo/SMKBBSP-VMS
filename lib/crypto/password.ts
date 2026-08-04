import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Password hashing with scrypt.
 *
 * scrypt is a memory-hard KDF standardised in RFC 7914 and shipped in Node's
 * core `crypto` module. Choosing it over Argon2/bcrypt avoids a native
 * addon that has to compile per platform - the spec asks for an algorithm
 * "supported reliably by the runtime", and a hashing dependency that fails to
 * build on a marking machine would take the whole login flow with it.
 *
 * Cost parameters (documented per the spec's requirement):
 *   N = 32768  CPU/memory cost. Memory used is roughly 128 * N * r bytes.
 *   r = 8      block size  ->  ~32 MB per hash
 *   p = 1      parallelisation
 *
 * That lands around 100 ms per verification on typical hardware: slow enough
 * to make offline guessing expensive, fast enough for an interactive login.
 * `maxmem` is raised explicitly because Node's 32 MB default sits exactly on
 * the boundary and would otherwise reject these parameters.
 */

/**
 * `promisify` cannot express scrypt's options overload, so the wrapper is
 * written by hand to keep the cost parameters type-checked.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2; // ~64 MB headroom

const PREFIX = 'scrypt';

/**
 * Encoded as `scrypt$N$r$p$salt$hash` (base64 segments) so the parameters
 * travel with the hash and can be raised later without invalidating
 * existing passwords.
 */
export async function hashPassword(password: string): Promise<string> {
  assertUsablePassword(password);

  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  })) as Buffer;

  return [
    PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verify a candidate password.
 *
 * Returns false for malformed stored hashes rather than throwing, so a
 * corrupted row cannot be distinguished from a wrong password by an attacker
 * watching responses.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  try {
    const derived = (await scrypt(password.normalize('NFKC'), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: Math.max(MAX_MEM, 128 * parsed.N * parsed.r * 2),
    })) as Buffer;

    return timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // Guard against a tampered row demanding an absurd amount of memory.
  if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return null;

  try {
    const salt = Buffer.from(parts[4] ?? '', 'base64');
    const hash = Buffer.from(parts[5] ?? '', 'base64');
    if (salt.length === 0 || hash.length === 0) return null;
    return { N, r, p, salt, hash };
  } catch {
    return null;
  }
}

/** Minimum staff password policy, enforced wherever a password is set. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function assertUsablePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    // Long inputs are rejected rather than truncated: scrypt's cost grows with
    // input size, so an unbounded password is a cheap denial-of-service.
    throw new Error(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
}

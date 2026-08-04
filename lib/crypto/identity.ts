import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityType } from '@prisma/client';
import { getEnv } from '@/lib/env';

/**
 * Identity number handling.
 *
 * A Malaysian NRIC is a *predictable* 12-digit value: the full keyspace is
 * small enough to enumerate. A plain SHA-256 of one is therefore reversible by
 * brute force in seconds, which is why matching uses a keyed HMAC and storage
 * uses authenticated encryption. Neither operation is possible without the
 * environment keys.
 *
 * Two distinct derivations are kept per visitor:
 *   - `identityHmac`  deterministic, for blacklist matching and dedupe
 *   - ciphertext/iv/tag  reversible, for the audited admin reveal only
 *
 * Nothing in this module ever logs or returns a plaintext identity except the
 * explicit `decryptIdentity` call.
 */

const AES_ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the size recommended for GCM.

export interface EncryptedIdentity {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}

export interface IdentityRecordFields extends EncryptedIdentity {
  hmac: string;
  last4: string;
}

function encryptionKey(): Buffer {
  return Buffer.from(getEnv().IDENTITY_ENCRYPTION_KEY, 'base64');
}

function hmacKey(): Buffer {
  return Buffer.from(getEnv().IDENTITY_HMAC_KEY, 'base64');
}

// ---------------------------------------------------------------------------
// Normalization and validation
// ---------------------------------------------------------------------------

/**
 * Reduce an identity number to its canonical comparable form.
 *
 * Normalization must happen before hashing or encryption, otherwise
 * `880101-14-5523` and `880101145523` would produce different HMACs and a
 * blacklisted person could slip through by re-typing their number differently.
 */
export function normalizeIdentity(type: IdentityType, raw: string): string {
  const trimmed = raw.trim();

  if (type === IdentityType.NRIC) {
    // Malaysian NRIC: digits only, hyphens and spaces are formatting.
    return trimmed.replace(/[\s-]/g, '');
  }

  // Passport / driving licence / other: uppercase alphanumerics only.
  return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface IdentityValidationResult {
  ok: boolean;
  /** Stable code the UI maps to a localised message. */
  code?: 'NRIC_LENGTH' | 'NRIC_DIGITS' | 'TOO_SHORT' | 'TOO_LONG' | 'EMPTY';
}

/**
 * Validate a *normalized* identity value.
 *
 * Deliberately structural only. The system never infers birth date, state of
 * birth, gender or citizenship from an NRIC, and never claims the number is
 * genuine - that remains the guard's physical sighting.
 */
export function validateNormalizedIdentity(
  type: IdentityType,
  normalized: string,
): IdentityValidationResult {
  if (normalized.length === 0) return { ok: false, code: 'EMPTY' };

  if (type === IdentityType.NRIC) {
    if (!/^\d+$/.test(normalized)) return { ok: false, code: 'NRIC_DIGITS' };
    if (normalized.length !== 12) return { ok: false, code: 'NRIC_LENGTH' };
    return { ok: true };
  }

  if (normalized.length < 4) return { ok: false, code: 'TOO_SHORT' };
  if (normalized.length > 24) return { ok: false, code: 'TOO_LONG' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/** The trailing fragment stored in the clear and shown in listings. */
export function identityLast4(normalized: string): string {
  return normalized.slice(-4).padStart(4, '*');
}

/**
 * Default rendering everywhere outside the audited reveal.
 * NRIC renders in its familiar shape so staff can still recognise the format:
 * `******-**-5523`.
 */
export function maskIdentity(type: IdentityType, last4: string): string {
  if (type === IdentityType.NRIC) return `******-**-${last4}`;
  return `****${last4}`;
}

/** Mask directly from a full normalized value (used in tests and previews). */
export function maskNormalizedIdentity(type: IdentityType, normalized: string): string {
  return maskIdentity(type, identityLast4(normalized));
}

// ---------------------------------------------------------------------------
// Deterministic matching
// ---------------------------------------------------------------------------

/**
 * Keyed HMAC used for equality comparison and blacklist matching.
 * The type is bound into the input so an NRIC and a passport that happen to
 * share a digit string cannot collide.
 */
export function computeIdentityHmac(type: IdentityType, normalized: string): string {
  return createHmac('sha256', hmacKey()).update(`${type}:${normalized}`, 'utf8').digest('hex');
}

/**
 * Timing-safe comparison of two hex digests of equal length.
 *
 * Non-hex input is rejected up front. `Buffer.from` parses hex leniently and
 * returns an empty buffer for garbage, which would otherwise make any two
 * equal-length non-hex strings compare as equal.
 */
export function hmacEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (!isHexDigest(a) || !isHexDigest(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function isHexDigest(value: string): boolean {
  return value.length % 2 === 0 && value.length > 0 && /^[0-9a-fA-F]+$/.test(value);
}

// ---------------------------------------------------------------------------
// Reversible storage
// ---------------------------------------------------------------------------

export function encryptIdentity(normalized: string): EncryptedIdentity {
  const env = getEnv();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    keyVersion: env.IDENTITY_KEY_VERSION,
  };
}

/**
 * Reverse `encryptIdentity`.
 *
 * Throws on a wrong key or tampered ciphertext: GCM authenticates, so a
 * modified row fails loudly instead of returning plausible garbage. Callers
 * must be an audited admin reveal path.
 */
export function decryptIdentity(record: EncryptedIdentity): string {
  const env = getEnv();

  if (record.keyVersion !== env.IDENTITY_KEY_VERSION) {
    throw new Error(
      `Identity record uses key version ${record.keyVersion} but the environment provides version ${env.IDENTITY_KEY_VERSION}. Re-encrypt the affected rows before rotating.`,
    );
  }

  const decipher = createDecipheriv(
    AES_ALGORITHM,
    encryptionKey(),
    Buffer.from(record.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Build every persisted identity column from a raw user-supplied value.
 * This is the only supported way to create those columns, which keeps
 * normalization, HMAC and encryption from drifting apart.
 */
export function buildIdentityFields(type: IdentityType, raw: string): IdentityRecordFields {
  const normalized = normalizeIdentity(type, raw);
  const validation = validateNormalizedIdentity(type, normalized);
  if (!validation.ok) {
    throw new Error(`Invalid identity value (${validation.code ?? 'UNKNOWN'})`);
  }

  return {
    ...encryptIdentity(normalized),
    hmac: computeIdentityHmac(type, normalized),
    last4: identityLast4(normalized),
  };
}

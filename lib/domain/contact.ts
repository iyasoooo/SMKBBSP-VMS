/**
 * Contact detail normalization.
 *
 * Stored values are canonical so that blacklist matching and visitor
 * de-duplication compare like with like. `012-345 6789`, `0123456789` and
 * `+60123456789` are the same Malaysian number and must produce the same
 * stored string, or a blocked contact could evade a match by changing format.
 */

/** Lower-cased and trimmed. Returns null for an empty value. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  return value.length > 0 ? value : null;
}

/**
 * Normalize to E.164 where the number is recognisably Malaysian, otherwise
 * keep a conservative digits-and-plus form rather than guessing a country.
 *
 *   012-345 6789   -> +60123456789
 *   60123456789    -> +60123456789
 *   +60 12 3456789 -> +60123456789
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const cleaned = raw.trim().replace(/[\s()\-.]/g, '');
  if (cleaned.length === 0) return null;

  const hasPlus = cleaned.startsWith('+');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (hasPlus) return `+${digits}`;

  // Local trunk form: 0 followed by 9-10 digits.
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 11) {
    return `+60${digits.slice(1)}`;
  }

  // Already carries the Malaysian country code without a plus.
  if (digits.startsWith('60') && digits.length >= 10 && digits.length <= 13) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/** Structural check only; it does not prove the number is reachable. */
export function isPlausiblePhone(normalized: string | null): boolean {
  if (!normalized) return false;
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * Mask a phone number for display: `+6012****789`.
 * Used in lists where staff need to recognise a repeat visitor without the
 * full number being readable over someone's shoulder.
 */
export function maskPhone(normalized: string | null): string {
  if (!normalized) return '-';
  if (normalized.length <= 7) return '*'.repeat(normalized.length);
  return `${normalized.slice(0, 5)}****${normalized.slice(-3)}`;
}

/** Mask an email for display: `nu****@contoh.test`. */
export function maskEmail(email: string | null): string {
  if (!email) return '-';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '****';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(2, local.length - head.length))}@${domain}`;
}

/** Collapse whitespace in a person's name without altering its characters. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

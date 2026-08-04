/**
 * Extract form-fillable fields from OCR text read off a Malaysian identity card.
 *
 * This is data entry assistance and nothing more. It does not verify that a
 * card is genuine, does not check the number against any registry, and does
 * not decide anything: every field it produces is presented to a human for
 * correction before it is used. OCR misreads are expected and normal, which is
 * why each field carries a confidence signal the UI uses to draw attention to
 * anything doubtful.
 *
 * Kept free of DOM and worker code so the parsing rules can be tested directly.
 */

export interface ParsedIcFields {
  /** 12 digits, unformatted, or null when no plausible number was found. */
  identityNumber: string | null;
  /** Name as printed, or null. */
  fullName: string | null;
  /** Fields the reader is least sure about, for the UI to highlight. */
  uncertain: Array<'identityNumber' | 'fullName'>;
}

/**
 * OCR routinely confuses these glyphs in the digit rows of an IC. Applied only
 * to candidate *number* strings, never to the name, where the substitutions
 * would corrupt legitimate letters.
 */
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  Q: '0',
  I: '1',
  l: '1',
  '|': '1',
  Z: '2',
  S: '5',
  s: '5',
  B: '8',
  G: '6',
  T: '7',
};

function coerceDigits(candidate: string): string {
  return candidate
    .split('')
    .map((char) => DIGIT_CONFUSIONS[char] ?? char)
    .join('')
    .replace(/\D/g, '');
}

/**
 * Find the identity number.
 *
 * Preference order matters. A hyphenated `YYMMDD-PB-###G` match is by far the
 * strongest signal, because that shape does not otherwise occur on the card. A
 * bare 12-digit run is accepted next. Anything that needed glyph correction is
 * reported as uncertain, since a corrected digit is a guess.
 */
function findIdentityNumber(text: string): { value: string | null; certain: boolean } {
  const hyphenated = /(\d{6})\s*-\s*(\d{2})\s*-\s*(\d{4})/.exec(text);
  if (hyphenated) {
    return { value: `${hyphenated[1]}${hyphenated[2]}${hyphenated[3]}`, certain: true };
  }

  const plain = /(?<!\d)(\d{12})(?!\d)/.exec(text);
  if (plain?.[1]) return { value: plain[1], certain: true };

  // Fall back to glyph-corrected candidates, which are inherently less certain.
  for (const line of text.split(/\r?\n/)) {
    const compact = line.replace(/[\s-]/g, '');
    // Only consider runs that are mostly digits already.
    if (compact.length < 12) continue;
    const digitRatio = (compact.match(/\d/g) ?? []).length / compact.length;
    if (digitRatio < 0.6) continue;

    const coerced = coerceDigits(compact);
    const match = /(?<!\d)(\d{12})(?!\d)/.exec(coerced);
    if (match?.[1]) return { value: match[1], certain: false };
  }

  return { value: null, certain: false };
}

/** Words printed on every MyKad that are never part of a person's name. */
const CARD_NOISE = [
  'MYKAD',
  'KAD PENGENALAN',
  'PENGENALAN',
  'MALAYSIA',
  'WARGANEGARA',
  'LELAKI',
  'PEREMPUAN',
  'ISLAM',
  'AGAMA',
  'ALAMAT',
  'IDENTITY',
  'CARD',
];

/**
 * Address tokens. The card prints the holder's address in the same capitals as
 * their name, and a house number is not always present, so digit filtering
 * alone does not separate them. No Malaysian personal name contains these.
 */
const ADDRESS_TOKENS = [
  'JALAN',
  'LORONG',
  'TAMAN',
  'KAMPUNG',
  'KAMPONG',
  'PERSIARAN',
  'SEKSYEN',
  'BANDAR',
  'BLOK',
  'TINGKAT',
];

/**
 * Find the cardholder name.
 *
 * The name sits on its own line in capitals, so the heuristic looks for the
 * longest all-caps line that is not one of the card's printed labels and
 * contains no digits. Addresses are excluded because they carry digits; the
 * baseline deliberately never captures an address anyway.
 */
function findFullName(text: string): { value: string | null; certain: boolean } {
  const candidates = text
    .split(/\r?\n/)
    // Reject digit-bearing lines on the *raw* text. Cleaning first would strip
    // an address's house number and leave a line that reads like a name.
    .filter((raw) => !/\d/.test(raw))
    .map((line) => line.replace(/[^A-Za-z@/'.\- ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (line.length < 4) return false;
      const upper = line.toUpperCase();
      if (CARD_NOISE.some((noise) => upper.includes(noise))) return false;
      if (ADDRESS_TOKENS.some((token) => upper.split(' ').includes(token))) return false;
      // Names are printed in capitals; mixed case is usually a label.
      const letters = line.replace(/[^A-Za-z]/g, '');
      if (letters.length === 0) return false;
      const upperRatio = (line.match(/[A-Z]/g) ?? []).length / letters.length;
      return upperRatio > 0.8;
    })
    .sort((a, b) => b.length - a.length);

  const best = candidates[0];
  if (!best) return { value: null, certain: false };

  // A confident name has at least two parts, as Malaysian names almost always do.
  return { value: best, certain: best.split(' ').length >= 2 };
}

export function parseIcText(rawText: string): ParsedIcFields {
  const text = rawText ?? '';

  const identity = findIdentityNumber(text);
  const name = findFullName(text);

  const uncertain: ParsedIcFields['uncertain'] = [];
  if (identity.value && !identity.certain) uncertain.push('identityNumber');
  if (name.value && !name.certain) uncertain.push('fullName');

  return {
    identityNumber: identity.value,
    fullName: name.value,
    uncertain,
  };
}

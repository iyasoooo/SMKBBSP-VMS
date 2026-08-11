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
 *
 * The line it was found on is reported too: the name sits directly beneath the
 * number on a MyKad, and that position is a far stronger signal than anything
 * the text of the name line itself provides.
 */
function findIdentityNumber(lines: string[]): {
  value: string | null;
  certain: boolean;
  lineIndex: number;
} {
  // Scanned per line rather than across the whole text so the position is
  // known, and so `\s` in the hyphenated form cannot straddle a line break.
  for (const [index, line] of lines.entries()) {
    const hyphenated = /(\d{6})\s*-\s*(\d{2})\s*-\s*(\d{4})/.exec(line);
    if (hyphenated) {
      return {
        value: `${hyphenated[1]}${hyphenated[2]}${hyphenated[3]}`,
        certain: true,
        lineIndex: index,
      };
    }
  }

  for (const [index, line] of lines.entries()) {
    const plain = /(?<!\d)(\d{12})(?!\d)/.exec(line);
    if (plain?.[1]) return { value: plain[1], certain: true, lineIndex: index };
  }

  // Fall back to glyph-corrected candidates, which are inherently less certain.
  for (const [index, line] of lines.entries()) {
    const compact = line.replace(/[\s-]/g, '');
    // Only consider runs that are mostly digits already.
    if (compact.length < 12) continue;
    const digitRatio = (compact.match(/\d/g) ?? []).length / compact.length;
    if (digitRatio < 0.6) continue;

    const coerced = coerceDigits(compact);
    const match = /(?<!\d)(\d{12})(?!\d)/.exec(coerced);
    if (match?.[1]) return { value: match[1], certain: false, lineIndex: index };
  }

  return { value: null, certain: false, lineIndex: -1 };
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
 * States and federal territories, which close the address block.
 *
 * These are set in the same capitals as the name and carry no digits, so
 * without them a line like `WILAYAH PERSEKUTUAN` or `SELANGOR DARUL EHSAN`
 * outranks a genuinely short name such as `SITI NORAINI`. Only unambiguous
 * place words are listed: honorifics like `AMAN` and `IMAN` are omitted
 * deliberately, because they also occur in given names.
 */
const PLACE_TOKENS = [
  'WILAYAH',
  'PERSEKUTUAN',
  'KUALA',
  'LUMPUR',
  'PUTRAJAYA',
  'LABUAN',
  'JOHOR',
  'KEDAH',
  'KELANTAN',
  'MELAKA',
  'NEGERI',
  'SEMBILAN',
  'PAHANG',
  'PERAK',
  'PERLIS',
  'PULAU',
  'PINANG',
  'SABAH',
  'SARAWAK',
  'SELANGOR',
  'TERENGGANU',
];

/**
 * Normalise a line and decide whether it could be a name at all. Returns the
 * cleaned line, or null when the line is a label, an address, or not capitals.
 */
function asNameCandidate(raw: string): string | null {
  // Tested on the *raw* line. Cleaning first would strip an address's house
  // number and leave something that reads like a name.
  if (/\d/.test(raw)) return null;

  const cleaned = raw.replace(/[^A-Za-z@/'.\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 4) return null;

  const upper = cleaned.toUpperCase();
  if (CARD_NOISE.some((noise) => upper.includes(noise))) return null;
  if (ADDRESS_TOKENS.some((token) => upper.split(' ').includes(token))) return null;

  // Names are printed in capitals; mixed case is usually a label.
  const letters = cleaned.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0) return null;
  const upperRatio = (cleaned.match(/[A-Z]/g) ?? []).length / letters.length;
  if (upperRatio <= 0.8) return null;

  return cleaned;
}

function isPlaceLine(line: string): boolean {
  const words = line.toUpperCase().split(' ');
  return PLACE_TOKENS.some((token) => words.includes(token));
}

/**
 * Find the cardholder name.
 *
 * Position is the primary signal: a MyKad prints the name directly beneath the
 * identity number, so the first plausible line after the number is the name.
 * This replaces an earlier "longest capitalised line" rule, which reliably
 * returned the state from the address block whenever the holder's name was
 * shorter than it - and reported that as certain.
 *
 * A name wrapped across two printed lines yields only its first line. That is
 * deliberate: truncation is obvious to the person reviewing the field, whereas
 * a name with part of an address appended is not.
 */
function findFullName(lines: string[], numberLineIndex: number): {
  value: string | null;
  certain: boolean;
} {
  if (numberLineIndex >= 0) {
    // Bounded so a stray digit run early in the read cannot drag the search
    // all the way down into the address block.
    const limit = Math.min(lines.length, numberLineIndex + 6);
    for (let index = numberLineIndex + 1; index < limit; index += 1) {
      const candidate = asNameCandidate(lines[index] ?? '');
      if (!candidate || isPlaceLine(candidate)) continue;
      return { value: candidate, certain: candidate.split(' ').length >= 2 };
    }
  }

  // No number to anchor to. Fall back to the longest capitalised line, and
  // never call it certain - without the anchor this is genuinely a guess.
  const best = lines
    .map((line) => asNameCandidate(line))
    .filter((line): line is string => line !== null && !isPlaceLine(line))
    .sort((a, b) => b.length - a.length)[0];

  return best ? { value: best, certain: false } : { value: null, certain: false };
}

export function parseIcText(rawText: string): ParsedIcFields {
  const lines = (rawText ?? '').split(/\r?\n/);

  const identity = findIdentityNumber(lines);
  const name = findFullName(lines, identity.lineIndex);

  const uncertain: ParsedIcFields['uncertain'] = [];
  if (identity.value && !identity.certain) uncertain.push('identityNumber');
  if (name.value && !name.certain) uncertain.push('fullName');

  return {
    identityNumber: identity.value,
    fullName: name.value,
    uncertain,
  };
}

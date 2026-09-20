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
 * One word as the recognizer reported it, with its own 0-100 confidence.
 *
 * Optional because the parsing rules must stay testable from plain text, but
 * when it is supplied it outranks every heuristic in this file: the recognizer
 * knows when it half-guessed a glyph, and no amount of pattern matching over
 * its output can recover that.
 */
export interface OcrWord {
  text: string;
  confidence: number;
}

/**
 * Below this, a word is a guess dressed up as a reading.
 *
 * Tesseract reports per-word confidence on a 0-100 scale. Clean print on a flat,
 * evenly lit card sits in the 80s and 90s; anything under ~70 is typically
 * glare, blur, or a hologram crossing the glyphs. The threshold decides only
 * whether a field is *flagged for a closer look*, never whether it is used, so
 * erring low costs a person one extra glance and erring high costs a wrong
 * identity number on a visitor pass.
 */
const LOW_CONFIDENCE = 70;

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

// ---------------------------------------------------------------------------
// Structural plausibility
// ---------------------------------------------------------------------------

/*
 * An NRIC is `YYMMDD-PB-###G`, and both leading groups are heavily constrained.
 * Checking them turns a misread from something only a human can catch into
 * something the parser can rank, which is the cheapest accuracy gain available
 * here: `880101` and `88O1O1` are indistinguishable to a regex, but only one of
 * them is a date.
 *
 * Scope note, because this brushes against a standing rule. The system never
 * *infers* anything from an identity number - not birth date, not state of
 * birth, not gender, not citizenship. Nothing below is stored, displayed,
 * logged, or returned. These are plausibility tests that run in the browser and
 * are discarded the moment a candidate has been ranked; they exist only to
 * choose between competing readings of the same photograph.
 */

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Does `YYMMDD` describe a real calendar date? */
function isPlausibleDatePrefix(digits: string): boolean {
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));

  if (month < 1 || month > 12) return false;
  // Leap years are not tested: the two-digit year is century-ambiguous, so
  // 29 February is accepted rather than risk rejecting a genuine card.
  return day >= 1 && day <= (DAYS_IN_MONTH[month - 1] ?? 31);
}

/**
 * Birthplace codes that are not issued.
 *
 * Expressed as the invalid set rather than the valid one on purpose. The
 * allocated ranges have been extended before, and a parser that rejects a real
 * visitor's card is a far worse failure than one that accepts an impossible
 * code: a miss here only means a wrong reading is not demoted, and a person
 * reviews the field either way.
 */
const INVALID_BIRTHPLACE = new Set([
  '00',
  '17',
  '18',
  '19',
  '20',
  '69',
  '70',
  '73',
  '80',
  '81',
  '94',
  '95',
  '96',
  '97',
]);

function isPlausibleBirthplace(digits: string): boolean {
  return !INVALID_BIRTHPLACE.has(digits.slice(6, 8));
}

/**
 * Rank a 12-digit candidate. Higher is better. Used only to choose between
 * readings of one photograph, and never reported anywhere.
 */
function scoreCandidate(digits: string, hyphenated: boolean, corrections: number): number {
  let score = 0;
  if (hyphenated) score += 3; // that shape occurs nowhere else on the card
  if (isPlausibleDatePrefix(digits)) score += 2;
  if (isPlausibleBirthplace(digits)) score += 2;
  score -= corrections; // every substituted glyph is a guess
  return score;
}

/** A candidate is trustworthy only if nothing was guessed and it holds up. */
function isStructurallySound(digits: string): boolean {
  return isPlausibleDatePrefix(digits) && isPlausibleBirthplace(digits);
}

// ---------------------------------------------------------------------------
// Identity number
// ---------------------------------------------------------------------------

interface NumberCandidate {
  value: string;
  certain: boolean;
  lineIndex: number;
  score: number;
}

/**
 * Find the identity number.
 *
 * Every plausible reading on every line is collected and then ranked, rather
 * than returning the first regex hit. The difference shows on a card where a
 * serial number or an expiry date also produces a digit run: the first match
 * wins by position alone, whereas the best match wins by looking like an NRIC.
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
  const candidates: NumberCandidate[] = [];

  for (const [index, line] of lines.entries()) {
    /*
     * The 6-2-4 grouping, with whatever the reader made of the separators.
     *
     * Insisting on literal hyphens threw away otherwise perfect readings: a
     * hyphen on a glared or blurred card comes back as `.`, as a space, or as
     * nothing at all, and none of that says anything about whether the digits
     * either side were read correctly. Accuracy is judged by the two signals
     * that do mean something - whether the groups are structurally possible,
     * and how sure the recognizer was - so the separator only contributes a
     * ranking bonus when it survived intact.
     *
     * The lookarounds are what keep this honest. Without them the pattern would
     * find a 6-2-4 grouping inside any longer digit run, inventing an identity
     * number from a serial number that merely happens to be long enough.
     */
    const grouped = /(?<!\d)(\d{6})([-.\s]{0,3})(\d{2})([-.\s]{0,3})(\d{4})(?!\d)/.exec(line);
    if (grouped) {
      const value = `${grouped[1]}${grouped[3]}${grouped[5]}`;
      const asPrinted = grouped[2] === '-' && grouped[4] === '-';
      candidates.push({
        value,
        // Even a perfectly hyphenated read is demoted when the groups are
        // impossible. This previously returned `certain` without looking.
        certain: isStructurallySound(value),
        lineIndex: index,
        score: scoreCandidate(value, asPrinted, 0),
      });
    }

    /*
     * The line with its separators removed. This catches two different things:
     * a number whose hyphens came back as spaces, which is an everyday OCR
     * result and involves no guessing at all, and one whose digits needed glyph
     * substitution, which is entirely guesswork. They are told apart by
     * counting the substitutions, so a clean reading always outranks a repaired
     * one and only the repaired one is reported as doubtful.
     */
    const compact = line.replace(/[\s-]/g, '');
    if (compact.length < 12) continue;
    const digitRatio = (compact.match(/\d/g) ?? []).length / compact.length;
    if (digitRatio < 0.6) continue;

    const coerced = coerceDigits(compact);
    const match = /(?<!\d)(\d{12})(?!\d)/.exec(coerced);
    if (match?.[1]) {
      const corrections = (compact.match(/[A-Za-z|]/g) ?? []).length;
      candidates.push({
        value: match[1],
        certain: corrections === 0 && isStructurallySound(match[1]),
        lineIndex: index,
        score: scoreCandidate(match[1], false, corrections),
      });
    }
  }

  if (candidates.length === 0) return { value: null, certain: false, lineIndex: -1 };

  // A tie keeps the earliest line: the number is printed above the address
  // block, so position breaks a tie in the right direction.
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  return { value: best.value, certain: best.certain, lineIndex: best.lineIndex };
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

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
/**
 * The widest run of text on a line, treating a large gap as a column break.
 *
 * A MyKad prints the holder's photograph to the right of their name, and its
 * edge, the hologram and the chip all produce stray glyphs on the *same text
 * line* as the name - observed directly, as
 * `NURUL HUDA BINTI ISMAIL{spaces}A`, which was then applied to the form as a
 * name ending in a stray `A`. Frame voting cannot catch it: the artefact comes
 * from the card's own layout, so every frame reproduces it.
 *
 * The gap is the signal, and it only exists because `preserve_interword_spaces`
 * is deliberately enabled - a wide run of spaces means a wide physical gap on
 * the card, so text either side of it belongs to different columns. The widest
 * fragment is the name, because the junk is by nature a glyph or two.
 */
function widestColumn(raw: string): string {
  return raw
    .split(/\s{4,}/)
    .map((part) => part.trim())
    .reduce((widest, part) => (part.length > widest.length ? part : widest), '');
}

function asNameCandidate(line: string): string | null {
  const raw = widestColumn(line);

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
function findFullName(
  lines: string[],
  numberLineIndex: number,
): {
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

// ---------------------------------------------------------------------------
// Recognizer confidence
// ---------------------------------------------------------------------------

/**
 * Did the recognizer itself struggle with the glyphs behind this value?
 *
 * Words are matched by the characters they contributed rather than by string
 * equality, because the value has been through normalisation - hyphens removed,
 * glyphs corrected - and no longer equals any word the recognizer emitted.
 */
function recognizerDoubts(value: string, words: OcrWord[], digitsOnly: boolean): boolean {
  const key = (text: string) =>
    digitsOnly ? coerceDigits(text) : text.toUpperCase().replace(/[^A-Z]/g, '');

  const wanted = key(value);
  if (wanted.length === 0) return false;

  /*
   * A fragment has to be long enough to identify the field it came from.
   * Without this, `ALI` coerces to the single digit `1`, which occurs in almost
   * every identity number, and the name's confidence silently governs the
   * number's. The digit threshold is the higher of the two because there are
   * only ten digits to collide on.
   */
  const minimumFragment = digitsOnly ? 4 : 3;

  const touching = words.filter((word) => {
    // A word with no digits in it cannot be part of the number, whatever the
    // confusion table would turn its letters into.
    if (digitsOnly && !/\d/.test(word.text)) return false;

    const candidate = key(word.text);
    return candidate.length >= minimumFragment && wanted.includes(candidate);
  });

  if (touching.length === 0) return false;
  // The weakest contributing word governs: one badly read glyph is enough to
  // make the whole field wrong, and an average would hide it behind the rest.
  return Math.min(...touching.map((word) => word.confidence)) < LOW_CONFIDENCE;
}

/**
 * Read an identity number out of text that is *known* to contain nothing else.
 *
 * Used for the second, digits-only recognition pass over the number band, where
 * there is no name or address to disambiguate against and the whole point is to
 * rank the digit runs. Exported separately so that pass does not have to
 * pretend to be a whole card.
 */
export function readIdentityNumber(rawText: string): { value: string | null; certain: boolean } {
  const found = findIdentityNumber((rawText ?? '').split(/\r?\n/));
  return { value: found.value, certain: found.certain };
}

export interface ParseIcOptions {
  /** Per-word confidence from the recognizer, when available. */
  words?: OcrWord[];
}

export function parseIcText(rawText: string, options: ParseIcOptions = {}): ParsedIcFields {
  const lines = (rawText ?? '').split(/\r?\n/);
  const words = options.words ?? [];

  const identity = findIdentityNumber(lines);
  const name = findFullName(lines, identity.lineIndex);

  const uncertain: ParsedIcFields['uncertain'] = [];

  // Two independent ways to doubt a field: the shape of the result, and how
  // sure the recognizer was of the pixels behind it. Either one flags it.
  if (identity.value && (!identity.certain || recognizerDoubts(identity.value, words, true))) {
    uncertain.push('identityNumber');
  }
  if (name.value && (!name.certain || recognizerDoubts(name.value, words, false))) {
    uncertain.push('fullName');
  }

  return {
    identityNumber: identity.value,
    fullName: name.value,
    uncertain,
  };
}

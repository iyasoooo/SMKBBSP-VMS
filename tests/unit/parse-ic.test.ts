import { describe, expect, it } from 'vitest';
import { parseIcText, readIdentityNumber } from '@/lib/ocr/parse-ic';

/**
 * OCR output is messy by nature, so these cases are written from what a reader
 * actually returns for a MyKad: capitals, stray punctuation, label lines, and
 * confused glyphs in the digit rows.
 *
 * The parser is assistance only. Every expectation here is about producing a
 * sensible *suggestion* and being honest about confidence - never about
 * verifying anything.
 */

const TYPICAL = `
KAD PENGENALAN
MALAYSIA
880101-14-5523
NURUL HUDA BINTI ISMAIL
NO 12 JALAN MELATI
WARGANEGARA
PEREMPUAN  ISLAM
`;

describe('parseIcText', () => {
  it('reads a hyphenated identity number and strips the formatting', () => {
    const parsed = parseIcText(TYPICAL);
    expect(parsed.identityNumber).toBe('880101145523');
  });

  it('reads the cardholder name and ignores the printed card labels', () => {
    const parsed = parseIcText(TYPICAL);
    expect(parsed.fullName).toBe('NURUL HUDA BINTI ISMAIL');
  });

  it('treats a clean hyphenated read as certain', () => {
    expect(parseIcText(TYPICAL).uncertain).toEqual([]);
  });

  it('accepts an unhyphenated 12-digit run', () => {
    expect(parseIcText('880101145523\nAHMAD BIN ALI').identityNumber).toBe('880101145523');
  });

  it('recovers glyph-confused digits but flags the result as uncertain', () => {
    // O for 0, I for 1, S for 5 - the classic misreads on a worn card.
    const parsed = parseIcText('88O1O1-14-55Z3\nAHMAD BIN ALI');
    expect(parsed.identityNumber).toBe('880101145523');
    expect(parsed.uncertain).toContain('identityNumber');
  });

  it('returns null rather than guessing when no number is present', () => {
    const parsed = parseIcText('KAD PENGENALAN\nMALAYSIA');
    expect(parsed.identityNumber).toBeNull();
  });

  it('does not mistake a short digit run for an identity number', () => {
    expect(parseIcText('NO 12 JALAN MELATI 43300').identityNumber).toBeNull();
  });

  it('does not absorb a 13-digit run', () => {
    expect(parseIcText('8801011455231').identityNumber).toBeNull();
  });

  it('flags a single-word name as uncertain', () => {
    const parsed = parseIcText('880101-14-5523\nRAJESWARI');
    expect(parsed.fullName).toBe('RAJESWARI');
    expect(parsed.uncertain).toContain('fullName');
  });

  it('keeps the punctuation Malaysian names legitimately contain', () => {
    const parsed = parseIcText('880101-14-5523\nRAJESH A/L MANICKAM');
    expect(parsed.fullName).toBe('RAJESH A/L MANICKAM');
  });

  it('skips address lines, which carry digits', () => {
    const parsed = parseIcText('880101-14-5523\nNO 12 JALAN MELATI 43300 SERI KEMBANGAN\nSITI NORAINI');
    expect(parsed.fullName).not.toContain('JALAN');
  });

  /**
   * The card prints the address directly under the name, and its final line is
   * a state or federal territory in the same capitals with no digits. The
   * original "longest capitalised line" rule therefore returned the state
   * whenever the holder's name was shorter than it - and called it certain.
   */
  const FULL_CARD = (name: string) => `KAD PENGENALAN
MALAYSIA
880101-14-5523
${name}
NO 12 JALAN MELATI 2
TAMAN SRI PETALING
KUALA LUMPUR
WILAYAH PERSEKUTUAN
PEREMPUAN  ISLAM
WARGANEGARA`;

  it('prefers the line under the number over a longer state line', () => {
    expect(parseIcText(FULL_CARD('SITI NORAINI')).fullName).toBe('SITI NORAINI');
  });

  it('does not return a state or federal territory as the name', () => {
    for (const name of ['SITI NORAINI', 'LEE WEI MING', 'NURUL HUDA BINTI ISMAIL']) {
      const parsed = parseIcText(FULL_CARD(name));
      expect(parsed.fullName).toBe(name);
    }
  });

  it('rejects a state line even when it is the only candidate left', () => {
    const parsed = parseIcText('880101-14-5523\nSELANGOR DARUL EHSAN');
    expect(parsed.fullName).toBeNull();
  });

  it('keeps place words that are also genuine given names', () => {
    // `AMAN` and `IMAN` occur in real names, so they are deliberately absent
    // from the place list even though states append them.
    const parsed = parseIcText(FULL_CARD('NUR IMAN BINTI AMAN'));
    expect(parsed.fullName).toBe('NUR IMAN BINTI AMAN');
  });

  it('skips a label printed between the number and the name', () => {
    const parsed = parseIcText('880101-14-5523\nWARGANEGARA\nAHMAD BIN ALI');
    expect(parsed.fullName).toBe('AHMAD BIN ALI');
  });

  it('never reports a name found without a number anchor as certain', () => {
    const parsed = parseIcText('KAD PENGENALAN\nAHMAD BIN ALI');
    expect(parsed.fullName).toBe('AHMAD BIN ALI');
    expect(parsed.uncertain).toContain('fullName');
  });

  it('handles empty and whitespace input without throwing', () => {
    for (const input of ['', '   ', '\n\n']) {
      const parsed = parseIcText(input);
      expect(parsed.identityNumber).toBeNull();
      expect(parsed.fullName).toBeNull();
    }
  });

  it('never returns a partially formatted number', () => {
    const parsed = parseIcText(TYPICAL);
    expect(parsed.identityNumber).toMatch(/^\d{12}$/);
  });

  it('accepts a number whose hyphens were read as spaces', () => {
    // An everyday OCR result, and no glyph was guessed, so it is not doubtful.
    const parsed = parseIcText('880101 14 5523\nAHMAD BIN ALI');
    expect(parsed.identityNumber).toBe('880101145523');
    expect(parsed.uncertain).not.toContain('identityNumber');
  });

  /*
   * A hyphen on a glared or blurred card comes back as `.`, as a space, or as
   * nothing. Rejecting those readings threw away otherwise perfect digits -
   * observed directly: a card whose number read `820101.14 5622` produced no
   * number at all, because of the full stop alone.
   */
  it.each([
    ['880101-14-5523', 'hyphens as printed'],
    ['880101.14.5523', 'hyphens read as full stops'],
    ['880101 14 5523', 'hyphens read as spaces'],
    ['880101.14 5523', 'a mixture of both'],
    ['880101145523', 'no separators at all'],
  ])('reads %s (%s)', (line) => {
    expect(parseIcText(`${line}\nAHMAD BIN ALI`).identityNumber).toBe('880101145523');
  });

  it('does not find a 6-2-4 grouping inside a longer digit run', () => {
    // Without the lookarounds the pattern would carve an identity number out
    // of any sufficiently long number printed on the card.
    expect(parseIcText('12345678901234567').identityNumber).toBeNull();
  });
});

/**
 * An NRIC is `YYMMDD-PB-###G`, and both leading groups are constrained. Using
 * that turns a misread from something only a person can notice into something
 * the parser can rank - which is the whole point, because a regex cannot tell
 * `880101` from `88O1O1` but a calendar can.
 *
 * These are plausibility tests only. Nothing is inferred from an identity
 * number, and no value derived here is stored, shown, or returned.
 */
describe('structural plausibility', () => {
  it('still returns an impossible month, but stops calling it certain', () => {
    const parsed = parseIcText('881301-14-5523\nAHMAD BIN ALI');
    // Returned, because a person is about to review and correct it. Flagged,
    // because month 13 means at least one digit was misread.
    expect(parsed.identityNumber).toBe('881301145523');
    expect(parsed.uncertain).toContain('identityNumber');
  });

  it('flags an impossible day', () => {
    expect(parseIcText('880132-14-5523\nAHMAD BIN ALI').uncertain).toContain('identityNumber');
  });

  it('flags a birthplace code that is never issued', () => {
    // 17 is not an allocated code; 14 is Kuala Lumpur.
    expect(parseIcText('880101-17-5523\nAHMAD BIN ALI').uncertain).toContain('identityNumber');
    expect(parseIcText('880101-14-5523\nAHMAD BIN ALI').uncertain).not.toContain('identityNumber');
  });

  it('prefers a structurally sound number over an earlier unsound one', () => {
    // The unsound run comes first, so a first-match rule would return it.
    const parsed = parseIcText(`KAD PENGENALAN
991345678901
880101-14-5523
AHMAD BIN ALI`);
    expect(parsed.identityNumber).toBe('880101145523');
  });

  it('anchors the name to the number it actually chose', () => {
    const parsed = parseIcText(`991345678901
NOT THE NAME LINE
880101-14-5523
AHMAD BIN ALI`);
    expect(parsed.fullName).toBe('AHMAD BIN ALI');
  });

  it('prefers a clean reading over a glyph-repaired one', () => {
    const parsed = parseIcText(`88O1O1-14-55Z3
880101-14-5523
AHMAD BIN ALI`);
    expect(parsed.identityNumber).toBe('880101145523');
    expect(parsed.uncertain).not.toContain('identityNumber');
  });
});

/**
 * The recognizer reports how sure it was of each word, and that outranks every
 * heuristic in the parser: a value can be perfectly shaped and still be built
 * from glyphs the reader barely saw. Before this, such a value was reported as
 * certain purely because it matched a pattern.
 */
describe('recognizer confidence', () => {
  const CLEAN = '880101-14-5523\nAHMAD BIN ALI';

  const words = (confidence: number) => [
    { text: '880101-14-5523', confidence },
    { text: 'AHMAD', confidence: 96 },
    { text: 'BIN', confidence: 95 },
    { text: 'ALI', confidence: 97 },
  ];

  it('flags a well-shaped number the reader was unsure of', () => {
    const parsed = parseIcText(CLEAN, { words: words(41) });
    expect(parsed.identityNumber).toBe('880101145523');
    expect(parsed.uncertain).toContain('identityNumber');
  });

  it('leaves a confidently read number unflagged', () => {
    const parsed = parseIcText(CLEAN, { words: words(94) });
    expect(parsed.uncertain).toEqual([]);
  });

  it('flags only the field the reader struggled with', () => {
    const parsed = parseIcText(CLEAN, { words: words(41) });
    expect(parsed.uncertain).not.toContain('fullName');
  });

  it('judges a name by its weakest word, not its average', () => {
    // Three strong words would carry a mean well above the threshold, but one
    // unreadable word is enough to make the whole name wrong.
    const parsed = parseIcText(CLEAN, {
      words: [
        { text: '880101-14-5523', confidence: 95 },
        { text: 'AHMAD', confidence: 96 },
        { text: 'BIN', confidence: 95 },
        { text: 'ALI', confidence: 22 },
      ],
    });
    expect(parsed.uncertain).toContain('fullName');
    expect(parsed.uncertain).not.toContain('identityNumber');
  });

  it('behaves exactly as before when no confidence is supplied', () => {
    expect(parseIcText(CLEAN).uncertain).toEqual([]);
  });
});

describe('readIdentityNumber', () => {
  it('reads the number from a digits-only second pass', () => {
    const refined = readIdentityNumber('880101-14-5523');
    expect(refined.value).toBe('880101145523');
    expect(refined.certain).toBe(true);
  });

  it('refuses to call a structurally impossible re-read certain', () => {
    // The caller adopts a second-pass result only when it is certain, so this
    // is what stops a bad re-read from overwriting a good first pass.
    expect(readIdentityNumber('881345-99-5523').certain).toBe(false);
  });

  it('returns nothing when the band held no number', () => {
    expect(readIdentityNumber('-- ---- --').value).toBeNull();
  });
});

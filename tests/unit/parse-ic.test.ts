import { describe, expect, it } from 'vitest';
import { parseIcText } from '@/lib/ocr/parse-ic';

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
});

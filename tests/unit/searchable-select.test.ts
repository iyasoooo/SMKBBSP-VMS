import { describe, expect, it } from 'vitest';
import { filterOptions, type SearchableOption } from '@/components/ui/searchable-select';

/**
 * The destination picker's matching rules.
 *
 * These are written from the school's actual room list, because that is where
 * the rules broke. Ninety places, most of them named "Bilik <something>" in
 * Malay and "<something> room" in English, spread across three blocks - a
 * naive substring match returns half the school for a two-word query, and the
 * failure is invisible against a handful of test fixtures.
 */

const option = (
  label: string,
  detail?: string,
  keywords?: string,
): SearchableOption => ({ value: label, label, detail, keywords });

const SCHOOL: SearchableOption[] = [
  option('Science Lab B', 'Ground floor · Block B', 'Makmal Sains B'),
  option('Science Lab C', 'Ground floor · Block B', 'Makmal Sains C'),
  option('Biology Lab', 'Level 1 · Block C', 'Makmal Biologi'),
  option('Library / Resource Centre', 'Level 1 · Block B', 'Pusat Sumber'),
  option('Canteen', 'Ground floor', 'Kantin'),
  option('Ablution room', 'Level 3 · Block A', 'Bilik Wuduk'),
  option('Bilik Juara', 'Ground floor · Block B', 'Bilik Juara'),
];

const labels = (rows: SearchableOption[]) => rows.map((row) => row.label);

describe('filterOptions', () => {
  it('returns everything when nothing has been typed', () => {
    expect(filterOptions(SCHOOL, '')).toHaveLength(SCHOOL.length);
    expect(filterOptions(SCHOOL, '   ')).toHaveLength(SCHOOL.length);
  });

  it('hides the "no preference" row as soon as a query is typed', () => {
    const withEmpty = [{ value: '', label: 'Not sure / to be advised' }, ...SCHOOL];
    expect(filterOptions(withEmpty, '')).toHaveLength(withEmpty.length);
    expect(labels(filterOptions(withEmpty, 'canteen'))).toEqual(['Canteen']);
  });

  it('matches the English name', () => {
    expect(labels(filterOptions(SCHOOL, 'library'))).toEqual(['Library / Resource Centre']);
  });

  /*
   * The reason the Malay name is carried at all. A parent told to go to "Bilik
   * Sains" types that, not "Science Lab" - before the names were indexed this
   * returned nothing at all, which reads as "the school has no such room".
   */
  it('matches the Malay name, which is what a visitor is usually given', () => {
    expect(labels(filterOptions(SCHOOL, 'sains'))).toEqual(['Science Lab B', 'Science Lab C']);
    expect(labels(filterOptions(SCHOOL, 'kantin'))).toEqual(['Canteen']);
  });

  it('matches on where the room is, not only what it is called', () => {
    expect(labels(filterOptions(SCHOOL, 'ground'))).toEqual([
      'Science Lab B',
      'Science Lab C',
      'Canteen',
      'Bilik Juara',
    ]);
  });

  it('anchors to the start of a word rather than anywhere inside one', () => {
    // "ains" is inside "Sains" but starts no word, so it is not a match.
    expect(filterOptions(SCHOOL, 'ains')).toEqual([]);
    expect(filterOptions(SCHOOL, 'sain')).not.toEqual([]);
  });

  /*
   * The first bug. Every row carrying a block has the token "block", and a
   * substring match let the trailing `b` be satisfied by that same token, so
   * "block b" returned every room in the school.
   */
  it('requires each word to claim a different token', () => {
    const found = filterOptions(SCHOOL, 'block b');
    expect(labels(found)).toEqual(['Science Lab B', 'Science Lab C', 'Library / Resource Centre', 'Bilik Juara']);
    expect(found.every((row) => row.detail?.includes('Block B'))).toBe(true);
  });

  /*
   * The second bug. `b` prefix-matches "Bilik", which begins almost every Malay
   * room name, so "lab b" led with Biology Lab in a different block entirely.
   */
  it('treats a single letter as a whole token, not a prefix', () => {
    /*
     * "lab b" is genuinely ambiguous - it can mean Lab B, or a lab in Block B -
     * and both readings are in this list, so both are returned with Lab B
     * first. What matters is what is *absent*: Biology Lab, in Block C, which
     * led these results while `b` was still prefix-matching "Biology".
     */
    const found = labels(filterOptions(SCHOOL, 'lab b'));
    expect(found).toEqual(['Science Lab B', 'Science Lab C']);
    expect(found).not.toContain('Biology Lab');
    // "Bilik Wuduk" and "Bilik Juara" both begin with b and must not match.
    expect(labels(filterOptions(SCHOOL, 'b'))).toEqual([
      'Science Lab B',
      'Science Lab C',
      'Library / Resource Centre',
      'Bilik Juara',
    ]);
  });

  it('narrows as words are added rather than widening', () => {
    const one = filterOptions(SCHOOL, 'lab');
    const two = filterOptions(SCHOOL, 'lab science');
    expect(two.length).toBeLessThan(one.length);
    expect(labels(two)).toEqual(['Science Lab B', 'Science Lab C']);
  });

  it('is case and punctuation insensitive', () => {
    expect(labels(filterOptions(SCHOOL, 'LIBRARY'))).toEqual(['Library / Resource Centre']);
    expect(labels(filterOptions(SCHOOL, 'resource'))).toEqual(['Library / Resource Centre']);
  });

  it('returns nothing rather than guessing when a word matches no room', () => {
    expect(filterOptions(SCHOOL, 'swimming pool')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { extractJsonObject } from '@/lib/ocr/ollama';

/**
 * A language model reading an identity card fails differently from a text
 * recognizer, and these are the two places that difference has to be caught.
 *
 * A recognizer that cannot read a digit returns something obviously wrong. A
 * model returns a *well-formed* identity number that nobody printed, wrapped in
 * whatever prose it felt like adding. So there are two jobs: get the object out
 * of the surrounding chatter without being fooled by it, and refuse anything
 * that could not be a real card - which is the only evidence left once
 * per-character confidence is gone.
 */

describe('extractJsonObject', () => {
  it('reads a bare object', () => {
    expect(extractJsonObject('{"card":"ic","id":"900101-14-5523","name":"SITI"}')).toEqual({
      card: 'ic',
      id: '900101-14-5523',
      name: 'SITI',
    });
  });

  it('reads an object inside a fenced code block', () => {
    // The shape the model actually returned in testing, despite being asked
    // for JSON only. Treating this as a failure would discard good readings.
    const raw = '```json\n{\n  "card": "ic",\n  "id": "900101-14-5523",\n  "name": "SITI"\n}\n```';

    expect(extractJsonObject(raw)).toEqual({
      card: 'ic',
      id: '900101-14-5523',
      name: 'SITI',
    });
  });

  it('reads an object introduced by prose', () => {
    const raw = 'Here is the information from the card:\n{"card":"ic","id":"1","name":"A"}\nHope that helps!';
    expect(extractJsonObject(raw)).toEqual({ card: 'ic', id: '1', name: 'A' });
  });

  it('handles a nested object without stopping at the inner brace', () => {
    expect(extractJsonObject('{"a":{"b":1},"c":2}')).toEqual({ a: { b: 1 }, c: 2 });
  });

  it('is not fooled by a brace inside a string', () => {
    // Depth counting that ignores string literals would cut the object short
    // here and lose every field after the brace.
    expect(extractJsonObject('{"name":"WEIRD } NAME","id":"7"}')).toEqual({
      name: 'WEIRD } NAME',
      id: '7',
    });
  });

  it('is not fooled by an escaped quote', () => {
    expect(extractJsonObject('{"name":"O\\"BRIEN","id":"7"}')).toEqual({
      name: 'O"BRIEN',
      id: '7',
    });
  });

  it('returns null when the model answered with prose only', () => {
    expect(extractJsonObject('I am sorry, I cannot read this image.')).toBeNull();
  });

  it('returns null for a truncated object', () => {
    // A generation that hit its token limit mid-object. Better nothing than a
    // half-read card.
    expect(extractJsonObject('{"card":"ic","id":"900101-14-55')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJsonObject('{card: ic, id: 900101}')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractJsonObject('')).toBeNull();
  });
});

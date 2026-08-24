import { describe, expect, it } from 'vitest';
import { combineReadings, type FrameReading } from '@/lib/ocr/consensus';
import { coverCrop, sharpnessScore, CARD_ASPECT } from '@/lib/ocr/prepare-image';

/**
 * Voting across camera frames is the one accuracy gain a live camera offers
 * that a chosen photograph cannot, so it is worth pinning precisely - including
 * the cases where it must *refuse* to be confident.
 */

const frame = (
  identityNumber: string | null,
  fullName: string | null,
  confidence = 90,
  uncertain: Array<'identityNumber' | 'fullName'> = [],
): FrameReading => ({
  fields: { identityNumber, fullName, uncertain },
  confidence,
});

describe('combineReadings', () => {
  it('accepts a value every frame agreed on', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('880101145523', 'AHMAD BIN ALI'),
    ]);

    expect(combined.identityNumber).toBe('880101145523');
    expect(combined.uncertain).toEqual([]);
  });

  it('takes the majority reading when one frame disagrees', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('820101145622', 'AHMAD BIN ALI'),
    ]);

    expect(combined.identityNumber).toBe('880101145523');
  });

  it('flags a majority reading, because a disagreeing frame is evidence', () => {
    // The digits two frames read differently are exactly the digits nobody
    // should trust, even though one reading clearly won the vote.
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('820101145622', 'AHMAD BIN ALI'),
    ]);

    expect(combined.uncertain).toContain('identityNumber');
    // The name was unanimous, so it is not dragged down with the number.
    expect(combined.uncertain).not.toContain('fullName');
  });

  it('flags a value no other frame corroborated', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI'),
      frame(null, 'AHMAD BIN ALI'),
      frame(null, 'AHMAD BIN ALI'),
    ]);

    expect(combined.identityNumber).toBe('880101145523');
    expect(combined.uncertain).toContain('identityNumber');
  });

  it('breaks a tied vote with the recognizer confidence', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI', 94),
      frame('820101145622', 'AHMAD BIN ALI', 51),
    ]);

    expect(combined.identityNumber).toBe('880101145523');
    // Tied votes are never presented as settled.
    expect(combined.uncertain).toContain('identityNumber');
  });

  it('does not trust agreement about something every frame doubted', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI', 90, ['identityNumber']),
      frame('880101145523', 'AHMAD BIN ALI', 90, ['identityNumber']),
    ]);

    expect(combined.identityNumber).toBe('880101145523');
    expect(combined.uncertain).toContain('identityNumber');
  });

  it('accepts a value one frame read cleanly and another merely doubted', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('880101145523', 'AHMAD BIN ALI', 90, ['identityNumber']),
    ]);

    expect(combined.uncertain).not.toContain('identityNumber');
  });

  it('behaves like a single reading when only one frame is usable', () => {
    // The chosen-photograph path goes through here too, and must not be made
    // doubtful merely for lack of a second frame.
    const combined = combineReadings([frame('880101145523', 'AHMAD BIN ALI')]);

    expect(combined.identityNumber).toBe('880101145523');
    expect(combined.uncertain).toEqual([]);
  });

  it('returns nothing when no frame read anything', () => {
    const combined = combineReadings([frame(null, null), frame(null, null)]);

    expect(combined.identityNumber).toBeNull();
    expect(combined.fullName).toBeNull();
    expect(combined.uncertain).toEqual([]);
  });

  it('handles an empty burst', () => {
    expect(combineReadings([]).identityNumber).toBeNull();
  });

  it('decides the two fields independently', () => {
    const combined = combineReadings([
      frame('880101145523', 'AHMAD BIN ALI'),
      frame('880101145523', 'AHMAD BIN ALL'),
      frame('880101145523', 'AHMAD BIN ALI'),
    ]);

    expect(combined.identityNumber).toBe('880101145523');
    expect(combined.fullName).toBe('AHMAD BIN ALI');
    expect(combined.uncertain).toEqual(['fullName']);
  });
});

/**
 * The viewfinder shows a card-shaped crop of a 16:9 camera frame, so the
 * frame's sides are off-screen. Recognising the whole frame would read a strip
 * of desk the person framing the shot never saw and had no chance to keep clear.
 */
describe('coverCrop', () => {
  it('clips the sides of a source wider than the box', () => {
    const crop = coverCrop(1920, 1080, CARD_ASPECT);

    expect(crop.sHeight).toBe(1080);
    expect(crop.sWidth).toBeCloseTo(1080 * CARD_ASPECT, 5);
    // Centred, so equal amounts are lost from each side.
    expect(crop.sx).toBeCloseTo((1920 - 1080 * CARD_ASPECT) / 2, 5);
    expect(crop.sy).toBe(0);
  });

  it('clips the top and bottom of a source taller than the box', () => {
    const crop = coverCrop(1080, 1920, CARD_ASPECT);

    expect(crop.sWidth).toBe(1080);
    expect(crop.sHeight).toBeCloseTo(1080 / CARD_ASPECT, 5);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBeCloseTo((1920 - 1080 / CARD_ASPECT) / 2, 5);
  });

  it('keeps the whole source when the aspects already match', () => {
    const crop = coverCrop(1586, 1000, 1.586);

    expect(crop.sx).toBeCloseTo(0, 5);
    expect(crop.sy).toBeCloseTo(0, 5);
    expect(crop.sWidth).toBeCloseTo(1586, 5);
    expect(crop.sHeight).toBeCloseTo(1000, 5);
  });

  it('never proposes a region outside the source', () => {
    const sizes: Array<[number, number]> = [
      [1920, 1080],
      [1280, 720],
      [640, 480],
      [1080, 1920],
      [4032, 3024],
    ];

    for (const [w, h] of sizes) {
      const crop = coverCrop(w, h, CARD_ASPECT);
      expect(crop.sx).toBeGreaterThanOrEqual(0);
      expect(crop.sy).toBeGreaterThanOrEqual(0);
      expect(crop.sx + crop.sWidth).toBeLessThanOrEqual(w + 0.001);
      expect(crop.sy + crop.sHeight).toBeLessThanOrEqual(h + 0.001);
    }
  });
});

/**
 * Only the ordering of these values is ever relied on - the burst keeps its
 * sharpest frames and discards the rest - so that is what is tested, rather
 * than any absolute figure.
 */
describe('sharpnessScore', () => {
  const size = 40;

  /** Hard black and white stripes: maximum high-frequency detail. */
  const sharp = () => {
    const grey = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) grey[y * size + x] = x % 4 < 2 ? 0 : 255;
    }
    return grey;
  };

  /** The same stripes as a smooth ramp: the same shapes, no sharp edges. */
  const soft = () => {
    const grey = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) grey[y * size + x] = Math.round((x / size) * 255);
    }
    return grey;
  };

  it('scores a crisp image above a soft one', () => {
    expect(sharpnessScore(sharp(), size, size)).toBeGreaterThan(
      sharpnessScore(soft(), size, size),
    );
  });

  it('scores flat, featureless input at zero', () => {
    expect(sharpnessScore(new Uint8Array(size * size).fill(128), size, size)).toBe(0);
  });

  it('does not divide by zero on input too small to have an interior', () => {
    expect(sharpnessScore(new Uint8Array(1), 1, 1)).toBe(0);
  });
});

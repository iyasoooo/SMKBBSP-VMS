import { describe, expect, it } from 'vitest';
import { coverCrop, sharpnessScore, CARD_ASPECT } from '@/lib/ocr/prepare-image';

/**
 * The image preparation that still runs in the browser.
 *
 * Reading a card moved to a model host, but the geometry did not: what gets
 * cropped out of a camera frame, and whether a photo was sharp enough to be
 * worth sending, are both decided here. A crop that disagrees with the
 * viewfinder sends a strip of desk to be read, and a blur measure that reports
 * nothing lets an illegible photo through without a warning - neither fails
 * loudly, so both are pinned.
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

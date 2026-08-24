/**
 * Turn a photograph or a camera frame into something a text recogniser can read.
 *
 * Separated from the React component for two reasons: the geometry and the
 * pixel work are the parts most likely to be wrong, and neither needs a
 * component to be tested. Everything here runs in the browser and touches only
 * a canvas - no image ever leaves the device, and nothing is persisted.
 */

/**
 * The width band the reader is actually given.
 *
 * Recognition cost scales with pixel count, and a modern phone camera produces
 * something like 4000x3000 - twelve megapixels of which the card is a fraction.
 * Handing that over unchanged is what makes a scan take tens of seconds, and it
 * buys nothing: a card filling most of the frame still has far more than the
 * ~30px of glyph height Tesseract needs once it is down at 2000px. The lower
 * bound covers the opposite case, a small or already-downscaled photo.
 */
export const MIN_WIDTH = 1400;
export const MAX_WIDTH = 2000;

/**
 * Window for the local threshold, as a fraction of image width. Wide enough to
 * span several characters plus their background, narrow enough that the card's
 * photo does not influence the text beside it.
 */
const THRESHOLD_WINDOW = 0.125;

/** How far below the local mean a pixel must sit to count as ink. */
const THRESHOLD_BIAS = 0.86;

/** Below this the photo is soft enough that a misread is likely. */
export const BLUR_THRESHOLD = 60;

/**
 * A MyKad is 85.6mm x 54mm, so the printed card is this many times wider than
 * it is tall. The viewfinder is cut to the same shape, which is what lets the
 * capture crop assume the card fills the frame.
 */
export const CARD_ASPECT = 85.6 / 54;

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  /** Measured before binarisation, which would destroy the signal. */
  sharpness: number;
}

export interface CropRect {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
}

/**
 * The part of a source image that is actually visible when it is displayed
 * with `object-fit: cover` inside a box of `targetAspect`.
 *
 * The viewfinder shows a card-shaped crop of a camera frame that is typically
 * 16:9, so the frame's left and right edges are off-screen. Recognising the
 * whole frame would therefore read a strip of desk or lap that the person
 * framing the shot could not see and had no chance to keep clear. This computes
 * exactly what they *did* see, so the crop and the viewfinder cannot disagree.
 */
export function coverCrop(width: number, height: number, targetAspect: number): CropRect {
  const sourceAspect = width / height;

  if (sourceAspect > targetAspect) {
    // Source is wider than the box: full height, sides clipped.
    const sWidth = height * targetAspect;
    return { sx: (width - sWidth) / 2, sy: 0, sWidth, sHeight: height };
  }

  // Source is taller than the box: full width, top and bottom clipped.
  const sHeight = width / targetAspect;
  return { sx: 0, sy: (height - sHeight) / 2, sWidth: width, sHeight };
}

/**
 * How much high-frequency detail a greyscale carries, as the variance of its
 * Laplacian.
 *
 * Blur is the failure this feature cannot recover from: binarising a soft photo
 * produces confident-looking output built from glyphs that were never legible.
 * Measuring it serves two purposes - advising that a photo be retaken, and
 * choosing between camera frames, where only the *relative* values matter and
 * no threshold has to be trusted at all.
 */
export function sharpnessScore(grey: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  // Interior pixels only, so the 4-neighbour kernel needs no bounds checks.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      const laplacian =
        4 * (grey[p] ?? 0) -
        (grey[p - 1] ?? 0) -
        (grey[p + 1] ?? 0) -
        (grey[p - width] ?? 0) -
        (grey[p + width] ?? 0);

      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/** Rec. 601 luma, which is what Tesseract's own greyscale conversion uses. */
function toGreyscale(data: Uint8ClampedArray, pixels: number): Uint8Array {
  const grey = new Uint8Array(pixels);

  for (let p = 0; p < pixels; p += 1) {
    const i = p * 4;
    grey[p] = ((data[i] ?? 0) * 299 + (data[i + 1] ?? 0) * 587 + (data[i + 2] ?? 0) * 114) / 1000;
  }

  return grey;
}

/**
 * Binarise with a *local* threshold.
 *
 * This replaces a global min-max contrast stretch, which was close to useless
 * on a real card. A MyKad carries a dark portrait over roughly a fifth of its
 * face, so the darkest pixel in the image comes from the photograph, not the
 * text: the measured range was already near 0-255 and the stretch therefore did
 * almost nothing to the text region it was supposed to help. Any single global
 * threshold has the same problem, including the Otsu pass Tesseract runs
 * internally - it lands somewhere between "portrait" and "card", not between
 * "ink" and "paper".
 *
 * A per-pixel threshold taken from the neighbourhood mean (Bradley's method,
 * via an integral image so the window cost is constant) sidesteps all of it,
 * and handles the glare and uneven lighting of a handheld photo at the same
 * time - the two conditions a global threshold handles worst.
 */
function binarise(context: CanvasRenderingContext2D, width: number, height: number): number {
  const image = context.getImageData(0, 0, width, height);
  const { data } = image;

  const grey = toGreyscale(data, width * height);

  // Taken from the greyscale, before the threshold below turns every pixel into
  // pure black or white and erases the gradients it measures.
  const sharpness = sharpnessScore(grey, width, height);

  /*
   * Summed-area table, one row and column of zero padding so the window sum
   * needs no bounds checks. A Uint32 cannot overflow here: the largest
   * possible total is 255 x 2000 x 2000, comfortably inside 2^32.
   */
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += grey[y * width + x] ?? 0;
      integral[(y + 1) * (width + 1) + (x + 1)] =
        (integral[y * (width + 1) + (x + 1)] ?? 0) + rowSum;
    }
  }

  const radius = Math.max(8, Math.round((width * THRESHOLD_WINDOW) / 2));

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);

      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        (integral[(y1 + 1) * (width + 1) + (x1 + 1)] ?? 0) -
        (integral[y0 * (width + 1) + (x1 + 1)] ?? 0) -
        (integral[(y1 + 1) * (width + 1) + x0] ?? 0) +
        (integral[y0 * (width + 1) + x0] ?? 0);

      // pixel < mean * bias, with the division folded away: the local mean is
      // sum/area, so multiplying both sides by area keeps this in integers.
      const p = y * width + x;
      const ink = (grey[p] ?? 0) * area < sum * THRESHOLD_BIAS;
      const value = ink ? 0 : 255;

      const i = p * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }

  context.putImageData(image, 0, 0);
  return sharpness;
}

/** The scaled canvas dimensions for a source region of the given width. */
function targetSize(sWidth: number, sHeight: number): { width: number; height: number } {
  const target = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, sWidth));
  const scale = target / sWidth;
  return { width: Math.round(sWidth * scale), height: Math.round(sHeight * scale) };
}

function draw(
  source: CanvasImageSource,
  crop: CropRect,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const { width, height } = targetSize(crop.sWidth, crop.sHeight);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2d canvas context unavailable');

  context.imageSmoothingQuality = 'high';
  context.drawImage(source, crop.sx, crop.sy, crop.sWidth, crop.sHeight, 0, 0, width, height);

  return { canvas, context };
}

/** Prepare a chosen or dropped photograph. The whole image is used. */
export async function prepareFile(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);

  try {
    const { canvas, context } = draw(bitmap, {
      sx: 0,
      sy: 0,
      sWidth: bitmap.width,
      sHeight: bitmap.height,
    });

    return { canvas, sharpness: binarise(context, canvas.width, canvas.height) };
  } finally {
    // Free the decoded frame straight away; a card photo is several megabytes.
    bitmap.close();
  }
}

/**
 * Prepare one live camera frame, cropped to exactly what the viewfinder showed.
 *
 * Synchronous by design. Grabbing a burst of frames means reading them as fast
 * as the camera produces them, and an `await` between `drawImage` calls would
 * let the video advance mid-burst.
 */
export function prepareVideoFrame(video: HTMLVideoElement): PreparedImage {
  const crop = coverCrop(video.videoWidth, video.videoHeight, CARD_ASPECT);
  const { canvas, context } = draw(video, crop);

  return { canvas, sharpness: binarise(context, canvas.width, canvas.height) };
}

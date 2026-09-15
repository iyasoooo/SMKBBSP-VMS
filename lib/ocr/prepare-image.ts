/**
 * Turn a photograph or a camera frame into something a card reader can read.
 *
 * Separated from the React component for two reasons: the geometry and the
 * pixel work are the parts most likely to be wrong, and neither needs a
 * component to be tested.
 *
 * Note what this file no longer promises. Reading now happens on a model host
 * the server talks to, so the prepared image *does* leave the device - it is
 * posted to `app/api/ocr/route.ts`, held for one request and dropped. The work
 * here is what keeps that trip small and legible: crop to what the viewfinder
 * showed, scale to a sane size, and measure whether the photo was sharp enough
 * to be worth sending at all.
 */

/**
 * The width band the reader is actually given.
 *
 * A modern phone camera produces something like 4000x3000 - twelve megapixels
 * of which the card is a fraction - and handing that over unchanged costs
 * memory and time for nothing.
 *
 * 2000 also bounds the upload. A card filling the frame at this width is about
 * 1260 pixels tall, which leaves the identity number roughly 60 pixels high -
 * comfortably legible - while keeping the encoded image to a few hundred
 * kilobytes. That matters more than it looks: the photo now travels to a model
 * host over a school's wifi, and a twelve-megapixel original would spend longer
 * in transit than the model spends reading it. The lower bound covers the
 * opposite case, a small or already-downscaled photo.
 */
export const MIN_WIDTH = 1400;
export const MAX_WIDTH = 2000;

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
  /** Laplacian variance of the prepared image; only relative values matter. */
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
 * Blur is the failure this feature cannot recover from: a soft photo still
 * produces confident-looking output, assembled from glyphs that were never
 * legible in the first place. Measuring it serves two purposes - advising that
 * a photo be retaken, and choosing between camera frames, where only the
 * *relative* values matter and no threshold has to be trusted at all.
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

/** Rec. 601 luma - the standard weighting, and what the blur measure expects. */
function toGreyscale(data: Uint8ClampedArray, pixels: number): Uint8Array {
  const grey = new Uint8Array(pixels);

  for (let p = 0; p < pixels; p += 1) {
    const i = p * 4;
    grey[p] = ((data[i] ?? 0) * 299 + (data[i + 1] ?? 0) * 587 + (data[i + 2] ?? 0) * 114) / 1000;
  }

  return grey;
}

/**
 * Measure how sharp the card is, leaving the pixels untouched.
 *
 * This used to binarise as well - a local, per-pixel threshold that turned the
 * card into pure black and white before reading it. That suited a classical
 * recognizer, which thresholds internally anyway. It is wrong for a model
 * trained on ordinary photographs: shadows, glare, coloured backgrounds, the
 * lot. A binarised card is not a cleaner version of that input, it is an image
 * unlike anything the model was shown, and a threshold that clips a thin stroke
 * deletes evidence the model would otherwise have weighed - silently. Sending
 * the natural photograph lets it do the separating, which is the part it is
 * actually good at.
 *
 * The measurement survives because it never needed the threshold. It reads the
 * greyscale, and binarising was destroying the very gradients it measures.
 */
function measureSharpness(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const { data } = context.getImageData(0, 0, width, height);
  return sharpnessScore(toGreyscale(data, width * height), width, height);
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

/**
 * The browser could not decode the chosen file.
 *
 * Distinguished from every other failure because it is the only one the person
 * holding the phone can do something about, and because the honest message is
 * the opposite of the one they were getting: the card was never read, so
 * nothing about the card is wrong.
 */
export class UndecodableImageError extends Error {
  constructor() {
    super('the browser could not decode that image');
    this.name = 'UndecodableImageError';
  }
}

/** Prepare a chosen or dropped photograph. The whole image is used. */
export async function prepareFile(file: File): Promise<PreparedImage> {
  /*
   * `createImageBitmap` throws on a format this browser cannot decode, and a
   * phone's own camera roll is where that happens: iPhones and recent Samsungs
   * save HEIC, which no desktop-class browser decodes. The throw used to travel
   * up as an ordinary failure and be reported as "the card could not be read",
   * which is misleading in the worst way - it blames the document, so the
   * obvious response is to photograph it again, which produces another HEIC.
   */
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UndecodableImageError();
  }

  try {
    const { canvas, context } = draw(bitmap, {
      sx: 0,
      sy: 0,
      sWidth: bitmap.width,
      sHeight: bitmap.height,
    });

    return { canvas, sharpness: measureSharpness(context, canvas.width, canvas.height) };
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

  return { canvas, sharpness: measureSharpness(context, canvas.width, canvas.height) };
}

/**
 * Quality the prepared card is encoded at for the trip to the reader.
 *
 * High, and deliberately so. This is the one lossy step between the camera and
 * the model, and JPEG spends its error budget exactly where it hurts here - on
 * the hard edges of small glyphs, which is what the reader has to resolve. The
 * bytes saved by compressing harder are not worth a digit.
 */
const UPLOAD_QUALITY = 0.92;

/**
 * Encode a prepared card for upload.
 *
 * JPEG rather than PNG: a photograph of a card compresses to a few hundred
 * kilobytes this way against several megabytes losslessly, and the difference
 * is what makes this usable over a school's wifi from a phone at the gate.
 *
 * Nothing here writes the image anywhere. The blob exists for the duration of
 * one request and is dropped with it.
 */
export async function toUploadBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', UPLOAD_QUALITY);
  });

  if (!blob) throw new Error('the card could not be encoded');
  return blob;
}

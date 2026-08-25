/**
 * Read an identity card for the visitor form.
 *
 * The one endpoint in the application that accepts an image, and the reason the
 * privacy rules around it are spelled out rather than assumed:
 *
 *   - The image is held in memory for the duration of one request and is never
 *     written to disk, never cached and never logged. There is no upload
 *     directory, and nothing here creates one.
 *   - Nothing read off the card is persisted. The reading is returned to the
 *     browser that sent the photo, for a person to correct, and this server
 *     forgets it. The identity number reaches the database later - if at all -
 *     through the ordinary form submission, where it is encrypted like any
 *     other.
 *   - The response carries no store directive, so an intermediary cannot hold
 *     a copy of somebody's name.
 *
 * Public, because the visitor form is public: a parent filling in a request has
 * no account and cannot be asked for one. That makes the rate limit and the
 * size cap load-bearing rather than defensive - see `RATE_LIMITS.ocrScan`.
 */

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { consumeRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  isOcrConfigured,
  readCard,
  OcrFailedError,
  OcrUnavailableError,
} from '@/lib/ocr/ollama';
import { createLogger } from '@/lib/logger';

const log = createLogger('ocr');

/** Reading a card is a model call; it cannot be prerendered or cached. */
export const dynamic = 'force-dynamic';

/**
 * Largest image accepted, in bytes.
 *
 * The browser downscales to about 2000px before sending, which lands well under
 * a megabyte as JPEG. Eight is loose enough that an unexpectedly large frame
 * still works and tight enough that the endpoint cannot be used to push
 * arbitrary payloads at the model host.
 */
const MAX_BYTES = 8 * 1024 * 1024;

/** Only formats a camera actually produces. */
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    // A reading is somebody's name and identity number. Nothing between here
    // and the browser may keep it.
    headers: { 'Cache-Control': 'no-store, private' },
  });
}

/**
 * Whether card reading is offered at all.
 *
 * Separate from the read itself, and deliberately cheap: it takes no body,
 * reaches no model host and - the part that matters - does not count against
 * the rate limit. The panel asks this when it opens, and a visitor who opens
 * and closes it a few times before taking a photo must not find they have
 * spent their scans on having looked.
 *
 * It reports only whether a reader is configured. That is not a secret, and it
 * is the one fact the browser needs in order to decide between showing a
 * dropzone and explaining that scanning is unavailable here.
 */
export async function GET(): Promise<NextResponse> {
  return json({ available: isOcrConfigured() }, isOcrConfigured() ? 200 : 503);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isOcrConfigured()) {
    // Not an error. A deployment without a model host simply has no card
    // reader, and the panel is hidden rather than offered and then broken.
    return json({ error: 'unavailable' }, 503);
  }

  const headerList = await headers();
  const ip = (headerList.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local';

  const limit = await consumeRateLimit(RATE_LIMITS.ocrScan, ip);
  if (!limit.allowed) {
    return json({ error: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds }, 429);
  }

  let image: Uint8Array;
  let type: string;

  try {
    const form = await request.formData();
    const file = form.get('image');

    if (!(file instanceof File)) return json({ error: 'no_image' }, 400);

    type = file.type;
    if (!ALLOWED_TYPES.has(type)) return json({ error: 'unsupported_type' }, 415);

    // Checked before reading the body into memory, so an oversized upload is
    // refused rather than buffered.
    if (file.size > MAX_BYTES) return json({ error: 'too_large' }, 413);

    image = new Uint8Array(await file.arrayBuffer());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (image.byteLength === 0) return json({ error: 'no_image' }, 400);

  try {
    const reading = await readCard(image);

    return json(
      {
        identityNumber: reading.identityNumber,
        fullName: reading.fullName,
        card: reading.card,
        uncertain: reading.uncertain,
      },
      200,
    );
  } catch (error) {
    if (error instanceof OcrUnavailableError) {
      // Logged without the message: it can name the host and its port.
      log.warn('model host unavailable');
      return json({ error: 'unavailable' }, 503);
    }

    if (error instanceof OcrFailedError) {
      /*
       * With the reason, unlike the unavailable case above. These messages
       * report what the model host did - a status code, an unreadable body, a
       * timeout - and never carry its address or anything read off the card,
       * so they are safe here. Without one, every distinct failure logged the
       * same four words and a genuine fault was indistinguishable from an
       * unreadable photograph.
       */
      log.warn('card read failed', { reason: error.message });
      return json({ error: 'failed' }, 502);
    }

    log.error('unexpected failure reading a card', undefined, error);
    return json({ error: 'failed' }, 500);
  }
}

/**
 * Read an identity card with a vision-language model on an Ollama host.
 *
 * This replaced a browser-side OCR pipeline (PP-OCRv5 through ONNX Runtime).
 * The reason is empirical rather than architectural: a conventional recognizer
 * transcribes lines and leaves a parser to guess which line was the name and
 * which was the number, and on a real laminated MyKad - hologram over the
 * digits, the portrait bleeding into the text column, print that is not quite
 * horizontal - that guess fails often enough to be useless. A model that
 * understands the card's *layout* reads the labels, so it knows which field it
 * is looking at instead of inferring it from position.
 *
 * The cost of that is paid in this file, and it is worth stating plainly. A
 * recognizer that misreads produces garbage a person notices. A language model
 * that misreads produces a *plausible* identity number, because producing
 * plausible text is what it does. Everything below is therefore built around
 * one assumption: the model's output is an untrusted suggestion that has to
 * survive structural validation before a person is even shown it.
 *
 * Server-only, by the same convention the rest of `lib/` follows: it reads the
 * environment and is imported by a route handler, never by a component. The
 * browser posts an image to `app/api/ocr/route.ts` and never addresses the
 * model host itself, which is what keeps `connect-src 'self'` in the content
 * security policy and stops the endpoint being reachable from a page at all.
 */

import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { readIdentityNumber } from '@/lib/ocr/parse-ic';

const log = createLogger('ocr');

/**
 * What the model is asked for, and nothing more.
 *
 * A card carries an address, a birthplace, a religion and a photograph. None of
 * those have a field on the visitor form, so none of them are requested -
 * asking for data the system has nowhere to put would mean it existed, briefly,
 * in a server's memory and possibly in a log, for no purpose at all. The card
 * type is the one extra: it is not stored either, but it catches a passport
 * scanned while the form says MyKad.
 */
const PROMPT = [
  'Read this Malaysian identity document exactly as printed.',
  'Reply with JSON only, no prose and no code fences, in this shape:',
  '{"card":"ic","id":"030520-10-3242","name":"FULL NAME AS PRINTED"}',
  '',
  '"card" is "ic" for a MyKad, "passport" for a passport, otherwise "other".',
  '"id" is the identity or passport number, copied character for character.',
  '"name" is the full name exactly as printed, in capitals.',
  'If a field is not legible, use null for that field. Never guess a digit.',
].join('\n');

/** The shape the model is asked to produce. Anything else is discarded. */
const modelReply = z.object({
  card: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(['ic', 'passport', 'other']))
    .nullish()
    .catch(null),
  id: z.string().trim().max(60).nullish().catch(null),
  name: z.string().trim().max(120).nullish().catch(null),
});

export type CardKind = 'ic' | 'passport' | 'other';

export interface CardReading {
  /** 12 digits, unformatted, or null when nothing survived validation. */
  identityNumber: string | null;
  fullName: string | null;
  /** What the model thought it was looking at, for a mismatch warning. */
  card: CardKind | null;
  /**
   * Fields the reader is least sure about.
   *
   * Where a recognizer would report its own probabilities, this is derived
   * entirely from structure - see `certainty` below for why that is the only
   * honest signal available from a language model.
   */
  uncertain: Array<'identityNumber' | 'fullName'>;
}

/**
 * Context window requested for the read, in tokens.
 *
 * A card photograph costs a few thousand tokens once the vision encoder has
 * turned it into patches, and the exact figure moves with the picture. 8192
 * clears the largest image this endpoint will accept with room to spare; see
 * the note at the call site for why the default cannot be relied on.
 */
const NUM_CTX = 8192;

/** Ollama's non-streaming generate response, of which one field is wanted. */
const generateResponse = z.object({ response: z.string() });

/** Ollama's model list, used to refuse a host that lacks the pinned model. */
const tagsResponse = z.object({
  models: z.array(z.object({ name: z.string() })).default([]),
});

export class OcrUnavailableError extends Error {}
export class OcrFailedError extends Error {}

/** Whether OCR assistance is configured at all. */
export function isOcrConfigured(): boolean {
  return getEnv().OCR_OLLAMA_URL.trim().length > 0;
}

function baseUrl(): string {
  const configured = getEnv().OCR_OLLAMA_URL.trim();
  if (!configured) throw new OcrUnavailableError('OCR is not configured');
  return configured.replace(/\/+$/, '');
}

/**
 * Pull the JSON object out of whatever the model actually said.
 *
 * Asking for "JSON only" is a request, not a guarantee. Small models wrap the
 * object in ```json fences, or narrate a sentence before it, and both are
 * common enough that treating them as failures would throw away good readings.
 * The first balanced `{...}` run is taken, which is the object in every one of
 * those shapes.
 *
 * Exported for tests: this is where malformed output turns into either a
 * reading or nothing, and it is worth pinning without a model in the loop.
 */
export function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];

    // Braces inside a string literal are text, not structure. A name is
    // unlikely to contain one, but a hallucinated line easily might.
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Decide how much to trust each field, from structure alone.
 *
 * This is the part that replaces per-character confidence, and it is weaker -
 * there is no way around that, and pretending otherwise would be the actual
 * danger. A language model reports no calibrated probability, and asking it to
 * rate its own confidence produces a number that reads well and means nothing.
 *
 * So the only evidence used is whether the value could be real. An identity
 * number is checked by `readIdentityNumber`, which knows a MyKad encodes a
 * valid birth date and an issued state code - a hallucinated number fails that
 * far more often than it passes. A name is doubted when it is too short to be
 * one, or carries characters that are not printed on a card.
 *
 * A field that fails outright is returned as `null` rather than flagged. The
 * point of the flag is to make a person look harder at something they can
 * check; a number that cannot be a MyKad is not worth showing them at all.
 */
function certainty(parsed: z.infer<typeof modelReply>): CardReading {
  const uncertain: CardReading['uncertain'] = [];

  const number = parsed.id ? readIdentityNumber(parsed.id) : { value: null, certain: false };
  const identityNumber = number.value;
  if (identityNumber && !number.certain) uncertain.push('identityNumber');

  let fullName: string | null = null;
  if (parsed.name) {
    // Collapse the whitespace a model adds freely, then judge what is left.
    const cleaned = parsed.name.replace(/\s+/g, ' ').trim();
    const printable = /^[A-Za-z@/'.\- ]+$/.test(cleaned);

    if (cleaned.length >= 2) {
      fullName = cleaned;
      // A name with characters no card prints was partly invented, even when
      // the rest of it is right.
      if (!printable) uncertain.push('fullName');
    }
  }

  return { identityNumber, fullName, card: parsed.card ?? null, uncertain };
}

/** Confirm the host is up and actually serving the model we pinned. */
async function assertModelPresent(signal: AbortSignal): Promise<void> {
  const response = await fetch(`${baseUrl()}/api/tags`, { signal, cache: 'no-store' });
  if (!response.ok) throw new OcrUnavailableError(`model host returned ${response.status}`);

  const tags = tagsResponse.safeParse(await response.json());
  if (!tags.success) throw new OcrUnavailableError('model host returned an unreadable list');

  const wanted = getEnv().OCR_OLLAMA_MODEL;
  if (!tags.data.models.some((model) => model.name === wanted)) {
    /*
     * Refused rather than silently falling back. Ollama will happily answer
     * with a different model if asked loosely, and on a host that also carries
     * a cloud-routed tag - `gpt-oss:120b-cloud` and the like - that means an
     * identity card leaving the country. The failure has to be loud and the
     * name has to match exactly.
     *
     * This check cannot catch a cloud tag that was asked for deliberately: it
     * is installed on the host, so it matches and passes. `isCloudRoutedModel`
     * in lib/env.ts is what refuses that, before the application starts.
     */
    throw new OcrUnavailableError(`model ${wanted} is not installed on the host`);
  }
}

/**
 * Read one card image.
 *
 * `image` is raw bytes; the base64 encoding Ollama wants happens here so no
 * caller has to hold an encoded copy as well. Neither form is stored, logged or
 * written to disk - the buffer is unreferenced when this returns, which is the
 * whole of the "image is never retained" guarantee on the server side.
 */
export async function readCard(image: Uint8Array): Promise<CardReading> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OCR_TIMEOUT_MS);

  try {
    await assertModelPresent(controller.signal);

    const response = await fetch(`${baseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify({
        model: env.OCR_OLLAMA_MODEL,
        prompt: PROMPT,
        images: [Buffer.from(image).toString('base64')],
        stream: false,
        // Thinking would spend the budget narrating before it answers, and
        // nothing downstream reads the reasoning.
        think: false,
        options: {
          // Greedy. A card has one correct reading, and sampling only invents
          // alternatives to it.
          temperature: 0,
          // Enough for the JSON object and no more; a runaway generation is
          // always a failed read, never a long answer.
          num_predict: 256,
          /*
           * Set explicitly, because Ollama's default is 4096 regardless of what
           * the model can actually hold, and a photographed card lands close
           * enough to that ceiling to cross it depending on the picture. When it
           * does, the host answers 400 `exceed_context_size_error` rather than
           * truncating, so the read fails outright - and it fails for a good
           * photo, which makes it look like the reader cannot cope with the
           * card rather than with the request. A measured failure needed 4160
           * tokens against the 4096 default: over by 64.
           *
           * This is not the model's limit. `qwen3.5:0.8b` advertises 262144,
           * and the cost of a larger window is address space rather than
           * compute, so the headroom is close to free at this size.
           */
          num_ctx: NUM_CTX,
        },
      }),
    });

    if (!response.ok) throw new OcrFailedError(`model host returned ${response.status}`);

    const body = generateResponse.safeParse(await response.json());
    if (!body.success) throw new OcrFailedError('model host returned an unreadable response');

    const parsed = modelReply.safeParse(extractJsonObject(body.data.response));
    if (!parsed.success) {
      // Not an error worth raising: a model that answered with prose has
      // simply failed to read the card, and the panel says so.
      log.debug('model reply did not parse');
      return { identityNumber: null, fullName: null, card: null, uncertain: [] };
    }

    /*
     * Never log the reading itself. It is a real name and a real identity
     * number, and the project rules put both firmly out of the logs - this is
     * exactly the call site where a debugging line would leak them.
     */
    const reading = certainty(parsed.data);
    log.debug('card read', {
      hasNumber: reading.identityNumber !== null,
      hasName: reading.fullName !== null,
      uncertain: reading.uncertain.length,
    });

    return reading;
  } catch (error) {
    if (error instanceof OcrUnavailableError || error instanceof OcrFailedError) throw error;

    if (error instanceof Error && error.name === 'AbortError') {
      throw new OcrFailedError('the model host took too long');
    }
    // A connection refused here is the ordinary case of the host being down,
    // and the underlying message can carry internal addresses.
    throw new OcrUnavailableError('the model host could not be reached');
  } finally {
    clearTimeout(timeout);
  }
}

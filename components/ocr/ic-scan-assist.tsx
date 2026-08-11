'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Worker as TesseractWorker } from 'tesseract.js';
import { clsx } from 'clsx';
import { parseIcText, type ParsedIcFields } from '@/lib/ocr/parse-ic';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/surface';
import { createLogger } from '@/lib/logger';

const log = createLogger('ocr');

/**
 * Optional OCR assistance for Malaysian identity cards.
 *
 * Honest description of what this is: it reads text from a photograph to save
 * typing. It does not verify identity, does not check the number against any
 * registry, and cannot tell a genuine card from a forgery. The extracted values
 * are suggestions that a person must review and correct.
 *
 * Privacy properties, which are the reason it is built this way:
 *   - The image is read from a local `File` and decoded in this browser. It is
 *     never uploaded: there is no fetch, no form field, and no server action
 *     that receives it.
 *   - The Tesseract worker, its WASM core and the language model are served
 *     from this origin (`/ocr/...`), so no third party sees anything either.
 *   - The object URL and the image bitmap are released as soon as recognition
 *     finishes, and the file input is cleared, so the page holds no copy.
 *
 * The whole feature is loaded on demand. A visitor who never opens it downloads
 * none of the ~30 MB of OCR runtime.
 */

type Status = 'idle' | 'loading' | 'reading' | 'done' | 'error' | 'rejected' | 'unsupported';

/**
 * Which part of the work is running. The language model is ~22 MB, so lumping
 * its download in with the rest leaves the panel apparently frozen for the
 * whole first scan; naming it lets the progress bar mean something.
 */
type Phase = 'prepare' | 'download' | 'read';

export interface IcScanAssistProps {
  /** Applies the reviewed values to the surrounding form. */
  onApply: (fields: { fullName?: string; identityNumber?: string }) => void;
  /** Bahasa Melayu copy is required on guard screens. */
  locale?: 'en' | 'ms';
}

const COPY = {
  en: {
    title: 'Scan an identity card (optional)',
    intro:
      'Take or choose a photo of the identity card to fill the name and number automatically. You must check the result before it is used.',
    disclaimer:
      'This reads text from the photo to save typing. It does not verify identity and cannot tell whether a card is genuine.',
    // Both required claims in one line: that this is not identity
    // verification, and that the image does not leave the device.
    notice: 'Reads text only - not identity verification. The photo is never uploaded or stored.',
    rawLabel: 'Show exactly what the reader saw',
    drop: 'Drag a photo of the card here',
    dropActive: 'Release to read the card',
    browse: 'or tap to browse for a file',
    camera: 'Take a photo',
    notImage: 'That file is not an image. Choose a photo of the card.',
    reading: 'Reading the card...',
    loading: 'Preparing the reader...',
    downloading: 'Downloading the reader. This happens only once.',
    review: 'Check these values, correct anything wrong, then apply them.',
    apply: 'Use these details',
    discard: 'Discard',
    name: 'Name',
    number: 'Identity number',
    nothing:
      'Nothing could be read from that photo. Try better lighting, or type the details in yourself.',
    failed: 'The reader could not start. Please type the details in yourself.',
    uncertain: 'Low confidence - check this carefully',
    unsupported: 'This browser cannot run the card reader. Please type the details in yourself.',
  },
  ms: {
    title: 'Imbas kad pengenalan (pilihan)',
    intro:
      'Ambil atau pilih gambar kad pengenalan untuk mengisi nama dan nombor secara automatik. Anda mesti menyemak hasilnya sebelum digunakan.',
    disclaimer:
      'Ini membaca teks daripada gambar untuk menjimatkan masa menaip. Ia tidak mengesahkan identiti dan tidak boleh menentukan sama ada kad itu tulen.',
    notice:
      'Membaca teks sahaja - bukan pengesahan identiti. Gambar tidak dimuat naik atau disimpan.',
    rawLabel: 'Tunjuk apa yang dibaca',
    drop: 'Seret gambar kad ke sini',
    dropActive: 'Lepaskan untuk membaca kad',
    browse: 'atau ketik untuk memilih fail',
    camera: 'Ambil gambar',
    notImage: 'Fail itu bukan gambar. Sila pilih gambar kad.',
    reading: 'Sedang membaca kad...',
    loading: 'Menyediakan pembaca...',
    downloading: 'Memuat turun pembaca. Ini berlaku sekali sahaja.',
    review: 'Semak nilai ini, betulkan jika salah, kemudian gunakannya.',
    apply: 'Guna butiran ini',
    discard: 'Buang',
    name: 'Nama',
    number: 'Nombor pengenalan',
    nothing:
      'Tiada apa-apa dapat dibaca daripada gambar itu. Cuba pencahayaan lebih baik, atau taip sendiri.',
    failed: 'Pembaca tidak dapat dimulakan. Sila taip butiran sendiri.',
    uncertain: 'Keyakinan rendah - semak dengan teliti',
    unsupported: 'Pelayar ini tidak boleh menjalankan pembaca kad. Sila taip butiran sendiri.',
  },
} as const;

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
const MIN_WIDTH = 1400;
const MAX_WIDTH = 2000;

/**
 * Window for the local threshold, as a fraction of image width. Wide enough to
 * span several characters plus their background, narrow enough that the card's
 * photo does not influence the text beside it.
 */
const THRESHOLD_WINDOW = 0.125;

/** How far below the local mean a pixel must sit to count as ink. */
const THRESHOLD_BIAS = 0.86;

/**
 * Binarise the photo with a *local* threshold before recognition.
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
async function prepareImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);

  try {
    const target = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, bitmap.width));
    const scale = target / bitmap.width;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d canvas context unavailable');

    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const { width, height } = canvas;
    const image = context.getImageData(0, 0, width, height);
    const { data } = image;

    const grey = new Uint8Array(width * height);
    for (let p = 0; p < grey.length; p += 1) {
      const i = p * 4;
      grey[p] =
        ((data[i] ?? 0) * 299 + (data[i + 1] ?? 0) * 587 + (data[i + 2] ?? 0) * 114) / 1000;
    }

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
    return canvas;
  } finally {
    // Free the decoded frame straight away; a card photo is several megabytes.
    bitmap.close();
  }
}

export function IcScanAssist({ onApply, locale = 'en' }: IcScanAssistProps) {
  const t = COPY[locale];

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<Phase>('prepare');
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [parsed, setParsed] = useState<ParsedIcFields | null>(null);
  /*
   * Kept only so the review step can show it. It never leaves the component:
   * not logged, not sent anywhere, and dropped with the rest of the state on
   * reset - logging it would put a real name and identity number into the
   * console, which the project rules forbid outright.
   */
  const [rawText, setRawText] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftNumber, setDraftNumber] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  /*
   * Built once and kept for the life of the panel.
   *
   * Starting a worker means compiling the WASM core and parsing a 22 MB
   * language model. Doing that per scan made a second attempt cost as much as
   * the first, which is punishing when the first read was the one that came
   * back wrong and you just want to retake the photo.
   */
  const workerRef = useRef<TesseractWorker | null>(null);

  useEffect(() => {
    return () => {
      void workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  /*
   * `capture` is honoured by phones and tablets and ignored everywhere else, so
   * on a laptop the camera button would silently open the same file dialog as
   * the drop zone. A coarse pointer is the practical signal for a device that
   * has a camera worth pointing at a card. Resolved after mount because the
   * server cannot know it, and a guess would mismatch on hydration.
   */
  useEffect(() => {
    setHasCamera(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  const getWorker = useCallback(async (): Promise<TesseractWorker> => {
    const existing = workerRef.current;
    if (existing) return existing;

    // Imported here, not at module scope, so the OCR runtime is fetched only
    // when someone actually opens this panel.
    const { createWorker } = await import('tesseract.js');

    const worker = await createWorker(
      'eng',
      1,
      {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr',
        langPath: '/ocr/tessdata',
        // The model is served uncompressed from our own origin.
        gzip: false,
        logger: (message: { status: string; progress: number }) => {
          const percent = Math.round((message.progress ?? 0) * 100);

          if (message.status === 'recognizing text') {
            setStatus('reading');
            setPhase('read');
          } else if (message.status.includes('traineddata')) {
            // The 22 MB language model. Worth naming: it is the only step slow
            // enough for someone to think the panel has hung.
            setPhase('download');
          } else {
            setPhase('prepare');
          }

          setProgress(percent);
        },
      },
      {
        // Turn the English dictionaries off. Malaysian names are not English
        // words, and with the dictionaries loaded the decoder pulls them
        // towards ones that are. These are init-time options: passing them to
        // `setParameters` afterwards would be accepted and silently ignored.
        load_system_dawg: '0',
        load_freq_dawg: '0',
      },
    );

    await worker.setParameters({
      // Names are parsed word by word, so the gaps have to survive.
      preserve_interword_spaces: '1',
      // The photo carries no DPI metadata; saying so avoids a bad guess.
      user_defined_dpi: '300',
    });

    workerRef.current = worker;
    return worker;
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setDragging(false);

      // A dropped file can be anything at all; the browse dialog filters by
      // `accept`, but a drag bypasses that entirely.
      if (!file.type.startsWith('image/')) {
        if (inputRef.current) inputRef.current.value = '';
        if (cameraRef.current) cameraRef.current.value = '';
        setStatus('rejected');
        return;
      }

      setStatus('loading');
      setPhase('prepare');
      setProgress(0);
      setParsed(null);

      try {
        // Prepared before the worker is asked for, so a large photo is already
        // down to a workable size by the time recognition starts.
        const prepared = await prepareImage(file);
        const worker = await getWorker();
        const { data } = await worker.recognize(prepared);

        const fields = parseIcText(data.text);
        setRawText(data.text);
        setParsed(fields);
        setDraftName(fields.fullName ?? '');
        setDraftNumber(fields.identityNumber ?? '');
        setStatus('done');
      } catch (error) {
        // Never surface the underlying error: it can contain local file paths.
        log.error('recognition failed', undefined, error);
        setStatus('error');
      } finally {
        // The prepared canvas is unreferenced once recognition returns, so the
        // only handles left are the two inputs' own copies of the file.
        if (inputRef.current) inputRef.current.value = '';
        if (cameraRef.current) cameraRef.current.value = '';
      }
    },
    [getWorker],
  );

  function applyAndClose() {
    onApply({
      fullName: draftName.trim() || undefined,
      identityNumber: draftNumber.trim() || undefined,
    });
    reset();
  }

  function reset() {
    setParsed(null);
    setRawText('');
    setDraftName('');
    setDraftNumber('');
    setStatus('idle');
    setPhase('prepare');
    setProgress(0);
    setDragging(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--line-strong)] p-4">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          {t.title}
        </Button>
        <p className="mt-2 text-xs text-muted">{t.disclaimer}</p>
      </div>
    );
  }

  return (
    <section
      aria-label={t.title}
      className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-inset)] p-4"
    >
      <h3 className="text-sm font-semibold">{t.title}</h3>
      <p className="mt-1 text-sm text-muted">{t.intro}</p>
      {/*
        Deliberately quiet. The spec requires this be stated, not that it
        dominate the panel: a tinted two-paragraph alert above every scan reads
        as a warning about something dangerous, when the honest message is just
        that the reader saves typing and keeps the photo local.
      */}
      <p className="mt-1 text-xs text-muted">{t.notice}</p>

      {status === 'idle' || status === 'error' || status === 'rejected' ? (
        <div className="mt-4">
          {/*
            The input stays in the accessibility tree and keyboard tab order -
            `sr-only`, never `hidden` - and the label is what gets styled. That
            keeps one native control doing the work, so a keyboard user opens
            the same picker a pointer user does.
          */}
          <input
            ref={inputRef}
            id="ic-photo"
            type="file"
            accept="image/*"
            className="peer sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <label
            htmlFor="ic-photo"
            onDragOver={(event) => {
              // Without preventDefault the browser navigates to the dropped file.
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              const file = event.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={clsx(
              'peer-ring flex min-h-[var(--spacing-touch)] cursor-pointer flex-col items-center',
              'justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center',
              'transition-colors',
              dragging
                ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                : 'border-[var(--line-strong)] bg-[var(--surface-card)] hover:bg-[var(--surface-muted)]',
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-8 w-8 text-muted"
            >
              <rect x="2.5" y="5" width="19" height="14" rx="2" />
              <circle cx="8.5" cy="11" r="2" />
              <path d="M5.5 16c.7-1.6 2-2.4 3-2.4s2.3.8 3 2.4M14 10h4.5M14 13.5h4.5" />
            </svg>
            <span className="text-sm font-medium text-[var(--text-strong)]">
              {dragging ? t.dropActive : t.drop}
            </span>
            <span className="text-xs text-muted">{t.browse}</span>
          </label>

          {hasCamera ? (
            <>
              <input
                ref={cameraRef}
                id="ic-camera"
                type="file"
                accept="image/*"
                // `capture` opens the rear camera directly on a phone or tablet.
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <Button
                type="button"
                size="lg"
                className="mt-3 w-full"
                onClick={() => cameraRef.current?.click()}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-5 w-5"
                >
                  <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                {t.camera}
              </Button>
            </>
          ) : null}

          {status === 'error' ? (
            <div className="mt-3">
              <Alert tone="warning">{t.failed}</Alert>
            </div>
          ) : null}
          {status === 'rejected' ? (
            <div className="mt-3">
              <Alert tone="warning">{t.notImage}</Alert>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === 'loading' || status === 'reading' ? (
        <div className="mt-4">
          <p className="text-sm" role="status" aria-live="polite">
            {phase === 'read' ? t.reading : phase === 'download' ? t.downloading : t.loading}
          </p>
          {/*
            Determinate per phase rather than across the whole job: the phases
            each report their own 0-100 and there is no honest way to weigh a
            22 MB download against a two-second recognition pass.
          */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs tabular-nums text-muted">{progress}%</p>
        </div>
      ) : null}

      {status === 'done' && parsed ? (
        <div className="mt-4 flex flex-col gap-3">
          {!parsed.fullName && !parsed.identityNumber ? (
            <Alert tone="warning">{t.nothing}</Alert>
          ) : (
            <>
              <p className="text-sm font-medium">{t.review}</p>

              <div className="flex flex-col gap-1">
                <label htmlFor="ocr-name" className="text-xs text-muted">
                  {t.name}
                </label>
                <input
                  id="ocr-name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  className="h-11 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-card)] px-3"
                />
                {parsed.uncertain.includes('fullName') ? (
                  <p className="text-xs font-medium text-[var(--warn-text)]">{t.uncertain}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="ocr-number" className="text-xs text-muted">
                  {t.number}
                </label>
                <input
                  id="ocr-number"
                  value={draftNumber}
                  inputMode="numeric"
                  onChange={(event) => setDraftNumber(event.target.value)}
                  className="h-11 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-card)] px-3 font-mono"
                />
                {parsed.uncertain.includes('identityNumber') ? (
                  <p className="text-xs font-medium text-[var(--warn-text)]">{t.uncertain}</p>
                ) : null}
              </div>
            </>
          )}

          {/*
            The reader's unedited output. When a field comes back wrong this is
            what says whether the text was misread or merely picked from the
            wrong line, which is otherwise impossible to tell from the outside.
          */}
          {rawText.trim() ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">{t.rawLabel}</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--surface-inset)] p-3 font-mono text-[11px] whitespace-pre-wrap">
                {rawText.trim()}
              </pre>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {parsed.fullName || parsed.identityNumber ? (
              <Button type="button" onClick={applyAndClose}>
                {t.apply}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={reset}>
              {t.discard}
            </Button>
          </div>
        </div>
      ) : null}

      {status === 'unsupported' ? (
        <div className="mt-4">
          <Alert tone="warning">{t.unsupported}</Alert>
        </div>
      ) : null}
    </section>
  );
}

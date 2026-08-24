'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Block, Bbox, PSM, Worker as TesseractWorker } from 'tesseract.js';
import { clsx } from 'clsx';
import {
  parseIcText,
  readIdentityNumber,
  type OcrWord,
  type ParsedIcFields,
} from '@/lib/ocr/parse-ic';
import { combineReadings, type FrameReading } from '@/lib/ocr/consensus';
import {
  BLUR_THRESHOLD,
  CARD_ASPECT,
  prepareFile,
  prepareVideoFrame,
  type PreparedImage,
} from '@/lib/ocr/prepare-image';
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
 * There are two ways in: a live camera, and choosing a file. The camera is
 * preferred where it exists, because it can read a burst of frames and keep
 * only what they agree on - see `lib/ocr/consensus.ts` for why agreement is
 * better evidence than any single frame's own confidence.
 *
 * Privacy properties, which are the reason it is built this way:
 *   - Camera frames and chosen files are decoded in this browser and never
 *     uploaded: there is no fetch, no form field, and no server action that
 *     receives an image.
 *   - The Tesseract worker, its WASM core and the language model are served
 *     from this origin (`/ocr/...`), so no third party sees anything either.
 *   - The camera stream is stopped the moment the burst is taken, the bitmaps
 *     are released as soon as recognition finishes, and the file input is
 *     cleared, so the page holds no copy of the card.
 *
 * The whole feature is loaded on demand. A visitor who never opens it downloads
 * none of the ~30 MB of OCR runtime.
 */

type Status =
  | 'idle'
  | 'camera'
  | 'capturing'
  | 'loading'
  | 'reading'
  | 'done'
  | 'error'
  | 'rejected'
  | 'unsupported';

/** Why the camera is not available, so the panel can say something useful. */
type CameraFault = 'denied' | 'unavailable';

/**
 * How many frames a capture takes, and how many of them are recognised.
 *
 * Reading every frame would triple the wait for no gain, because the blurred
 * ones are exactly the ones that produce wrong answers. Taking more than are
 * read and keeping the sharpest is nearly free - a `drawImage` is microseconds
 * against seconds of recognition - and it means a hand shaking at the wrong
 * moment costs nothing.
 */
const BURST_FRAMES = 5;
const FRAMES_READ = 3;

/** Spacing between grabs, long enough for the sensor to produce a new frame. */
const BURST_INTERVAL_MS = 120;

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
    blurry:
      'That photo looks blurry, so the details below may be wrong. Hold the card flat, avoid glare, and take it again for a better read.',
    openCamera: 'Use the camera',
    guide: 'Fill the frame with the card. Keep it flat and avoid glare on the numbers.',
    capture: 'Capture',
    capturing: 'Hold still...',
    cancelCamera: 'Close the camera',
    cameraDenied:
      'The camera permission was refused. Allow it in your browser settings, or choose a photo instead.',
    cameraUnavailable: 'No camera is available on this device. Choose a photo instead.',
    orChoose: 'or choose a photo instead',
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
    blurry:
      'Gambar itu kelihatan kabur, jadi butiran di bawah mungkin salah. Pegang kad rata, elakkan silau, dan ambil gambar semula untuk bacaan lebih baik.',
    openCamera: 'Guna kamera',
    guide: 'Penuhkan bingkai dengan kad. Pegang rata dan elakkan silau pada nombor.',
    capture: 'Tangkap',
    capturing: 'Pegang diam...',
    cancelCamera: 'Tutup kamera',
    cameraDenied:
      'Kebenaran kamera ditolak. Benarkan dalam tetapan pelayar anda, atau pilih gambar sebaliknya.',
    cameraUnavailable: 'Tiada kamera pada peranti ini. Sila pilih gambar sebaliknya.',
    orChoose: 'atau pilih gambar sebaliknya',
  },
} as const;


// ---------------------------------------------------------------------------
// Recognition passes
// ---------------------------------------------------------------------------

/**
 * The page segmentation modes this component uses.
 *
 * Carried as values rather than imported, because `PSM` is a runtime export of
 * `tesseract.js` and importing it normally would pull the OCR bundle into the
 * initial page load - defeating the dynamic import that keeps this feature free
 * for visitors who never open it. They are read off the module that
 * `getWorker` already loads.
 */
interface SegmentationModes {
  auto: PSM;
  singleLine: PSM;
  sparseText: PSM;
}

/** The only characters the number band can legitimately contain. */
const DIGIT_WHITELIST = '0123456789-';

interface FlatLine {
  text: string;
  bbox: Bbox;
  words: OcrWord[];
}

/**
 * Flatten the recognizer's block/paragraph/line/word tree into lines.
 *
 * Only the line text, its box and its words' confidences are wanted, and
 * reaching through four levels of nesting at every call site is how the
 * `blocks` array being `null` gets forgotten.
 */
function flattenLines(blocks: Block[] | null): FlatLine[] {
  const lines: FlatLine[] = [];

  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        lines.push({
          text: line.text ?? '',
          bbox: line.bbox,
          words: (line.words ?? []).map((word) => ({
            text: word.text ?? '',
            confidence: word.confidence ?? 0,
          })),
        });
      }
    }
  }

  return lines;
}

/**
 * The line most likely to hold the identity number, for the second pass to
 * re-read. Chosen by digit density rather than by matching the number itself:
 * the whole reason a second pass is running is that the first pass did not
 * produce a number worth trusting, so the digits are, by assumption, wrong.
 */
function numberBandOf(lines: FlatLine[]): Bbox | null {
  let best: { bbox: Bbox; digits: number } | null = null;

  for (const line of lines) {
    const compact = line.text.replace(/[\s-]/g, '');
    if (compact.length < 8) continue;

    const digits = (compact.match(/\d/g) ?? []).length;
    // Mostly-numeric and long enough to be the 12-digit run rather than a
    // house number in the address block.
    if (digits < 8 || digits / compact.length < 0.6) continue;
    if (!best || digits > best.digits) best = { bbox: line.bbox, digits };
  }

  return best?.bbox ?? null;
}

/** Grow a box outward, clamped to the canvas, so no glyph is clipped. */
function padded(bbox: Bbox, canvas: HTMLCanvasElement) {
  const padX = Math.round((bbox.x1 - bbox.x0) * 0.06) + 12;
  const padY = Math.round((bbox.y1 - bbox.y0) * 0.35) + 8;

  const left = Math.max(0, bbox.x0 - padX);
  const top = Math.max(0, bbox.y0 - padY);

  return {
    left,
    top,
    width: Math.min(canvas.width - left, bbox.x1 - bbox.x0 + padX * 2),
    height: Math.min(canvas.height - top, bbox.y1 - bbox.y0 + padY * 2),
  };
}

/**
 * Read the number band again with only digits permitted.
 *
 * The first pass runs over the whole card with every character allowed, so the
 * decoder is free to return `S` for `5` and `B` for `8` - both are legal
 * outputs there, and by the time the text reaches the parser the evidence for
 * choosing between them is gone. Constraining the alphabet moves that decision
 * back inside the recognizer, where the pixel likelihoods still exist.
 *
 * Non-regressive by construction: the caller only runs this when the first pass
 * produced nothing or something doubtful, and the result is adopted only when
 * it is structurally sound. A failed second pass leaves the first pass standing.
 */
async function reReadNumber(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  band: Bbox | null,
  modes: SegmentationModes,
): Promise<string | null> {
  try {
    await worker.setParameters({
      tessedit_char_whitelist: DIGIT_WHITELIST,
      // A cropped band is one line of text; the whole card is scattered text.
      tessedit_pageseg_mode: band ? modes.singleLine : modes.sparseText,
    });

    const { data } = await worker.recognize(
      canvas,
      band ? { rectangle: padded(band, canvas) } : {},
      { text: true },
    );

    const refined = readIdentityNumber(data.text ?? '');
    return refined.certain ? refined.value : null;
  } finally {
    // The worker is reused across scans, so leaving the whitelist in place
    // would silently reduce every later card to digits.
    await worker.setParameters({
      tessedit_char_whitelist: '',
      tessedit_pageseg_mode: modes.auto,
    });
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
  /** Advisory: the photo was soft, so any field may be wrong. */
  const [blurry, setBlurry] = useState(false);
  const [cameraFault, setCameraFault] = useState<CameraFault | null>(null);
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /*
   * Built once and kept for the life of the panel.
   *
   * Starting a worker means compiling the WASM core and parsing a 22 MB
   * language model. Doing that per scan made a second attempt cost as much as
   * the first, which is punishing when the first read was the one that came
   * back wrong and you just want to retake the photo.
   */
  const workerRef = useRef<TesseractWorker | null>(null);
  /** Populated alongside the worker, from the same dynamic import. */
  const modesRef = useRef<SegmentationModes | null>(null);

  useEffect(() => {
    return () => {
      void workerRef.current?.terminate();
      workerRef.current = null;
      modesRef.current = null;
    };
  }, []);

  /*
   * Whether to offer the camera at all.
   *
   * This used to test for a coarse pointer, on the theory that only phones have
   * a camera worth pointing at a card. That was wrong twice over: it hid the
   * button on a touchscreen guard tablet's docked setup and on any laptop with
   * a usable webcam, and it offered it on touch devices with no camera. The
   * real question is whether the API exists; whether a camera answers is
   * settled by `getUserMedia` itself, and handled as a fault.
   *
   * Resolved after mount because the server cannot know it, and a guess would
   * mismatch on hydration.
   */
  useEffect(() => {
    setHasCamera(Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const getWorker = useCallback(async (): Promise<TesseractWorker> => {
    const existing = workerRef.current;
    if (existing) return existing;

    // Imported here, not at module scope, so the OCR runtime is fetched only
    // when someone actually opens this panel.
    const { createWorker, PSM: modes } = await import('tesseract.js');

    modesRef.current = {
      auto: modes.AUTO,
      singleLine: modes.SINGLE_LINE,
      sparseText: modes.SPARSE_TEXT,
    };

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

  /**
   * Recognise one prepared image. Shared by both entry points, so a camera
   * frame and a chosen photograph are read by exactly the same code.
   */
  const readOne = useCallback(
    async (
      worker: TesseractWorker,
      canvas: HTMLCanvasElement,
    ): Promise<{ reading: FrameReading; text: string }> => {
      // `blocks` is off by default and carries the per-word confidence, which
      // is the only honest source for the "check this carefully" flag.
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });

      const lines = flattenLines(data.blocks);
      const words = lines.flatMap((line) => line.words);
      let fields = parseIcText(data.text ?? '', { words });

      /*
       * Second pass, only when the first one left the number missing or
       * doubtful. Skipping it on a clean read keeps the common case fast, and
       * means this can only ever add a correct number, never replace one.
       */
      const modes = modesRef.current;
      if (modes && (!fields.identityNumber || fields.uncertain.includes('identityNumber'))) {
        const refined = await reReadNumber(worker, canvas, numberBandOf(lines), modes);

        if (refined && refined !== fields.identityNumber) {
          fields = {
            ...fields,
            identityNumber: refined,
            // A digits-only re-read of a structurally sound number is the
            // strongest evidence available here, so the flag comes off.
            uncertain: fields.uncertain.filter((field) => field !== 'identityNumber'),
          };
        }
      }

      return {
        reading: { fields, confidence: data.confidence ?? 0 },
        text: data.text ?? '',
      };
    },
    [],
  );

  /** Recognise a set of prepared images and settle on what they agree about. */
  const readAll = useCallback(
    async (prepared: PreparedImage[]) => {
      const worker = await getWorker();

      const readings: FrameReading[] = [];
      const texts: string[] = [];

      for (const image of prepared) {
        const { reading, text } = await readOne(worker, image.canvas);
        readings.push(reading);
        texts.push(text);
      }

      const fields = combineReadings(readings);

      /*
       * The raw text of the frame that actually won, so "what the reader saw"
       * corresponds to the values on screen. Showing the first frame's text
       * beside a different frame's answer would be actively misleading.
       */
      const chosen = Math.max(
        0,
        readings.findIndex(
          (reading) =>
            fields.identityNumber !== null &&
            reading.fields.identityNumber === fields.identityNumber,
        ),
      );

      setRawText(texts[chosen] ?? texts[0] ?? '');
      // The sharpest frame governs: it is the one whose reading was believed.
      setBlurry((prepared[0]?.sharpness ?? 0) < BLUR_THRESHOLD);
      setParsed(fields);
      setDraftName(fields.fullName ?? '');
      setDraftNumber(fields.identityNumber ?? '');
      setStatus('done');
    },
    [getWorker, readOne],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setDragging(false);

      // A dropped file can be anything at all; the browse dialog filters by
      // `accept`, but a drag bypasses that entirely.
      if (!file.type.startsWith('image/')) {
        if (inputRef.current) inputRef.current.value = '';
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
        await readAll([await prepareFile(file)]);
      } catch (error) {
        // Never surface the underlying error: it can contain local file paths.
        log.error('recognition failed', undefined, error);
        setStatus('error');
      } finally {
        // The prepared canvas is unreferenced once recognition returns, so the
        // only handle left is the input's own copy of the file.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [readAll],
  );

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------

  /**
   * Release the camera.
   *
   * Every track has to be stopped individually - dropping the reference is not
   * enough, and leaves the device's camera indicator lit. Written to be safe to
   * call twice, because it runs from the capture path, the cancel button and
   * unmount, and those can overlap.
   */
  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;

    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  // The stream must not outlive the panel: a live camera left running is both a
  // privacy surprise and a flat battery.
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraFault('unavailable');
      return;
    }

    setCameraFault(null);
    setStatus('camera');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera, and as many pixels as the device will give: the
        // limiting factor on a card is glyph height in the captured frame.
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        // The panel closed while the permission prompt was open.
        stopCamera();
        return;
      }

      video.srcObject = stream;
      await video.play();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      // A refusal is worth distinguishing: it is the one fault the person can
      // actually do something about.
      setCameraFault(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      setStatus('idle');
      stopCamera();
      log.debug('camera unavailable', { name });
    }
  }, [stopCamera]);

  /**
   * Take a burst, keep the sharpest frames, and read those.
   *
   * The burst is grabbed before anything is recognised, and the camera is
   * released immediately afterwards. Holding it open through several seconds of
   * OCR would keep the indicator lit long after the person had finished, and
   * invite them to move the card while it was still being read.
   */
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    setStatus('capturing');

    const frames: PreparedImage[] = [];
    try {
      for (let i = 0; i < BURST_FRAMES; i += 1) {
        frames.push(prepareVideoFrame(video));
        if (i < BURST_FRAMES - 1) {
          await new Promise((resolve) => setTimeout(resolve, BURST_INTERVAL_MS));
        }
      }
    } catch (error) {
      log.error('capture failed', undefined, error);
      stopCamera();
      setStatus('error');
      return;
    }

    stopCamera();

    setStatus('loading');
    setPhase('prepare');
    setProgress(0);
    setParsed(null);

    try {
      // Sharpest first, so the blur advisory and the raw-text panel both refer
      // to the best frame rather than whichever happened to be grabbed first.
      const sharpest = frames.sort((a, b) => b.sharpness - a.sharpness).slice(0, FRAMES_READ);
      await readAll(sharpest);
    } catch (error) {
      log.error('recognition failed', undefined, error);
      setStatus('error');
    }
  }, [readAll, stopCamera]);

  function applyAndClose() {
    onApply({
      fullName: draftName.trim() || undefined,
      identityNumber: draftNumber.trim() || undefined,
    });
    reset();
  }

  function reset() {
    stopCamera();
    setCameraFault(null);
    setParsed(null);
    setBlurry(false);
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
            <Button type="button" size="lg" className="mt-3 w-full" onClick={() => void startCamera()}>
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
              {t.openCamera}
            </Button>
          ) : null}

          {cameraFault ? (
            <div className="mt-3">
              <Alert tone="warning">
                {cameraFault === 'denied' ? t.cameraDenied : t.cameraUnavailable}
              </Alert>
            </div>
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

      {status === 'camera' || status === 'capturing' ? (
        <div className="mt-4">
          {/*
            Cut to the card's own proportions, and the frame is the crop: what
            recognition receives is exactly this rectangle, computed by
            `coverCrop`. That is the point of matching the shapes - a guide that
            only approximated the crop would quietly read a strip of desk the
            person framing the shot could not see.
          */}
          <div
            className="relative w-full overflow-hidden rounded-xl bg-black"
            style={{ aspectRatio: String(CARD_ASPECT) }}
          >
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              // `playsInline` keeps iOS from taking the video fullscreen, which
              // would hide the frame and the capture button.
              playsInline
              muted
              // Decorative: the guidance below is the accessible description,
              // and a live camera feed has no alternative text worth giving.
              aria-hidden="true"
            />

            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[6%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]"
            />

            {status === 'capturing' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                <p className="text-sm font-semibold text-white" role="status">
                  {t.capturing}
                </p>
              </div>
            ) : null}
          </div>

          <p className="mt-2 text-sm text-muted">{t.guide}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              onClick={() => void capture()}
              disabled={status === 'capturing'}
            >
              {t.capture}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                stopCamera();
                setStatus('idle');
              }}
              disabled={status === 'capturing'}
            >
              {t.cancelCamera}
            </Button>
          </div>
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
          {/*
            Shown above the fields rather than beside one of them: blur degrades
            the whole read, so attaching it to a single field would imply the
            others are sound.
          */}
          {blurry ? <Alert tone="warning">{t.blurry}</Alert> : null}

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

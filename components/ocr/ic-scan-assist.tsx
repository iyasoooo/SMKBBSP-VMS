'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  BLUR_THRESHOLD,
  CARD_ASPECT,
  prepareFile,
  UndecodableImageError,
  prepareVideoFrame,
  toUploadBlob,
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
 * preferred where it exists, because it can take a burst and send only the
 * sharpest frame, which costs nothing and removes the worst of hand shake.
 *
 * Reading happens on a vision model, reached through this application's own
 * `/api/ocr` endpoint. It used to happen here in the browser, and the honest
 * reason it moved is that the browser-sized recognizer was not good enough on
 * real cards - it transcribes lines and leaves a parser guessing which line was
 * the name, and a laminated MyKad with a hologram across the digits defeats
 * that guess often enough to be useless. See `lib/ocr/ollama.ts`.
 *
 * What that costs, stated plainly because the UI has to be honest about it:
 *   - The photograph leaves this device. It is posted to this origin only,
 *     held for the length of one request, and never stored - but "the image
 *     never leaves your phone" is no longer a claim this component can make,
 *     and the copy below no longer makes it.
 *   - There is no per-character confidence any more. A language model reports
 *     none, so the "check this carefully" flag is now driven by whether a value
 *     is *structurally possible* rather than by how sure a recognizer was.
 *
 * What is unchanged:
 *   - Nothing read off the card is stored anywhere until the visitor submits
 *     the form themselves, and every field stays editable before that.
 *   - The camera stream is stopped the moment the shot is taken, the bitmaps
 *     are released once the upload is built, and the file input is cleared.
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
  /* The browser could not decode the chosen file - HEIC, usually. */
  | 'undecodable'
  | 'throttled'
  /* Configured, but the model host did not answer. Temporary; worth retrying. */
  | 'offline'
  /* No model host configured for this deployment. Permanent; do not retry. */
  | 'unsupported';

/** Why the camera is not available, so the panel can say something useful. */
type CameraFault = 'denied' | 'unavailable';

/**
 * How many frames a capture takes. Only the sharpest is sent.
 *
 * Taking several and keeping the best is nearly free - a `drawImage` is
 * microseconds - and it means a hand shaking at the wrong moment costs nothing.
 *
 * Only one is read, where the previous engine read three and voted on what they
 * agreed about. Voting was worth having: it cancelled the random half of OCR
 * error, because sensor noise and hand shake differ frame to frame. It is not
 * affordable now. Each frame is a model call measured in seconds, so three
 * would put half a minute between pressing the button and seeing a name, and it
 * would spend three times the request budget on one scan. The sharpest frame
 * alone is the trade, and the blur warning is what remains of the safeguard.
 */
const BURST_FRAMES = 5;

/** Spacing between grabs, long enough for the sensor to produce a new frame. */
const BURST_INTERVAL_MS = 120;

/**
 * Which part of the work is running.
 *
 * `prepare` is local and quick; `read` is the model, and it is the one that
 * takes long enough for someone to wonder whether the panel has hung.
 */
type Phase = 'prepare' | 'read';

/**
 * What `/api/ocr` answers with.
 *
 * Declared here rather than imported from the reader, which is server-only:
 * pulling its module in would drag the model client and its environment
 * handling into the browser bundle.
 */
interface CardFields {
  identityNumber: string | null;
  fullName: string | null;
  card: 'ic' | 'passport' | 'other' | null;
  uncertain: Array<'identityNumber' | 'fullName'>;
}

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
    /*
      Both required claims in one line: that this is not identity verification,
      and what actually happens to the photo. The previous wording promised the
      image was "never uploaded", which was true of the in-browser reader and is
      not true now - saying so plainly is the whole point of the line.
    */
    notice:
      'Reads text only - not identity verification. The photo is sent to the school reader, used once, and never saved.',
    drop: 'Drag a photo of the card here',
    dropActive: 'Release to read the card',
    browse: 'or tap to browse for a file',
    camera: 'Take a photo',
    notImage: 'That file is not an image. Choose a photo of the card.',
    undecodable:
      'This browser could not open that photo - phone cameras often save a format it cannot read. Take a new photo with the camera button, or choose a JPEG.',
    reading: 'Reading the card. This takes a few seconds...',
    loading: 'Preparing the photo...',
    review: 'Check these values, correct anything wrong, then apply them.',
    apply: 'Use these details',
    discard: 'Discard',
    name: 'Name',
    number: 'Identity number',
    nothing:
      'Nothing could be read from that photo. Try better lighting, or type the details in yourself.',
    failed: 'The card could not be read. Please type the details in yourself.',
    uncertain: 'This may be wrong - check it carefully',
    unsupported: 'Card scanning is not set up here. Please type the details in yourself.',
    offline:
      'The card reader is not responding right now. Try again in a moment, or type the details in yourself.',
    throttled:
      'Too many scans from this connection. Wait a few minutes, or type the details in yourself.',
    cardMismatch: 'That does not look like a MyKad. Check that you scanned the right document.',
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
      'Membaca teks sahaja - bukan pengesahan identiti. Gambar dihantar ke pembaca sekolah, digunakan sekali, dan tidak disimpan.',
    drop: 'Seret gambar kad ke sini',
    dropActive: 'Lepaskan untuk membaca kad',
    browse: 'atau ketik untuk memilih fail',
    camera: 'Ambil gambar',
    notImage: 'Fail itu bukan gambar. Sila pilih gambar kad.',
    undecodable:
      'Pelayar ini tidak dapat membuka gambar itu - kamera telefon selalunya menyimpan format yang tidak boleh dibaca. Ambil gambar baharu dengan butang kamera, atau pilih fail JPEG.',
    reading: 'Sedang membaca kad. Ini mengambil beberapa saat...',
    loading: 'Menyediakan gambar...',
    review: 'Semak nilai ini, betulkan jika salah, kemudian gunakannya.',
    apply: 'Guna butiran ini',
    discard: 'Buang',
    name: 'Nama',
    number: 'Nombor pengenalan',
    nothing:
      'Tiada apa-apa dapat dibaca daripada gambar itu. Cuba pencahayaan lebih baik, atau taip sendiri.',
    failed: 'Kad tidak dapat dibaca. Sila taip butiran sendiri.',
    uncertain: 'Mungkin salah - semak dengan teliti',
    unsupported: 'Imbasan kad tidak disediakan di sini. Sila taip butiran sendiri.',
    offline:
      'Pembaca kad tidak memberi respons sekarang. Cuba sebentar lagi, atau taip butiran sendiri.',
    throttled:
      'Terlalu banyak imbasan dari sambungan ini. Tunggu beberapa minit, atau taip butiran sendiri.',
    cardMismatch: 'Ini tidak kelihatan seperti MyKad. Sila semak dokumen yang diimbas.',
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

export function IcScanAssist({ onApply, locale = 'en' }: IcScanAssistProps) {
  const t = COPY[locale];

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [phase, setPhase] = useState<Phase>('prepare');
  const [dragging, setDragging] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [parsed, setParsed] = useState<CardFields | null>(null);
  /** Advisory: the photo was soft, so any field may be wrong. */
  const [blurry, setBlurry] = useState(false);
  const [cameraFault, setCameraFault] = useState<CameraFault | null>(null);
  /*
   * Whether the preview is being shown through a front-facing camera.
   *
   * A laptop webcam hands back a reversed picture, so a card held up to it
   * appears with its text mirrored. That is worth undoing rather than living
   * with: a person framing a card checks the preview to see whether the number
   * is inside the guide and in focus, and they cannot read it backwards. The
   * flip below restores it, so the preview shows the card the same way round as
   * the photograph that will actually be read.
   *
   * It deliberately does not touch what is captured, and does not need to. The
   * flip is CSS, while `drawImage` reads frames from the video element rather
   * than from its rendered box, so the bytes sent to the reader are the
   * camera's own either way. Correcting this in the capture path instead would
   * be the dangerous version of the same fix: a genuinely mirrored photograph
   * puts the card's text backwards and no reader can do anything with it.
   */
  const [frontFacing, setFrontFacing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftNumber, setDraftNumber] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /*
   * Aborts the read in flight.
   *
   * A model call takes seconds, which is long enough for someone to close the
   * panel, discard the result and take another photo while the first is still
   * being read. Without this the earlier answer arrives late and overwrites the
   * newer one - the classic race, and one that would silently put the wrong
   * card's details into the form.
   */
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
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

  /**
   * Whether a reader is configured at all.
   *
   * Asked once, when the panel is first opened, rather than at mount: a visitor
   * who never scans a card should not cause a request. A deployment with no
   * model host hides the whole feature instead of offering it and then failing
   * at the moment somebody tries to use it.
   */
  const checkAvailable = useCallback(async (): Promise<boolean> => {
    try {
      // GET rather than an empty POST. The POST path counts against the scan
      // budget, so probing with one would let a visitor exhaust their own
      // allowance simply by opening the panel a few times.
      const response = await fetch('/api/ocr', { method: 'GET' });
      if (response.status === 503) {
        setStatus('unsupported');
        return false;
      }
      return true;
    } catch {
      // A network failure here is not proof of anything: the endpoint may be
      // fine and the tab briefly offline. Let the real attempt report it.
      return true;
    }
  }, []);

  /**
   * Send one prepared card to be read.
   *
   * The image is encoded and posted as `multipart/form-data` rather than as
   * base64 in a JSON body: base64 inflates the payload by a third for no gain,
   * and a multipart part streams rather than being held twice in memory.
   */
  const readImage = useCallback(async (prepared: PreparedImage) => {
    // Any read still running belongs to a photo the person has moved on from.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    setPhase('prepare');
    const blob = await toUploadBlob(prepared.canvas);

    const body = new FormData();
    body.append('image', blob, 'card.jpg');

    setStatus('reading');
    setPhase('read');

    const response = await fetch('/api/ocr', {
      method: 'POST',
      body,
      signal: controller.signal,
    });

    // A newer scan started while this one was in flight; its answer is the one
    // that should win, so this reply is dropped rather than applied.
    if (controller.signal.aborted) return;

    if (response.status === 503) {
      /*
       * Two different situations share this status, and the difference is the
       * whole point: `not_configured` means this deployment has no reader at
       * all and never will, while anything else means the host exists and did
       * not answer - worth trying again. Reading the body rather than assuming
       * is what stops an unreachable host from being reported as a deployment
       * that was never meant to scan.
       */
      const reason = await response
        .json()
        .then((body: { error?: string }) => body.error)
        .catch(() => undefined);

      setStatus(reason === 'not_configured' ? 'unsupported' : 'offline');
      return;
    }
    if (response.status === 429) {
      setStatus('throttled');
      return;
    }
    if (!response.ok) {
      setStatus('error');
      return;
    }

    const fields = (await response.json()) as CardFields;

    setBlurry(prepared.sharpness < BLUR_THRESHOLD);
    setParsed(fields);
    setDraftName(fields.fullName ?? '');
    setDraftNumber(fields.identityNumber ?? '');
    setStatus('done');
  }, []);

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
      setParsed(null);

      try {
        // Downscaled before it is sent, so a twelve-megapixel photo does not
        // spend longer in transit than the model spends reading it.
        await readImage(await prepareFile(file));
      } catch (error) {
        // An abort is this component cancelling its own request, not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;

        /*
         * A file this browser cannot decode never reached the reader, so
         * saying the card could not be read would be untrue and would send
         * the visitor to photograph it again - producing another file in the
         * same format.
         */
        if (error instanceof UndecodableImageError) {
          log.warn('chosen file could not be decoded');
          setStatus('undecodable');
          return;
        }

        // Never surface the underlying error: it can contain local file paths.
        log.error('card read failed', undefined, error);
        setStatus('error');
      } finally {
        // The prepared canvas is unreferenced once recognition returns, so the
        // only handle left is the input's own copy of the file.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [readImage],
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
    // Cleared with the stream: the next camera opened may not be the same one.
    setFrontFacing(false);

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

      /*
       * `facingMode` is what the device actually gave, which is not necessarily
       * what was asked for: the constraint above is `ideal`, so a machine with
       * no rear camera - any laptop - satisfies it with the front one rather
       * than failing.
       *
       * Only an explicit `environment` counts as rear, because a great many
       * cameras report no `facingMode` at all. Desktop browsers routinely omit
       * it for a built-in or USB webcam, having no meaningful answer to give,
       * and those are precisely the cameras that point at the person. Testing
       * for `=== 'user'` therefore misses the whole case this exists for, while
       * testing for `!== 'environment'` treats an unlabelled camera as
       * user-facing, which for a webcam it always is. Phones do report the
       * value, so a rear camera still identifies itself and is left alone.
       */
      const facing = stream.getVideoTracks()[0]?.getSettings().facingMode;
      setFrontFacing(facing !== 'environment');

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
    setParsed(null);

    try {
      // The sharpest of the burst, and only that one: every frame sent is a
      // separate model call, so this is where the burst pays for itself.
      const sharpest = frames.reduce((best, frame) =>
        frame.sharpness > best.sharpness ? frame : best,
      );
      await readImage(sharpest);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      log.error('card read failed', undefined, error);
      setStatus('error');
    }
  }, [readImage, stopCamera]);

  function applyAndClose() {
    onApply({
      fullName: draftName.trim() || undefined,
      identityNumber: draftNumber.trim() || undefined,
    });
    reset();
  }

  function reset() {
    stopCamera();
    // Discarding a result while its successor is still being read would let
    // the older answer land in an emptied panel.
    requestRef.current?.abort();
    requestRef.current = null;
    setCameraFault(null);
    setParsed(null);
    setBlurry(false);
    setDraftName('');
    setDraftNumber('');
    setStatus('idle');
    setPhase('prepare');
    setDragging(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--line-strong)] p-4">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setOpen(true);
            // Fire and forget: the panel opens immediately either way, and the
            // probe only decides whether it shows a dropzone or an explanation.
            void checkAvailable();
          }}
        >
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

      {status === 'idle' ||
      status === 'error' ||
      status === 'rejected' ||
      status === 'undecodable' ||
      status === 'throttled' ||
      status === 'offline' ? (
        <div className="mt-4">
          {/*
            The input stays in the accessibility tree and keyboard tab order -
            `sr-only`, never `hidden` - and the label is what gets styled. That
            keeps one native control doing the work, so a keyboard user opens
            the same picker a pointer user does.
          */}
          {/*
            Named formats rather than `image/*`, and this is the fix rather
            than the guard: asked for `image/*`, a phone hands over the file as
            it sits in the camera roll, and on an iPhone or a recent Samsung
            that is HEIC - which the browser cannot decode, so the scan failed
            before anything was ever uploaded. Listing only formats that decode
            everywhere makes iOS transcode the chosen photo to JPEG on its way
            out, and makes an Android picker hide the ones that would fail.

            These are the same three the server accepts. The browser re-encodes
            to JPEG before upload regardless, so this constrains what can be
            *chosen*, not what is sent.
          */}
          <input
            ref={inputRef}
            id="ic-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
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

          {/*
            Above the read failures, because it is a different kind of problem:
            nothing was read, so nothing about the card or the lighting is worth
            changing. The dropzone and the camera button both stay in reach, and
            the camera is the way out - it produces a frame this browser encoded
            itself, so it cannot be in a format it then cannot decode.
          */}
          {status === 'undecodable' ? (
            <div className="mt-3">
              <Alert tone="warning">{t.undecodable}</Alert>
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
          {status === 'throttled' ? (
            <div className="mt-3">
              <Alert tone="warning">{t.throttled}</Alert>
            </div>
          ) : null}
          {/*
            Shown above the dropzone rather than replacing it: the host may well
            be back by the time the photo is retaken, so the way out stays in
            reach instead of the panel becoming a dead end.
          */}
          {status === 'offline' ? (
            <div className="mt-3">
              <Alert tone="warning">{t.offline}</Alert>
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
              // Preview only, and only on a camera pointed at the person - see
              // `frontFacing`. The captured frame is never flipped.
              style={frontFacing ? { transform: 'scaleX(-1)' } : undefined}
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
            {phase === 'read' ? t.reading : t.loading}
          </p>
          {/*
            Indeterminate, because it honestly is. The model answers when it
            answers and reports nothing on the way, so a bar creeping towards a
            number nobody knows would be an invented progress signal - worse
            than none, because it implies knowledge that does not exist.
          */}
          <div
            role="progressbar"
            aria-busy="true"
            aria-label={phase === 'read' ? t.reading : t.loading}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]"
          >
            <div className="ocr-progress-sweep h-full w-1/3 rounded-full bg-[var(--accent)]" />
          </div>
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

          {/*
            The model is asked what kind of document it saw, and this is the
            only thing that answer is used for. It catches the common mistake of
            photographing a passport while the form says MyKad, which otherwise
            produces a number that fails validation with no explanation.
          */}
          {parsed.card && parsed.card !== 'ic' ? (
            <Alert tone="warning">{t.cardMismatch}</Alert>
          ) : null}

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

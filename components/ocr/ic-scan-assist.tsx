'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

type Status = 'idle' | 'loading' | 'reading' | 'done' | 'error' | 'unsupported';

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
    privacy:
      'The photo is processed in this browser only. It is never uploaded and never stored.',
    choose: 'Choose a photo',
    reading: 'Reading the card...',
    loading: 'Preparing the reader...',
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
    privacy:
      'Gambar diproses dalam pelayar ini sahaja. Ia tidak dimuat naik dan tidak disimpan.',
    choose: 'Pilih gambar',
    reading: 'Sedang membaca kad...',
    loading: 'Menyediakan pembaca...',
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

export function IcScanAssist({ onApply, locale = 'en' }: IcScanAssistProps) {
  const t = COPY[locale];

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [parsed, setParsed] = useState<ParsedIcFields | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftNumber, setDraftNumber] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  // Held so the worker can be torn down if the component unmounts mid-read.
  const workerRef = useRef<{ terminate: () => Promise<unknown> } | null>(null);

  useEffect(() => {
    return () => {
      void workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus('loading');
      setProgress(0);
      setParsed(null);

      let objectUrl: string | null = null;

      try {
        // Imported here, not at module scope, so the OCR runtime is fetched
        // only when someone actually opens this panel.
        const { createWorker } = await import('tesseract.js');

        const worker = await createWorker('eng', 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr',
          langPath: '/ocr/tessdata',
          // The model is served uncompressed from our own origin.
          gzip: false,
          logger: (message: { status: string; progress: number }) => {
            if (message.status === 'recognizing text') {
              setStatus('reading');
              setProgress(Math.round(message.progress * 100));
            }
          },
        });

        workerRef.current = worker;

        objectUrl = URL.createObjectURL(file);
        const { data } = await worker.recognize(objectUrl);

        const fields = parseIcText(data.text);
        setParsed(fields);
        setDraftName(fields.fullName ?? '');
        setDraftNumber(fields.identityNumber ?? '');
        setStatus('done');

        await worker.terminate();
        workerRef.current = null;
      } catch (error) {
        // Never surface the underlying error: it can contain local file paths.
        log.error('recognition failed', undefined, error);
        setStatus('error');
      } finally {
        // Release the image immediately, whatever happened.
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [],
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
    setDraftName('');
    setDraftNumber('');
    setStatus('idle');
    setProgress(0);
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

      <div className="mt-3">
        <Alert tone="info">
          <p>{t.disclaimer}</p>
          <p className="mt-1">{t.privacy}</p>
        </Alert>
      </div>

      {status === 'idle' || status === 'error' ? (
        <div className="mt-4">
          <label
            htmlFor="ic-photo"
            className="text-sm font-medium text-[var(--text-strong)]"
          >
            {t.choose}
          </label>
          <input
            ref={inputRef}
            id="ic-photo"
            type="file"
            accept="image/*"
            // `capture` opens the rear camera directly on a phone or tablet.
            capture="environment"
            className="mt-1 block w-full text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {status === 'error' ? (
            <div className="mt-3">
              <Alert tone="warning">{t.failed}</Alert>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === 'loading' || status === 'reading' ? (
        <p className="mt-4 text-sm" role="status" aria-live="polite">
          {status === 'loading' ? t.loading : `${t.reading} ${progress}%`}
        </p>
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

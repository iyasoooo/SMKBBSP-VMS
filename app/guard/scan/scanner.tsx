'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { clsx } from 'clsx';
import { lookupPassAction, type PassLookupPayload } from '@/app/guard/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, fieldAria } from '@/components/ui/field';
import { Alert, Card, DetailRow, Pill } from '@/components/ui/surface';
import type { GuardDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/result';

type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable';

function LookupButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? busyLabel : label}
    </Button>
  );
}

/**
 * Guard scanner.
 *
 * The manual code field is always present, never hidden behind a "camera
 * failed" branch. A guard on a tablet with a broken or refused camera must be
 * able to process an arrival without discovering a fallback first, so the
 * camera is treated as an accelerator for a form that already works.
 */
export function Scanner({ t }: { t: GuardDictionary }) {
  const [state, formAction] = useActionState<ActionResult<PassLookupPayload> | null, FormData>(
    lookupPassAction,
    null,
  );

  const [camera, setCamera] = useState<CameraState>('idle');
  /*
   * Whether to show the preview mirrored.
   *
   * A front-facing camera - a laptop webcam, or a tablet turned towards the
   * guard - produces a feed in which moving the pass to your right moves it
   * left on screen. Aiming at a small code that way is genuinely awkward, and
   * every video-call application mirrors for exactly this reason. A rear camera
   * must be left alone: it already shows the scene the way the person holding
   * the device sees it, and mirroring that would introduce the problem instead
   * of fixing it.
   */
  const [mirrored, setMirrored] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<string>('');

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    // Cleared with the stream: the next camera opened may face the other way.
    setMirrored(false);
    setCamera('idle');
  }, []);

  // Always release the camera when leaving the page; a still-live stream keeps
  // the tablet's camera indicator on and drains the battery.
  useEffect(() => () => controlsRef.current?.stop(), []);

  const startCamera = useCallback(async () => {
    setCamera('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }

    try {
      const reader = new BrowserQRCodeReader();
      const video = videoRef.current;
      if (!video) {
        setCamera('unavailable');
        return;
      }

      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        video,
        (result) => {
          if (!result) return;
          const text = result.getText();

          // The decoder fires continuously while the code is in frame; submit
          // each distinct value once.
          if (text === lastScanRef.current) return;
          lastScanRef.current = text;

          if (tokenRef.current) tokenRef.current.value = text;
          controlsRef.current?.stop();
          controlsRef.current = null;
          setMirrored(false);
          setCamera('idle');
          formRef.current?.requestSubmit();
        },
      );

      /*
       * Decide from the track that actually opened rather than from what was
       * requested. Desktop browsers routinely report no `facingMode` at all,
       * and a built-in laptop webcam is always user-facing, so anything that is
       * not explicitly `environment` is treated as one.
       */
      const source = video.srcObject;
      const track = source instanceof MediaStream ? source.getVideoTracks()[0] : undefined;
      setMirrored(track?.getSettings().facingMode !== 'environment');

      setCamera('running');
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, []);

  const result = state?.ok ? state.data : null;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">{t.scanHeading}</h2>
            <p className="mt-0.5 text-sm text-muted">{t.scanInstruction}</p>
          </div>

          <div className="relative aspect-[4/3] w-full bg-black">
            {/*
              Mirrored in CSS only. The decoder reads frames from the video
              element's own buffer, which a transform never touches, so the
              preview can be flipped while decoding still sees the true
              orientation - which matters, because a QR code read back to front
              does not decode.
            */}
            <video
              ref={videoRef}
              className={clsx('size-full object-cover', mirrored && '-scale-x-100')}
              muted
              playsInline
              aria-label={t.scanHeading}
            />
            {camera !== 'running' ? (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/70">
                {camera === 'starting' ? t.loading : t.scanInstruction}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3 p-4">
            {camera === 'running' ? (
              <Button type="button" variant="secondary" size="lg" onClick={stopCamera}>
                {t.stopCamera}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                onClick={() => void startCamera()}
                disabled={camera === 'starting'}
              >
                {t.startCamera}
              </Button>
            )}
          </div>

          {camera === 'denied' ? (
            <div className="px-4 pb-4">
              <Alert tone="warning">{t.cameraDenied}</Alert>
            </div>
          ) : null}
          {camera === 'unavailable' ? (
            <div className="px-4 pb-4">
              <Alert tone="warning">{t.cameraUnavailable}</Alert>
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">{t.useManualCode}</h2>

          <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-4">
            {/* Populated by the camera; the guard never types into this. */}
            <input type="hidden" name="value" ref={tokenRef} />
            <input type="hidden" name="mode" value="token" />
          </form>

          <form action={formAction} className="mt-2 flex flex-col gap-4">
            <input type="hidden" name="mode" value="code" />
            <Field id="code" label={t.manualCodeLabel} hint={t.manualCodeHint} required>
              <Input
                {...fieldAria('code', { hint: true })}
                name="value"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                className="h-14 font-mono text-2xl tracking-[0.3em] uppercase"
                placeholder="ABCD-EFGH"
              />
            </Field>
            <LookupButton label={t.lookUp} busyLabel={t.searching} />
          </form>
        </Card>
      </div>

      <div>
        {state && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}
        {result ? <PassResult payload={result} t={t} /> : null}
        {!state ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted">{t.scanInstruction}</p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function PassResult({ payload, t }: { payload: PassLookupPayload; t: GuardDictionary }) {
  const presentation = describeState(payload.state, t);

  return (
    <Card className="overflow-hidden">
      <div
        className="px-5 py-4"
        style={{ background: presentation.background, color: presentation.color }}
      >
        <p className="text-lg font-semibold">{presentation.label}</p>
        <p className="mt-0.5 text-sm opacity-90">{presentation.help}</p>
      </div>

      {payload.state === 'NOT_FOUND' ? (
        <div className="p-5">
          <p className="text-sm text-muted">{t.passNotFound}</p>
        </div>
      ) : (
        <>
          {payload.blacklist === 'BLOCKED' ? (
            <div className="p-4">
              <Alert tone="danger" title={t.statusBlocked}>
                {t.blockedInstruction}
              </Alert>
            </div>
          ) : payload.blacklist === 'REVIEW' ? (
            <div className="p-4">
              <Alert tone="warning" title={t.statusReview}>
                {t.reviewInstruction}
              </Alert>
            </div>
          ) : null}

          <dl className="divide-y divide-[var(--line-soft)] px-5 py-2">
            <DetailRow label={t.visitor}>{payload.visitorName ?? '-'}</DetailRow>
            <DetailRow label={t.identity}>
              <span className="font-mono">{payload.identityMasked ?? '-'}</span>
            </DetailRow>
            <DetailRow label={t.host}>{payload.hostName ?? '-'}</DetailRow>
            <DetailRow label={t.destination}>{payload.destinationName ?? '-'}</DetailRow>
            <DetailRow label={t.partySize}>{payload.partySize ?? 1}</DetailRow>
            <DetailRow label={t.reference}>
              <span className="font-mono text-xs">{payload.reference ?? '-'}</span>
            </DetailRow>
            {payload.blacklist ? (
              <DetailRow label="Check">
                <Pill
                  tone={
                    payload.blacklist === 'BLOCKED'
                      ? 'danger'
                      : payload.blacklist === 'REVIEW'
                        ? 'warning'
                        : 'success'
                  }
                >
                  {payload.blacklist === 'BLOCKED'
                    ? t.statusBlocked
                    : payload.blacklist === 'REVIEW'
                      ? t.statusReview
                      : t.statusClear}
                </Pill>
              </DetailRow>
            ) : null}
          </dl>

          {payload.visitId ? (
            <div className="border-t border-[var(--line-soft)] p-4">
              <Link
                href={`/guard/visits/${payload.visitId}`}
                className="flex min-h-12 w-full items-center justify-center rounded-lg bg-[var(--accent)] px-6 text-base font-medium text-[var(--accent-text)]"
              >
                Open visit
              </Link>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function describeState(
  state: PassLookupPayload['state'],
  t: GuardDictionary,
): { label: string; help: string; background: string; color: string } {
  const ok = { background: 'var(--ok)', color: '#fff' };
  const warn = { background: 'var(--warn)', color: '#fff' };
  const bad = { background: 'var(--danger)', color: '#fff' };
  const info = { background: 'var(--info)', color: '#fff' };

  switch (state) {
    case 'VALID':
      return { label: t.passValid, help: 'Open the visit to check this visitor in.', ...ok };
    case 'ALREADY_CHECKED_IN':
      return { label: t.passAlreadyIn, help: 'Open the visit to check this visitor out.', ...info };
    case 'ALREADY_CHECKED_OUT':
      return { label: t.passAlreadyOut, help: 'This visit is already complete.', ...info };
    case 'TOO_EARLY':
      return { label: t.passTooEarly, help: 'This pass is not valid yet.', ...warn };
    case 'EXPIRED':
      return { label: t.passExpired, help: 'The visiting window has closed.', ...bad };
    case 'REVOKED':
      return { label: t.passRevoked, help: 'This pass was withdrawn by the school.', ...bad };
    case 'NOT_APPROVED':
      return { label: t.passNotApproved, help: 'This visit was not approved.', ...bad };
    case 'CANCELLED':
      return { label: t.passCancelled, help: 'This visit was cancelled.', ...bad };
    case 'NOT_FOUND':
    default:
      return { label: t.passNotFound, help: 'Check the code and try again.', ...bad };
  }
}

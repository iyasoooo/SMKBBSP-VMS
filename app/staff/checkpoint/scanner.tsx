'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import clsx from 'clsx';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { CheckpointKind } from '@prisma/client';
import {
  recordCheckpointScanAction,
  type CheckpointScanPayload,
} from '@/app/staff/checkpoint/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, fieldAria } from '@/components/ui/field';
import { Alert, Card } from '@/components/ui/surface';
import type { GuardDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/result';

type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable';

export interface DestinationOption {
  id: string;
  name: string;
}

function SubmitButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? busyLabel : label}
    </Button>
  );
}

/**
 * Staff checkpoint scanner.
 *
 * Structured like the gate scanner on purpose, including its most important
 * decision: the typed code is always on screen rather than hidden behind a
 * camera failure. A teacher on a desktop with no webcam, or a guard whose
 * tablet camera is refused, must be able to confirm a visitor without first
 * discovering that a fallback exists.
 */
export function CheckpointScanner({
  t,
  destinations,
  defaultDestinationId,
}: {
  t: GuardDictionary;
  destinations: DestinationOption[];
  defaultDestinationId: string | null;
}) {
  const [state, formAction] = useActionState<ActionResult<CheckpointScanPayload> | null, FormData>(
    recordCheckpointScanAction,
    null,
  );

  const [camera, setCamera] = useState<CameraState>('idle');
  const [mirrored, setMirrored] = useState(false);
  const [kind, setKind] = useState<CheckpointKind>(CheckpointKind.ARRIVAL);
  const [destinationId, setDestinationId] = useState(defaultDestinationId ?? '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const tokenFormRef = useRef<HTMLFormElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<string>('');

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setMirrored(false);
    setCamera('idle');
  }, []);

  // Release the camera when leaving; a live stream keeps the device's camera
  // indicator lit and drains the battery.
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

      controlsRef.current = await reader.decodeFromVideoDevice(undefined, video, (result) => {
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
        tokenFormRef.current?.requestSubmit();
      });

      /*
       * Mirror based on the track that actually opened. A built-in laptop
       * webcam is user-facing and reports no facingMode at all, so anything
       * not explicitly `environment` is treated as front-facing.
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
          {/* The page heading already carries the title and instruction; a
              second copy here only pushed the camera below the fold. */}
          <div className="relative aspect-[4/3] w-full bg-black">
            {/*
              Mirrored in CSS only. The decoder reads from the video element's
              own buffer, which a transform never touches, so the preview can be
              flipped while decoding still sees the true orientation.
            */}
            <video
              ref={videoRef}
              className={clsx('size-full object-cover', mirrored && '-scale-x-100')}
              muted
              playsInline
              aria-label={t.checkpointHeading}
            />
            {camera !== 'running' ? (
              <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/70">
                {camera === 'starting' ? t.loading : t.checkpointInstruction}
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
      </div>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <fieldset>
            <legend className="text-base font-semibold">{t.checkpointWhat}</legend>

            <div className="mt-4 flex flex-col gap-4">
              <Field id="kind" label={t.checkpointType}>
                <Select
                  {...fieldAria('kind', {})}
                  name="kind-display"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as CheckpointKind)}
                >
                  <option value={CheckpointKind.ARRIVAL}>{t.confirmArrival}</option>
                  <option value={CheckpointKind.PRESENCE}>{t.recordPresence}</option>
                  <option value={CheckpointKind.DEPARTURE}>{t.confirmDeparture}</option>
                </Select>
              </Field>

              <Field id="destinationId" label={t.destination}>
                <Select
                  {...fieldAria('destinationId', {})}
                  name="destinationId-display"
                  value={destinationId}
                  onChange={(event) => setDestinationId(event.target.value)}
                >
                  <option value="">{t.checkpointNoDestination}</option>
                  {destinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </fieldset>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">{t.useManualCode}</h2>

          {/* Populated by the camera; nobody types into this one. */}
          <form ref={tokenFormRef} action={formAction}>
            <input type="hidden" name="token" ref={tokenRef} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="destinationId" value={destinationId} />
          </form>

          <form action={formAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="destinationId" value={destinationId} />
            <Field id="code" label={t.manualCodeLabel} hint={t.manualCodeHint} required>
              <Input
                {...fieldAria('code', { hint: true })}
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                className="font-mono text-lg tracking-widest uppercase"
              />
            </Field>
            <SubmitButton label={t.confirm} busyLabel={t.searching} />
          </form>
        </Card>

        <div aria-live="polite">
          {state?.ok === false ? <Alert tone="danger">{state.message}</Alert> : null}
          {result ? (
            <Alert
              tone={result.deduped ? 'info' : 'success'}
              title={
                result.deduped
                  ? t.alreadyConfirmed
                  : result.kind === CheckpointKind.DEPARTURE
                    ? t.departureConfirmed
                    : t.arrivalConfirmed
              }
            >
              <p className="font-semibold">{result.visitorName}</p>
              <p className="font-mono text-xs">{result.badgeNumber}</p>
              {result.destinationName ? (
                <p className="text-xs">
                  {t.atDestination} {result.destinationName}
                </p>
              ) : null}
            </Alert>
          ) : null}
        </div>
      </div>
    </div>
  );
}

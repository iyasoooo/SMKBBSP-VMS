'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  checkInAction,
  checkOutAction,
  denyEntryAction,
  recordSightingAction,
} from '@/app/guard/actions';
import { Button, buttonClasses } from '@/components/ui/button';
import { Checkbox, Textarea } from '@/components/ui/field';
import { Alert, Card } from '@/components/ui/surface';
import type { GuardDictionary } from '@/lib/i18n/dictionary';
import type { ActionResult } from '@/lib/result';

function SubmitButton({
  label,
  busyLabel,
  variant,
  disabled,
}: {
  label: string;
  busyLabel: string;
  variant: 'success' | 'danger' | 'primary';
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="lg" disabled={pending || disabled}>
      {pending ? busyLabel : label}
    </Button>
  );
}

/**
 * Check-in panel.
 *
 * When the visit type requires it, the check-in button stays disabled until
 * the guard ticks the ID declaration. The server enforces the same rule, so
 * this is a usability aid rather than the control itself.
 */
export function CheckInPanel({
  visitId,
  requiresIdSighted,
  blocked,
  t,
}: {
  visitId: string;
  requiresIdSighted: boolean;
  blocked: boolean;
  t: GuardDictionary;
}) {
  const [state, formAction] = useActionState<
    ActionResult<{ badgeNumber: string; visitId: string }> | null,
    FormData
  >(checkInAction, null);
  const [idSighted, setIdSighted] = useState(false);
  const router = useRouter();

  if (state?.ok) {
    return (
      <Alert tone="success" title={t.checkedInSuccess}>
        <p className="mt-1">
          {t.badgeNumber}: <strong className="font-mono">{state.data.badgeNumber}</strong>
        </p>
        {/* Nothing to hand over here: this visitor arrived on an approved
            appointment, so they are already holding their pass. */}
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => router.refresh()}
            className={buttonClasses('primary', 'lg')}
          >
            {t.back}
          </button>
        </div>
      </Alert>
    );
  }

  if (blocked) {
    return (
      <Alert tone="danger" title={t.statusBlocked}>
        {t.blockedInstruction}
      </Alert>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{t.checkIn}</h2>

      {state && !state.ok ? (
        <div className="mt-3">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="visitId" value={visitId} />

        {requiresIdSighted ? (
          <>
            <Checkbox
              id="idSighted"
              name="idSighted"
              checked={idSighted}
              onChange={(event) => setIdSighted(event.target.checked)}
              label={<span className="font-medium">{t.confirmIdSighted}</span>}
            />
            <p className="-mt-2 text-xs text-muted">{t.idSightedHelp}</p>
          </>
        ) : (
          <p className="text-sm text-muted">{t.idNotRequired}</p>
        )}

        <SubmitButton
          label={t.checkIn}
          busyLabel={t.loading}
          variant="success"
          disabled={requiresIdSighted && !idSighted}
        />
      </form>
    </Card>
  );
}

export function CheckOutPanel({ visitId, t }: { visitId: string; t: GuardDictionary }) {
  const [state, formAction] = useActionState<ActionResult<{ badgeNumber: string }> | null, FormData>(
    checkOutAction,
    null,
  );
  const router = useRouter();

  if (state?.ok) {
    return (
      <Alert tone="success" title={t.checkedOutSuccess}>
        <p className="mt-1">
          {t.badgeNumber}: <strong className="font-mono">{state.data.badgeNumber}</strong>
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => router.refresh()}
            className={buttonClasses('secondary', 'lg')}
          >
            {t.back}
          </button>
        </div>
      </Alert>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{t.checkOut}</h2>

      {state && !state.ok ? (
        <div className="mt-3">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      <form action={formAction} className="mt-4">
        <input type="hidden" name="visitId" value={visitId} />
        <SubmitButton label={t.checkOut} busyLabel={t.loading} variant="primary" />
      </form>
    </Card>
  );
}

/** Denial requires an explicit second step and an optional note for the record. */
export function DenyPanel({ visitId, t }: { visitId: string; t: GuardDictionary }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    denyEntryAction,
    null,
  );
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (state?.ok) {
    return (
      <Alert tone="info" title={t.deniedSuccess}>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-2 font-medium underline underline-offset-2"
        >
          {t.back}
        </button>
      </Alert>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(true)}>
        {t.deny}
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{t.deny}</h2>

      {state && !state.ok ? (
        <div className="mt-3">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="visitId" value={visitId} />
        <label htmlFor="deny-note" className="text-sm font-medium">
          Note for the record
        </label>
        <Textarea id="deny-note" name="note" rows={2} maxLength={300} />
        <div className="flex flex-wrap gap-3">
          <SubmitButton label={t.confirm} busyLabel={t.loading} variant="danger" />
          <Button type="button" variant="secondary" size="lg" onClick={() => setOpen(false)}>
            {t.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Record that a guard has seen this visitor during rounds.
 *
 * Offered only while a visit is checked in. It answers the question the gate
 * screen otherwise cannot - "has anybody laid eyes on this person since they
 * came through?" - without asking the visitor for anything.
 */
export function SightingPanel({ visitId, t }: { visitId: string; t: GuardDictionary }) {
  const [state, formAction] = useActionState<
    ActionResult<{ visitorName: string; deduped: boolean }> | null,
    FormData
  >(recordSightingAction, null);

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{t.recordPresence}</h2>
      <p className="mt-1 text-sm text-muted">{t.recordSightingHelp}</p>

      <form action={formAction} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="visitId" value={visitId} />
        <label htmlFor="sighting-note" className="text-sm font-medium">
          {t.sightingNote}
        </label>
        <Textarea id="sighting-note" name="note" rows={2} maxLength={200} />
        <SubmitButton label={t.confirm} busyLabel={t.loading} variant="primary" />
      </form>

      <p aria-live="polite" className="mt-2 text-sm">
        {state?.ok === false ? (
          <span style={{ color: 'var(--danger)' }}>{state.message}</span>
        ) : state?.ok === true ? (
          <span className="text-muted">
            {state.data.deduped ? t.alreadyConfirmed : t.sightingRecorded}
          </span>
        ) : null}
      </p>
    </Card>
  );
}

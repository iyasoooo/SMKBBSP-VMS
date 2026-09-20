'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckpointKind } from '@prisma/client';
import { confirmVisitorAction, type ConfirmVisitorPayload } from '@/app/teacher/actions';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/result';

function SubmitButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" disabled={pending}>
      {pending ? busyLabel : label}
    </Button>
  );
}

/**
 * Host confirmation control for one visitor.
 *
 * Rendered only for a visit the gate has already checked in, which is what
 * makes a single tap an acceptable substitute for scanning a pass: the teacher
 * is confirming that an already-admitted visitor reached them, not asserting
 * that somebody is on the grounds.
 *
 * The result is announced through a live region because the visible change -
 * one button swapping for another - is easy to miss on a phone held at arm's
 * length between other tasks.
 */
export function ConfirmArrival({
  visitId,
  confirmedAt,
  departedAt,
  labels,
}: {
  visitId: string;
  confirmedAt: string | null;
  departedAt: string | null;
  labels: {
    confirmArrival: string;
    confirmDeparture: string;
    arrivalConfirmed: string;
    departureConfirmed: string;
    alreadyConfirmed: string;
    loading: string;
  };
}) {
  const [state, formAction] = useActionState<ActionResult<ConfirmVisitorPayload> | null, FormData>(
    confirmVisitorAction,
    null,
  );

  // The server revalidates the page, so props lead; local state only covers
  // the moment between the action resolving and the refreshed props arriving.
  const arrived = Boolean(confirmedAt) || (state?.ok === true);
  const departed =
    Boolean(departedAt) || (state?.ok === true && state.data.kind === CheckpointKind.DEPARTURE);

  /*
   * One message, from one source. An earlier version rendered a static label
   * next to the live region and both fired after a departure, so the row read
   * "Departure recorded" twice - once visually and twice to a screen reader.
   */
  const status = state?.ok
    ? state.data.deduped
      ? labels.alreadyConfirmed
      : state.data.kind === CheckpointKind.ARRIVAL
        ? labels.arrivalConfirmed
        : labels.departureConfirmed
    : departed
      ? labels.departureConfirmed
      : arrived
        ? labels.arrivalConfirmed
        : null;

  return (
    <div className="flex flex-col items-start gap-1">
      {departed ? null : (
        <form action={formAction}>
          <input type="hidden" name="visitId" value={visitId} />
          <input
            type="hidden"
            name="kind"
            value={arrived ? CheckpointKind.DEPARTURE : CheckpointKind.ARRIVAL}
          />
          <SubmitButton
            label={arrived ? labels.confirmDeparture : labels.confirmArrival}
            busyLabel={labels.loading}
          />
        </form>
      )}

      <p aria-live="polite" className="text-xs">
        {state?.ok === false ? (
          <span style={{ color: 'var(--danger)' }}>{state.message}</span>
        ) : status ? (
          <span className="text-muted">{status}</span>
        ) : null}
      </p>
    </div>
  );
}

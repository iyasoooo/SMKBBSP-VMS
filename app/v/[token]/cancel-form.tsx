'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { cancelRequestAction } from './actions';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Cancelling...' : 'Yes, cancel my request'}
    </Button>
  );
}

/**
 * Cancellation requires an explicit confirmation step rather than firing on
 * the first click: this is destructive and the page may be open on a phone in
 * a pocket.
 */
export function CancelRequestForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    cancelRequestAction,
    null,
  );
  const [confirming, setConfirming] = useState(false);

  if (state?.ok) {
    return (
      <Alert tone="info" title="Request cancelled">
        Your request has been cancelled. Refresh this page to see the updated status.
      </Alert>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Need to cancel?</h2>
      <p className="mt-1 text-sm text-muted">
        If your plans have changed, please cancel so your host teacher and the guard house are not
        expecting you.
      </p>

      {state && !state.ok ? (
        <div className="mt-3">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      {confirming ? (
        <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
          <input type="hidden" name="token" value={token} />
          <p className="w-full text-sm font-medium text-[var(--text-strong)]">
            This cannot be undone. Are you sure?
          </p>
          <ConfirmButton />
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
            Keep my request
          </Button>
        </form>
      ) : (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            Cancel this request
          </Button>
        </div>
      )}
    </Card>
  );
}

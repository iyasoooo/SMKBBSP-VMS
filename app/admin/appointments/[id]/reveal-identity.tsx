'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { revealIdentityAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, fieldAria } from '@/components/ui/field';
import { Alert, Card } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function RevealButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Checking...' : 'Reveal identity number'}
    </Button>
  );
}

/**
 * Audited identity reveal.
 *
 * Three deliberate frictions: it is closed by default, it requires a written
 * reason, and the reason is recorded before the value is returned. The value
 * is shown only in this component's memory - it is never written into the
 * page's initial HTML, so it cannot leak through a cached document or a
 * screenshot of the page source.
 */
export function RevealIdentity({
  visitorId,
  maskedValue,
}: {
  visitorId: string;
  maskedValue: string;
}) {
  const [state, formAction] = useActionState<ActionResult<{ fullValue: string }> | null, FormData>(
    revealIdentityAction,
    null,
  );
  const [open, setOpen] = useState(false);

  if (state?.ok) {
    return (
      <Card className="p-5">
        <h2 className="text-base font-semibold">Identity number</h2>
        <p className="mt-3 font-mono text-2xl font-semibold tracking-wide text-[var(--text-strong)]">
          {state.data.fullValue}
        </p>
        <div className="mt-3">
          <Alert tone="warning">
            This reveal has been recorded in the audit log with your name and reason. Close this
            page when you are finished.
          </Alert>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Identity number</h2>
      <p className="mt-1 font-mono text-lg">{maskedValue}</p>

      {!open ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            Request full value
          </Button>
          <p className="mt-2 text-xs text-muted">
            Revealing the full number is recorded in the audit log.
          </p>
        </div>
      ) : (
        <form action={formAction} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="visitorId" value={visitorId} />

          {state && !state.ok ? <Alert tone="danger">{state.message}</Alert> : null}

          <Field
            id="reveal-reason"
            label="Reason for viewing"
            required
            hint="Recorded in the audit log alongside your name."
          >
            <Input
              {...fieldAria('reveal-reason', { hint: true })}
              name="reason"
              required
              minLength={5}
              maxLength={200}
              placeholder="e.g. Police request reference 12/2026"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <RevealButton />
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

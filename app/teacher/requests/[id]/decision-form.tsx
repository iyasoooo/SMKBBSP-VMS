'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { decideRequestAction } from '@/app/teacher/actions';
import { Button } from '@/components/ui/button';
import { Field, Textarea, fieldAria } from '@/components/ui/field';
import { Alert, Card } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function DecisionButtons({ mode }: { mode: 'APPROVE' | 'REJECT' | null }) {
  const { pending } = useFormStatus();

  if (mode === 'REJECT') {
    return (
      <Button type="submit" variant="danger" size="lg" disabled={pending}>
        {pending ? 'Recording...' : 'Confirm rejection'}
      </Button>
    );
  }

  return (
    <Button type="submit" variant="success" size="lg" disabled={pending}>
      {pending ? 'Recording...' : 'Confirm approval'}
    </Button>
  );
}

/**
 * Approve / reject control.
 *
 * The two paths are separated by an explicit mode step rather than two
 * submit buttons on one form: approving a visitor by mis-tapping is a real
 * risk on a phone, and rejection additionally requires a written reason that
 * the visitor will read.
 */
export function DecisionForm({ appointmentId }: { appointmentId: string }) {
  const [state, formAction] = useActionState<ActionResult<{ decision: string }> | null, FormData>(
    decideRequestAction,
    null,
  );
  const [mode, setMode] = useState<'APPROVE' | 'REJECT' | null>(null);
  const router = useRouter();

  if (state?.ok) {
    const approved = state.data.decision.includes('APPROVED');
    return (
      <Alert tone={approved ? 'success' : 'info'} title={approved ? 'Approved' : 'Rejected'}>
        {state.data.decision === 'ALREADY_APPROVED' || state.data.decision === 'ALREADY_REJECTED'
          ? 'This request had already been decided. Nothing was duplicated.'
          : approved
            ? 'The visitor has been emailed their QR pass and the guard house now expects them.'
            : 'The visitor has been emailed your decision. No pass was issued.'}
        <p className="mt-3">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="font-medium underline underline-offset-2"
          >
            Refresh this page
          </button>
        </p>
      </Alert>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Your decision</h2>
      <p className="mt-1 text-sm text-muted">
        Approving issues an expiring QR pass to the visitor. Rejecting issues nothing.
      </p>

      {state && !state.ok ? (
        <div className="mt-4">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      {mode === null ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" variant="success" size="lg" onClick={() => setMode('APPROVE')}>
            Approve this visit
          </Button>
          <Button type="button" variant="danger" size="lg" onClick={() => setMode('REJECT')}>
            Reject
          </Button>
        </div>
      ) : (
        <form action={formAction} className="mt-5 flex flex-col gap-4">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <input type="hidden" name="decision" value={mode} />

          <Field
            id="note"
            label={mode === 'APPROVE' ? 'Note for the visitor (optional)' : 'Reason for rejection'}
            required={mode === 'REJECT'}
            error={state && !state.ok ? state.fieldErrors?.note : undefined}
            hint={
              mode === 'APPROVE'
                ? 'For example where to wait, or what to bring. Included in their approval email.'
                : 'The visitor will read this. Keep it brief and courteous.'
            }
          >
            <Textarea
              {...fieldAria('note', {
                error: state && !state.ok ? state.fieldErrors?.note : undefined,
                hint: true,
              })}
              name="note"
              rows={3}
              maxLength={500}
              required={mode === 'REJECT'}
              hasError={Boolean(state && !state.ok && state.fieldErrors?.note)}
            />
          </Field>

          <div className="flex flex-wrap gap-3">
            <DecisionButtons mode={mode} />
            <Button type="button" variant="secondary" size="lg" onClick={() => setMode(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

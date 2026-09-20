'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { reissuePassAction, type ReissuedPass } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm('Issue a new pass? The visitor’s current link will stop working.')) {
          event.preventDefault();
        }
      }}
    >
      {pending ? 'Issuing...' : label}
    </Button>
  );
}

/**
 * Reissue a pass and show the new link - once.
 *
 * Nothing can be sent to the visitor, so the administrator is the delivery
 * channel. The link exists only in this action's response: it is not stored or
 * audited, so a reload loses it and a second reissue is the only way to get
 * another. The panel says so, rather than letting someone discover it after
 * closing the tab.
 */
export function ReissuePassForm({
  appointmentId,
  hasActivePass,
}: {
  appointmentId: string;
  hasActivePass: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult<ReissuedPass> | null, FormData>(
    reissuePassAction,
    null,
  );

  if (state?.ok) {
    return (
      <Alert tone="success" title="New pass issued">
        <p>
          Give this to the visitor now. It is shown only once and cannot be displayed again after
          you leave or reload this page. Their old link no longer works.
        </p>

        <div className="mt-4 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.data.qrDataUrl}
            alt="QR code of the visitor's new private link"
            width={200}
            height={200}
            className="rounded-lg border border-[var(--line-soft)] bg-white p-2"
          />
          <p className="text-center text-xs">
            If the visitor is with you, they can scan this with their phone camera to open their
            new link.
          </p>
        </div>

        <label className="mt-4 flex flex-col gap-1 text-xs font-medium">
          New private link
          <input
            readOnly
            value={state.data.passUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="rounded-md border border-[var(--line-soft)] bg-[var(--surface-inset)] px-2 py-1.5 font-mono text-xs text-[var(--text-strong)]"
          />
        </label>

        <p className="mt-3 text-xs">
          Manual code for the gate:{' '}
          <span className="font-mono text-sm font-semibold tracking-widest">
            {state.data.fallbackCode}
          </span>
        </p>
      </Alert>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="appointmentId" value={appointmentId} />

      {state && !state.ok ? (
        <div className="mb-3">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      <p className="mb-3 text-sm text-muted">
        Issues a fresh QR code and manual code on a new private link, which you then give to the
        visitor - nothing is sent to them. Their current link stops working. Use this when a link
        has been shared with someone else, or the visitor has lost it.
      </p>

      <Submit label={hasActivePass ? 'Replace with a new pass' : 'Issue a new pass'} />
    </form>
  );
}

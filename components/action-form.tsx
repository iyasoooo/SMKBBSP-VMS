'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { Alert } from '@/components/ui/surface';
import type { ActionResult } from '@/lib/result';

/**
 * Thin wrapper for the many small admin forms.
 *
 * It owns the three things every one of them needs - pending state, a safe
 * error message, and a success confirmation - so individual screens stay
 * declarative instead of repeating the same `useActionState` plumbing.
 */

function Submit({
  label,
  busyLabel,
  variant,
  confirm,
}: {
  label: string;
  busyLabel: string;
  variant: ButtonVariant;
  confirm?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      // Native confirm() is used deliberately for destructive admin actions:
      // it is keyboard accessible, screen-reader announced, and cannot be
      // missed the way an inline panel can.
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? busyLabel : label}
    </Button>
  );
}

export function ActionForm<T>({
  action,
  children,
  submitLabel,
  busyLabel = 'Working...',
  variant = 'primary',
  confirm,
  successMessage,
  className,
  hidden,
}: {
  action: (previous: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children?: ReactNode;
  submitLabel: string;
  busyLabel?: string;
  variant?: ButtonVariant;
  confirm?: string;
  successMessage?: string;
  className?: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState<ActionResult<T> | null, FormData>(action, null);

  return (
    <form action={formAction} className={className}>
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}

      {state && !state.ok ? (
        <div className="mb-3">
          <Alert tone="danger">{state.message}</Alert>
        </div>
      ) : null}

      {state?.ok && successMessage ? (
        <div className="mb-3">
          <Alert tone="success">{successMessage}</Alert>
        </div>
      ) : null}

      {children}

      <Submit label={submitLabel} busyLabel={busyLabel} variant={variant} confirm={confirm} />
    </form>
  );
}

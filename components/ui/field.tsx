import { clsx } from 'clsx';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/**
 * Form primitives.
 *
 * Every control is wrapped by `Field`, which owns the label association and
 * the error wiring. Errors are linked with `aria-describedby` and
 * `aria-invalid` so a screen reader announces the problem when focus reaches
 * the offending input, rather than leaving it as a red outline only.
 */

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ id, label, error, hint, required, children, className }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-[var(--text-strong)]">
        {label}
        {required ? (
          <span className="ml-1 text-[var(--danger)]" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>

      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}

      {children}

      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Compose the aria attributes a control needs to match its Field.
 *
 * `hint` is a flag rather than the text itself: the wording already lives on
 * the Field, and only its presence matters for building `aria-describedby`.
 */
export function fieldAria(id: string, options: { error?: string; hint?: boolean }) {
  const describedBy = [options.hint ? `${id}-hint` : null, options.error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return {
    id,
    'aria-invalid': options.error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const;
}

const CONTROL_BASE =
  'w-full rounded-lg border bg-[var(--surface-card)] px-3 text-[var(--text-body)] ' +
  'placeholder:text-[var(--text-muted)] transition-colors ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

function controlClasses(hasError: boolean, className?: string, extra?: string): string {
  return clsx(
    CONTROL_BASE,
    extra ?? 'h-11',
    hasError ? 'border-[var(--danger)]' : 'border-[var(--line-strong)]',
    className,
  );
}

interface InputProps extends ComponentPropsWithoutRef<'input'> {
  hasError?: boolean;
}

export function Input({ hasError, className, ...props }: InputProps) {
  return <input className={controlClasses(Boolean(hasError), className)} {...props} />;
}

interface TextareaProps extends ComponentPropsWithoutRef<'textarea'> {
  hasError?: boolean;
}

export function Textarea({ hasError, className, ...props }: TextareaProps) {
  return (
    <textarea
      className={controlClasses(Boolean(hasError), className, 'min-h-24 py-2 leading-relaxed')}
      {...props}
    />
  );
}

interface SelectProps extends ComponentPropsWithoutRef<'select'> {
  hasError?: boolean;
}

export function Select({ hasError, className, ...props }: SelectProps) {
  return <select className={controlClasses(Boolean(hasError), className)} {...props} />;
}

interface CheckboxProps extends ComponentPropsWithoutRef<'input'> {
  label: ReactNode;
  error?: string;
}

/**
 * Checkbox with the label as the click target. The 44px minimum height keeps
 * consent and ID-sighting confirmations usable with a gloved finger.
 */
export function Checkbox({ label, error, id, className, ...props }: CheckboxProps) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={clsx(
          'flex min-h-[var(--spacing-touch)] cursor-pointer items-start gap-3 text-sm',
          className,
        )}
      >
        <input
          type="checkbox"
          id={id}
          className="mt-0.5 size-5 shrink-0 rounded border-[var(--line-strong)] accent-[var(--accent)]"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...props}
        />
        <span className="text-[var(--text-body)]">{label}</span>
      </label>
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

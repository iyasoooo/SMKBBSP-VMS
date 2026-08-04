import { clsx } from 'clsx';
import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * `lg` exists for the guard tablet: every control on a gate screen must clear
 * the 44x44 CSS pixel minimum touch target, which `sm` deliberately does not.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'min-h-[var(--spacing-touch)] h-12 px-6 text-base gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors ' +
  'disabled:opacity-50 disabled:pointer-events-none select-none border';

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-[var(--accent)] text-[var(--accent-text)] border-transparent hover:bg-[var(--accent-hover)]',
    secondary:
      'bg-[var(--surface-card)] text-[var(--text-body)] border-[var(--line-strong)] hover:bg-[var(--surface-muted)]',
    ghost: 'bg-transparent text-[var(--text-body)] border-transparent hover:bg-[var(--surface-muted)]',
    danger: 'bg-[var(--danger)] text-white border-transparent hover:opacity-90',
    success: 'bg-[var(--ok)] text-white border-transparent hover:opacity-90',
  };

  return clsx(BASE, SIZES[size], variants[variant], className);
}

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

interface ButtonLinkProps extends ComponentPropsWithoutRef<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** Card, alert, empty-state and status primitives shared across all roles. */

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  /*
   * `min-w-0` for the same reason as TableScroll: cards are routinely placed in
   * a grid, and a grid item that cannot shrink below its content will push the
   * page wider than the screen rather than letting its contents wrap or scroll.
   */
  return <Tag className={clsx('surface-card min-w-0 rounded-xl', className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ALERT_TONES: Record<AlertTone, { bg: string; text: string; border: string }> = {
  info: { bg: 'var(--info-soft)', text: 'var(--info-text)', border: 'var(--info)' },
  success: { bg: 'var(--ok-soft)', text: 'var(--ok-text)', border: 'var(--ok)' },
  warning: { bg: 'var(--warn-soft)', text: 'var(--warn-text)', border: 'var(--warn)' },
  danger: { bg: 'var(--danger-soft)', text: 'var(--danger-text)', border: 'var(--danger)' },
};

/**
 * `role="alert"` is applied only to error and warning tones. Announcing every
 * informational panel would make a screen reader interrupt constantly.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const colors = ALERT_TONES[tone];
  const assertive = tone === 'danger' || tone === 'warning';

  return (
    <div
      role={assertive ? 'alert' : undefined}
      className={clsx('rounded-lg border-l-4 px-4 py-3 text-sm', className)}
      style={{ background: colors.bg, color: colors.text, borderLeftColor: colors.border }}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('px-5 py-12 text-center', className)}>
      <p className="text-sm font-medium text-[var(--text-strong)]">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const PILL_TONES: Record<PillTone, { bg: string; text: string }> = {
  neutral: { bg: 'var(--surface-muted)', text: 'var(--text-muted)' },
  info: { bg: 'var(--info-soft)', text: 'var(--info-text)' },
  success: { bg: 'var(--ok-soft)', text: 'var(--ok-text)' },
  warning: { bg: 'var(--warn-soft)', text: 'var(--warn-text)' },
  danger: { bg: 'var(--danger-soft)', text: 'var(--danger-text)' },
};

export function Pill({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  const colors = PILL_TONES[tone];
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        className,
      )}
      style={{ background: colors.bg, color: colors.text }}
    >
      {children}
    </span>
  );
}

/** Label/value pair used on every detail screen. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4', className)}>
      <dt className="text-sm text-muted sm:w-44 sm:shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-[var(--text-strong)]">{children}</dd>
    </div>
  );
}

/**
 * Horizontal scroll container for wide tables. The page body must never scroll
 * sideways on a tablet, so the overflow is confined here.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  /*
   * `min-w-0` is what makes the horizontal scroll actually work.
   *
   * A grid or flex item defaults to `min-width: auto`, meaning it refuses to
   * shrink below its content's intrinsic width. Without this, a wide table
   * stretches this container past the viewport instead of scrolling inside it,
   * and the whole page scrolls sideways - which is invisible on a desktop and
   * obvious on a phone.
   */
  /*
   * `relative` is not cosmetic here. `overflow` does not clip absolutely
   * positioned descendants unless the scroll container is also their
   * containing block. Screen-reader-only text inside these tables is
   * `position: absolute`, so without this it escapes the scroller entirely and
   * stretches the document sideways - invisibly, since the spans are 1px and
   * clipped from view. Every visible element stays put, which is why this
   * looked like a phantom for several rounds of debugging.
   */
  return <div className="relative w-full min-w-0 overflow-x-auto">{children}</div>;
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

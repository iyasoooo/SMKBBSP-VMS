import { clsx } from 'clsx';

/**
 * The school crest.
 *
 * The artwork is the school's own emblem, kept as a single transparent PNG at
 * `public/brand/crest.png`. It is referenced as a file rather than inlined so
 * the school can replace the emblem by overwriting that one file - and so the
 * browser caches one copy across every page instead of re-sending the markup on
 * each render. Re-run `npm run pwa:icons` afterwards to bring the favicon and
 * the installed-app icons along with it.
 *
 * `next/image` buys nothing here - a fixed-size logo has no responsive sizes
 * worth generating - so the lint rule preferring it is switched off at each
 * call site rather than followed into a worse result.
 */

/** Intrinsic aspect ratio of the artwork; it is slightly wider than it is tall. */
const RATIO = 640 / 610;

const SRC = '/brand/crest.png';
const LABEL = 'Crest of Sekolah Menengah Kebangsaan Bandar Baru Seri Petaling';

/**
 * The crest on its own.
 *
 * `size` is the rendered height; the width follows from the artwork's own
 * proportions so it is never stretched.
 */
export function Crest({
  size = 36,
  decorative = true,
  className,
}: {
  size?: number;
  /** Set false where the crest is the only thing naming the school. */
  decorative?: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC}
      alt={decorative ? '' : LABEL}
      aria-hidden={decorative ? 'true' : undefined}
      width={Math.round(size * RATIO)}
      height={size}
      className={clsx('shrink-0 select-none', className)}
    />
  );
}

/**
 * The crest on a white plate, for headers.
 *
 * The emblem carries its own black outline on a transparent ground, so it needs
 * a light backing to hold together: on the dark theme that outline would
 * otherwise disappear into the page. The plate is therefore white in both
 * themes rather than following the surface colour.
 */
export function CrestTile({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-1 py-0.5 ring-1 ring-black/10',
        className,
      )}
    >
      <Crest size={size} />
    </span>
  );
}

/** The crest at title size, where the ribbon lettering is actually readable. */
export function CrestFull({ width = 180, className }: { width?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={SRC}
      alt={LABEL}
      width={width}
      height={Math.round(width / RATIO)}
      className={clsx('select-none', className)}
    />
  );
}

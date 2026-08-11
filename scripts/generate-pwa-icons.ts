/**
 * Render the PWA icon set from `public/icon.svg`.
 *
 *   npm run pwa:icons
 *
 * Generated rather than hand-drawn so the icons can never drift from the source
 * mark, and committed rather than built on demand because a missing icon makes
 * an installed app look broken with no error anywhere.
 *
 * Two shapes are produced for a reason:
 *   - `any`      the mark on its own, used where the platform draws the frame.
 *   - `maskable` the same mark inset inside a filled square, because Android
 *                crops maskable icons to a circle or squircle and anything in
 *                the outer ~10% is cut off.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const ICON_DIR = resolve(PUBLIC_DIR, 'icons');

/** Crest crimson, matching --color-crimson-700 in globals.css. */
const BACKGROUND = '#a50e26';

interface Target {
  file: string;
  size: number;
  /** Fraction of the canvas left as padding on each side. */
  inset: number;
  background: string;
}

const TARGETS: Target[] = [
  // Plain icons: no padding, transparent behind the mark.
  { file: 'icon-192.png', size: 192, inset: 0, background: 'transparent' },
  { file: 'icon-512.png', size: 512, inset: 0, background: 'transparent' },

  // Maskable: 10% inset on each side keeps the mark inside Android's safe zone.
  { file: 'maskable-192.png', size: 192, inset: 0.1, background: BACKGROUND },
  { file: 'maskable-512.png', size: 512, inset: 0.1, background: BACKGROUND },

  // iOS home screen. Safari does not honour maskable and composites onto white,
  // so this one carries the brand background itself.
  { file: 'apple-touch-icon.png', size: 180, inset: 0.08, background: BACKGROUND },
];

async function main(): Promise<void> {
  mkdirSync(ICON_DIR, { recursive: true });
  const svg = readFileSync(resolve(PUBLIC_DIR, 'icon.svg'));

  for (const target of TARGETS) {
    const inner = Math.round(target.size * (1 - target.inset * 2));
    const pad = Math.round((target.size - inner) / 2);

    const mark = await sharp(svg, { density: 512 })
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const canvas = sharp({
      create: {
        width: target.size,
        height: target.size,
        channels: 4,
        background:
          target.background === 'transparent'
            ? { r: 0, g: 0, b: 0, alpha: 0 }
            : target.background,
      },
    });

    const out = await canvas
      .composite([{ input: mark, top: pad, left: pad }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    const path = resolve(ICON_DIR, target.file);
    writeFileSync(path, out);
    console.log(`  ${target.file.padEnd(24)} ${target.size}x${target.size}  ${(out.length / 1024).toFixed(1)} kB`);
  }

  console.log('\nIcons written to public/icons.');
}

main().catch((error: unknown) => {
  console.error('Failed to generate icons:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

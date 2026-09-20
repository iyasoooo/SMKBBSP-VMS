/**
 * Render the favicon and PWA icon set from the school crest.
 *
 *   npm run pwa:icons
 *
 * The source is `public/brand/crest.png` - the same file the application shows
 * in its headers - so replacing the school's emblem is a one-file change and
 * the icons cannot drift away from what is on screen.
 *
 * Generated rather than hand-drawn, and committed rather than built on demand,
 * because a missing icon makes an installed app look broken with no error
 * anywhere.
 *
 * Three shapes are produced, for three different consumers:
 *   - `any`      the crest on its own, used where the platform draws the frame.
 *   - `maskable` the crest inset inside a filled square, because Android crops
 *                maskable icons to a circle or squircle.
 *   - favicon    a small flattened PNG, since a browser tab renders it at 16px.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const PUBLIC_DIR = resolve(process.cwd(), 'public');
const ICON_DIR = resolve(PUBLIC_DIR, 'icons');
const SOURCE = resolve(PUBLIC_DIR, 'brand', 'crest.png');

/*
 * White, not crest crimson.
 *
 * The mark is the school crest, whose upper field is itself red - on a crimson
 * plate that field disappears and the shield loses its shape. White is also how
 * the crest is presented on school stationery, so it is the honest backing.
 */
const BACKGROUND = '#ffffff';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

interface Target {
  file: string;
  size: number;
  /** Fraction of the canvas left as padding on each side. */
  inset: number;
  background: string;
}

const TARGETS: Target[] = [
  // Plain icons: no padding, transparent behind the crest.
  { file: 'icon-192.png', size: 192, inset: 0, background: 'transparent' },
  { file: 'icon-512.png', size: 512, inset: 0, background: 'transparent' },

  /*
   * Maskable: the crest is a shield, widest across its shoulders, and a
   * circular crop takes those corners first - so it is inset further than the
   * 10% Android strictly requires.
   */
  { file: 'maskable-192.png', size: 192, inset: 0.16, background: BACKGROUND },
  { file: 'maskable-512.png', size: 512, inset: 0.16, background: BACKGROUND },

  // iOS home screen. Safari does not honour maskable and composites onto white,
  // so this one carries its own background rather than relying on that.
  { file: 'apple-touch-icon.png', size: 180, inset: 0.08, background: BACKGROUND },

  /*
   * Browser tab. Drawn at 16-32px, where the ribbon lettering is long gone, so
   * it is given a white plate: the crest's black outline would otherwise vanish
   * against a dark browser chrome.
   */
  { file: 'favicon-32.png', size: 32, inset: 0.02, background: BACKGROUND },
];

async function main(): Promise<void> {
  mkdirSync(ICON_DIR, { recursive: true });
  const source = readFileSync(SOURCE);

  for (const target of TARGETS) {
    const inner = Math.round(target.size * (1 - target.inset * 2));

    // `contain` rather than `cover`: the crest is slightly wider than it is
    // tall, and cropping it to a square would clip the ribbon's ends.
    const mark = await sharp(source)
      .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
      .png()
      .toBuffer();

    const { width = inner, height = inner } = await sharp(mark).metadata();
    const left = Math.round((target.size - width) / 2);
    const top = Math.round((target.size - height) / 2);

    const canvas = sharp({
      create: {
        width: target.size,
        height: target.size,
        channels: 4,
        background: target.background === 'transparent' ? TRANSPARENT : target.background,
      },
    });

    const out = await canvas
      .composite([{ input: mark, top, left }])
      .png({ palette: true, effort: 10, compressionLevel: 9 })
      .toBuffer();

    writeFileSync(resolve(ICON_DIR, target.file), out);
    console.log(
      `  ${target.file.padEnd(24)} ${target.size}x${target.size}  ${(out.length / 1024).toFixed(1)} kB`,
    );
  }

  console.log('\nIcons written to public/icons.');
}

main().catch((error: unknown) => {
  console.error('Failed to generate icons:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

/**
 * Exports every wireframe in docs/WIREFRAMES.html as its own PNG, ready to be
 * inserted into the FYP report as a figure.
 *
 * Each PNG holds the device frame and its annotation callouts, but NOT the
 * caption line. Captions belong in Word itself (References > Insert Caption),
 * so that the numbering and the List of Figures stay automatic. The caption
 * text is written alongside the images in captions.txt for copying.
 *
 *   node scripts/export-wireframes.mjs
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'docs', 'WIREFRAMES.html');
const outDir = path.join(root, 'docs', 'wireframes');

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
// A high device scale factor keeps the thin 1px rules sharp once Word scales
// the image down to fit the page.
const page = await browser.newPage({
  viewport: { width: 1400, height: 1000 },
  deviceScaleFactor: 3,
});

await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });

// The horizontal scrollbars exist for reading the page in a narrow window.
// They would clip a wide frame during capture, so drop them first.
await page.addStyleTag({ content: '.scroll { overflow: visible !important; }' });

const figures = await page.locator('figure').all();
const captions = [];

for (const [index, figure] of figures.entries()) {
  const caption = (await figure.locator('figcaption').innerText()).replace(/\s+/g, ' ').trim();
  const numbered = caption.match(/^Figure (\d+)\.(\d+)/);
  const name = numbered
    ? `figure-${numbered[1]}-${numbered[2].padStart(2, '0')}`
    : `figure-${String(index + 1).padStart(2, '0')}`;

  const file = path.join(outDir, `${name}.png`);

  // Capturing the row container would pad a phone frame with ~400px of empty
  // white on each side, so the phone would land tiny on the page. Measure the
  // device plus its callouts instead and crop to exactly that.
  const box = await figure.evaluate((element) => {
    const parts = [
      element.querySelector('.phone, .tablet, .laptop'),
      ...element.querySelectorAll('.note'),
    ].filter(Boolean);
    const rects = parts.map((part) => part.getBoundingClientRect());
    return {
      left: Math.min(...rects.map((r) => r.left)) + window.scrollX,
      top: Math.min(...rects.map((r) => r.top)) + window.scrollY,
      right: Math.max(...rects.map((r) => r.right)) + window.scrollX,
      bottom: Math.max(...rects.map((r) => r.bottom)) + window.scrollY,
    };
  });

  const margin = 12;
  await page.screenshot({
    path: file,
    fullPage: true,
    clip: {
      x: Math.max(0, box.left - margin),
      y: Math.max(0, box.top - margin),
      width: box.right - box.left + margin * 2,
      height: box.bottom - box.top + margin * 2,
    },
  });

  captions.push(caption);
  console.log(`  ${path.relative(root, file)}`);
}

await writeFile(path.join(outDir, 'captions.txt'), `${captions.join('\n\n')}\n`, 'utf8');
await browser.close();

console.log(`\n${figures.length} wireframes exported to ${path.relative(root, outDir)}`);
console.log('Caption text for Word is in docs/wireframes/captions.txt');

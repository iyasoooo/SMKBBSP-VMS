/**
 * Copy the OCR runtime into `public/ocr/` so nothing is fetched from a CDN.
 *
 *   npm run ocr:assets
 *
 * Why this exists: tesseract.js defaults to loading its worker, its WASM core
 * and its language data from jsDelivr at runtime. That would mean a visitor's
 * browser reaching out to a third party while filling in a school form, and it
 * would require opening `connect-src` and `script-src` to that origin. Serving
 * every piece from our own origin keeps the CSP restricted to `'self'`.
 *
 * The copied files and the language model are git-ignored - they are build
 * inputs reproduced from node_modules and a pinned upstream release, not
 * source. Run this after `npm install`; the OCR panel degrades to a clear
 * message if they are absent.
 */
import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_OCR = resolve(process.cwd(), 'public', 'ocr');
const TESSDATA = resolve(PUBLIC_OCR, 'tessdata');

/** Pinned so a rebuild cannot silently change the model. */
const LANG = 'eng';
const TESSDATA_TAG = '4.1.0';
const LANG_URL = `https://raw.githubusercontent.com/tesseract-ocr/tessdata/${TESSDATA_TAG}/${LANG}.traineddata`;

/**
 * Files copied out of node_modules. The SIMD LSTM core is the accurate,
 * LSTM-only build; tesseract.js falls back automatically if a browser lacks
 * SIMD, which is why the plain core is copied too.
 */
const VENDOR: Array<[from: string, to: string]> = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
];

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main(): Promise<void> {
  mkdirSync(TESSDATA, { recursive: true });

  for (const [from, to] of VENDOR) {
    const source = resolve(process.cwd(), 'node_modules', from);
    if (!existsSync(source)) {
      throw new Error(`Missing ${from}. Run \`npm install\` first.`);
    }
    const target = resolve(PUBLIC_OCR, to);
    copyFileSync(source, target);
    console.log(`  copied  ${to.padEnd(36)} ${mb(statSync(target).size)}`);
  }

  const langFile = resolve(TESSDATA, `${LANG}.traineddata`);
  if (existsSync(langFile)) {
    console.log(`  present ${LANG}.traineddata`.padEnd(46) + mb(statSync(langFile).size));
  } else {
    console.log(`  downloading ${LANG}.traineddata from tessdata ${TESSDATA_TAG} ...`);
    /*
     * Retried, because this also runs inside the Docker build, where a single
     * dropped connection fails the entire image. The model is 22 MB pulled from
     * a public host, so a transient network blip is the expected failure rather
     * than a permanent one, and one retry usually settles it.
     */
    let response: Response | undefined;
    let lastError = '';

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        response = await fetch(LANG_URL);
        if (response.ok) break;
        lastError = `HTTP ${response.status} ${response.statusText}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'fetch failed';
      }

      if (attempt < 4) {
        const waitMs = attempt * 2000;
        console.log(`  attempt ${attempt} failed (${lastError}); retrying in ${waitMs / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    if (!response?.ok) {
      throw new Error(`Download failed after 4 attempts: ${lastError}`);
    }
    // Buffered rather than streamed: ~22 MB is trivial for a build script, and
    // it avoids the Node/DOM ReadableStream type mismatch entirely.
    writeFileSync(langFile, Buffer.from(await response.arrayBuffer()));
    console.log(`  downloaded ${LANG}.traineddata`.padEnd(46) + mb(statSync(langFile).size));
  }

  console.log('\nOCR assets ready in public/ocr. Nothing will be fetched from a CDN at runtime.');
}

main().catch((error: unknown) => {
  console.error('Failed to sync OCR assets:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

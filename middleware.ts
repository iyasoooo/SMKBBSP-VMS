import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content Security Policy.
 *
 * Next.js streams the React Server Component payload through inline
 * `<script>` tags. A static `script-src 'self'` header blocks every one of
 * them, so React never hydrates: the server-rendered markup appears but
 * nothing is interactive and no Server Action can submit. That is exactly the
 * failure this replaces.
 *
 * The fix is a nonce rather than `'unsafe-inline'`. Next.js detects a nonce in
 * the CSP header and stamps it onto the scripts it generates, so its own
 * inline scripts run while any injected one still does not. `'unsafe-inline'`
 * would have fixed the symptom by disabling the protection.
 *
 * The nonce must be unique per request, which is why this lives in middleware
 * and not in `next.config.ts` - a header declared there is static and would be
 * cached and replayed, defeating the point.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const isProduction = process.env.NODE_ENV === 'production';

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's nonced bootstrap load its own chunks without
    // each one needing a nonce. 'wasm-unsafe-eval' is required by the optional
    // IC OCR panel and permits WebAssembly compilation only - it does not
    // re-enable eval() on JavaScript. blob: covers the Tesseract worker.
    isProduction
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' blob:`
      : `script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:`,
    // Next.js injects inline <style> during streaming; there is no nonce hook
    // for those, so styles remain the one inline exception.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  // Passing the nonce down on the request lets a server component read it via
  // headers() if it ever needs to render a script of its own.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets. The OCR model under /ocr is ~22 MB and
     * gains nothing from a CSP header, so it is excluded along with the build
     * output and image optimiser.
     */
    {
      source: '/((?!_next/static|_next/image|ocr/|favicon.ico|icon.svg).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};

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

  /*
   * Whether this particular request arrived over TLS, which is not the same
   * question as whether this is a production build. `upgrade-insecure-requests`
   * rewrites every subresource URL to https://, so on a production build served
   * over plain http - a LAN address during testing, say - the browser asks for
   * stylesheets and scripts on a port that speaks no TLS and the page renders
   * as unstyled markup. The same reasoning already governs HSTS in
   * `next.config.ts`: a transport header belongs on the transport it describes.
   *
   * The forwarded header is checked first so the directive survives a TLS
   * terminating proxy, where the request reaches Next over http by design.
   */
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const isSecure = forwardedProto
    ? forwardedProto.split(',')[0]?.trim() === 'https'
    : request.nextUrl.protocol === 'https:';

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets Next's nonced bootstrap load its own chunks without
    // each one needing a nonce. 'wasm-unsafe-eval' is required by the optional
    // IC OCR panel, whose inference runtime is WebAssembly, and permits
    // compilation only - it does not re-enable eval() on JavaScript. blob:
    // covers the worker that runtime starts.
    isProduction
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' blob:`
      : `script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:`,
    // Next.js injects inline <style> during streaming; there is no nonce hook
    // for those, so styles remain the one inline exception.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: mediastream:",
    // `blob:` and `data:` are required by the optional IC OCR panel, which
    // fetches both: the inference runtime starts its worker from an object URL
    // and the card photo is read through one too. Neither is a network
    // destination, so allowing them cannot exfiltrate anything - they only
    // re-permit the page to read bytes it already holds in memory. Without them
    // the reader dies on `TypeError: Failed to fetch`.
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction && isSecure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  // Passing the nonce down on the request lets a server component read it via
  // headers() if it ever needs to render a script of its own.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  /*
   * A server action cannot see the request scheme, only its headers, so the
   * answer is forwarded. `lib/auth/session.ts` needs it to decide whether the
   * session cookie may carry `Secure`: setting that flag on a page served over
   * plain http makes the browser discard the cookie, which presents as a login
   * page that returns immediately after a successful sign-in.
   */
  requestHeaders.set('x-request-secure', isSecure ? '1' : '0');

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

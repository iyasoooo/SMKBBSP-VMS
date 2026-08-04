import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * The CSP is intentionally explicit rather than permissive. `'unsafe-inline'`
 * is required for styles because Next.js injects inline style tags for
 * streaming and Tailwind's runtime layer; scripts avoid it by relying on
 * Next.js nonce-free bundling of first-party code only. No third-party origin
 * is allowed: fonts, scripts, and images are all first-party or data URIs
 * (QR codes are rendered as data URIs at presentation time).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  /*
   * `'wasm-unsafe-eval'` is required by the optional IC OCR panel, which
   * compiles the Tesseract WASM module in the browser. It is far narrower than
   * `'unsafe-eval'`: it permits WebAssembly compilation only and still forbids
   * `eval()` and `new Function()` on JavaScript.
   *
   * `blob:` is needed because tesseract.js starts its worker from a Blob URL.
   * Both the worker script and the WASM binary are served from this origin
   * (see `public/ocr/`), so no third-party script origin is allowed.
   */
  process.env.NODE_ENV === 'production'
    ? "script-src 'self' 'wasm-unsafe-eval' blob:"
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // blob: + mediastream are needed by the guard camera QR scanner.
  "media-src 'self' blob: mediastream:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    // The guard scanner needs the camera; nothing else is permitted.
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  },
];

// HSTS is only meaningful over HTTPS and would be harmful on localhost.
if (process.env.NODE_ENV === 'production') {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  serverExternalPackages: ['@prisma/client', 'nodemailer', 'exceljs'],
  eslint: {
    // Linting is a separate, enforced quality gate (`npm run lint`).
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

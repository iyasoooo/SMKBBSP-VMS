import type { NextConfig } from 'next';

const securityHeaders = [
  // Content-Security-Policy is deliberately NOT set here. It is issued
  // per-request by `middleware.ts` so it can carry a fresh nonce; a static
  // header cannot. Declaring it in both places would make the browser enforce
  // the intersection of the two, which would block Next.js's own inline
  // scripts again and undo the fix.
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

/**
 * Dev-only origins allowed to load `/_next/*` assets.
 *
 * A phone or tablet on the same Wi-Fi reaches this machine by LAN address, and
 * the dev server rejects that as cross-origin unless the address is listed.
 * Hard-coding one address meant every change of network silently broke the
 * tablet again, so the value is derived from APP_URL - the same address the
 * private links, QR passes and badge codes already point at - and cannot drift from
 * it. The private-range wildcards keep a DHCP lease change from breaking it
 * before anyone has updated `.env`.
 *
 * This applies to `next dev` only; a production build ignores it entirely.
 */
function devOrigins(): string[] {
  const wildcards = ['192.168.*.*', '10.*.*.*', '172.16.*.*', '172.20.*.*'];
  try {
    const host = new URL(process.env.APP_URL ?? 'http://localhost:3000').hostname;
    return host === 'localhost' ? wildcards : [host, ...wildcards];
  } catch {
    // A malformed APP_URL is reported properly by `lib/env.ts` at startup;
    // failing the config load here would replace that message with a stack.
    return wildcards;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: devOrigins(),
  poweredByHeader: false,
  typedRoutes: false,
  serverExternalPackages: ['@prisma/client', 'exceljs'],
  eslint: {
    // Linting is a separate, enforced quality gate (`npm run lint`).
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

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

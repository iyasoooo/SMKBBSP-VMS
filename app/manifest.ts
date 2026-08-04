import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * This makes the app installable to a home screen so a guard can launch it
 * without browser chrome on a gate tablet. It adds no offline capability - see
 * `public/sw.js` for why that is deliberate.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SMKBBSP VisitorPass',
    short_name: 'VisitorPass',
    description:
      'Request a school visit, receive an approved QR pass, and check in at the gate.',
    // Guards land on the gate screen; everyone else is redirected to their own
    // home by the role guard, so this is the most useful entry point.
    start_url: '/guard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7fa',
    theme_color: '#26437a',
    lang: 'en-MY',
    dir: 'ltr',
    categories: ['productivity', 'education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops maskable icons to a circle or squircle; these are inset
      // so the mark survives that crop.
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Scan a pass', short_name: 'Scan', url: '/guard/scan' },
      { name: 'Register a walk-in', short_name: 'Walk-in', url: '/guard/walk-in' },
      { name: 'Emergency list', short_name: 'Emergency', url: '/guard/emergency' },
    ],
  };
}

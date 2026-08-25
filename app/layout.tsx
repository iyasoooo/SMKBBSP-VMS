import type { Metadata, Viewport } from 'next';
import { getTheme, getLocale } from '@/lib/theme';
import { ServiceWorkerRegistration } from '@/components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SMKBBSP VisitorPass',
    template: '%s | SMKBBSP VisitorPass',
  },
  description:
    'Appointment-based visitor management for SMK Bandar Baru Sri Petaling: request a visit, get teacher approval, and check in at the gate with a QR pass.',
  robots: { index: false, follow: false },
  icons: {
    // Both are rendered from the crest by `npm run pwa:icons`. The small one is
    // what a browser tab actually draws; the large one is there for bookmarks
    // and tab-switcher previews.
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    // Safari ignores the manifest icons for the home screen and composites onto
    // white, so it gets its own pre-branded icon.
    apple: '/icons/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // Launches without Safari chrome once added to the home screen. iOS has no
    // install prompt, so this only takes effect via Share > Add to Home Screen.
    capable: true,
    title: 'VisitorPass',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Guards zoom the gate screen in bright sunlight; do not lock scaling.
  maximumScale: 5,
  // Tints the browser and installed-app chrome. Two entries so an installed app
  // matches the theme the user actually has, rather than forcing crest crimson
  // onto a dark-mode device.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#a50e26' },
    { media: '(prefers-color-scheme: dark)', color: '#101311' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, locale] = await Promise.all([getTheme(), getLocale()]);

  return (
    <html lang={locale} className={theme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/*
          Next emits the modern `mobile-web-app-capable`, but iOS before 17 only
          honours Apple's original spelling, and a school tablet or phone may
          well be older than that. React hoists this into <head>.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}

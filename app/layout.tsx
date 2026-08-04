import type { Metadata, Viewport } from 'next';
import { getTheme, getLocale } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SMKBBSP VisitorPass',
    template: '%s | SMKBBSP VisitorPass',
  },
  description:
    'Appointment-based visitor management for SMK Bandar Baru Sri Petaling: request a visit, get teacher approval, and check in at the gate with a QR pass.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Guards zoom the gate screen in bright sunlight; do not lock scaling.
  maximumScale: 5,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, locale] = await Promise.all([getTheme(), getLocale()]);

  return (
    <html lang={locale} className={theme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}

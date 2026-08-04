'use client';

import { useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('pwa');

/**
 * Register the service worker that makes the app installable.
 *
 * Registration is deliberately best-effort. The worker adds nothing but
 * installability - it caches nothing and intercepts nothing - so a failure must
 * never surface to a visitor or block a guard. It is logged and ignored.
 *
 * Runs only over a secure context, because service workers require one. On a
 * school network served over plain HTTP the app still works normally; it simply
 * cannot be installed to a home screen.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // `isSecureContext` covers both HTTPS and localhost, which is exactly the
    // set of origins where registration can succeed.
    if (!window.isSecureContext) {
      log.debug('skipping registration: insecure context');
      return;
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(
      () => log.debug('service worker registered'),
      (error: unknown) => log.warn('service worker registration failed', { reason: String(error) }),
    );
  }, []);

  return null;
}

/*
 * Service worker for SMKBBSP VisitorPass.
 *
 * This worker deliberately caches NOTHING.
 *
 * Its only purpose is to satisfy the installability requirement: Chrome will
 * not offer to install a web app unless a service worker with a fetch handler
 * is registered. That gives a guard a home-screen icon that launches without
 * browser chrome, which is the whole point of the exercise.
 *
 * Why no caching, when every PWA tutorial adds it:
 *
 * Offline check-in is explicitly out of scope, and PROJECT_SPEC.md requires the
 * app to "show a clear connection error instead of pretending a write
 * succeeded". A cache-first or stale-while-revalidate strategy would break that
 * directly. A guard could be served a cached "expected visitors" list from an
 * hour ago, check someone in against it, see a success screen, and have nothing
 * reach the database. On a gate that is worse than a plain network error,
 * because the guard has no reason to doubt what they saw.
 *
 * So the fetch handler exists and does nothing: it registers no response, which
 * lets the browser perform every request normally, straight to the network.
 * When the network is down the user gets the browser's own failure, which is
 * honest.
 *
 * If offline support is ever brought into scope, it needs a real design - an
 * outbox queued in IndexedDB, replayed on reconnect, with the UI clearly
 * marking a visit as "pending sync" rather than "checked in". Do not reach for
 * a cache here as a shortcut to that.
 */

// Take over from any previous worker immediately, so an update cannot leave a
// stale worker mediating requests.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Defensive: if an earlier version of this file ever created caches, or a
      // developer experimented locally, remove them. Nothing here should own a
      // cache, and a forgotten one would serve stale gate data.
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/*
 * Present, and intentionally empty.
 *
 * Chrome requires a fetch handler to consider the app installable. Because this
 * listener never calls `event.respondWith()`, the browser handles every request
 * itself, exactly as it would with no service worker at all.
 */
self.addEventListener('fetch', () => {
  // No caching. See the file header.
});

// ChartVista service worker: makes the site installable. It does not cache anything, so the
// logged-in app and live market data are always fetched fresh from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass-through: browser handles the request normally */ });

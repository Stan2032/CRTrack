// Service worker: lets the site install as an app, works offline for the page itself,
// and shows notifications. Pushes carry no data; the latest alert is fetched from the site.
const CACHE = 'war-audit-v2';
const SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'stats.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Page files: network first (always fresh), cached copy if offline. API calls are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let a = null;
    try { a = (await (await fetch('api/alerts/latest', { cache: 'no-store' })).json())[0]; } catch (err) {}
    await self.registration.showNotification(a?.title || 'Clan War Audit', {
      body: a?.body || 'Something changed. Tap to open.',
      icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: a?.key || 'war-audit', data: { url: './' },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return clients.openWindow(e.notification.data?.url || './');
  }));
});

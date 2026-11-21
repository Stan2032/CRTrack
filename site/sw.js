// Service worker: lets the site install as an app, works offline for the page itself,
// and shows notifications. Pushes carry no data; the latest alert is fetched from the site.
const CACHE = 'war-audit-v24';
const SHELL = ['./', 'index.html', 'style.css', 'logic.js', 'stats.js', 'ui.js', 'app.js', 'me.html', 'me.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/clan-badge.svg', 'privacy.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== META).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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

// Small settings the page leaves for us: which clan this device follows, and the last alert shown.
const META = 'war-audit-meta';
async function metaGet(k) { const r = await (await caches.open(META)).match('/__' + k); return r ? r.text() : ''; }
async function metaSet(k, v) { await (await caches.open(META)).put('/__' + k, new Response(String(v))); }

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let shown = 0;
    try {
      const clan = await metaGet('clan'), seen = Number(await metaGet('seen')) || 0;
      const list = await (await fetch('api/alerts/latest' + (clan ? '?clan=' + clan : ''), { cache: 'no-store' })).json();
      const fresh = list.filter(a => a.id > seen).sort((a, b) => a.id - b.id).slice(-3);   // several alerts can arrive in one run
      for (const a of fresh) {
        await self.registration.showNotification(a.title, { body: a.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: a.key, data: { url: './' } });
        shown++;
      }
      if (list.length) await metaSet('seen', Math.max(seen, ...list.map(a => a.id)));
    } catch (err) {}
    // A push must always show something.
    if (!shown) await self.registration.showNotification('Clan War Audit', { body: 'Something changed. Tap to open.', icon: 'icons/icon-192.png', tag: 'war-audit', data: { url: './' } });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return clients.openWindow(e.notification.data?.url || './');
  }));
});

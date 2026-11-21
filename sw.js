/* port service worker — makes the app and loaded kits work offline */
const VERSION = 'port-0.14.1';
const SHELL = VERSION + '-shell';
const KITS = 'port-kits';           // shared with the page (save offline)
const APIC = 'port-api';
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES).catch(() => c.addAll(['./', './index.html']))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL, KITS, APIC];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function networkFirst(req, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(ms)]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: cacheName === SHELL });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await caches.match('./index.html') || await caches.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await caches.match(req);
  const update = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await update) || new Response('', { status: 504 });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // kit listing from the GitHub API
  if (url.hostname === 'api.github.com') { if (req.headers.has('Authorization')) return; e.respondWith(networkFirst(req, APIC, 4000)); return; }
  if (url.origin !== self.location.origin) return;

  // the app itself: fresh when online, cached when not
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/sw.js')) {
    e.respondWith(networkFirst(req, SHELL, 3000)); return;
  }
  // kit.json / index.json: fresh when online so edits show up
  if (url.pathname.includes('/kits/') && url.pathname.endsWith('.json')) {
    e.respondWith(networkFirst(req, KITS, 4000)); return;
  }
  // audio and everything else: instant from cache, refreshed in the background
  e.respondWith(staleWhileRevalidate(req, url.pathname.includes('/kits/') ? KITS : SHELL));
});

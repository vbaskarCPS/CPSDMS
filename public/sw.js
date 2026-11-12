// public/sw.js — propertystars.app's service worker.
//  1. Keeps the app itself on the phone (the files listed in /precache.json, written at build time),
//     so it opens with no signal. Pages: the network first (a few seconds), then the phone's copy.
//     App files (hashed, never change): the phone's copy first.
//  2. Push notifications.
// A new version installs in the background and waits; the page offers "Update ready" so nobody is
// reloaded in the middle of a sale. Supabase and map tiles aren't touched here (the app keeps its own
// encrypted copy of field data; see src/lib/offline).
const PREFIX = 'cps-app-';
const BUILD = 'dev';   // replaced with the build's version at build time (vite.config.ts), so a new release is noticed
let VERSION = null;

async function manifest() {
  const res = await fetch('/precache.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('no precache.json');
  return res.json();
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const m = await manifest();
      VERSION = m.version;
      const cache = await caches.open(PREFIX + m.version);
      // one by one, so a single missing file doesn't stop the rest
      await Promise.all(m.urls.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => undefined)));
      await cache.put('/__version', new Response(m.version));
    } catch { /* dev server or no manifest: nothing to keep */ }
    // the very first install (no older app on the phone) takes over straight away
    if (!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const mine = keys.filter(k => k.startsWith(PREFIX)).sort();
    // keep only the newest app copy
    const newest = await currentCacheName();
    await Promise.all(mine.filter(k => k !== newest).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  // the planner's "Check notifications" asks whether this worker tells the page when a push arrives (older ones don't)
  if (e.data && e.data.type === 'push-check' && e.source) e.source.postMessage({ type: 'push-check', ok: true });
});

async function currentCacheName() {
  if (VERSION) return PREFIX + VERSION;
  const keys = (await caches.keys()).filter(k => k.startsWith(PREFIX));
  // the most recently made cache holds a /__version entry; pick the last one
  for (const k of keys.reverse()) { const c = await caches.open(k); if (await c.match('/__version')) return k; }
  return null;
}

async function fromCache(req) {
  const name = await currentCacheName();
  if (name) { const hit = await (await caches.open(name)).match(req, { ignoreSearch: true }); if (hit) return hit; }
  return caches.match(req, { ignoreSearch: true });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // Supabase, Mapbox, fonts: not ours
  if (url.pathname === '/sw.js' || url.pathname === '/precache.json') return;

  // the page itself (any app address): the network, but no more than 4 s; then the phone's copy
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = fetch(req);
        const timeout = new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000));
        return await Promise.race([net, timeout]);
      } catch {
        // the planner (/vijayplanner, /roshplanner, and /demo on the planner host) is its own page: never hand it the field app's index,
        // whose router would show "page not found"
        if (/^\/(vijayplanner|roshplanner)(\/|$)/.test(url.pathname) || (/^planner\./.test(url.hostname) && /^\/demo(\/|$)/.test(url.pathname))) {
          return (await fromCache('/planner.html')) || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Planner</title><body style="font-family:system-ui;background:#101c3a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center"><p style="font-size:18px">No connection right now.</p><button onclick="location.reload()" style="font:inherit;padding:12px 20px;border-radius:12px;border:0;background:#ffd166;color:#101c3a;font-weight:700">Try again</button></div>', { headers: { 'Content-Type': 'text/html' } });
        }
        return (await fromCache('/index.html')) || (await fromCache('/')) || Response.error();
      }
    })());
    return;
  }

  // the app's files: the phone's copy first (their names change with every build)
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|woff2?)$/.test(url.pathname) || url.pathname === '/manifest.json') {
    e.respondWith((async () => {
      const hit = await fromCache(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (url.pathname.startsWith('/assets/')) {
        const type = res.headers.get('content-type') || '';
        // The server has no such file (it answers with the app's page instead): this copy of the app is
        // from an older build the server no longer has. Drop the copy so the next load is a clean one.
        if (/\.(js|css)$/.test(url.pathname) && (!res.ok || /text\/html/.test(type))) {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => k.startsWith(PREFIX)).map(k => caches.delete(k)));
          VERSION = null;
          self.registration.update().catch(() => undefined);
          return Response.error();
        }
        if (res.ok) {
          const name = await currentCacheName();
          if (name) (await caches.open(name)).put(req, res.clone());
        }
      }
      return res;
    })());
  }
});

// ── push notifications ──
// The planner's notifications (its pushes carry the planner's own icon) get a proper small icon for the status
// bar, and its chat messages stack: several from the same person while the phone wasn't looked at become one
// notification that lists them (newest last, the last five), not one that keeps replacing itself.
const PLANNER_ICON = /^\/(vijayplanner|roshplanner)\//;
async function showPush(d) {
  const planner = PLANNER_ICON.test(d.icon || '');
  let title = d.title || 'Property Stars', body = d.body || '';
  const data = { url: d.url || '/app' };
  if (planner && d.tag === 'chat') {
    const before = (await self.registration.getNotifications({ tag: 'chat' }).catch(() => []))[0];
    const same = before && before.data && before.data.from === title;
    data.from = title;
    data.lines = [...(same ? before.data.lines || [] : []), body].slice(-5);
    data.count = (same ? before.data.count || 1 : 0) + 1;
    if (data.count > 1) { body = data.lines.join('\n'); title = `${title} · ${data.count} messages`; }
  }
  return self.registration.showNotification(title, {
    body,
    icon: d.icon || '/icon-192.png',     // the planner sends its own icon
    // the status-bar icon is drawn from the picture's transparency alone: a full-colour square shows as a blank box
    badge: d.badge || (planner ? '/planner-badge.png?v=2' : '/badge-96.png'),
    tag: d.tag || undefined,
    renotify: !!d.tag,
    ...(planner ? { timestamp: Date.now(), vibrate: [70, 50, 70] } : {}),
    data,
  });
}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Property Stars', body: e.data ? e.data.text() : '' }; }
  // any open page hears that a push arrived: the planner's "Check notifications" waits for this to tell a push that
  // never reached the phone from one that arrived and wasn't shown
  const told = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(cs => { for (const c of cs) c.postMessage({ type: 'push-arrived', tag: d.tag || '' }); })
    .catch(() => {});
  e.waitUntil(Promise.all([showPush(d), told]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/app', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch { /* cross-scope */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

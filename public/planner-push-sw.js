// public/planner-push-sw.js — the planner's notifications (src/planner/lib/push.ts registers it).
// A service worker with no pages of its own. It is registered at /vijayplanner/push/ (or /roshplanner/push/), inside
// the installed app's own address, for one reason: a phone decides whose notification it is by the address of the
// worker that shows it. From the site-wide worker (sw.js, at /, outside the installed app) the planner's
// notifications are Chrome's: Chrome's icon, Chrome's notification settings. From here they are the Planner app's.
// It answers no page requests; the app itself still runs on sw.js. The one thing it keeps is a copy of the person's
// choice in Settings › Sounds (src/planner/features/sounds/store.ts writes it): which kinds of notification come
// without the phone's sound.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('message', e => {
  // "Check notifications" asks whether this worker tells the page when a push arrives
  if (e.data && e.data.type === 'push-check' && e.source) e.source.postMessage({ type: 'push-check', ok: true });
});

// ── Settings › Sounds: silent or not ──
// Which kind a push is (the app works it out the same way: src/planner/features/sounds/choice.ts, kindOfPush).
const ARVY_TITLE = 'Arvy';
function soundKind(d) {
  const tag = (d && d.tag) || '';
  if (tag === 'chat') return d.title === ARVY_TITLE ? 'arvy' : 'chat';
  if (tag.indexOf('arvy') === 0) return 'arvy';
  return 'other';
}
// The app keeps the choice in Cache Storage under this worker's own address (the worker can't read the page's
// storage). Silent only when that copy says so in so many words: when it can't be read, the phone makes its sound.
const SOUND_CACHE = 'planner-sounds';
async function silentFor(d) {
  try {
    const hit = await (await caches.open(SOUND_CACHE)).match(self.registration.scope + 'sounds.json');
    if (!hit) return false;
    const c = await hit.json();
    const k = c && c[soundKind(d)];
    return !!k && k.closed === false;
  } catch { return false; }
}
self.plannerSound = { soundKind, silentFor };   // for the tests (src/planner/features/sounds/worker.test.ts)

// Chat messages stack: several from the same person while the phone wasn't looked at become one notification that
// lists them (newest last, the last five), not one that keeps replacing itself.
async function showPush(d) {
  let title = d.title || 'Planner', body = d.body || '';
  const data = { url: d.url || '/' };
  if (d.tag === 'chat') {
    const before = (await self.registration.getNotifications({ tag: 'chat' }).catch(() => []))[0];
    const same = before && before.data && before.data.from === title;
    data.from = title;
    data.lines = [...(same ? before.data.lines || [] : []), body].slice(-5);
    data.count = (same ? before.data.count || 1 : 0) + 1;
    if (data.count > 1) { body = data.lines.join('\n'); title = `${title} · ${data.count} messages`; }
  }
  const silent = await silentFor(d);
  return self.registration.showNotification(title, {
    body,
    icon: d.icon || '/vijayplanner/icon-192.png',
    badge: d.badge || '/planner-badge.png?v=2',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    timestamp: Date.now(),
    // a silent one doesn't buzz either (a phone refuses a notification that is both silent and buzzes)
    ...(silent ? { silent: true } : { vibrate: [70, 50, 70] }),
    data,
  });
}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  // any open page hears that a push arrived ("Check notifications" waits for this)
  const told = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(cs => { for (const c of cs) c.postMessage({ type: 'push-arrived', tag: d.tag || '' }); })
    .catch(() => {});
  e.waitUntil(Promise.all([showPush(d), told]));
});

// A tap opens the planner where the notification points. This worker controls no page, so it can't steer an open
// one itself: it brings the planner to the front and tells it where to go (src/planner/App.tsx listens).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  const app = '/' + url.pathname.split('/')[1] + '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find(c => new URL(c.url).origin === url.origin && (new URL(c.url).pathname + '/').startsWith(app));
    if (open && 'focus' in open) {
      try { await open.focus(); } catch { /* the phone wouldn't bring it forward: the message still reaches it */ }
      open.postMessage({ type: 'planner-open', url: url.pathname + url.search });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});

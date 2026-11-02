// src/lib/offline/appUpdate.ts — puts the app on the phone (public/sw.js) and notices new versions.
// A new version downloads in the background and waits; `onUpdateReady` fires so the page can offer
// "Update" instead of reloading someone in the middle of a sale.
type Fn = () => void;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Fn>();
const announce = (w: ServiceWorker) => { waiting = w; listeners.forEach(f => f()); };

export const updateReady = () => waiting !== null;
export function onUpdateReady(fn: Fn): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Switch to the new version now (the page reloads once it has taken over). */
export function applyUpdate() {
  if (!waiting) { window.location.reload(); return; }
  waiting.postMessage('skipWaiting');
}

/** A part of the app that can't be fetched — the phone's copy is from an older build and the server no
 *  longer has that build's files (a deploy while the app was open). Drop the copy and reload once. */
async function recoverFromStaleBuild(): Promise<void> {
  const KEY = 'cps-stale-reload';
  let already = false;
  try { already = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1'); } catch { /* no storage */ }
  if (already) return;   // reloaded once already: a real outage, leave the page as it is
  try {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith('cps-app-')) await caches.delete(k);
  } catch { /* best effort */ }
  window.location.reload();
}

export function watchForStaleBuild(): void {
  // Vite raises this when a lazy part of the app (a page, a chunk) fails to load
  window.addEventListener('vite:preloadError', e => { e.preventDefault(); recoverFromStaleBuild(); });
  window.addEventListener('unhandledrejection', e => {
    if (/Failed to fetch dynamically imported module|Importing a module script failed/.test(String(e.reason?.message || e.reason))) recoverFromStaleBuild();
  });
  // the app stayed up: the next stale build may reload once again
  setTimeout(() => { try { sessionStorage.removeItem('cps-stale-reload'); } catch { /* no storage */ } }, 20_000);
}

export async function registerAppWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (reg.waiting && hadController) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w); });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;   // the very first install: nothing to reload
      reloaded = true; window.location.reload();
    });
    // look for a new version now and then (and whenever the app comes back to the front)
    const check = () => { reg.update().catch(() => undefined); };
    setInterval(check, 30 * 60_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  } catch (e) { console.warn('[app] service worker not registered', e); }
}

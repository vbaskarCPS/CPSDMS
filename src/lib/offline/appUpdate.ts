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

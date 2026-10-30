// src/planner/lib/push.ts — push notifications on this phone for the planner's routine reminders.
// The browser subscribes with the planner-push function's public key; the subscription is kept as a
// planner doc (planner_push_subscribe). Modelled on src/v2/lib/push.ts.
import { supabase } from '../../lib/supabase';
import { call, getPass, SignedOut } from './auth';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Where notifications stand on this device. iPhones need the app on the Home Screen first. */
export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !standalone()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch { return 'off'; }
}

const toKey = (b64: string): Uint8Array => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

/** Register the app's service worker (scope '/', shared with the field app). */
export async function registerWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

/** Ask, subscribe and save. Throws a readable message when it can't. */
export async function enablePush(): Promise<void> {
  if (!getPass()) throw new SignedOut();
  if (!pushSupported()) throw new Error('This browser can’t show notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked. Allow them in this browser’s site settings.');
  const reg = await registerWorker();
  const { data, error } = await supabase.functions.invoke('planner-push', { body: { action: 'key' } });
  const key = (data as { publicKey?: string } | null)?.publicKey;
  if (error || !key) throw new Error('Couldn’t reach the notification service.');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const current = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    const want = toKey(key);
    if (!current || current.length !== want.length || current.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) as unknown as BufferSource });
  const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  const r = await call<{ ok: boolean; reason?: string }>('planner_push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_agent: navigator.userAgent });
  if (!r.ok) throw new Error(r.reason === 'bad_subscription' ? 'The browser gave an unusable subscription.' : 'Could not save the subscription.');
}

/** Forget this device (server side too) and unsubscribe the browser. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try { await call('planner_push_unsubscribe', { p_endpoint: sub.endpoint }); } catch { /* the server forgets it on the next 410 */ }
    await sub.unsubscribe();
  }
}

/** A "notifications are on" message to every device of this user. */
export async function sendTest(): Promise<{ sent: number }> {
  const p = getPass();
  if (!p) throw new SignedOut();
  const { data, error } = await supabase.functions.invoke('planner-push', { body: { action: 'test', token: p.token } });
  if (error) throw new Error('Couldn’t reach the notification service.');
  if (data?.error) throw new Error(data.error === 'signed_out' ? 'Please sign in again.' : data.error);
  return { sent: Number(data?.sent || 0) };
}

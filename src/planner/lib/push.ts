// src/planner/lib/push.ts — push notifications on this phone for the planner's routine reminders.
// The browser subscribes with the planner-push function's public key; the subscription is kept as a
// planner doc (planner_push_subscribe). Modelled on src/v2/lib/push.ts.
import { supabase } from '../../lib/supabase';
import { call, getPass, SignedOut } from './auth';
import { isDemo } from './app';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Where notifications stand on this device. iPhones need the app on the Home Screen first. */
export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || isDemo()) return 'unsupported';
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

// ── "Check notifications": where do they stop? ──
// A push goes server → Google → this phone → a notification on screen. The server's part can be seen from the server
// (Google says whether it took the push); the phone's part can't, so the check does it from here: it puts a
// notification up straight from the phone, then has the server push one and waits to hear from the service worker
// (public/sw.js) that it arrived.
export interface PushCheck {
  /** a notification put up from this phone itself: 'shown', or 'blocked' when the phone wouldn't */ here: 'shown' | 'blocked';
  /** the server had a phone to send to and Google took it */ sent: boolean;
  /** the pushed one arrived here. null = this version of the app can't tell yet (it needs the update) */ arrived: boolean | null;
}
const waitFor = (type: string, ms: number, also?: (d: { tag?: string }) => boolean): Promise<boolean> => new Promise(done => {
  const sw = navigator.serviceWorker;
  const end = (ok: boolean) => { sw.removeEventListener('message', on); window.clearTimeout(t); done(ok); };
  const on = (e: MessageEvent) => { if (e.data?.type === type && (!also || also(e.data))) end(true); };
  const t = window.setTimeout(() => end(false), ms);
  sw.addEventListener('message', on);
});
/** Run the check. Takes up to `patience` ms when the pushed one doesn't arrive. */
export async function checkPush(name: string, icon: string, patience = 20000): Promise<PushCheck> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) throw new Error('Notifications aren’t set up on this phone. Turn them off and on again.');
  let here: PushCheck['here'] = 'blocked';
  try {
    await reg.showNotification(name, { body: 'Check 1 of 2: this phone can show the planner’s notifications.', tag: 'check-here', icon, badge: '/planner-badge.png' });
    await new Promise(r => setTimeout(r, 800));
    here = (await reg.getNotifications({ tag: 'check-here' })).length ? 'shown' : 'blocked';
  } catch { here = 'blocked'; }
  // will the worker tell us when a push arrives? (one from before this check existed won't)
  const asks = waitFor('push-check', 1500);
  reg.active?.postMessage({ type: 'push-check' });
  const canTell = await asks;
  const arrives = canTell ? waitFor('push-arrived', patience, d => d.tag === 'test') : null;
  let sent = false;
  try { sent = (await sendTest()).sent > 0; } catch { sent = false; }
  return { here, sent, arrived: !sent ? (canTell ? false : null) : arrives ? await arrives : null };
}
/** What the check found, in words, and whether all is well. No browser here (tested in push.test.ts). */
export function pushAdvice(c: PushCheck): { ok: boolean; lines: { ok: boolean | null; text: string }[]; todo?: string } {
  const lines: { ok: boolean | null; text: string }[] = [
    { ok: c.here === 'shown', text: c.here === 'shown' ? 'This phone put up a notification from the planner.' : 'This phone would not put up a notification from the planner.' },
    { ok: c.sent, text: c.sent ? 'The server sent one, and Google accepted it for this phone.' : 'The server had no phone to send to.' },
  ];
  if (c.sent) lines.push({ ok: c.arrived, text: c.arrived === null ? 'Whether it arrived here can’t be told on this version of the app.' : c.arrived ? 'It arrived on this phone.' : 'It did not arrive on this phone within 20 seconds.' });
  if (!c.sent) return { ok: false, lines, todo: 'Turn notifications off and on again here, then check once more.' };
  if (c.here === 'blocked') return { ok: false, lines, todo: 'The phone is hiding the planner’s notifications. In the phone’s Settings › Apps, open Planner and Chrome and allow notifications for both, and switch Do Not Disturb off.' };
  if (c.arrived === false) return { ok: false, lines, todo: 'The phone is holding deliveries back. Switch Power saving off, and in Settings › Battery › Background usage limits take Chrome and Planner out of Sleeping and Deep sleeping apps. Then check again: a held one can also arrive late.' };
  if (c.arrived === null) return { ok: false, lines, todo: 'Tap Update when the planner offers it, then check again: the newest version can tell whether a push arrives.' };
  return { ok: true, lines, todo: 'Both worked. You should have seen two notifications: “Check 1 of 2” and “Notifications are on.” If they were silent, look at the phone’s sound and Do Not Disturb.' };
}

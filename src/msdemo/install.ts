// src/msdemo/install.ts — puts the MainstreetAI demo in front of the network. Every Supabase data, function and
// storage call the app makes is answered by the pretend server (store.ts); none reaches the real database.
// Sign-in calls (/auth/v1) are left alone, so a visitor who is also signed in to Property Stars stays signed in.
// The phone's location is set to Oakville, in the middle of the demo zones.
import seedJson from './seed.json';
import { fn, rpc, table } from './store';
import { db } from '../v2/lib/client';
import { supabase } from '../lib/supabase';

const SUPA = /^https:\/\/[a-z0-9]+\.supabase\.co\//;
const json = (body: unknown, status = 200) => new Response(body === undefined ? 'null' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  try {
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (typeof raw === 'string' && raw) return JSON.parse(raw);
  } catch { /* not JSON (a photo upload) */ }
  return {};
}

const photos = new Map<string, string>();   // uploaded in the demo: path → a local object URL

export function installDemoNetwork(): void {
  // Every Supabase request first asks the client for the signed-in session, and only one tab at a time may read it.
  // With the real app open in another tab on the phone, the demo waited behind it and never loaded ("Loading your
  // zones…"). The demo has no session of its own, so it never asks: requests go straight to the pretend server.
  for (const c of [db, supabase]) {
    const auth = c.auth as unknown as { getSession: () => Promise<unknown>; stopAutoRefresh?: () => Promise<void> };
    auth.getSession = async () => ({ data: { session: null }, error: null });
    void auth.stopAutoRefresh?.();
  }

  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!SUPA.test(url)) return real(input as RequestInfo, init);
    const path = url.replace(SUPA, '/').split('?')[0];
    if (path.startsWith('/auth/v1/')) return real(input as RequestInfo, init);
    // a short pause, so the screens' loading states look as they do for real
    await new Promise(r => setTimeout(r, 120 + Math.random() * 180));
    try {
      let m: RegExpExecArray | null;
      if ((m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)/.exec(path))) {
        const out = rpc(m[1], await bodyOf(input, init));
        if (out === undefined) console.info('[demo] no sample answer for', m[1]);
        return json(out ?? null);
      }
      if ((m = /^\/rest\/v1\/([a-z0-9_]+)/.exec(path))) return json(table(m[1]));
      if ((m = /^\/functions\/v1\/([a-z0-9_-]+)/.exec(path))) return json(fn(m[1], await bodyOf(input, init)));
      if ((m = /^\/storage\/v1\/object\/sign\/([^/]+)/.exec(path))) {
        const b = await bodyOf(input, init);
        const paths = (b.paths as string[]) || [];
        return json(paths.map(p => ({ path: p, signedURL: photos.get(p) || '', error: null })));
      }
      if ((m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path))) {
        const blob = init?.body instanceof Blob ? init.body : null;
        if (blob) photos.set(decodeURIComponent(m[2]), URL.createObjectURL(blob));
        return json({ Key: `${m[1]}/${m[2]}`, Id: m[2] });
      }
      return json(null);
    } catch (e) {
      return json({ message: e instanceof Error ? e.message : String(e), code: 'P0001' }, 400);
    }
  };

  // the demo rep is standing in Oakville, next to the biggest plaza in the zones
  const seed = seedJson as unknown as { businesses: { lat: number; lng: number; pid: number | null }[] };
  const byPlaza = new Map<number, { lat: number; lng: number }[]>();
  for (const b of seed.businesses) if (b.pid != null) byPlaza.set(b.pid, [...(byPlaza.get(b.pid) || []), b]);
  const big = [...byPlaza.values()].sort((a, b) => b.length - a.length)[0] || seed.businesses.slice(0, 1);
  const here = { lat: big.reduce((t, b) => t + b.lat, 0) / big.length, lng: big.reduce((t, b) => t + b.lng, 0) / big.length };
  const pos = (): GeolocationPosition => ({
    timestamp: Date.now(),
    coords: { latitude: here.lat, longitude: here.lng, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return this; } },
    toJSON() { return this; },
  } as GeolocationPosition);
  const geo: Geolocation = {
    getCurrentPosition: ok => { setTimeout(() => ok(pos()), 250); },
    watchPosition: ok => { setTimeout(() => ok(pos()), 250); return 1; },
    clearWatch: () => undefined,
  };
  try { Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => geo }); } catch { /* read-only: the real location is used */ }
}

// supabase/functions/planner-push/index.ts — Vijay Planner's push notifications.
//
//   POST { action: 'key' }            → { publicKey }   the VAPID key the phone subscribes with (shared push_keys)
//   POST { token, action: 'test' }    → sends "notifications are on" to every device of the planner user
//   POST { action: 'tick' }  header x-cron-key = planner_secrets.cron_key (or PLANNER_CRON_KEY)  (pg_cron, every 5 minutes)
//        → sends the routine reminders that are due right now, Toronto time, once each per planner day
//
// Subscriptions are planner docs (kind 'push'); reminders already sent are in kind 'pushlog' (one doc per
// planner day); the routine's times come from kind 'prefs' key 'routine'. Deployed without JWT
// verification: 'key' is public, 'test' checks the planner token, 'tick' checks the cron key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { makeVapidKeys, sendPush, type VapidKeys } from './webpush.ts';

const SUBJECT = 'mailto:planner@propertystars.app';
const TZ = 'America/Toronto';
const DAY_START_HOUR = 4;   // the planner's day rolls over at 4 am (src/planner/lib/docs.ts)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Same defaults as src/planner/lib/routine.ts (night: Vijay, morning: Rosh); the app comes from settings.app
type Profile = 'night' | 'morning';
type AppId = 'vijayplanner' | 'roshplanner';
interface Routine { profile: Profile; wake: string; wakeGrace: number; briefMinutes: number; daycare: string; eatOpen: string; eatClose: string; gym: string; shake: string; unwindCap: number; lightsOut: string; stretchMin: number; meditateMin: number; workoutMin: number; kiaanUp: string; fast: boolean }
const NIGHT_ROUTINE: Routine = {
  profile: 'night', stretchMin: 0, meditateMin: 0, workoutMin: 0, kiaanUp: '08:30', fast: true,
  wake: '08:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '23:00', gym: '21:00', shake: '23:00', unwindCap: 60, lightsOut: '01:00',
};
const MORNING_ROUTINE: Routine = {
  profile: 'morning', stretchMin: 10, meditateMin: 10, workoutMin: 20, kiaanUp: '08:00', fast: false,
  wake: '05:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '07:00', eatClose: '20:00', gym: '06:00', shake: '20:00', unwindCap: 30, lightsOut: '21:00',
};
interface UserSettings { app?: string; profile?: string }
const appOf = (s: UserSettings | null | undefined): AppId => (s?.app === 'roshplanner' ? 'roshplanner' : 'vijayplanner');
const profileOf = (s: UserSettings | null | undefined, app: AppId): Profile => (s?.profile === 'morning' || s?.profile === 'night' ? s.profile : app === 'roshplanner' ? 'morning' : 'night');
const APP_NAME: Record<AppId, string> = { vijayplanner: 'Vijay Planner', roshplanner: 'Rosh Planner' };

type Sub = { endpoint: string; p256dh: string; auth: string };
// deno-lint-ignore no-explicit-any
type Svc = any;

async function keys(svc: Svc): Promise<VapidKeys> {
  const { data } = await svc.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  if (data) return { publicKey: data.public_key, privateJwk: data.private_jwk };
  const k = await makeVapidKeys();
  await svc.from('push_keys').upsert({ id: 1, public_key: k.publicKey, private_jwk: k.privateJwk }, { onConflict: 'id', ignoreDuplicates: true });
  const { data: again } = await svc.from('push_keys').select('public_key, private_jwk').eq('id', 1).single();
  return { publicKey: again.public_key, privateJwk: again.private_jwk };
}

/** The planner user's live subscriptions (JSON-null docs are forgotten ones). */
async function subsOf(svc: Svc, userId: string): Promise<{ key: string; sub: Sub }[]> {
  const { data } = await svc.from('planner_docs').select('key, data').eq('user_id', userId).eq('kind', 'push');
  return ((data || []) as { key: string; data: Sub | null }[])
    .filter(d => d.data && typeof d.data === 'object' && d.data.endpoint)
    .map(d => ({ key: d.key, sub: d.data as Sub }));
}

async function forgetSub(svc: Svc, userId: string, key: string): Promise<void> {
  // PostgREST turns a JSON null into SQL NULL (the column is NOT NULL), so a gone subscription is
  // marked instead; subsOf() skips docs without an endpoint.
  await svc.from('planner_docs').update({ data: { gone: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('kind', 'push').eq('key', key);
}

async function sendAll(svc: Svc, userId: string, payload: Record<string, unknown>): Promise<{ sent: number; gone: number }> {
  const k = await keys(svc);
  let sent = 0, gone = 0;
  for (const { key, sub } of await subsOf(svc, userId)) {
    try {
      const status = await sendPush(sub, payload, k, SUBJECT);
      if (status === 404 || status === 410) { await forgetSub(svc, userId, key); gone++; }
      else if (status < 300) sent++;
      else console.error('planner-push: status', status, new URL(sub.endpoint).host);
    } catch (e) { console.error('planner-push: failed', e instanceof Error ? e.message : e); }
  }
  return { sent, gone };
}

// ───────────── time, Toronto ─────────────
/** Local wall-clock parts in the planner's time zone. */
function local(now: Date): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}
/** The planner day key (YYYY-MM-DD, rolls over at 4 am) for an instant. */
function plannerDayKey(now: Date): string {
  const t = local(new Date(now.getTime() - DAY_START_HOUR * 3600_000));
  return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}
const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Minutes since 4 am, so 01:00 sorts after 23:00 — same scale as src/planner/lib/routine.ts. */
const routineMin = (mins: number): number => ((mins - DAY_START_HOUR * 60) + 1440) % 1440;
function clock(hhmm: string): string {
  const m = minutesOf(hhmm), h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

interface Reminder { id: string; at: number; body: string; url: string; done: (day: DayDoc) => boolean }
interface DayDoc { brief?: { finishedAt?: string }; ticks?: Record<string, string | undefined> }

function reminders(r: Routine, app: AppId): Reminder[] {
  const u = (path: string) => `/${app}${path}`;
  if (r.profile === 'morning') return [
    { id: 'wake', at: routineMin(minutesOf(r.wake)), body: 'Morning. Stretch, breathe, move — then the Brief.', url: u('/plan/morning'), done: d => !!d.ticks?.up },
    { id: 'evening', at: routineMin(minutesOf(r.lightsOut) - 30), body: 'Evening review, then bed with Kiaan.', url: u('/plan/night'), done: d => !!d.ticks?.lightsOut },
    { id: 'bed', at: routineMin(minutesOf(r.lightsOut) - 10), body: 'Lights out.', url: u('/plan/night'), done: d => !!d.ticks?.lightsOut },
  ];
  return [
    { id: 'wake', at: routineMin(minutesOf(r.wake)), body: `Morning. Bed Brief — ${r.briefMinutes} minutes, from bed.`, url: u('/plan/brief'), done: d => !!d.brief?.finishedAt },
    { id: 'window', at: routineMin(minutesOf(r.eatOpen) - 15), body: `Eating window opens at ${clock(r.eatOpen)}. Protein first.`, url: u('/food'), done: d => !!d.ticks?.dinner },
    { id: 'gym', at: routineMin(minutesOf(r.gym) - 20), body: `Gym at ${clock(r.gym)} with the boys.`, url: u('/workout'), done: d => !!d.ticks?.gym },
    { id: 'shake', at: routineMin(minutesOf(r.shake)), body: 'Shake, then Miracle Night.', url: u('/plan/night'), done: d => !!d.ticks?.shake },
    { id: 'lightsOut', at: routineMin(minutesOf(r.lightsOut) - 15), body: 'Lights out in 15.', url: u('/plan/night'), done: d => !!d.ticks?.lightsOut },
  ];
}

/** Which reminders fire at `now`: within [t, t+10 min) and not yet logged or already done. Pure. */
export function dueReminders(r: Routine, now: Date, log: Record<string, string>, day: DayDoc, app: AppId = 'vijayplanner'): Reminder[] {
  const t = local(now);
  const nowMin = routineMin(t.h * 60 + t.min);
  return reminders(r, app).filter(x => nowMin >= x.at && nowMin < x.at + 10 && !log[x.id] && !x.done(day));
}

async function doc<T>(svc: Svc, userId: string, kind: string, key: string): Promise<T | null> {
  const { data } = await svc.from('planner_docs').select('data').eq('user_id', userId).eq('kind', kind).eq('key', key).maybeSingle();
  return data && data.data && typeof data.data === 'object' ? data.data as T : null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const url = Deno.env.get('SUPABASE_URL')!;
    const svc = createClient(url, svcKey, { auth: { persistSession: false } });
    const b = await req.json().catch(() => ({})) as { action?: string; token?: string };

    if (b.action === 'key') return json({ publicKey: (await keys(svc)).publicKey });

    if (b.action === 'test') {
      const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
      const { data: me, error } = await anon.rpc('planner_me', { p_token: b.token || '' });
      if (error || !me?.ok) return json({ error: 'signed_out' }, 401);
      const app = appOf(me.user.settings as UserSettings);
      const r = await sendAll(svc, me.user.id, { title: APP_NAME[app], body: 'Notifications are on.', url: `/${app}/`, tag: 'test', icon: `/${app}/icon-192.png` });
      return json({ ok: true, ...r });
    }

    if (b.action === 'tick') {
      // the key lives in planner_secrets (service role only); pg_cron sends the same row's value
      let want = Deno.env.get('PLANNER_CRON_KEY') || '';
      if (!want) { const { data: k } = await svc.from('planner_secrets').select('value').eq('name', 'cron_key').maybeSingle(); want = k?.value || ''; }
      if (!want || (req.headers.get('x-cron-key') || '') !== want) return json({ error: 'Not allowed' }, 403);
      const now = new Date();
      const dayKey = plannerDayKey(now);
      let sent = 0, skipped = 0;
      const { data: users } = await svc.from('planner_users').select('id, settings');
      for (const u of (users || []) as { id: string; settings: UserSettings | null }[]) {
        const subs = await subsOf(svc, u.id);
        if (!subs.length) continue;
        const app = appOf(u.settings);
        const profile = profileOf(u.settings, app);
        const routine: Routine = { ...(profile === 'morning' ? MORNING_ROUTINE : NIGHT_ROUTINE), ...((await doc<Partial<Routine>>(svc, u.id, 'prefs', 'routine')) || {}), profile };
        const log = (await doc<Record<string, string>>(svc, u.id, 'pushlog', dayKey)) || {};
        const day = (await doc<DayDoc>(svc, u.id, 'day', dayKey)) || {};
        const due = dueReminders(routine, now, log, day, app);
        if (!due.length) { skipped++; continue; }
        for (const rem of due) {
          const r = await sendAll(svc, u.id, { title: APP_NAME[app], body: rem.body, url: rem.url, tag: rem.id, icon: `/${app}/icon-192.png` });
          sent += r.sent;
          log[rem.id] = now.toISOString();
        }
        await svc.from('planner_docs').upsert({ user_id: u.id, kind: 'pushlog', key: dayKey, data: log, updated_at: now.toISOString() }, { onConflict: 'user_id,kind,key' });
      }
      return json({ ok: true, sent, skipped, day: dayKey });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});

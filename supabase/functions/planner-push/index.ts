// supabase/functions/planner-push/index.ts — Vijay Planner's push notifications.
//
//   POST { action: 'key' }            → { publicKey }   the VAPID key the phone subscribes with (shared push_keys)
//   POST { token, action: 'test' }    → sends "notifications are on" to every device of the planner user
//   POST { action: 'tick' }  header x-cron-key = planner_secrets.cron_key (or PLANNER_CRON_KEY)  (pg_cron, every 5 minutes)
//        → sends the routine reminders that are due right now, Toronto time, once each per planner day
//
// Subscriptions are planner docs (kind 'push'); reminders already sent are in kind 'pushlog' (one doc per
// planner day); the routine's times come from kind 'prefs' key 'routine', and a day's own changes to it (sick: no
// gym, up at 7) from that day's doc (reminders.ts, adjust.ts: shared with the app). Deployed without JWT
// verification: 'key' is public, 'test' checks the planner token, 'tick' checks the cron key.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { makeVapidKeys, sendPush, type VapidKeys } from './webpush.ts';
import { clock, dueReminders, plannerDayKey, MORNING_ROUTINE, NIGHT_ROUTINE, type AppId, type DayDoc, type Profile, type Routine } from './reminders.ts';
import { cleanAdjust, routineFor } from './adjust.ts';

const SUBJECT = 'mailto:planner@propertystars.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

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

async function doc<T>(svc: Svc, userId: string, kind: string, key: string): Promise<T | null> {
  const { data } = await svc.from('planner_docs').select('data').eq('user_id', userId).eq('kind', kind).eq('key', key).maybeSingle();
  return data && data.data && typeof data.data === 'object' ? data.data as T : null;
}

/** "Kitchen closes at 2:00 pm — 45 g protein still to go." from today's logged meals and the protein goal. */
async function kitchenBody(svc: Svc, userId: string, dayKey: string, r: Routine): Promise<string> {
  const head = `Kitchen closes at ${clock(r.kitchenClose)}`;
  try {
    const goal = Number((await doc<{ protein?: number }>(svc, userId, 'foodprefs', 'targets'))?.protein) || 180;
    const { data } = await svc.from('planner_docs').select('data').eq('user_id', userId).eq('kind', 'meal').gte('key', `${dayKey}~`).lt('key', `${dayKey}~~`);
    const eaten = Math.round(((data || []) as { data: { totals?: { protein?: number } } | null }[]).reduce((t, m) => t + (Number(m.data?.totals?.protein) || 0), 0));
    const left = goal - eaten;
    return left > 0 ? `${head} — ${left} g protein still to go (${eaten} of ${goal}).` : `${head} — ${eaten} g protein, goal hit. 💪`;
  } catch { return `${head} — 30 minutes.`; }
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
          if (rem.id === 'kitchen') rem.body = await kitchenBody(svc, u.id, dayKey, routineFor(routine, cleanAdjust(day.adjust)));
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

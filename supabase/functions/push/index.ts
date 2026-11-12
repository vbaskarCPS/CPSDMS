// supabase/functions/push/index.ts — push notifications for propertystars.app.
//
//   POST { action: 'key' }                          → { publicKey }   the VAPID public key the browser subscribes with
//   POST { action: 'notify', messages: [uuid, …] }  (service role only: the mail functions) → tells whoever a new
//        message is for (push_for_message: the mailbox's owner, or the business's rep) on every device they
//        turned notifications on. Gone subscriptions (404/410) are removed.
//   POST { action: 'benny_live' }                   → tells the people whose Benny log entry (a bug, a request) just went
//        live, on the devices they turned notifications on. It takes nothing from the caller: the database hands over
//        what is due (benny_live_due), each notice once, so calling it can only send what was already ordered.
//   POST { action: 'events' }                       → sends what Settings › Notifications says is due (notify_due: the
//        database works out who, from their choices, and hands each one over once; several of a kind become one).
// The VAPID keys are made here the first time and kept in push_keys (no one else can read that table), so
// there is no secret to set. Deployed without JWT verification: 'key' is public, 'notify' checks the
// service role key itself, and 'benny_live' and 'events' have nothing a caller can change.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { makeVapidKeys, sendPush, type VapidKeys } from './webpush.ts';

const SUBJECT = Deno.env.get('PUSH_SUBJECT') || 'mailto:mainstreetai@propertystars.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
async function keys(svc: any): Promise<VapidKeys> {
  const { data } = await svc.from('push_keys').select('public_key, private_jwk').eq('id', 1).maybeSingle();
  if (data) return { publicKey: data.public_key, privateJwk: data.private_jwk };
  const k = await makeVapidKeys();
  await svc.from('push_keys').upsert({ id: 1, public_key: k.publicKey, private_jwk: k.privateJwk }, { onConflict: 'id', ignoreDuplicates: true });
  const { data: again } = await svc.from('push_keys').select('public_key, private_jwk').eq('id', 1).single();   // whoever won the race
  return { publicKey: again.public_key, privateJwk: again.private_jwk };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, svcKey, { auth: { persistSession: false } });
    const b = await req.json().catch(() => ({})) as { action?: string; messages?: string[] };
    if (b.action === 'key') return json({ publicKey: (await keys(svc)).publicKey });

    if (b.action === 'notify') {
      if ((req.headers.get('Authorization') || '') !== `Bearer ${svcKey}`) return json({ error: 'Not allowed' }, 403);
      const k = await keys(svc);
      let sent = 0, gone = 0;
      for (const id of (b.messages || []).slice(0, 50)) {
        const { data: n } = await svc.rpc('push_for_message', { p_message: id });
        if (!n) continue;
        for (const s of (n.subs || []) as { endpoint: string; p256dh: string; auth: string }[]) {
          try {
            const status = await sendPush(s, { title: n.title, body: n.body, url: n.url, tag: n.tag }, k, SUBJECT);
            if (status === 404 || status === 410) { await svc.rpc('push_gone', { p_endpoint: s.endpoint }); gone++; }
            else if (status < 300) sent++;
            else console.error('push: status', status, new URL(s.endpoint).host);
          } catch (e) { console.error('push: failed', e instanceof Error ? e.message : e); }
        }
      }
      return json({ ok: true, sent, gone });
    }
    if (b.action === 'benny_live') {
      const { data: due, error } = await svc.rpc('benny_live_due');
      if (error) return json({ error: error.message }, 500);
      const list = (Array.isArray(due) ? due : []) as { id: string; title: string; body: string; url: string; tag: string; subs?: { endpoint: string; p256dh: string; auth: string }[] }[];
      if (!list.length) return json({ ok: true, notices: 0, sent: 0, gone: 0 });
      const k = await keys(svc);
      let sent = 0, gone = 0;
      for (const n of list) {
        let ok = 0;
        for (const s of n.subs || []) {
          try {
            const status = await sendPush(s, { title: n.title, body: n.body, url: n.url, tag: n.tag }, k, SUBJECT);
            if (status === 404 || status === 410) { await svc.rpc('push_gone', { p_endpoint: s.endpoint }); gone++; }
            else if (status < 300) ok++;
            else console.error('push: status', status, new URL(s.endpoint).host);
          } catch (e) { console.error('push: failed', e instanceof Error ? e.message : e); }
        }
        sent += ok;
        await svc.rpc('benny_live_sent', { p_id: n.id, p_sent: ok });
      }
      return json({ ok: true, notices: list.length, sent, gone });
    }
    if (b.action === 'events') {
      const { data: due, error } = await svc.rpc('notify_due');
      if (error) return json({ error: error.message }, 500);
      const list = (Array.isArray(due) ? due : []) as { title: string; body: string; url: string; tag: string; icon?: string | null; subs?: { endpoint: string; p256dh: string; auth: string }[] }[];
      if (!list.length) return json({ ok: true, notices: 0, sent: 0, gone: 0 });
      const k = await keys(svc);
      let sent = 0, gone = 0;
      for (const n of list) {
        for (const s of n.subs || []) {
          try {
            const status = await sendPush(s, { title: n.title, body: n.body, url: n.url, tag: n.tag, ...(n.icon ? { icon: n.icon } : {}) }, k, SUBJECT);
            if (status === 404 || status === 410) { await svc.rpc('push_gone', { p_endpoint: s.endpoint }); gone++; }
            else if (status < 300) sent++;
            else console.error('push: status', status, new URL(s.endpoint).host);
          } catch (e) { console.error('push: failed', e instanceof Error ? e.message : e); }
        }
      }
      return json({ ok: true, notices: list.length, sent, gone });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});

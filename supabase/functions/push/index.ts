// supabase/functions/push/index.ts — push notifications for propertystars.app.
//
//   POST { action: 'key' }                          → { publicKey }   the VAPID public key the browser subscribes with
//   POST { action: 'notify', messages: [uuid, …] }  (service role only: the mail functions) → tells whoever a new
//        message is for (push_for_message: the mailbox's owner, or the business's rep) on every device they
//        turned notifications on. Gone subscriptions (404/410) are removed.
// The VAPID keys are made here the first time and kept in push_keys (no one else can read that table), so
// there is no secret to set. Deployed without JWT verification: 'key' is public, 'notify' checks the
// service role key itself.
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
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});

// supabase/functions/ms-site-quote/index.ts — "Request your free savings quote" on the Main Street AI website
// (mainstreetai.propertystars.app). No sign-in: anyone on the site can send one.
//
// POST { name, business, email, phone?, city?, spend?, message?, website (must be empty), ms (time on the form) }
// → the request is filed in the MainstreetAI inbox exactly like an email from the customer to
//   mainstreetai@propertystars.app (ms_mail_inbound): a conversation with them (under their business if we already
//   know their address, else Unsorted for admins), so a reply goes straight to them; admins get the push alert.
//
// Spam: a hidden field people never fill, a minimum time on the form, at most 3 requests per address an hour,
// and at most 40 from the site an hour overall. Nothing is sent to the customer from here.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { asEmail, readQuote } from './quote.ts';

const INBOX = 'mainstreetai@propertystars.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const r = readQuote(b);
    if ('error' in r) return r.quiet ? json({ ok: true }) : json({ error: r.error }, 400);   // spam gets a quiet "ok"
    const q = r.quote;
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const mine = await svc.from('ms_messages').select('id', { count: 'exact', head: true })
      .like('resend_id', 'site-quote:%').eq('from_email', q.email).gte('at', hourAgo);
    if ((mine.count || 0) >= 3) return json({ error: 'We already have your request. A consultant will be in touch.' }, 429);
    const all = await svc.from('ms_messages').select('id', { count: 'exact', head: true }).like('resend_id', 'site-quote:%').gte('at', hourAgo);
    if ((all.count || 0) >= 40) return json({ error: 'We’re getting a lot of requests right now. Please email us instead.' }, 429);

    const e = asEmail(q);
    const { data, error } = await svc.rpc('ms_mail_inbound', {
      p_resend_id: `site-quote:${crypto.randomUUID()}`, p_from: q.email, p_from_name: q.name, p_to: [INBOX], p_cc: [],
      p_subject: e.subject, p_html: e.html, p_text: e.text, p_message_id: null, p_in_reply_to: null, p_attachments: [], p_at: null,
    });
    if (error) { console.error('ms-site-quote: file', error.message); return json({ error: 'The request didn’t go through.' }, 500); }
    const filed = data as { thread_id?: string; message_id?: string };

    // tell the admins (never fails the request)
    if (filed?.message_id) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 8000);
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'notify', messages: [filed.message_id] }),
        });
        clearTimeout(t);
      } catch (err) { console.error('ms-site-quote: notify', err instanceof Error ? err.message : err); }
    }
    return json({ ok: true });
  } catch (err) {
    console.error('ms-site-quote', err instanceof Error ? err.message : err);
    return json({ error: 'The request didn’t go through.' }, 500);
  }
});

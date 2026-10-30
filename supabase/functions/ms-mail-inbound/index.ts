// supabase/functions/ms-mail-inbound/index.ts — MainstreetAI mail: Resend's "email.received" webhook.
//
// Resend posts here when mail arrives at propertystars.app. The post is checked against the
// webhook's signing secret (RESEND_WEBHOOK_SECRET, Svix format), then (with RESEND_RECEIVING_API_KEY, a
// full-access key, falling back to RESEND_API_KEY):
//   1. the full email (body, headers) is fetched from Resend's receiving API
//   2. mail_inbound files it: to a staff address (or an alias) → that manager's mailbox, in the conversation
//      it answers; otherwise the MainstreetAI rules (ms_mail_inbound): the conversation's reply address, the
//      message it answers, the latest conversation with that sender, a new one under the business with
//      that contact's email, or "unsorted" for admins. "Unsubscribe" records an opt-out.
//   3. attachments are copied into the private ms-mail bucket (in/<conversation>/<message>/<file>)
//   4. the push function tells whoever it's for
//   5. for a customer's email to a centre's customer mailbox, Claude suggests a reply and what to do with the booking
//      (in the background, after answering Resend; kept for someone to approve — _shared/suggest.ts, RUN_71)
// Deployed without JWT verification (Resend isn't signed in); the signature check stands in for it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { DELIVERY_EVENTS, reasonOf, verify } from '../_shared/svix.ts';
import { suggestFor } from '../_shared/suggest.ts';
export { verify };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MAX_ATTACHMENT = 20 * 1024 * 1024;

/** "Ann Owner <ann@shop.ca>" → { email, name } */
export function parseAddress(s: string | null | undefined): { email: string; name: string | null } {
  const v = (s || '').trim();
  const m = /^(.*?)\s*<([^>]+)>$/.exec(v);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].replace(/^"|"$/g, '').trim() || null };
  return { email: v.toLowerCase(), name: null };
}
const list = (x: unknown): string[] => (Array.isArray(x) ? x : typeof x === 'string' && x ? [x] : []).map(a => parseAddress(String(a)).email).filter(Boolean);
/** The Message-ID this email answers: In-Reply-To, else the last one in References. */
export function answers(hdr: Record<string, string>): string | null {
  const irt = (hdr['in-reply-to'] || '').trim();
  if (irt) return (/<[^>]+>/.exec(irt)?.[0]) || irt;
  const refs = (hdr['references'] || '').match(/<[^>]+>/g);
  return refs?.length ? refs[refs.length - 1] : null;
}
const safeName = (s: string) => (s || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const raw = await req.text();
  const ok = await verify(Deno.env.get('RESEND_WEBHOOK_SECRET') || '', req.headers.get('svix-id') || '', req.headers.get('svix-timestamp') || '',
    raw, req.headers.get('svix-signature') || '');
  if (!ok) return json({ error: 'Bad signature' }, 401);
  try {
    const evt = JSON.parse(raw) as { type?: string; created_at?: string; data?: Record<string, unknown> & { email_id?: string; created_at?: string } };
    // delivery events, if this webhook is sent them too: the same as the bounce webhook (clever-worker) does
    if (evt.type && DELIVERY_EVENTS.includes(evt.type) && evt.data?.email_id) {
      const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
      const { data, error } = await svc.rpc('mail_delivery', { p_resend_id: evt.data.email_id, p_type: evt.type, p_reason: reasonOf(evt.data),
        p_at: evt.created_at || evt.data.created_at || null });
      if (error) { console.error('ms-mail-inbound: mail_delivery', error.message); return json({ error: error.message }, 500); }
      return json({ received: true, ...(data as object) });
    }
    if (evt.type !== 'email.received' || !evt.data?.email_id) return json({ ignored: evt.type || 'unknown' });
    // reading received mail needs a full-access key; the app's sending key may be "sending access" only
    const apiKey = Deno.env.get('RESEND_RECEIVING_API_KEY') || Deno.env.get('RESEND_API_KEY')!;
    const id = evt.data.email_id;
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) { const why = await r.text().catch(() => ''); console.error('ms-mail-inbound: fetch failed', r.status, why.slice(0, 300)); return json({ error: `Couldn’t fetch the email (${r.status})` }, 502); }   // Resend retries
    const e = await r.json() as Record<string, unknown> & { headers?: Record<string, string> };
    const from = parseAddress(String(e.from || ''));
    const hdr = Object.fromEntries(Object.entries(e.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const args = {
      p_resend_id: id, p_from: from.email, p_from_name: from.name,
      p_to: [...list(e.to), ...list(e.received_for)], p_cc: list(e.cc), p_subject: String(e.subject || ''),
      p_html: typeof e.html === 'string' ? e.html : null, p_text: typeof e.text === 'string' ? e.text : null,
      p_message_id: typeof e.message_id === 'string' && e.message_id.trim() ? (e.message_id.trim().startsWith('<') ? e.message_id.trim() : `<${e.message_id.trim()}>`) : null,
      p_in_reply_to: answers(hdr), p_at: (e.created_at as string) || evt.data.created_at || null,
    };
    let { data: filed, error } = await svc.rpc('mail_inbound', args);
    if (error && /mail_inbound/.test(error.message)) {
      // staff mailboxes (RUN_65) not in this database yet: MainstreetAI filing only
      const old = await svc.rpc('ms_mail_inbound', { ...args, p_attachments: [] });
      error = old.error;
      const o = old.data as { thread_id?: string; message_id?: string; again?: boolean } | null;
      filed = o?.again ? { again: true } : { deliveries: o ? [o] : [] };
    }
    if (error) return json({ error: error.message }, 500);
    const f = filed as { again?: boolean; deliveries?: { thread_id?: string; message_id?: string }[] };
    const deliveries = (f.deliveries || []).filter(d => d.thread_id && d.message_id) as { thread_id: string; message_id: string }[];
    if (f.again || !deliveries.length) return json({ ok: true, again: !!f.again });

    // attachments into the private bucket, a copy for each conversation it landed in
    let saved = 0;
    const al = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}/attachments`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (al.ok) {
      const { data: atts } = await al.json() as { data?: { id: string; filename: string; size: number; content_type: string; download_url: string }[] };
      const files: { name: string; type: string; size: number; bytes: ArrayBuffer }[] = [];
      for (const a of atts || []) {
        if (a.size > MAX_ATTACHMENT || !a.download_url) continue;
        const dl = await fetch(a.download_url);
        if (dl.ok) files.push({ name: a.filename || 'file', type: a.content_type || 'application/octet-stream', size: a.size, bytes: await dl.arrayBuffer() });
      }
      for (const d of files.length ? deliveries : []) {
        const list: { name: string; type: string; size: number; path: string }[] = [];
        for (const fl of files) {
          const path = `in/${d.thread_id}/${d.message_id}/${safeName(fl.name)}`;
          const up = await svc.storage.from('ms-mail').upload(path, fl.bytes, { contentType: fl.type, upsert: true });
          if (!up.error) list.push({ name: fl.name, type: fl.type, size: fl.size, path });
        }
        if (list.length) { await svc.rpc('ms_mail_set_attachments', { p_message: d.message_id, p_attachments: list }); saved += list.length; }
      }
    }
    // tell whoever it's for (never fails the delivery)
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push`, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notify', messages: deliveries.map(d => d.message_id) }),
      });
      clearTimeout(t);
    } catch (err) { console.error('ms-mail-inbound: notify', err instanceof Error ? err.message : err); }
    // Claude's suggestion, in the background (it takes a few seconds; Resend shouldn't wait)
    const suggest = Promise.all(deliveries.map(d => suggestFor(svc, d.message_id)
      .catch(err => console.error('ms-mail-inbound: suggest', err instanceof Error ? err.message : err))));
    const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(suggest); else await suggest;
    return json({ ok: true, deliveries: deliveries.length, attachments: saved });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});

// supabase/functions/ms-rep-notify/index.ts — MainstreetAI rep app: the follow-up emails reps turn on in Settings.
//   POST { action: 'tick' }  header x-cron-key = planner_secrets.cron_key  (pg_cron, every 2 minutes)
// Sends each "follow-up set" email once, and each rep's 8 AM "today's follow-ups" email once a day (ms_notify_pending
// says what's due; ms_notify_mark records it so nothing goes twice, even when sending failed).
// The Resend key lives only in the RESEND_API_KEY secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { followupIcs, morningEmail, setEmail, type MorningNotice, type SetNotice } from './mail.ts';

const FROM_ADDRESS = Deno.env.get('MAINSTREET_MAIL_FROM') || 'mainstreetai@propertystars.app';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: k } = await svc.from('planner_secrets').select('value').eq('name', 'cron_key').maybeSingle();
    if (!k?.value || (req.headers.get('x-cron-key') || '') !== k.value) return json({ error: 'Not allowed' }, 403);
    const body = await req.json().catch(() => ({})) as { action?: string };
    if (body.action !== 'tick') return json({ error: 'Unknown action' }, 400);
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'RESEND_API_KEY is missing' }, 500);

    const { data, error } = await svc.rpc('ms_notify_pending');
    if (error) throw new Error(error.message);
    const due = data as { set: SetNotice[]; morning: MorningNotice[] };

    const send = async (to: string, mail: { subject: string; html: string; text: string }, ics?: string) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `MainstreetAI Follow-ups <${FROM_ADDRESS}>`, to: [to], subject: mail.subject, html: mail.html, text: mail.text,
          ...(ics ? { attachments: [{ filename: 'follow-up.ics', content: b64(ics), content_type: 'text/calendar; charset=utf-8; method=PUBLISH' }] } : {}) }),
      });
      return res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}`;
    };
    const mark = (kind: string, ref: string, rep: string, err: string | null) =>
      svc.rpc('ms_notify_mark', { p_kind: kind, p_ref: ref, p_rep: rep, p_ok: !err, p_error: err });

    let sent = 0, failed = 0;
    for (const n of due.set || []) {
      const err = await send(n.email, setEmail(n), followupIcs(n)).catch(e => String(e));
      await mark('set', n.visit_id, n.rep_id, err);
      if (err) { failed++; console.error('ms-rep-notify: set', n.visit_id, err); } else sent++;
    }
    for (const n of due.morning || []) {
      if (!n.items?.length) continue;
      const err = await send(n.email, morningEmail(n)).catch(e => String(e));
      await mark('morning', `${n.rep_id}:${n.day}`, n.rep_id, err);
      if (err) { failed++; console.error('ms-rep-notify: morning', n.rep_id, err); } else sent++;
    }
    return json({ sent, failed });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});

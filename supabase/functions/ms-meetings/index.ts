// supabase/functions/ms-meetings/index.ts — MainstreetAI › Meetings: the emails for an onboarding call.
// POST as the signed-in rep, host or admin who booked or changed the call:
//   { action: 'notify', meeting_id, kind: 'booked' | 'changed' | 'cancelled' }
// The owner (when they gave an email) and the host each get an email with the time, the host's Zoom link and a
// calendar invite (.ics). ms_meeting_notice, run as the caller, checks they may see this call.
// → { sent: ['owner', 'host'], skipped: [...] }
// The Resend key lives only in the RESEND_API_KEY secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { icsFor, meetingEmail, type MeetingNotice } from './mail.ts';

const FROM_ADDRESS = Deno.env.get('MAINSTREET_MAIL_FROM') || 'mainstreetai@propertystars.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'Email isn’t set up (RESEND_API_KEY is missing).' }, 500);
    const body = await req.json().catch(() => ({})) as { action?: string; meeting_id?: string; kind?: string };
    if (body.action !== 'notify' || !body.meeting_id) return json({ error: 'Which call?' }, 400);
    const kind = (['booked', 'changed', 'cancelled'].includes(body.kind || '') ? body.kind : 'booked') as 'booked' | 'changed' | 'cancelled';
    const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
    });
    const { data, error } = await user.rpc('ms_meeting_notice', { p_meeting: body.meeting_id });
    if (error) return json({ error: error.message }, /not allowed/i.test(error.message) ? 403 : 400);
    const m = data as MeetingNotice;
    const sent: string[] = [], skipped: string[] = [];
    const to: { who: 'owner' | 'host'; email: string | null }[] = [{ who: 'owner', email: m.owner_email }, { who: 'host', email: m.host.email }];
    for (const t of to) {
      if (!t.email) { skipped.push(t.who); continue; }
      const mail = meetingEmail(m, t.who, kind);
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${mail.fromName.replace(/[<>"]/g, '')} <${FROM_ADDRESS}>`,
          to: [t.email],
          reply_to: t.who === 'owner' ? (m.host.email || undefined) : (m.owner_email || undefined),
          subject: mail.subject, html: mail.html, text: mail.text,
          attachments: [{ filename: 'onboarding-call.ics', content: b64(icsFor(m, kind, new Date(), FROM_ADDRESS, t.who)), content_type: 'text/calendar; charset=utf-8; method=' + (kind === 'cancelled' ? 'CANCEL' : 'REQUEST') }],
        }),
      });
      if (res.ok) sent.push(t.who);
      else { skipped.push(t.who); console.error('ms-meetings: send', t.who, res.status, (await res.text()).slice(0, 300)); }
    }
    return json({ sent, skipped });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});

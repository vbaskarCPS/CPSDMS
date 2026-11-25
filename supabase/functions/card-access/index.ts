// supabase/functions/card-access/index.ts — tells a manager that Card Processing was turned on for them
// (card_access in 20261253900000_card_access.sql). Header x-cron-key = planner_secrets.cron_key; deployed without
// JWT checks. The database calls it when the permission is added in User Management.
//   POST { action: 'tick' }   email everyone whose access is new and not yet emailed (each up to 3 tries)
// Sent with Resend (RESEND_API_KEY) from accounts@propertystars.app; replies go to whoever turned it on.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { accessEmail } from './email.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const FROM = 'Property Stars <accounts@propertystars.app>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

    const { data: due, error } = await svc.from('card_access').select('user_id, granted_by, email_tries')
      .is('revoked_at', null).is('emailed_at', null).lt('email_tries', 3);
    if (error) throw new Error(error.message);
    let sent = 0, failed = 0;
    for (const a of (due || []) as { user_id: string; granted_by: string | null; email_tries: number }[]) {
      // one sender per person: only the call that moves the count goes on
      const { data: mine } = await svc.from('card_access').update({ email_tries: a.email_tries + 1 })
        .eq('user_id', a.user_id).eq('email_tries', a.email_tries).is('emailed_at', null).select('user_id');
      if (!mine?.length) continue;
      const { data: u } = await svc.from('app_users').select('full_name, username, email, is_active').eq('id', a.user_id).maybeSingle();
      const { data: by } = a.granted_by ? await svc.from('app_users').select('full_name, email').eq('id', a.granted_by).maybeSingle() : { data: null };
      const to = String(u?.email || '').trim();
      if (!u?.is_active || !EMAIL_RE.test(to)) {
        await svc.from('card_access').update({ email_tries: 3, email_error: !u?.is_active ? 'The account is not active' : 'No email address on the account' }).eq('user_id', a.user_id);
        failed++; continue;
      }
      const mail = accessEmail({ firstName: String(u.full_name || '').trim().split(/\s+/)[0] || 'there', username: u.username || null, grantedBy: by?.full_name || null });
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text,
            ...(by?.email && EMAIL_RE.test(by.email) ? { reply_to: by.email } : {}) }),
        });
        const out = await res.json().catch(() => ({})) as { message?: string };
        if (!res.ok) throw new Error(`${res.status} ${out.message || ''}`.trim());
        await svc.from('card_access').update({ emailed_at: new Date().toISOString(), email_to: to, email_error: null }).eq('user_id', a.user_id);
        sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('card-access', a.user_id, msg);
        await svc.from('card_access').update({ email_to: to, email_error: msg.slice(0, 300) }).eq('user_id', a.user_id);
        failed++;
      }
    }
    return json({ sent, failed });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});

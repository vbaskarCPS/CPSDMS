// supabase/functions/rep-auth/index.ts — MainstreetAI reps: sign in with their email, and "forgot password".
//
// Reps sign in with their email only: they have no username they can use (RUN_62 gives each rep a hidden
// sign-in address, which only this function looks up). The browser can't be allowed to ask which
// emails belong to reps, so both steps happen here, with the service role, and always answer the
// same way whether or not the email is a rep's.
//
// POST { action: 'sign_in', email, password }  → { access_token, refresh_token } or "Wrong email or password."
// POST { action: 'forgot', email }              → { ok: true } always; a rep gets a one-time link (2 hours)
//                                                  by email (Resend), MainstreetAI-branded
//
// Deployed without JWT verification (the rep isn't signed in yet). The Resend key lives only in the
// RESEND_API_KEY secret; the link code never goes back to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APP_URL = (Deno.env.get('APP_URL') || 'https://propertystars.app').replace(/\/+$/, '');
const FROM = Deno.env.get('MAINSTREET_FROM') || 'MainstreetAI <accounts@propertystars.app>';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const WRONG = 'Wrong email or password.';

export function resetEmail(p: { firstName: string; link: string }): { subject: string; html: string; text: string } {
  const subject = 'Reset your MainstreetAI password';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#1c1b1a;padding:24px;text-align:center;color:#f6f1e7;font-size:24px;font-weight:bold;letter-spacing:-.5px;">Mainstreet<span style="color:#5eead4;">AI</span></td></tr>
  <tr><td style="padding:28px;">
    <h2 style="margin:0 0 10px;color:#111827;font-size:20px;">Hi ${esc(p.firstName)},</h2>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">Someone asked to reset the password for your MainstreetAI account. Choose a new one here:</p>
    <p style="margin:0 0 22px;text-align:center;"><a href="${p.link}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:8px;font-size:15px;">Choose a new password</a></p>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.5;">The link works once and expires in 2 hours. Then sign in at <a href="${APP_URL}/mainstreet" style="color:#0f766e;">${APP_URL.replace(/^https?:\/\//, '')}/mainstreet</a> with your email.</p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">If you didn’t ask for this, ignore it: your password stays the same.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${p.firstName},\n\nSomeone asked to reset the password for your MainstreetAI account. Choose a new one here (works once, expires in 2 hours):\n${p.link}\n\nThen sign in at ${APP_URL}/mainstreet with your email.\n\nIf you didn’t ask for this, ignore it.\n`;
  return { subject, html, text };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; email?: string; password?: string };
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter your email.' }, 400);
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    if (body.action === 'sign_in') {
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) return json({ error: WRONG }, 401);
      const { data: address } = await svc.rpc('ms_rep_login_address', { p_email: email });
      if (typeof address !== 'string' || !address) return json({ error: WRONG }, 401);
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
      const { data, error } = await anon.auth.signInWithPassword({ email: address, password });
      if (error || !data.session) return json({ error: /rate|too many/i.test(error?.message || '') ? 'Too many tries. Wait a minute and try again.' : WRONG }, 401);
      return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    }

    if (body.action === 'forgot') {
      const apiKey = Deno.env.get('RESEND_API_KEY');
      if (!apiKey) return json({ error: 'Email isn’t set up.' }, 500);
      const { data } = await svc.rpc('ms_rep_reset_link', { p_email: email });
      const row = (data as { code: string; email: string; full_name: string }[] | null)?.[0];
      if (row) {
        const mail = resetEmail({ firstName: row.full_name.split(/\s+/)[0] || row.full_name, link: `${APP_URL}/app/setup#t=${row.code}` });
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM, to: row.email, subject: mail.subject, html: mail.html, text: mail.text }),
        });
        const result = await res.json().catch(() => ({}));
        const sendError = res.ok ? null : String(result?.message || `Resend error ${res.status}`);
        await svc.rpc('app_setup_record_send', { p_code: row.code, p_resend_id: result?.id ?? null, p_error: sendError });
        await svc.from('email_logs').insert({ recipient_email: row.email, email_type: 'mainstreet_reset', status: res.ok ? 'sent' : 'failed',
          resend_message_id: result?.id ?? null, bounce_reason: sendError });
      }
      return json({ ok: true });   // the same answer whether or not the email is a rep's
    }

    return json({ error: 'Unknown action' }, 400);
  } catch {
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
});

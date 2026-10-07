// supabase/functions/account-setup/index.ts — emails a new manager their account setup link (Resend).
//
// POST { userId } as a signed-in admin (Super Admin › Users permission).
//   1. app_admin_issue_setup(userId), called with the admin's own sign-in, checks the permission and
//      makes a one-time link code (only its hash is kept in the database)
//   2. the link goes to the user's email through Resend, from accounts@propertystars.app, with the
//      admin as the reply-to
//   3. whether Resend took it is recorded on the link (app_setup_record_send, service role)
//
// The Resend key lives only in the RESEND_API_KEY secret. The link code never goes back to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APP_URL = (Deno.env.get('APP_URL') || 'https://propertystars.app').replace(/\/+$/, '');
const FROM = Deno.env.get('ACCOUNT_SETUP_FROM') || 'Property Stars <accounts@propertystars.app>';
const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function setupEmail(p: { firstName: string; username: string; link: string; invitedBy: string | null; expires: string }): { subject: string; html: string; text: string } {
  const subject = 'Set up your Property Stars account';
  const by = p.invitedBy ? `${esc(p.invitedBy)} added you` : 'You’ve been added';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#111827;padding:26px;text-align:center;"><img src="${LOGO_URL}" alt="Property Stars" style="max-width:180px;height:auto;" /></td></tr>
  <tr><td style="padding:28px;">
    <h2 style="margin:0 0 10px;color:#111827;font-size:20px;">Hi ${esc(p.firstName)},</h2>
    <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${by} to the Property Stars DMS. Choose your password to finish setting up your account.</p>
    <table cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 20px;width:100%;">
      <tr><td style="padding:14px 16px;font-size:14px;color:#374151;">Your username: <b style="font-family:monospace;font-size:16px;color:#111827;">${esc(p.username)}</b></td></tr>
    </table>
    <p style="margin:0 0 22px;text-align:center;"><a href="${p.link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:8px;font-size:15px;">Set up my account</a></p>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.5;">The link works once and expires ${esc(p.expires)}. After that, sign in at <a href="${APP_URL}/app/login" style="color:#2563eb;">${APP_URL.replace(/^https?:\/\//, '')}</a> with your username and password.</p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">If you weren’t expecting this, you can ignore it. Nobody can use the link without this email.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${p.firstName},\n\n${p.invitedBy ? `${p.invitedBy} added you` : 'You’ve been added'} to the Property Stars DMS.\n\nYour username: ${p.username}\n\nChoose your password here (works once, expires ${p.expires}):\n${p.link}\n\nAfter that, sign in at ${APP_URL}/app/login with your username and password.\n`;
  return { subject, html, text };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'Email isn’t set up (RESEND_API_KEY is missing).' }, 500);
    const { userId } = await req.json().catch(() => ({}));
    if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Which user?' }, 400);

    // as the admin: checks the Super Admin › Users permission and makes the link
    const asAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });
    const { data, error } = await asAdmin.rpc('app_admin_issue_setup', { p_user: userId });
    if (error) return json({ error: error.message }, /not allowed|only the super admin/i.test(error.message) ? 403 : 400);
    const row = (data as { code: string; email: string; full_name: string; username: string; expires_at: string; reply_to: string | null; invited_by: string | null }[])[0];
    if (!row) return json({ error: 'Couldn’t make the setup link' }, 500);

    const link = `${APP_URL}/app/setup#t=${row.code}`;
    const expires = new Date(row.expires_at).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Toronto' });
    const mail = setupEmail({ firstName: row.full_name.split(/\s+/)[0] || row.full_name, username: row.username, link, invitedBy: row.invited_by, expires });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: row.email, subject: mail.subject, html: mail.html, text: mail.text, ...(row.reply_to ? { reply_to: row.reply_to } : {}) }),
    });
    const result = await res.json().catch(() => ({}));

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const sendError = res.ok ? null : String(result?.message || `Resend error ${res.status}`);
    await svc.rpc('app_setup_record_send', { p_code: row.code, p_resend_id: result?.id ?? null, p_error: sendError });
    await svc.from('email_logs').insert({ recipient_email: row.email, email_type: 'account_setup', status: res.ok ? 'sent' : 'failed',
      resend_message_id: result?.id ?? null, bounce_reason: sendError });

    if (!res.ok) return json({ error: `The email didn’t send: ${sendError}` }, 502);
    return json({ ok: true, email: row.email, expires_at: row.expires_at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});

// supabase/functions/ms-mail/index.ts — MainstreetAI mail: send an email from the rep app (Resend).
//
// POST { thread_id?, business_id?, campaign_id?, to: string[], cc?: string[], subject, html, text, attachments?: [{name, type, size, path}] }
// as the signed-in rep or admin.
//   1. ms_mail_prepare (as them) checks who may write to whom, unsubscribes and attachments, and keeps the
//      message as "sending"
//   2. Resend sends it from mainstreetai@propertystars.app. Replies go to the conversation's own address
//      (c-<token>@propertystars.app), so they land back in the right conversation
//   3. ms_mail_sent (service role) records what Resend said
// The first email in a conversation carries who it's from and how to unsubscribe (Canada's anti-spam law).
// The Resend key lives only in the RESEND_API_KEY secret.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const APP_URL = (Deno.env.get('APP_URL') || 'https://propertystars.app').replace(/\/+$/, '');
const FROM_ADDRESS = Deno.env.get('MAINSTREET_MAIL_FROM') || 'mainstreetai@propertystars.app';
const REPLY_DOMAIN = Deno.env.get('MAINSTREET_REPLY_DOMAIN') || 'propertystars.app';
const MAILING_ADDRESS = Deno.env.get('MAINSTREET_MAILING_ADDRESS') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

interface Prepared {
  message_id: string; thread_id: string; token: string; to: string[]; cc: string[]; subject: string; html: string | null; text: string | null;
  attachments: { name: string; type?: string; path: string }[]; sender_name: string; sender_first: string; sender_phone: string | null;
  campaign: string | null; in_reply_to: string | null; first_contact: boolean;
}

/** The email around what the rep wrote: their signature, and on a first contact who it's from and how to stop. */
export function wrap(p: Prepared, unsubscribe: string): { html: string; text: string } {
  const sig = [esc(p.sender_first), p.campaign ? `${esc(p.campaign)} · via MainstreetAI` : 'MainstreetAI', p.sender_phone ? esc(p.sender_phone) : ''].filter(Boolean).join('<br>');
  const legal = p.first_contact
    ? `<p style="margin:24px 0 0;color:#8a8f98;font-size:12px;line-height:1.5;">Sent by ${esc(p.sender_name.replace(/ via MainstreetAI$/, ''))} through MainstreetAI${MAILING_ADDRESS ? `, ${esc(MAILING_ADDRESS)}` : ''}. Don’t want these emails? <a href="${unsubscribe}" style="color:#8a8f98;">Unsubscribe</a>.</p>`
    : `<p style="margin:24px 0 0;color:#8a8f98;font-size:12px;"><a href="${unsubscribe}" style="color:#8a8f98;">Unsubscribe</a></p>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:620px;padding:8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1c1b1a;">
${p.html || `<p>${esc(p.text || '').replace(/\n/g, '<br>')}</p>`}
<p style="margin:20px 0 0;color:#3d4148;font-size:14px;line-height:1.45;">${sig}</p>
${legal}
</div></body></html>`;
  const text = `${p.text || ''}\n\n${p.sender_first}\n${p.campaign ? `${p.campaign} · via MainstreetAI` : 'MainstreetAI'}${p.sender_phone ? `\n${p.sender_phone}` : ''}\n\n${p.first_contact ? `Sent through MainstreetAI${MAILING_ADDRESS ? `, ${MAILING_ADDRESS}` : ''}. ` : ''}Unsubscribe: ${unsubscribe}\n`;
  return { html, text };
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return json({ error: 'Email isn’t set up (RESEND_API_KEY is missing).' }, 500);
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false },
    });
    const { data, error } = await asUser.rpc('ms_mail_prepare', {
      p_thread: b.thread_id || null, p_business: b.business_id || null, p_campaign: b.campaign_id || null,
      p_to: Array.isArray(b.to) ? b.to : [], p_cc: Array.isArray(b.cc) ? b.cc : [],
      p_subject: typeof b.subject === 'string' ? b.subject : '', p_html: typeof b.html === 'string' ? b.html : null,
      p_text: typeof b.text === 'string' ? b.text : null, p_attachments: Array.isArray(b.attachments) ? b.attachments : [],
    });
    if (error) return json({ error: error.message }, /not allowed/i.test(error.message) ? 403 : 400);
    const p = data as Prepared;
    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const unsubscribe = `${APP_URL}/app/unsubscribe#t=${p.token}`;
    const body = wrap(p, unsubscribe);
    const attachments: { filename: string; content: string }[] = [];
    for (const a of p.attachments || []) {
      const { data: file, error: fe } = await svc.storage.from('ms-mail').download(a.path);
      if (fe || !file) { await svc.rpc('ms_mail_sent', { p_message: p.message_id, p_resend_id: null, p_error: `Couldn’t attach ${a.name}` }); return json({ error: `Couldn’t attach ${a.name}` }, 400); }
      attachments.push({ filename: a.name, content: b64(new Uint8Array(await file.arrayBuffer())) });
    }
    const headers: Record<string, string> = {
      'List-Unsubscribe': `<mailto:c-${p.token}@${REPLY_DOMAIN}?subject=unsubscribe>, <${unsubscribe}>`,
    };
    if (p.in_reply_to) { headers['In-Reply-To'] = p.in_reply_to; headers['References'] = p.in_reply_to; }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${p.sender_name.replace(/[<>"]/g, '')} <${FROM_ADDRESS}>`,
        to: p.to, ...(p.cc?.length ? { cc: p.cc } : {}),
        reply_to: `c-${p.token}@${REPLY_DOMAIN}`,
        subject: p.subject, html: body.html, text: body.text, headers,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    const result = await res.json().catch(() => ({}));
    const sendError = res.ok ? null : String(result?.message || `Resend error ${res.status}`);
    await svc.rpc('ms_mail_sent', { p_message: p.message_id, p_resend_id: result?.id ?? null, p_error: sendError });
    await svc.from('email_logs').insert({ recipient_email: p.to.join(', '), email_type: 'mainstreet_mail', status: res.ok ? 'sent' : 'failed',
      resend_message_id: result?.id ?? null, bounce_reason: sendError });
    if (!res.ok) return json({ error: `The email didn’t send: ${sendError}`, thread_id: p.thread_id }, 502);
    return json({ ok: true, thread_id: p.thread_id, message_id: p.message_id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});

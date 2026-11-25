// supabase/functions/card-access/email.ts — the email a manager gets when Card Processing is turned on for them.
// No Deno or network here, so the app's tests run it too (src/v2/lib/cardAccess.test.ts).

export const APP_URL = 'https://propertystars.app';
const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const ACCESS_STEPS = [
  'Fill in the customer, the service address and what they bought. The price you type is the full price, tax included.',
  'Type the card into the secure card fields, press Charge and confirm the amount.',
  'The customer gets a receipt by email, and the sale is saved in History for everyone with access.',
];

export function accessEmail(p: { firstName: string; username: string | null; grantedBy: string | null; appUrl?: string }): { subject: string; html: string; text: string } {
  const app = (p.appUrl || APP_URL).replace(/\/+$/, '');
  const link = `${app}/app/cards`;
  const subject = 'You can now process cards in the Property Stars app';
  const by = p.grantedBy ? `${p.grantedBy} turned on Card Processing for your account.` : 'Card Processing is now turned on for your account.';
  const intro = `${by} You can take a customer’s card over the phone and charge it through Bambora.`;
  const where = `Sign in at ${app.replace(/^https?:\/\//, '')}/app, open the menu at the top left and choose Card Processing.`;
  const first = 'The first time you sign in, the app walks you through it.';
  const P = 'margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#111827;padding:26px;text-align:center;"><img src="${LOGO_URL}" alt="Property Stars" style="max-width:180px;height:auto;" /></td></tr>
  <tr><td style="padding:28px;">
    <h2 style="margin:0 0 10px;color:#111827;font-size:20px;">Hi ${esc(p.firstName)},</h2>
    <p style="${P}">${esc(intro)}</p>
    <p style="${P}"><b style="color:#111827;">Where to find it.</b> ${esc(where)}</p>
    <p style="margin:0 0 6px;color:#111827;font-size:15px;font-weight:bold;">How it works</p>
    <ol style="margin:0 0 18px;padding-left:22px;color:#374151;font-size:15px;line-height:1.6;">${ACCESS_STEPS.map(s => `<li style="margin-bottom:6px;">${esc(s)}</li>`).join('')}</ol>
    <p style="margin:0 0 22px;text-align:center;"><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:8px;font-size:15px;">Open Card Processing</a></p>
    <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.5;">${esc(first)}${p.username ? ` Your username is <b style="font-family:monospace;color:#111827;">${esc(p.username)}</b>.` : ''}</p>
    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">Questions? Reply to this email.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = [`Hi ${p.firstName},`, '', intro, '', `Where to find it: ${where}`, '', 'How it works:', ...ACCESS_STEPS.map((s, i) => `${i + 1}. ${s}`), '',
    `Open Card Processing: ${link}`, '', `${first}${p.username ? ` Your username is ${p.username}.` : ''}`, '', 'Questions? Reply to this email.'].join('\n');
  return { subject, html, text };
}

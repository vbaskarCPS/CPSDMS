// supabase/functions/bright-processor/index.ts — customer receipts, DMB confirmations and onboarding emails (Resend).
//
// Receipts (RUN_69): when the centre has a client mailbox (Super Admin › Centres › Email), the receipt is sent
// from it ("Property Stars · BC Fall RJ <bcclients@propertystars.app>"), replies come back to it, and the receipt
// is kept as a sent conversation there — so a customer's reply lands in the shared inbox under it. A centre
// without one sends as before: receipts@propertystars.app with reply-to command_centers.reply_to_email.
// The Resend key lives only in the RESEND_API_KEY secret.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

const getEtransferInstructionsHtml = (address: string, workerName: string): string => `
<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 20px 0;">
  <tr>
    <td style="font-size: 14px; color: #1e40af; padding: 15px;">
      <strong style="font-size: 16px;">📧 E-Transfer Instructions</strong>
      <p style="margin: 10px 0 0 0;">If you haven't sent your e-transfer yet:</p>
      <table style="margin-top: 10px;">
        <tr>
          <td style="padding: 4px 0; color: #1e40af;"><strong>Send To:</strong></td>
          <td style="padding: 4px 0 4px 10px; color: #1e3a8a;">accounting@property-stars.com</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #1e40af;"><strong>Memo:</strong></td>
          <td style="padding: 4px 0 4px 10px; color: #1e3a8a;">${address}, ${workerName}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; color: #1e40af;"><strong>Password:</strong></td>
          <td style="padding: 4px 0 4px 10px; color: #1e3a8a;">Not required (if prompted: <code style="background: #dbeafe; padding: 2px 4px; border-radius: 3px;">spring</code>)</td>
        </tr>
      </table>
      <p style="margin: 15px 0 0 0; font-size: 13px;">Please show confirmation of your e-transfer to your technician.</p>
    </td>
  </tr>
</table>
`;

const getDefaultHtml = (data: Record<string, string>, showEtransferSection = false) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <img src="${LOGO_URL}" alt="${data.companyName || 'Property Stars'}" style="max-width: 200px; height: auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px;">Hi ${data.firstName || 'Valued Customer'},</h2>
              <p style="margin: 0 0 20px 0; color: #4b5563; font-size: 16px; line-height: 1.6;">
                Thank you for choosing Property Stars! Your service has been completed.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                <tr>
                  <td style="font-size: 14px; color: #374151; padding: 15px;">
                    <strong>Service:</strong> ${data.serviceName || 'Lawn Service'}<br/>
                    <strong>Address:</strong> ${data.address || ''}<br/>
                    <strong>Date:</strong> ${data.date || new Date().toLocaleDateString()}<br/>
                    <strong>Technician:</strong> ${data.workerName || ''}
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border-radius: 8px; padding: 20px;">
                <tr>
                  <td style="font-size: 14px; color: #166534; padding: 15px;">
                    <strong>Amount:</strong> ${data.displayPrice || '$0.00'}<br/>
                    <strong>Payment:</strong> ${data.paymentMethod || 'Paid'}
                  </td>
                </tr>
              </table>
              ${showEtransferSection ? getEtransferInstructionsHtml(data.address || '', data.workerName || '') : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 30px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;">Questions? Simply reply to this email and we'll be happy to help.</p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">© 2026 ${data.companyName || 'Property Stars'}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const replaceVariables = (html: string, data: Record<string, string>): string => {
  let result = html;
  for (const [key, value] of Object.entries(data)) result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  return result;
};

const hasEtransferPayment = (paymentMethod: string): boolean =>
  paymentMethod?.toLowerCase().includes('e-transfer') || paymentMethod?.toLowerCase().includes('etransfer');

// deno-lint-ignore no-explicit-any
const determineTemplateType = (data: any): string => {
  const { type, paymentMethod, isPrepaid, refId } = data;
  if (paymentMethod === 'Billed' || paymentMethod === 'IOS') return 'billed';
  if (isPrepaid || paymentMethod === 'Prepaid') return 'prepaid';
  if (type === 'Upgrade') {
    if (refId === 'star_plan_pro') return 'upgrade_star_plan_pro';
    if (refId === 'lawn_rejuv') return 'upgrade_lawn_rejuv';
    if (refId === 'golf_course') return 'upgrade_golf_course';
    return 'production';
  }
  if (type === 'Add-On') {
    if (refId === 'dethatch') return 'addon_dethatch';
    if (refId === 'rejuv_after_care') return 'addon_rejuv_after_care';
    if (refId === 'grub') return 'addon_grub';
    return 'production';
  }
  if (type === 'Sale') return 'sale';
  return 'production';
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Plain text of an email, for the copy kept in the mailbox. */
const toText = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|tr|h\d|div)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();

/** The Message-ID Resend gave an email; a customer's reply quotes it, which is how the reply finds its conversation. */
async function resendMessageId(resendId: string): Promise<string | null> {
  const key = Deno.env.get('RESEND_RECEIVING_API_KEY') || Deno.env.get('RESEND_API_KEY');
  for (const wait of [0, 1500, 4000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try {
      const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(resendId)}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return null;
      const e = await r.json() as { message_id?: string };
      if (e.message_id) { const id = e.message_id.trim(); return id.startsWith('<') ? id : `<${id}>`; }
    } catch { return null; }
  }
  return null;
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const data = await req.json();
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) return reply({ error: 'RESEND_API_KEY not configured' }, 500);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ── DMB confirmation — sent from clientcare@propertystars.app (unchanged)
    if (data.emailType === 'dmb_confirmation') {
      // deno-lint-ignore no-explicit-any
      const emailPayload: any = {
        from: 'clientcare@propertystars.app', to: data.customerEmail,
        subject: data.subject || 'Your Service Confirmation – Property Stars', html: data.html,
      };
      if (data.replyTo) emailPayload.reply_to = data.replyTo;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(emailPayload),
      });
      const result = await response.json();
      if (!response.ok) {
        await supabase.from('email_logs').insert({ recipient_email: data.customerEmail, email_type: 'dmb_confirmation', status: 'failed', bounce_reason: result.message || 'Unknown error' });
        return reply({ error: 'Resend API failed', details: result }, 500);
      }
      await supabase.from('email_logs').insert({ recipient_email: data.customerEmail, email_type: 'dmb_confirmation', status: 'sent', resend_message_id: result.id });
      return reply({ success: true, messageId: result.id, templateType: 'dmb_confirmation' });
    }

    // ── Onboarding (unchanged)
    if (data.emailType === 'onboarding') {
      // deno-lint-ignore no-explicit-any
      const emailPayload: any = {
        from: data.fromAddress || 'onboarding@propertystars.app', to: data.customerEmail,
        subject: data.subject || 'Welcome to the Team!', html: data.html,
      };
      if (data.replyTo) emailPayload.reply_to = data.replyTo;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(emailPayload),
      });
      const result = await response.json();
      if (!response.ok) {
        await supabase.from('email_logs').insert({ recipient_email: data.customerEmail, email_type: 'onboarding', status: 'failed', bounce_reason: result.message || 'Unknown error' });
        return reply({ error: 'Resend API failed', details: result }, 500);
      }
      await supabase.from('email_logs').insert({ recipient_email: data.customerEmail, email_type: 'onboarding', status: 'sent', resend_message_id: result.id });
      return reply({ success: true, messageId: result.id, templateType: 'onboarding' });
    }

    // ── Receipts
    const templateType = determineTemplateType(data);
    let replyTo: string | undefined;
    let companyName = 'Property Stars';
    let box: { id: string; address: string; label: string | null } | null = null;

    if (data.commandCenterId) {
      const { data: ccData } = await supabase.from('command_centers').select('display_name, reply_to_email').eq('id', data.commandCenterId).maybeSingle();
      if (ccData) {
        companyName = ccData.display_name || 'Property Stars';
        replyTo = ccData.reply_to_email || undefined;
      }
      const { data: b } = await supabase.rpc('mail_center_box', { p_center: data.commandCenterId, p_role: 'client' });
      if (b?.id) box = b;
    }

    const nameParts = (data.customerName || '').split(' ');
    const variableData: Record<string, string> = {
      firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '',
      fullName: data.customerName || '',
      address: data.customerAddress || data.address || '',
      price: String(data.price || '0.00'),
      displayPrice: data.amount || data.displayPrice || ('$' + String(data.price || '0.00')),
      paymentMethod: data.paymentMethod || 'Paid',
      date: data.date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      serviceName: data.serviceName || 'Lawn Service',
      workerName: data.workerName || '',
      companyName,
    };
    const isEtransferPayment = hasEtransferPayment(data.paymentMethod || '');

    let emailHtml: string;
    let emailSubject = 'Your Service Receipt - Property Stars';
    const { data: template } = data.commandCenterId
      ? await supabase.from('email_templates').select('*').eq('command_center_id', data.commandCenterId)
          .eq('template_type', templateType).eq('is_active', true).maybeSingle()
      : { data: null };
    if (template) {
      emailSubject = template.subject;
      const contentStructure = template.content_structure as { showEtransferInstructions?: boolean } | null;
      const showEtransferInstructions = contentStructure?.showEtransferInstructions ?? true;
      const processedHtml = String(template.html_content).replace(/{{ETRANSFER_INSTRUCTIONS_SECTION}}/g,
        showEtransferInstructions && isEtransferPayment ? getEtransferInstructionsHtml(variableData.address, variableData.workerName) : '');
      emailHtml = replaceVariables(processedHtml, variableData);
    } else {
      emailHtml = getDefaultHtml(variableData, isEtransferPayment);
    }

    const finalSubject = replaceVariables(emailSubject, variableData);
    // deno-lint-ignore no-explicit-any
    const emailPayload: any = box
      ? { from: `${(box.label || companyName).replace(/[<>"]/g, '')} <${box.address}>`, reply_to: box.address }
      : { from: 'receipts@propertystars.app', ...(replyTo ? { reply_to: replyTo } : {}) };
    Object.assign(emailPayload, { to: data.customerEmail, subject: finalSubject, html: emailHtml });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(emailPayload),
    });
    const result = await response.json();
    if (!response.ok) {
      await supabase.from('email_logs').insert({ transaction_id: data.transactionId, recipient_email: data.customerEmail, email_type: templateType,
        status: 'failed', bounce_reason: result.message || 'Unknown error' });
      return reply({ error: 'Resend API failed', details: result }, 500);
    }
    await supabase.from('email_logs').insert({ transaction_id: data.transactionId, recipient_email: data.customerEmail, email_type: templateType,
      status: 'sent', resend_message_id: result.id });

    // keep it in the centre's client mailbox; never fails the receipt
    if (box && data.customerEmail) {
      try {
        const ext = result?.id ? await resendMessageId(result.id) : null;
        await supabase.rpc('mail_log_outbound', { p_box: box.id, p_to: String(data.customerEmail), p_subject: finalSubject,
          p_html: emailHtml, p_text: toText(emailHtml), p_resend_id: result?.id ?? null, p_ext_id: ext });
      } catch (e) { console.error('bright-processor: keep in mailbox', e instanceof Error ? e.message : e); }
    }
    return reply({ success: true, messageId: result.id, templateType, from: box?.address || 'receipts@propertystars.app' });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'Something went wrong' }, 500);
  }
});

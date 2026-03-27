// src/lib/dmbEmailService.ts
//
// Handles DMB (Digital Master Bookings) confirmation emails:
//   - Template persistence in email_templates table (type: dmb_confirmation)
//   - Price breakdown calculation (tax-inclusive → base + HST display)
//   - HTML email generation
//   - Sending via bright-processor edge function

import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface DmbEmailTemplate {
  subject: string;
  bodyIntro: string; // Supports {{firstName}}, {{address}}, etc.
  replyTo: string;
}

export interface DmbBookingPayload {
  email: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city: string;
  price: string;
  serviceType: string;
  routeCode: string;
  rowIndex: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

export const DEFAULT_DMB_TEMPLATE: DmbEmailTemplate = {
  subject: 'Your Service Confirmation – Property Stars',
  bodyIntro:
    'Hi {{firstName}},\n\nThank you for choosing Property Stars! ' +
    "We're confirming your upcoming service at {{address}}. " +
    'Please see your price breakdown below.',
  replyTo: '',
};

// ─── PRICE BREAKDOWN ──────────────────────────────────────────────────────────

export function buildPriceBreakdown(taxInclusivePrice: string): {
  base: string;
  hst: string;
  total: string;
} {
  const total = parseFloat(String(taxInclusivePrice).replace(/[^0-9.]/g, '')) || 0;
  const base  = total / 1.13;
  const hst   = total - base;
  return {
    base:  base.toFixed(2),
    hst:   hst.toFixed(2),
    total: total.toFixed(2),
  };
}

// ─── VARIABLE REPLACEMENT ─────────────────────────────────────────────────────

function replaceVars(text: string, vars: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return result;
}

// ─── HTML BUILDER ─────────────────────────────────────────────────────────────

export function buildDmbEmailHtml(
  template: DmbEmailTemplate,
  booking: Omit<DmbBookingPayload, 'email' | 'rowIndex'>
): string {
  const address = [booking.houseNum, booking.streetName, booking.city]
    .filter(Boolean).join(' ');

  const price = buildPriceBreakdown(booking.price);

  const vars: Record<string, string> = {
    firstName:   booking.firstName,
    lastName:    booking.lastName,
    fullName:    `${booking.firstName} ${booking.lastName}`.trim(),
    address,
    basePrice:   `$${price.base}`,
    hst:         `$${price.hst}`,
    totalPrice:  `$${price.total}`,
    serviceType: booking.serviceType || 'Lawn Service',
    routeCode:   booking.routeCode,
  };

  const introHtml = replaceVars(template.bodyIntro, vars)
    .split('\n')
    .map(line =>
      line.trim()
        ? `<p style="margin:0 0 12px 0;color:#4b5563;font-size:16px;line-height:1.6;">${line}</p>`
        : ''
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:linear-gradient(135deg,#1f2937 0%,#374151 100%);
                      padding:30px;border-radius:12px 12px 0 0;text-align:center;">
            <img src="${LOGO_URL}" alt="Property Stars" style="max-width:200px;height:auto;" />
          </td>
        </tr>
        <tr>
          <td style="padding:30px 30px 10px 30px;">
            ${introHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:0 30px 20px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#f9fafb;border-radius:8px;margin-top:4px;">
              <tr>
                <td style="font-size:14px;color:#374151;padding:16px;">
                  <strong>Service:</strong> ${vars.serviceType}<br/>
                  <strong>Address:</strong> ${address}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 30px 30px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background-color:#f0fdf4;border-radius:8px;">
              <tr>
                <td style="font-size:14px;color:#166534;padding:16px;">
                  <strong style="display:block;margin-bottom:8px;">Price Breakdown</strong>
                  <table>
                    <tr>
                      <td style="padding:2px 24px 2px 0;color:#4b5563;">Base price</td>
                      <td style="color:#4b5563;">$${price.base}</td>
                    </tr>
                    <tr>
                      <td style="padding:2px 24px 2px 0;color:#4b5563;">HST (13%)</td>
                      <td style="color:#4b5563;">$${price.hst}</td>
                    </tr>
                    <tr>
                      <td style="padding:8px 24px 2px 0;border-top:1px solid #bbf7d0;">
                        <strong style="color:#166534;">Total</strong>
                      </td>
                      <td style="padding:8px 0 2px 0;border-top:1px solid #bbf7d0;">
                        <strong style="color:#166534;font-size:16px;">$${price.total}</strong>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 30px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0 0 8px 0;color:#6b7280;font-size:14px;">
              Questions? Simply reply to this email and we'll be happy to help.
            </p>
            <p style="margin:0;color:#9ca3af;font-size:12px;">
              © 2026 Property Stars. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── TEMPLATE PERSISTENCE ─────────────────────────────────────────────────────

export async function loadDmbTemplate(): Promise<DmbEmailTemplate> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return { ...DEFAULT_DMB_TEMPLATE };

  try {
    const { data } = await supabase
      .from('email_templates')
      .select('subject, content_structure')
      .eq('command_center_id', ccId)
      .eq('template_type', 'dmb_confirmation')
      .maybeSingle();

    if (!data) return { ...DEFAULT_DMB_TEMPLATE };

    const cs = data.content_structure as any;
    return {
      subject:   data.subject  || DEFAULT_DMB_TEMPLATE.subject,
      bodyIntro: cs?.bodyIntro || DEFAULT_DMB_TEMPLATE.bodyIntro,
      replyTo:   cs?.replyTo   || DEFAULT_DMB_TEMPLATE.replyTo,
    };
  } catch {
    return { ...DEFAULT_DMB_TEMPLATE };
  }
}

export async function saveDmbTemplate(template: DmbEmailTemplate): Promise<void> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return;

  const payload = {
    command_center_id: ccId,
    template_type:     'dmb_confirmation',
    template_name:     'DMB Confirmation Email',
    subject:           template.subject,
    html_content:      '',
    content_structure: { bodyIntro: template.bodyIntro, replyTo: template.replyTo },
    is_active:         true,
    updated_at:        new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('email_templates')
    .select('id')
    .eq('command_center_id', ccId)
    .eq('template_type', 'dmb_confirmation')
    .maybeSingle();

  if (existing) {
    await supabase.from('email_templates').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('email_templates').insert(payload);
  }
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

export async function sendDmbConfirmationEmail(
  booking: DmbBookingPayload,
  template: DmbEmailTemplate
): Promise<{ success: boolean; error?: string }> {
  try {
    const html = buildDmbEmailHtml(template, booking);
    const address = [booking.houseNum, booking.streetName, booking.city]
      .filter(Boolean).join(' ');

    const subject = template.subject
      .replace(/{{firstName}}/g, booking.firstName)
      .replace(/{{lastName}}/g, booking.lastName)
      .replace(/{{address}}/g, address);

    const payload: Record<string, any> = {
      emailType:     'dmb_confirmation',
      customerEmail: booking.email,
      subject,
      html,
      fromAddress:   'clientcare@propertystars.app',
    };

    if (template.replyTo?.trim()) {
      payload.replyTo = template.replyTo.trim();
    }

    const { data, error } = await supabase.functions.invoke('bright-processor', {
      body: payload,
    });

    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Unknown send error');

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send' };
  }
}
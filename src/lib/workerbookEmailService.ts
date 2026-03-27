// src/lib/workerbookEmailService.ts
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { ShuttlePoint } from './onboardingService';

const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface WorkerbookEmailTemplate {
  subject: string;
  bodyIntro: string;
  replyTo: string;
  signatureName: string;
  signatureTitle: string;
  signaturePhone: string;
  signatureEmail: string;
}

export interface WorkerbookEmailData {
  contractorId: string;
  firstName: string;
  lastName: string;
  email: string;
  date: string;        // e.g. "Mar27"
  shuttle?: string;
  days: number;
  isRookie: boolean;
  commandCenterId: string;
  commandCenterName: string;
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────

export const DEFAULT_REGULAR_TEMPLATE: WorkerbookEmailTemplate = {
  subject: 'Your Shift Confirmation – {{date}}',
  bodyIntro:
    'Hi {{firstName}},\n\nThis is a reminder about your upcoming shift on {{date}}. ' +
    'Please review your details below and confirm your attendance.',
  replyTo: '',
  signatureName: '',
  signatureTitle: '',
  signaturePhone: '',
  signatureEmail: '',
};

export const DEFAULT_ROOKIE_TEMPLATE: WorkerbookEmailTemplate = {
  subject: "Welcome to Your First Day – {{date}}",
  bodyIntro:
    "Hi {{firstName}},\n\nWelcome to the team! We're excited for your first day on {{date}}. " +
    'Please review your shift details and complete your online training before you arrive.',
  replyTo: '',
  signatureName: '',
  signatureTitle: '',
  signaturePhone: '',
  signatureEmail: '',
};

// ─── TEMPLATE PERSISTENCE ─────────────────────────────────────────────────────

export async function loadWorkerbookTemplates(): Promise<{
  regular: WorkerbookEmailTemplate;
  rookie: WorkerbookEmailTemplate;
}> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return { regular: { ...DEFAULT_REGULAR_TEMPLATE }, rookie: { ...DEFAULT_ROOKIE_TEMPLATE } };

  try {
    const { data } = await supabase
      .from('email_templates')
      .select('template_type, subject, content_structure')
      .eq('command_center_id', ccId)
      .in('template_type', ['workerbook_regular', 'workerbook_rookie']);

    const mapTemplate = (row: any, def: WorkerbookEmailTemplate): WorkerbookEmailTemplate => ({
      subject:        row?.subject                          || def.subject,
      bodyIntro:      (row?.content_structure as any)?.bodyIntro       || def.bodyIntro,
      replyTo:        (row?.content_structure as any)?.replyTo         || '',
      signatureName:  (row?.content_structure as any)?.signatureName   || '',
      signatureTitle: (row?.content_structure as any)?.signatureTitle  || '',
      signaturePhone: (row?.content_structure as any)?.signaturePhone  || '',
      signatureEmail: (row?.content_structure as any)?.signatureEmail  || '',
    });

    const reg = data?.find(t => t.template_type === 'workerbook_regular');
    const rok = data?.find(t => t.template_type === 'workerbook_rookie');

    return {
      regular: mapTemplate(reg, DEFAULT_REGULAR_TEMPLATE),
      rookie:  mapTemplate(rok, DEFAULT_ROOKIE_TEMPLATE),
    };
  } catch {
    return { regular: { ...DEFAULT_REGULAR_TEMPLATE }, rookie: { ...DEFAULT_ROOKIE_TEMPLATE } };
  }
}

export async function saveWorkerbookTemplate(
  type: 'workerbook_regular' | 'workerbook_rookie',
  template: WorkerbookEmailTemplate,
): Promise<void> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return;

  const payload = {
    command_center_id: ccId,
    template_type:     type,
    template_name:     type === 'workerbook_regular' ? 'Workerbook Regular Email' : 'Workerbook Rookie Email',
    subject:           template.subject,
    html_content:      '',
    content_structure: {
      bodyIntro:      template.bodyIntro,
      replyTo:        template.replyTo,
      signatureName:  template.signatureName,
      signatureTitle: template.signatureTitle,
      signaturePhone: template.signaturePhone,
      signatureEmail: template.signatureEmail,
    },
    is_active:  true,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from('email_templates')
    .select('id')
    .eq('command_center_id', ccId)
    .eq('template_type', type)
    .maybeSingle();

  if (existing) {
    await supabase.from('email_templates').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('email_templates').insert(payload);
  }
}

// ─── EMAIL TRACKING ───────────────────────────────────────────────────────────

export async function getEmailedTodaySet(): Promise<Set<string>> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('email_logs')
    .select('recipient_email')
    .in('email_type', ['workerbook_day_of_regular', 'workerbook_day_of_rookie'])
    .gte('sent_at', `${today}T00:00:00Z`);

  return new Set((data || []).map(r => r.recipient_email.toLowerCase()));
}

export async function cleanOldWorkerbookEmailLogs(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  await supabase
    .from('email_logs')
    .delete()
    .in('email_type', ['workerbook_day_of_regular', 'workerbook_day_of_rookie'])
    .lt('sent_at', cutoff.toISOString());
}

// ─── HTML BUILDER ─────────────────────────────────────────────────────────────

function replaceVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`{{${k}}}`, 'g'), v || ''),
    text,
  );
}

function buildShuttleSection(shuttle: string | undefined, point: ShuttlePoint | null): string {
  if (!shuttle) return '';
  const hasPoint = !!point;
  const bg     = hasPoint ? '#eff6ff' : '#fef3c7';
  const border  = hasPoint ? '#bfdbfe' : '#fde68a';
  const color   = hasPoint ? '#1e40af' : '#92400e';
  const body    = hasPoint
    ? `<strong>${point!.description}</strong><br/>
       <span style="color:#4b5563;">Pickup Time: ${point!.pickupTime}</span>
       ${point!.googleMapsUrl ? `<br/><a href="${point!.googleMapsUrl}" style="color:#2563eb;font-weight:bold;">📍 View on Google Maps</a>` : ''}`
    : `Shuttle #${shuttle} — details not yet configured`;

  return `
    <tr><td style="padding:10px 30px;">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background-color:${bg};border:1px solid ${border};border-radius:8px;">
        <tr><td style="padding:16px;font-size:14px;color:${color};">
          <strong style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">🚐 Your Shuttle Point</strong>
          <div style="margin-top:8px;line-height:1.6;">${body}</div>
        </td></tr>
      </table>
    </td></tr>`;
}

function buildTrainingSection(contractorId: string, firstName: string): string {
  return `
    <tr><td style="padding:10px 30px;">
      <h2 style="margin:0 0 12px 0;color:#1f2937;font-size:18px;">💻 Complete Your Online Training</h2>
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">
        <tr><td style="padding:16px;font-size:14px;color:#1e40af;line-height:1.8;">
          Please complete your training modules before your first day:<br/><br/>
          <strong>Website:</strong>
          <a href="https://propertystars.app" style="color:#2563eb;font-weight:bold;">propertystars.app</a><br/>
          <strong>Username:</strong>
          <span style="font-size:16px;font-weight:bold;color:#1e3a8a;">${contractorId}</span><br/>
          <strong>Password:</strong>
          <span style="font-size:16px;font-weight:bold;color:#1e3a8a;">${firstName}</span>
          <span style="font-size:12px;color:#6b7280;">(case sensitive)</span>
        </td></tr>
      </table>
    </td></tr>`;
}

function buildSignature(t: WorkerbookEmailTemplate): string {
  if (!t.signatureName) return '';
  return `
    <tr><td style="padding:20px 30px 10px 30px;border-top:1px solid #e5e7eb;">
      <strong style="font-size:16px;color:#374151;">${t.signatureName}</strong><br/>
      ${t.signatureTitle ? `<span style="color:#6b7280;">${t.signatureTitle}</span><br/>` : ''}
      ${t.signaturePhone ? `<span style="color:#6b7280;">📞 ${t.signaturePhone}</span><br/>` : ''}
      ${t.signatureEmail ? `<span style="color:#6b7280;">✉️ ${t.signatureEmail}</span>` : ''}
    </td></tr>`;
}

export function buildWorkerbookEmailHtml(
  template: WorkerbookEmailTemplate,
  data: WorkerbookEmailData,
  shuttlePoint: ShuttlePoint | null,
): string {
  const vars: Record<string, string> = {
    firstName:    data.firstName,
    lastName:     data.lastName,
    fullName:     `${data.firstName} ${data.lastName}`.trim(),
    date:         data.date,
    contractorId: data.contractorId,
    days:         String(data.days),
  };

  const introHtml = replaceVars(template.bodyIntro, vars)
    .split('\n')
    .map(l => l.trim()
      ? `<p style="margin:0 0 12px 0;color:#4b5563;font-size:16px;line-height:1.6;">${l}</p>`
      : '')
    .join('');

  const replyTarget = template.replyTo?.trim() || 'staff@propertystars.app';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:linear-gradient(135deg,#1f2937 0%,#374151 100%);
                      padding:30px;border-radius:12px 12px 0 0;text-align:center;">
            <img src="${LOGO_URL}" alt="${data.commandCenterName}" style="max-width:200px;height:auto;" />
          </td>
        </tr>
        <tr><td style="padding:30px 30px 10px 30px;">${introHtml}</td></tr>
        <tr><td style="padding:10px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
            <tr><td style="padding:16px;font-size:14px;color:#374151;line-height:1.8;">
              <strong>Date:</strong> ${data.date}<br/>
              <strong>Contractor ID:</strong> ${data.contractorId}<br/>
              <strong>Days Worked:</strong> ${data.days}
            </td></tr>
          </table>
        </td></tr>
        ${buildShuttleSection(data.shuttle, shuttlePoint)}
        ${data.isRookie ? buildTrainingSection(data.contractorId, data.firstName) : ''}
        <tr><td style="padding:20px 30px;text-align:center;">
          <a href="mailto:${replyTarget}?subject=Confirming%20Shift%20${encodeURIComponent(data.date)}%20-%20${data.contractorId}"
             style="display:inline-block;background-color:#16a34a;color:#ffffff;padding:14px 32px;
                    border-radius:8px;font-size:16px;font-weight:bold;text-decoration:none;">
            ✅ Confirm My Shift
          </a>
        </td></tr>
        ${buildSignature(template)}
        <tr><td style="padding:20px 30px 30px 30px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0 0 8px 0;color:#6b7280;font-size:14px;">Questions? Simply reply to this email.</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 ${data.commandCenterName}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

export async function sendWorkerbookEmail(
  data: WorkerbookEmailData,
  template: WorkerbookEmailTemplate,
  shuttlePoint: ShuttlePoint | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const html      = buildWorkerbookEmailHtml(template, data, shuttlePoint);
    const vars: Record<string, string> = {
      firstName: data.firstName, date: data.date, contractorId: data.contractorId,
    };
    const subject   = replaceVars(template.subject, vars);
    const emailType = data.isRookie ? 'workerbook_day_of_rookie' : 'workerbook_day_of_regular';

    const payload: Record<string, any> = {
      emailType:     'onboarding',
      customerEmail: data.email,
      subject,
      html,
      fromAddress:   'staff@propertystars.app',
      commandCenterId: data.commandCenterId,
    };
    if (template.replyTo?.trim()) payload.replyTo = template.replyTo.trim();

    const { error } = await supabase.functions.invoke('bright-processor', { body: payload });
    if (error) throw error;

    // Track this send separately so we can query by our specific types
    await supabase.from('email_logs').insert({
      recipient_email: data.email,
      email_type:      emailType,
      status:          'sent',
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to send' };
  }
}
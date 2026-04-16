// src/lib/workerbookEmailService.ts
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { ShuttlePoint } from './onboardingService';

const LOGO_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/storage/v1/object/public/logos/logo-white.png';
const CONFIRM_FUNCTION_URL = 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/workerbook-confirm';
const NO_SHUTTLE_FALLBACK  = 'No Shuttle Assigned: Please be at 405 Jones Road by 8:15AM';

// Sentinel strings — plain text that survives paragraph conversion,
// then swapped for real HTML blocks AFTER the <p> pass.
const SENTINEL_SHUTTLE = '%%SHUTTLE_BLOCK%%';
const SENTINEL_CONFIRM = '%%CONFIRM_BLOCK%%';

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
  date: string;        // MmmDD storage format e.g. "Mar27"
  shuttle?: string;
  days: number;
  isRookie: boolean;
  commandCenterId: string;
  commandCenterName: string;
}

export interface WorkerbookConfirmation {
  id: string;
  commandCenterId: string;
  dateTab: string;
  contractorId: string;
  confirmedAt: string;
  syncedToSheets: boolean;
}

// Text template type — simpler than email (no subject, no signature, etc.)
export interface WorkerbookTextTemplate {
  bodyText: string;
}

// ─── DATE FORMATTING ──────────────────────────────────────────────────────────

/**
 * Convert a MmmDD tab name (e.g. "Mar27") to a friendly display string
 * like "Saturday, March 27th" for use inside outgoing emails.
 */
export function formatDateForEmail(mmmdd: string): string {
  const monthMap: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4,  Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  const match = mmmdd.match(/^([A-Z][a-z]{2})(\d{1,2})$/);
  if (!match) return mmmdd; // fallback: return as-is

  const monthIdx = monthMap[match[1]];
  const day      = parseInt(match[2], 10);
  const year     = new Date().getFullYear();

  if (monthIdx === undefined || isNaN(day)) return mmmdd;

  const date = new Date(year, monthIdx, day);

  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month   = date.toLocaleDateString('en-US', { month: 'long' });

  // Ordinal suffix
  const suffix =
    day >= 11 && day <= 13 ? 'th'
    : day % 10 === 1 ? 'st'
    : day % 10 === 2 ? 'nd'
    : day % 10 === 3 ? 'rd'
    : 'th';

  return `${weekday}, ${month} ${day}${suffix}`;
}

// ─── DEFAULTS ─────────────────────────────────────────────────────────────────

export const DEFAULT_REGULAR_TEMPLATE: WorkerbookEmailTemplate = {
  subject: 'Your Shift Confirmation – {{dateFriendly}}',
  bodyIntro:
    'Hi {{firstName}},\n\nThis is a reminder about your upcoming shift on {{dateFriendly}}. ' +
    'Please review your details below and confirm your attendance.\n\n{{shuttlePoint}}\n\n{{confirmButton}}',
  replyTo: '',
  signatureName: '',
  signatureTitle: '',
  signaturePhone: '',
  signatureEmail: '',
};

export const DEFAULT_ROOKIE_TEMPLATE: WorkerbookEmailTemplate = {
  subject: "Welcome to Your First Day – {{dateFriendly}}",
  bodyIntro:
    "Hi {{firstName}},\n\nWelcome to the team! We're excited for your first day on {{dateFriendly}}. " +
    'Please review your shift details and complete your online training before you arrive.\n\n{{shuttlePoint}}\n\n{{confirmButton}}',
  replyTo: '',
  signatureName: '',
  signatureTitle: '',
  signaturePhone: '',
  signatureEmail: '',
};

export const DEFAULT_TEXT_CELL_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    'Hi {{firstName}}, reminder about your shift {{dateFriendly}}. ' +
    'Shuttle #{{shuttle}} - {{shuttleDescription}} at {{pickupTime}}. ' +
    'Reply YES to confirm. - Property Stars',
};

export const DEFAULT_TEXT_ALT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    'Hi, trying to reach {{firstName}} {{lastName}} about their shift {{dateFriendly}}. ' +
    'Please have them reply to confirm or call us back. - Property Stars',
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
      subject:        row?.subject                                     || def.subject,
      bodyIntro:      (row?.content_structure as any)?.bodyIntro      || def.bodyIntro,
      replyTo:        (row?.content_structure as any)?.replyTo        || '',
      signatureName:  (row?.content_structure as any)?.signatureName  || '',
      signatureTitle: (row?.content_structure as any)?.signatureTitle || '',
      signaturePhone: (row?.content_structure as any)?.signaturePhone || '',
      signatureEmail: (row?.content_structure as any)?.signatureEmail || '',
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

// ─── TEXT TEMPLATE PERSISTENCE ────────────────────────────────────────────────

export async function loadWorkerbookTextTemplates(): Promise<{
  cell: WorkerbookTextTemplate;
  alt:  WorkerbookTextTemplate;
}> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return {
    cell: { ...DEFAULT_TEXT_CELL_TEMPLATE },
    alt:  { ...DEFAULT_TEXT_ALT_TEMPLATE },
  };

  try {
    const { data } = await supabase
      .from('email_templates')
      .select('template_type, content_structure')
      .eq('command_center_id', ccId)
      .in('template_type', ['workerbook_text_cell', 'workerbook_text_alt']);

    const mapTemplate = (row: any, def: WorkerbookTextTemplate): WorkerbookTextTemplate => ({
      bodyText: (row?.content_structure as any)?.bodyText || def.bodyText,
    });

    const cellRow = data?.find(t => t.template_type === 'workerbook_text_cell');
    const altRow  = data?.find(t => t.template_type === 'workerbook_text_alt');

    return {
      cell: mapTemplate(cellRow, DEFAULT_TEXT_CELL_TEMPLATE),
      alt:  mapTemplate(altRow,  DEFAULT_TEXT_ALT_TEMPLATE),
    };
  } catch {
    return {
      cell: { ...DEFAULT_TEXT_CELL_TEMPLATE },
      alt:  { ...DEFAULT_TEXT_ALT_TEMPLATE },
    };
  }
}

export async function saveWorkerbookTextTemplate(
  type: 'workerbook_text_cell' | 'workerbook_text_alt',
  template: WorkerbookTextTemplate,
): Promise<void> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return;

  const payload = {
    command_center_id: ccId,
    template_type:     type,
    template_name:     type === 'workerbook_text_cell' ? 'Workerbook Text — Cell' : 'Workerbook Text — Alt',
    subject:           '',
    html_content:      '',
    content_structure: { bodyText: template.bodyText },
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
    .in('email_type', [
      'workerbook_day_of_regular',
      'workerbook_day_of_rookie',
      'workerbook_text_cell',
      'workerbook_text_alt',
    ])
    .lt('sent_at', cutoff.toISOString());
}

// ─── TEXT TRACKING ────────────────────────────────────────────────────────────

/**
 * Returns a Set of keys like "H1001:cell" or "H1001:alt" indicating
 * which contractor+phone combinations have been texted today.
 */
export async function getTextedTodayMap(): Promise<Set<string>> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('email_logs')
    .select('recipient_email, email_type')
    .in('email_type', ['workerbook_text_cell', 'workerbook_text_alt'])
    .gte('sent_at', `${today}T00:00:00Z`);

  const set = new Set<string>();
  for (const row of data || []) {
    // recipient_email holds the contractor ID for text logs
    const phoneType = row.email_type === 'workerbook_text_cell' ? 'cell' : 'alt';
    set.add(`${row.recipient_email}:${phoneType}`);
  }
  return set;
}

export async function logTextSent(
  contractorId: string,
  phoneType: 'cell' | 'alt',
): Promise<void> {
  const emailType = phoneType === 'cell' ? 'workerbook_text_cell' : 'workerbook_text_alt';
  await supabase.from('email_logs').insert({
    recipient_email: contractorId,
    email_type:      emailType,
    status:          'sent',
  });
}

// ─── CONFIRMATIONS ────────────────────────────────────────────────────────────

export function buildConfirmToken(data: WorkerbookEmailData): string {
  const payload = {
    commandCenterId: data.commandCenterId,
    dateTab:         data.date,
    contractorId:    data.contractorId,
    firstName:       data.firstName,
  };
  return btoa(JSON.stringify(payload));
}

export async function getConfirmationsForDateTab(
  commandCenterId: string,
  dateTab: string,
): Promise<WorkerbookConfirmation[]> {
  const { data, error } = await supabase
    .from('workerbook_confirmations')
    .select('*')
    .eq('command_center_id', commandCenterId)
    .eq('date_tab', dateTab);

  if (error) return [];

  return (data || []).map(row => ({
    id:              row.id,
    commandCenterId: row.command_center_id,
    dateTab:         row.date_tab,
    contractorId:    row.contractor_id,
    confirmedAt:     row.confirmed_at,
    syncedToSheets:  row.synced_to_sheets,
  }));
}

export async function markConfirmationSynced(id: string): Promise<void> {
  await supabase
    .from('workerbook_confirmations')
    .update({ synced_to_sheets: true })
    .eq('id', id);
}

// ─── HTML BLOCK BUILDERS ──────────────────────────────────────────────────────

function buildShuttleBlock(shuttle: string | undefined, point: ShuttlePoint | null): string {
  if (!shuttle) {
    return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
      <tr><td style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;
                     padding:14px 16px;font-size:14px;color:#92400e;">
        🚐 <strong>${NO_SHUTTLE_FALLBACK}</strong>
      </td></tr>
    </table>`;
  }

  if (point) {
    const mapsLink = point.googleMapsUrl
      ? ` &nbsp;<a href="${point.googleMapsUrl}" style="color:#2563eb;font-weight:bold;font-size:13px;">📍 View on Maps</a>`
      : '';
    return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
      <tr><td style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;
                     padding:14px 16px;font-size:14px;color:#1e40af;">
        🚐 <strong>${point.description}</strong> &nbsp;·&nbsp; ${point.pickupTime}${mapsLink}
      </td></tr>
    </table>`;
  }

  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">
    <tr><td style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;
                   padding:14px 16px;font-size:14px;color:#92400e;">
      🚐 Shuttle #${shuttle} — details TBC
    </td></tr>
  </table>`;
}

function buildConfirmBlock(confirmUrl: string, dateFriendly: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;text-align:center;">
    <tr><td style="padding:12px 0;">
      <a href="${confirmUrl}"
         style="display:inline-block;background-color:#16a34a;color:#ffffff;
                padding:14px 32px;border-radius:8px;font-size:16px;font-weight:bold;
                text-decoration:none;">
        ✅ Confirm My Shift
      </a>
      <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">
        Tap above to confirm your attendance for ${dateFriendly}.
      </p>
    </td></tr>
  </table>`;
}

// Auto-appended card versions (used when placeholders not in body)

function buildShuttleSection(shuttle: string | undefined, point: ShuttlePoint | null): string {
  if (!shuttle) return '';
  const hasPoint = !!point;
  const bg      = hasPoint ? '#eff6ff' : '#fef3c7';
  const border  = hasPoint ? '#bfdbfe' : '#fde68a';
  const color   = hasPoint ? '#1e40af' : '#92400e';
  const body    = hasPoint
    ? `<strong>${point!.description}</strong><br/>
       <span style="color:#4b5563;">Pickup Time: ${point!.pickupTime}</span>
       ${point!.googleMapsUrl ? `<br/><a href="${point!.googleMapsUrl}" style="color:#2563eb;font-weight:bold;">📍 View on Google Maps</a>` : ''}`
    : `Shuttle #${shuttle} — details TBC`;
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

function buildConfirmSection(confirmUrl: string, dateFriendly: string): string {
  return `
    <tr><td style="padding:20px 30px;text-align:center;">
      <a href="${confirmUrl}"
         style="display:inline-block;background-color:#16a34a;color:#ffffff;padding:14px 32px;
                border-radius:8px;font-size:16px;font-weight:bold;text-decoration:none;">
        ✅ Confirm My Shift
      </a>
      <p style="margin:10px 0 0 0;font-size:12px;color:#9ca3af;">
        Tap above to confirm your attendance for ${dateFriendly}.
      </p>
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

// ─── HTML BUILDER ─────────────────────────────────────────────────────────────

function replaceVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`{{${k}}}`, 'g'), v || ''),
    text,
  );
}

export function buildWorkerbookEmailHtml(
  template: WorkerbookEmailTemplate,
  data: WorkerbookEmailData,
  shuttlePoint: ShuttlePoint | null,
): string {
  const confirmToken    = buildConfirmToken(data);
  const confirmUrl      = `${CONFIRM_FUNCTION_URL}?token=${encodeURIComponent(confirmToken)}`;
  const dateFriendly    = formatDateForEmail(data.date);

  const hasShuttlePlaceholder = template.bodyIntro.includes('{{shuttlePoint}}');
  const hasConfirmPlaceholder = template.bodyIntro.includes('{{confirmButton}}');

  // Step 1: swap {{shuttlePoint}} / {{confirmButton}} for plain sentinels
  // so they don't get mangled by the paragraph pass
  let bodyText = template.bodyIntro;
  bodyText = bodyText.replace(/\{\{shuttlePoint\}\}/g, SENTINEL_SHUTTLE);
  bodyText = bodyText.replace(/\{\{confirmButton\}\}/g, SENTINEL_CONFIRM);

  // Step 2: replace all plain text variables
  const textVars: Record<string, string> = {
    firstName:    data.firstName,
    lastName:     data.lastName,
    fullName:     `${data.firstName} ${data.lastName}`.trim(),
    date:         data.date,
    dateFriendly,
    contractorId: data.contractorId,
    days:         String(data.days),
  };
  bodyText = replaceVars(bodyText, textVars);

  // Step 3: convert newline-delimited lines to <p> tags.
  // Sentinels are plain strings so they come through wrapped in <p> — we'll strip that next.
  const paragraphed = bodyText
    .split('\n')
    .map(line => line.trim()
      ? `<p style="margin:0 0 12px 0;color:#4b5563;font-size:16px;line-height:1.6;">${line}</p>`
      : '')
    .join('');

  // Step 4: replace sentinel <p> wrappers with real HTML blocks
  const shuttleHtml = buildShuttleBlock(data.shuttle, shuttlePoint);
  const confirmHtml = buildConfirmBlock(confirmUrl, dateFriendly);

  const introHtml = paragraphed
    .replace(/<p[^>]*>%%SHUTTLE_BLOCK%%<\/p>/g, shuttleHtml)
    .replace(/<p[^>]*>%%CONFIRM_BLOCK%%<\/p>/g, confirmHtml);

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

        <!-- Body -->
        <tr><td style="padding:30px 30px 10px 30px;">${introHtml}</td></tr>

        <!-- Shuttle section — only auto-appended if {{shuttlePoint}} NOT in body -->
        ${!hasShuttlePlaceholder ? buildShuttleSection(data.shuttle, shuttlePoint) : ''}

        <!-- Rookie training — always auto-appended for rookies -->
        ${data.isRookie ? buildTrainingSection(data.contractorId, data.firstName) : ''}

        <!-- Confirm button — only auto-appended if {{confirmButton}} NOT in body -->
        ${!hasConfirmPlaceholder ? buildConfirmSection(confirmUrl, dateFriendly) : ''}

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

// ─── TEXT MESSAGE BUILDER ─────────────────────────────────────────────────────

/**
 * Build the plain-text SMS body with all variables replaced.
 * Used both for preview in the template editor and for the actual sms: link.
 */
export function buildTextMessage(
  template: WorkerbookTextTemplate,
  data: {
    firstName: string;
    lastName: string;
    date: string;
    shuttle?: string;
    days: number;
    contractorId: string;
  },
  shuttlePoint: ShuttlePoint | null,
): string {
  const dateFriendly = formatDateForEmail(data.date);
  const vars: Record<string, string> = {
    firstName:          data.firstName,
    lastName:           data.lastName,
    fullName:           `${data.firstName} ${data.lastName}`.trim(),
    date:               data.date,
    dateFriendly,
    contractorId:       data.contractorId,
    days:               String(data.days),
    shuttle:            data.shuttle || '',
    shuttleDescription: shuttlePoint?.description || '',
    pickupTime:         shuttlePoint?.pickupTime  || '',
  };
  return replaceVars(template.bodyText, vars);
}

/**
 * Build the sms: URL that opens the device messaging app.
 * Samsung/Android use ?body= while iOS uses &body=, but on Android both work.
 */
export function buildSmsLink(phoneNumber: string, body: string): string {
  // Strip anything that isn't a digit or plus sign from the phone
  const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
  return `sms:${cleanPhone}?body=${encodeURIComponent(body)}`;
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

export async function sendWorkerbookEmail(
  data: WorkerbookEmailData,
  template: WorkerbookEmailTemplate,
  shuttlePoint: ShuttlePoint | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const html          = buildWorkerbookEmailHtml(template, data, shuttlePoint);
    const dateFriendly  = formatDateForEmail(data.date);
    const textVars: Record<string, string> = {
      firstName:    data.firstName,
      date:         data.date,
      dateFriendly,
      contractorId: data.contractorId,
    };
    const subject   = replaceVars(template.subject, textVars);
    const emailType = data.isRookie ? 'workerbook_day_of_rookie' : 'workerbook_day_of_regular';

    const payload: Record<string, any> = {
      emailType:       'onboarding',
      customerEmail:   data.email,
      subject,
      html,
      fromAddress:     'staff@propertystars.app',
      commandCenterId: data.commandCenterId,
    };
    if (template.replyTo?.trim()) payload.replyTo = template.replyTo.trim();

    const { error } = await supabase.functions.invoke('bright-processor', { body: payload });
    if (error) throw error;

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
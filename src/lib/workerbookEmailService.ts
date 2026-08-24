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

// Identifies which text-template context we're saving/loading
export type StatusTextTemplateType =
  | 'workerbook_text'
  | 'workerbook_text_ns'
  | 'workerbook_text_wdr'
  | 'workerbook_text_snow'
  | 'workerbook_text_tnb'
  // Outreach: texts to PAST CUSTOMERS from the cached callbook PCLs, not to
  // contractors. Different placeholders entirely — see buildOutreachTextMessage.
  | 'outreach_text';

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

// Workerbook day-of text — single unified template (used for both cell and alt).
export const DEFAULT_TEXT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    'Hi {{firstName}}, reminder about your shift {{dateFriendly}}. ' +
    'Shuttle #{{shuttle}} - {{shuttleDescription}} at {{pickupTime}}. ' +
    'Reply YES to confirm. - Property Stars',
};

// NS (no-show) callback template
export const DEFAULT_NS_TEXT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    "Hi {{firstName}}, we noticed you missed your shift. We'd love to get you back on the schedule. " +
    'Reply with a day that works for you. - Property Stars',
};

// WDR (worked didn't rebook) follow-up template
export const DEFAULT_WDR_TEXT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    'Hi {{firstName}}, hope your first shift went well! Ready to pick up another day? ' +
    'Reply with a day that works for you. - Property Stars',
};

// SNOW callback template
export const DEFAULT_SNOW_TEXT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    "Hi {{firstName}}, hope you're doing well! We'd love to have you back on a day that works for you. " +
    'Reply with your availability. - Property Stars',
};

// TNB callback template
export const DEFAULT_TNB_TEXT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    "Hi {{firstName}}, touching base to see if you're ready to jump back on the schedule. " +
    'Reply with a day that works for you. - Property Stars',
};

// Outreach — past customers, from the callbook PCLs cached against the maps.
export const DEFAULT_OUTREACH_TEXT_TEMPLATE: WorkerbookTextTemplate = {
  bodyText:
    'Hi {{firstName}}, this is Property Stars. We looked after {{address}} back in {{year}} ' +
    'at {{price}}. We are booking the area again shortly — would you like us to put you down? ' +
    'Reply YES and we will be in touch.',
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

/**
 * Load the unified workerbook text template.
 *
 * Backward-compatible: if the new 'workerbook_text' key doesn't exist yet,
 * falls back to the legacy 'workerbook_text_cell' key (from the cell/alt
 * split we used to have). Cell wins over alt per Vijay's preference.
 */
export async function loadWorkerbookTextTemplate(): Promise<WorkerbookTextTemplate> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return { ...DEFAULT_TEXT_TEMPLATE };

  try {
    const { data } = await supabase
      .from('email_templates')
      .select('template_type, content_structure')
      .eq('command_center_id', ccId)
      .in('template_type', ['workerbook_text', 'workerbook_text_cell']);

    // Prefer the unified 'workerbook_text' if it exists
    const unified = data?.find(t => t.template_type === 'workerbook_text');
    if (unified) {
      return {
        bodyText: (unified.content_structure as any)?.bodyText || DEFAULT_TEXT_TEMPLATE.bodyText,
      };
    }

    // Fallback to the legacy 'workerbook_text_cell' for migration
    const legacy = data?.find(t => t.template_type === 'workerbook_text_cell');
    if (legacy) {
      return {
        bodyText: (legacy.content_structure as any)?.bodyText || DEFAULT_TEXT_TEMPLATE.bodyText,
      };
    }

    return { ...DEFAULT_TEXT_TEMPLATE };
  } catch {
    return { ...DEFAULT_TEXT_TEMPLATE };
  }
}

/**
 * Save the unified workerbook text template.
 */
export async function saveWorkerbookTextTemplate(template: WorkerbookTextTemplate): Promise<void> {
  await saveStatusTextTemplate('workerbook_text', template);
}

/**
 * Load the NS callback text template.
 */
export async function loadNsTextTemplate(): Promise<WorkerbookTextTemplate> {
  return loadStatusTextTemplateByType('workerbook_text_ns', DEFAULT_NS_TEXT_TEMPLATE);
}

/**
 * Load the WDR callback text template.
 */
export async function loadWdrTextTemplate(): Promise<WorkerbookTextTemplate> {
  return loadStatusTextTemplateByType('workerbook_text_wdr', DEFAULT_WDR_TEXT_TEMPLATE);
}

/**
 * Load the SNOW callback text template.
 */
export async function loadSnowTextTemplate(): Promise<WorkerbookTextTemplate> {
  return loadStatusTextTemplateByType('workerbook_text_snow', DEFAULT_SNOW_TEXT_TEMPLATE);
}

/**
 * Load the TNB callback text template.
 */
export async function loadTnbTextTemplate(): Promise<WorkerbookTextTemplate> {
  return loadStatusTextTemplateByType('workerbook_text_tnb', DEFAULT_TNB_TEXT_TEMPLATE);
}

/**
 * Load all five text templates (workerbook, NS, WDR, SNOW, TNB) in one shot.
 */
export async function loadAllTextTemplates(): Promise<{
  workerbook: WorkerbookTextTemplate;
  ns: WorkerbookTextTemplate;
  wdr: WorkerbookTextTemplate;
  snow: WorkerbookTextTemplate;
  tnb: WorkerbookTextTemplate;
}> {
  const [workerbook, ns, wdr, snow, tnb] = await Promise.all([
    loadWorkerbookTextTemplate(),
    loadNsTextTemplate(),
    loadWdrTextTemplate(),
    loadSnowTextTemplate(),
    loadTnbTextTemplate(),
  ]);
  return { workerbook, ns, wdr, snow, tnb };
}

async function loadStatusTextTemplateByType(
  type: StatusTextTemplateType,
  def: WorkerbookTextTemplate,
): Promise<WorkerbookTextTemplate> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return { ...def };

  try {
    const { data } = await supabase
      .from('email_templates')
      .select('content_structure')
      .eq('command_center_id', ccId)
      .eq('template_type', type)
      .maybeSingle();

    return {
      bodyText: (data?.content_structure as any)?.bodyText || def.bodyText,
    };
  } catch {
    return { ...def };
  }
}

/**
 * Save any of the status text templates by type.
 */
export async function saveStatusTextTemplate(
  type: StatusTextTemplateType,
  template: WorkerbookTextTemplate,
): Promise<void> {
  const ccId = commandCenterService.getCurrentCommandCenterId();
  if (!ccId) return;

  const names: Record<StatusTextTemplateType, string> = {
    workerbook_text:      'Workerbook Day-Of Text',
    workerbook_text_ns:   'Workerbook NS Callback Text',
    workerbook_text_wdr:  'Workerbook WDR Callback Text',
    workerbook_text_snow: 'Workerbook SNOW Callback Text',
    workerbook_text_tnb:  'Workerbook TNB Callback Text',
    outreach_text:        'Outreach Text (past customers)',
  };

  const payload = {
    command_center_id: ccId,
    template_type:     type,
    template_name:     names[type],
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
      'workerbook_text',
      'workerbook_text_ns',
      'workerbook_text_wdr',
      'workerbook_text_snow',
      'workerbook_text_tnb',
    ])
    .lt('sent_at', cutoff.toISOString());
}

// ─── TEXT TRACKING ────────────────────────────────────────────────────────────

/**
 * Text tracking context — which screen the text was sent from.
 */
export type TextContext = 'workerbook' | 'ns' | 'wdr' | 'snow' | 'tnb';

/**
 * Returns a Set of keys like "H1001:cell:workerbook" or "H1001:alt:ns"
 * indicating which contractor+phone+context combinations have been texted today.
 *
 * Preserves backward compatibility with the old cell/alt split logs.
 */
export async function getTextedTodayMap(): Promise<Set<string>> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('email_logs')
    .select('recipient_email, email_type')
    .in('email_type', [
      'workerbook_text_cell',
      'workerbook_text_alt',
      'workerbook_text',
      'workerbook_text_ns',
      'workerbook_text_wdr',
      'workerbook_text_snow',
      'workerbook_text_tnb',
    ])
    .gte('sent_at', `${today}T00:00:00Z`);

  const set = new Set<string>();
  for (const row of data || []) {
    const t = row.email_type;
    let phoneType: 'cell' | 'alt' = 'cell';
    let context: TextContext = 'workerbook';

    if (t === 'workerbook_text_cell') { phoneType = 'cell'; context = 'workerbook'; }
    else if (t === 'workerbook_text_alt') { phoneType = 'alt'; context = 'workerbook'; }
    else if (t === 'workerbook_text') {
      const parts = String(row.recipient_email || '').split(':');
      if (parts.length >= 2 && (parts[1] === 'cell' || parts[1] === 'alt')) {
        set.add(`${parts[0]}:${parts[1]}:workerbook`);
        continue;
      }
      phoneType = 'cell';
      context = 'workerbook';
    }
    else if (t === 'workerbook_text_ns') {
      const parts = String(row.recipient_email || '').split(':');
      if (parts.length >= 2 && (parts[1] === 'cell' || parts[1] === 'alt')) {
        set.add(`${parts[0]}:${parts[1]}:ns`);
        continue;
      }
      context = 'ns';
    }
    else if (t === 'workerbook_text_wdr') {
      const parts = String(row.recipient_email || '').split(':');
      if (parts.length >= 2 && (parts[1] === 'cell' || parts[1] === 'alt')) {
        set.add(`${parts[0]}:${parts[1]}:wdr`);
        continue;
      }
      context = 'wdr';
    }
    else if (t === 'workerbook_text_snow') {
      const parts = String(row.recipient_email || '').split(':');
      if (parts.length >= 2 && (parts[1] === 'cell' || parts[1] === 'alt')) {
        set.add(`${parts[0]}:${parts[1]}:snow`);
        continue;
      }
      context = 'snow';
    }
    else if (t === 'workerbook_text_tnb') {
      const parts = String(row.recipient_email || '').split(':');
      if (parts.length >= 2 && (parts[1] === 'cell' || parts[1] === 'alt')) {
        set.add(`${parts[0]}:${parts[1]}:tnb`);
        continue;
      }
      context = 'tnb';
    }

    set.add(`${row.recipient_email}:${phoneType}:${context}`);
  }
  return set;
}

/**
 * Record that a text was sent (user tapped the SMS button).
 * context: 'workerbook' | 'ns' | 'wdr' | 'snow' | 'tnb'
 * phoneType: 'cell' | 'alt'
 */
export async function logTextSent(
  contractorId: string,
  phoneType: 'cell' | 'alt',
  context: TextContext = 'workerbook',
): Promise<void> {
  const emailType =
    context === 'ns'   ? 'workerbook_text_ns' :
    context === 'wdr'  ? 'workerbook_text_wdr' :
    context === 'snow' ? 'workerbook_text_snow' :
    context === 'tnb'  ? 'workerbook_text_tnb' :
                         'workerbook_text';

  const key = `${contractorId}:${phoneType}`;

  await supabase.from('email_logs').insert({
    recipient_email: key,
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

  let bodyText = template.bodyIntro;
  bodyText = bodyText.replace(/\{\{shuttlePoint\}\}/g, SENTINEL_SHUTTLE);
  bodyText = bodyText.replace(/\{\{confirmButton\}\}/g, SENTINEL_CONFIRM);

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

  const paragraphed = bodyText
    .split('\n')
    .map(line => line.trim()
      ? `<p style="margin:0 0 12px 0;color:#4b5563;font-size:16px;line-height:1.6;">${line}</p>`
      : '')
    .join('');

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

        <tr><td style="padding:30px 30px 10px 30px;">${introHtml}</td></tr>

        ${!hasShuttlePlaceholder ? buildShuttleSection(data.shuttle, shuttlePoint) : ''}

        ${data.isRookie ? buildTrainingSection(data.contractorId, data.firstName) : ''}

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
 */
export function buildSmsLink(phoneNumber: string, body: string): string {
  const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
  return `sms:${cleanPhone}?body=${encodeURIComponent(body)}`;
}

// ─── OUTREACH (past customers, from the map PCL cache) ───────────────────────
//
// Deliberately separate from buildTextMessage. That one is shaped around
// contractors — dates, shuttles, days worked — and cannot render an address or
// a last price. Bending it to serve both would put the workerbook's own messages
// at risk for no gain, so Outreach gets its own builder and its own placeholders.

export async function loadOutreachTextTemplate(): Promise<WorkerbookTextTemplate> {
  return loadStatusTextTemplateByType('outreach_text', DEFAULT_OUTREACH_TEXT_TEMPLATE);
}

export interface OutreachTextData {
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city?: string;
  /** Most recent year on record — history is stored newest-first. */
  year?: number;
  /** Most recent price, already formatted (e.g. "$179.00"). */
  price?: string;
  serviceType?: string;
}

export function buildOutreachTextMessage(
  template: WorkerbookTextTemplate,
  data: OutreachTextData,
): string {
  const address = `${data.houseNum || ''} ${data.streetName || ''}`.trim();
  const vars: Record<string, string> = {
    firstName:   data.firstName || 'there',
    lastName:    data.lastName || '',
    fullName:    `${data.firstName || ''} ${data.lastName || ''}`.trim(),
    address,
    city:        data.city || '',
    year:        data.year != null ? String(data.year) : '',
    price:       data.price || '',
    service:     data.serviceType || '',
  };
  return replaceVars(template.bodyText, vars);
}

/**
 * Outreach texts are tracked WITHOUT a date window, unlike the workerbook's.
 * A day-of reminder is worth repeating tomorrow; telling the same homeowner
 * twice that you serviced their driveway in 2021 is not.
 *
 * The key is `${routeCode}|${normalised address}` stored in recipient_email —
 * the same column the workerbook reuses as a general-purpose key.
 */
export function outreachClientKey(routeCode: string, houseNum: string, streetName: string): string {
  const addr = `${houseNum || ''} ${streetName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${routeCode}|${addr}`;
}

export async function getOutreachTextedSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const BATCH = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('email_logs')
      .select('recipient_email')
      .eq('email_type', 'outreach_text')
      .range(from, from + BATCH - 1);
    if (error) { console.warn('[Outreach] texted-set read failed:', error.message); break; }
    if (!data || data.length === 0) break;
    data.forEach((r: any) => set.add(r.recipient_email));
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return set;
}

export async function logOutreachText(clientKey: string): Promise<void> {
  const { error } = await supabase.from('email_logs').insert({
    recipient_email: clientKey,
    email_type:      'outreach_text',
    status:          'sent',
  });
  if (error) console.warn('[Outreach] Failed to log text:', error.message);
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
// src/lib/pclOutreachService.ts
//
// PCL OUTREACH — a crew member texts the past customers on their own routes,
// from the map logsheet, using a message THEY own.
//
// Kept apart from the office Outreach page on purpose: that page's template is
// per command centre and its texted log has no date window. Here the template
// is per contractor (worker_pcl_templates) and "texted" means texted this
// calendar year, so a PCL can be reached again next season.
//
// Nothing is sent from the browser. Tapping a client opens the phone's own
// Messages app with the body pre-filled (an `sms:` URL); the worker presses
// send. We log it at that moment because there is no callback afterwards.

import { supabase } from './supabase';

export const PCL_OUTREACH_LOG_TYPE = 'pcl_outreach_text';

export const DEFAULT_PCL_OUTREACH_TEMPLATE =
  'Hi {{firstName}}, it\'s {{workerFirstName}} from Property Stars. We looked after ' +
  '{{address}} in {{year}} and I\'m working your street today. Want me to stop by? ' +
  'Reply YES and I\'ll come to you.';

export const PCL_OUTREACH_PLACEHOLDERS = [
  { p: '{{firstName}}',       d: 'Customer first name (falls back to "there" if blank)' },
  { p: '{{lastName}}',        d: 'Last name' },
  { p: '{{fullName}}',        d: 'First and last together' },
  { p: '{{address}}',         d: 'House number and street, e.g. 49 Addley Cr' },
  { p: '{{city}}',            d: 'Town, where the callbook recorded one' },
  { p: '{{year}}',            d: 'Most recent year on record' },
  { p: '{{price}}',           d: 'Most recent price, e.g. $179.00' },
  { p: '{{service}}',         d: 'Most recent service code, e.g. SS' },
  { p: '{{routeCode}}',       d: 'Route code in square brackets, e.g. [AJ-12]' },
  { p: '{{workerFirstName}}', d: 'Your first name' },
  { p: '{{workerFullName}}',  d: 'Your first and last name' },
];

export interface PclOutreachTextData {
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city?: string;
  year?: number;
  price?: string;
  serviceType?: string;
  routeCode?: string;
  workerFirstName: string;
  workerLastName: string;
}

export function buildPclOutreachMessage(bodyText: string, d: PclOutreachTextData): string {
  const vars: Record<string, string> = {
    firstName:       d.firstName || 'there',
    lastName:        d.lastName || '',
    fullName:        `${d.firstName || ''} ${d.lastName || ''}`.trim(),
    address:         `${d.houseNum || ''} ${d.streetName || ''}`.trim(),
    city:            d.city || '',
    year:            d.year != null ? String(d.year) : '',
    price:           d.price || '',
    service:         d.serviceType || '',
    routeCode:       d.routeCode ? `[${d.routeCode}]` : '',
    workerFirstName: d.workerFirstName || '',
    workerFullName:  `${d.workerFirstName || ''} ${d.workerLastName || ''}`.trim(),
  };
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`{{${k}}}`, 'g'), v),
    bodyText,
  );
}

/** Same shape as the office key so a client is one thing everywhere. */
export function pclClientKey(routeCode: string, houseNum: string, streetName: string): string {
  const addr = `${houseNum || ''} ${streetName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${routeCode}|${addr}`;
}

// ─── TEMPLATE (per contractor) ────────────────────────────────────────────────

export async function loadWorkerPclTemplate(contractorId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('worker_pcl_templates')
      .select('body_text')
      .eq('contractor_id', contractorId)
      .maybeSingle();
    if (error) { console.warn('[PCL Outreach] template read failed:', error.message); return DEFAULT_PCL_OUTREACH_TEMPLATE; }
    const body = (data?.body_text || '').trim();
    return body || DEFAULT_PCL_OUTREACH_TEMPLATE;
  } catch {
    return DEFAULT_PCL_OUTREACH_TEMPLATE;
  }
}

export async function saveWorkerPclTemplate(
  contractorId: string,
  commandCenterId: string | null,
  bodyText: string,
): Promise<void> {
  const { error } = await supabase
    .from('worker_pcl_templates')
    .upsert({
      contractor_id: contractorId,
      command_center_id: commandCenterId,
      body_text: bodyText,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'contractor_id' });
  if (error) throw new Error(error.message);
}

// ─── TEXTED LOG (this calendar year) ─────────────────────────────────────────

export async function getPclTextedSet(): Promise<Set<string>> {
  const set = new Set<string>();
  const since = `${new Date().getFullYear()}-01-01T00:00:00Z`;
  const BATCH = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('email_logs')
      .select('recipient_email')
      .eq('email_type', PCL_OUTREACH_LOG_TYPE)
      .gte('sent_at', since)
      .range(from, from + BATCH - 1);
    if (error) { console.warn('[PCL Outreach] texted-set read failed:', error.message); break; }
    if (!data || data.length === 0) break;
    data.forEach((r: any) => set.add(r.recipient_email));
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return set;
}

export async function logPclText(clientKey: string): Promise<void> {
  const { error } = await supabase.from('email_logs').insert({
    recipient_email: clientKey,
    email_type:      PCL_OUTREACH_LOG_TYPE,
    status:          'sent',
  });
  if (error) console.warn('[PCL Outreach] Failed to log text:', error.message);
}
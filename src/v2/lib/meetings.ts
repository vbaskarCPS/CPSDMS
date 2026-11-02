// src/v2/lib/meetings.ts — MainstreetAI › Meetings: onboarding calls booked from the deck's last slide, the hosts
// who take them (their Zoom link and hours), the booking rules, and how each call went. Database:
// supabase/migrations/20261241100000_mainstreet_meetings.sql; emails: supabase/functions/ms-meetings.
import { db, must } from './client';

/** What the owner tapped on the deck's questions screen, and the proposal it made (built by the deck itself). */
export interface DeckAnswers {
  v: number; answers: Record<string, string | string[]>; summary: [string, string][];
  contact?: { name: string; role: string; phone: string; email: string } | null;
  proposal: null | { lines: [string, string][]; monthly: number; yearly: number; quoted: boolean; today_yearly: number | null; savings: number | null; fit: string };
}
export const hasAnswers = (a: DeckAnswers | null | undefined): a is DeckAnswers =>
  !!a && ((!!a.answers && Object.keys(a.answers).length > 0) || !!a.contact);

/** The people at a business (the deck's "Who we're talking to"). */
export interface BizContact { id: string; name?: string; role?: string; phone?: string; email?: string; updated_at: string }
export async function businessContacts(business: string, campaign: string): Promise<BizContact[]> {
  return (must(await db.rpc('ms_business_contacts_list', { p_business: business, p_campaign: campaign })) as BizContact[]) || [];
}

export type MeetingStatus = 'booked' | 'closed' | 'no_show' | 'not_fit' | 'cancelled';
export const STATUS_LABEL: Record<MeetingStatus, string> = {
  booked: 'Booked', closed: 'Closed', no_show: 'No-show', not_fit: 'Not a fit', cancelled: 'Cancelled',
};
export const STATUS_TONE: Record<MeetingStatus, 'g' | 'a' | 'b' | 'v' | 'r' | undefined> = {
  booked: 'b', closed: 'g', no_show: 'a', not_fit: 'r', cancelled: undefined,
};

/** Weekly hours: weekday (0 = Sunday) → blocks of [start, end] in minutes after midnight, in the host's time zone. */
export type Hours = Record<string, [number, number][]>;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const TIMEZONES = ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'America/Regina'];

export interface Meeting {
  id: string; status: MeetingStatus; starts_at: string; ends_at: string; length_min: number; timezone: string;
  owner_name: string; owner_phone: string | null; owner_email: string | null; notes: string | null; follow_up_at?: string | null;
  outcome_note: string | null; outcome_at: string | null; outcome_by: string | null;
  campaign: { id: string; name: string; color: string | null };
  business: { id: string; name: string; address: string | null; phone: string | null };
  host: { id: string; name: string; email: string | null; zoom_url: string | null; timezone: string };
  rep: { id: string; name: string; phone: string | null; email: string | null } | null;
  deal_id: string | null; deal_status: string | null; created_at: string; answers?: DeckAnswers | null;
}
export interface Slots { length_min: number; timezone: string; days_ahead: number; hosts: number; slots: { start: string; hosts: number }[] }
export interface Rules { campaign_id: string; length_min: number; buffer_min: number; notice_min: number; days_ahead: number; max_per_day: number | null; timezone: string }
export interface HostMe {
  id: string; name: string; email: string | null; zoom_url: string | null; timezone: string; hours: Hours; days_off: string[]; active: boolean;
  campaign: { id: string; name: string; color: string | null } | null; rules: Rules;
}
export interface HostRow {
  id: string; name: string; username: string; email: string | null; phone: string | null; user_active: boolean; active: boolean;
  zoom_url: string | null; timezone: string; hours: Hours; days_off: string[]; campaign_id: string | null; campaign: string | null;
  staff: boolean; setup_sent_at: string | null; setup_used_at: string | null; upcoming: number;
}

// ── booking (the rep, from the deck) ──
export async function meetingSlots(campaign: string, from: string | null, days = 7): Promise<Slots> {
  const r = must(await db.rpc('ms_meeting_slots', { p_campaign: campaign, p_from: from, p_days: days })) as Slots;
  return { ...r, slots: r.slots || [] };
}
export interface BookInput { campaign: string; business: string; start: string; name: string; phone: string; email: string; notes?: string; lat?: number | null; lng?: number | null; accuracy?: number | null }
export async function bookMeeting(b: BookInput): Promise<Meeting> {
  const m = must(await db.rpc('ms_book_meeting', {
    p_campaign: b.campaign, p_business: b.business, p_start: b.start, p_name: b.name, p_phone: b.phone || null, p_email: b.email || null,
    p_notes: b.notes || null, p_lat: b.lat ?? null, p_lng: b.lng ?? null, p_accuracy: b.accuracy ?? null,
  })) as Meeting;
  return m;
}
/** Saves the deck answers on the business (queued on the phone when there's no signal). */
export async function saveDeckAnswers(business: string, campaign: string, data: DeckAnswers): Promise<void> {
  const { sendOrQueue } = await import('./repQueue');
  await sendOrQueue({ id: crypto.randomUUID(), rpc: 'ms_save_deck_answers', args: { p_business: business, p_campaign: campaign, p_data: data },
    label: 'Deck answers', queued_at: Date.now() });
}

/** Emails the owner and the host (time, Zoom link, calendar invite). Never throws: the call is booked either way. */
export async function notifyMeeting(id: string, kind: 'booked' | 'changed' | 'cancelled'): Promise<{ sent: string[]; skipped: string[] } | { error: string }> {
  try {
    const { data, error } = await db.functions.invoke('ms-meetings', { body: { action: 'notify', meeting_id: id, kind } });
    if (error) return { error: (data as { error?: string } | null)?.error || error.message };
    return data as { sent: string[]; skipped: string[] };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

// ── hosts ──
export async function hostMe(): Promise<HostMe | null> { return (must(await db.rpc('ms_host_me')) as HostMe | null) || null; }
export async function isHost(): Promise<boolean> { return !!(await db.rpc('ms_is_host')).data; }
export async function saveMyHours(zoom: string, timezone: string, hours: Hours, daysOff: string[]): Promise<HostMe> {
  return must(await db.rpc('ms_host_save', { p_zoom: zoom, p_timezone: timezone, p_hours: hours, p_days_off: daysOff })) as HostMe;
}
export async function meetingsList(from: string, to: string, host?: string | null, campaign?: string | null): Promise<Meeting[]> {
  return (must(await db.rpc('ms_meetings_list', { p_from: from, p_to: to, p_host: host || null, p_campaign: campaign || null })) as Meeting[]) || [];
}
/** The host's follow-up after the call (a time and a note); the call stays booked. Null clears it. */
export async function setMeetingFollowUp(id: string, at: string | null, note?: string): Promise<Meeting> {
  return must(await db.rpc('ms_meeting_follow_up', { p_meeting: id, p_at: at, p_note: note || null })) as Meeting;
}
export async function setOutcome(id: string, status: Exclude<MeetingStatus, 'cancelled'>, note?: string): Promise<Meeting> {
  return must(await db.rpc('ms_meeting_outcome', { p_meeting: id, p_status: status, p_note: note || null })) as Meeting;
}

// ── admins ──
export async function hostsList(): Promise<HostRow[]> { return (must(await db.rpc('ms_hosts_list')) as HostRow[]) || []; }
export async function addHost(h: { user?: string | null; name?: string; email?: string; phone?: string; campaign: string; zoom?: string }): Promise<{ id: string; new_account: boolean }> {
  return must(await db.rpc('ms_admin_add_host', {
    p_user: h.user || null, p_full_name: h.name || null, p_email: h.email || null, p_phone: h.phone || null, p_campaign: h.campaign, p_zoom: h.zoom || null,
  })) as { id: string; new_account: boolean };
}
export async function saveHost(h: { id: string; campaign: string | null; zoom: string; timezone: string; hours: Hours; daysOff: string[]; active: boolean }): Promise<void> {
  must(await db.rpc('ms_admin_save_host', { p_user: h.id, p_campaign: h.campaign, p_zoom: h.zoom, p_timezone: h.timezone, p_hours: h.hours, p_days_off: h.daysOff, p_active: h.active }));
}
export async function getRules(campaign: string): Promise<Rules> { return must(await db.rpc('ms_get_meeting_rules', { p_campaign: campaign })) as Rules; }
export async function saveRules(r: Rules): Promise<Rules> {
  return must(await db.rpc('ms_save_meeting_rules', {
    p_campaign: r.campaign_id, p_length: r.length_min, p_buffer: r.buffer_min, p_notice: r.notice_min, p_days_ahead: r.days_ahead,
    p_max_per_day: r.max_per_day, p_timezone: r.timezone,
  })) as Rules;
}
export async function changeMeeting(id: string, c: { start?: string | null; host?: string | null; cancel?: boolean }): Promise<Meeting> {
  return must(await db.rpc('ms_admin_change_meeting', { p_meeting: id, p_start: c.start || null, p_host: c.host || null, p_cancel: !!c.cancel })) as Meeting;
}

// ── showing times ──
export const dayKey = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });   // YYYY-MM-DD
export const timeLabel = (iso: string, tz?: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
export const dayLabel = (iso: string, tz?: string) => new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
export const longDay = (iso: string, tz?: string) => new Date(iso).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
export const minLabel = (m: number) => { const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 && h < 24 ? 'PM' : 'AM', h12 = ((h + 11) % 12) + 1; return `${h12}:${String(mm).padStart(2, '0')} ${ap}`; };
export const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Group open times by day (in the campaign's time zone), in order. */
export function slotsByDay(s: Slots): { day: string; label: string; slots: { start: string; hosts: number }[] }[] {
  const out = new Map<string, { start: string; hosts: number }[]>();
  for (const x of s.slots) { const k = dayKey(x.start, s.timezone); out.set(k, [...(out.get(k) || []), x]); }
  return [...out.entries()].map(([day, slots]) => ({ day, label: dayLabel(slots[0].start, s.timezone), slots }));
}

/** A short summary of weekly hours, e.g. "Mon–Fri 9:00 AM–5:00 PM". */
export function hoursSummary(h: Hours): string {
  const parts = DAYS.map((d, i) => ({ d: d.slice(0, 3), v: (h[String(i)] || []).map(([a, b]) => `${minLabel(a)}–${minLabel(b)}`).join(', ') })).filter(x => x.v);
  if (!parts.length) return 'No hours set';
  const groups: { from: string; to: string; v: string }[] = [];
  for (const p of parts) { const g = groups[groups.length - 1]; if (g && g.v === p.v && DAYS.findIndex(d => d.startsWith(g.to)) + 1 === DAYS.findIndex(d => d.startsWith(p.d))) g.to = p.d; else groups.push({ from: p.d, to: p.d, v: p.v }); }
  return groups.map(g => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.v}`).join(' · ');
}

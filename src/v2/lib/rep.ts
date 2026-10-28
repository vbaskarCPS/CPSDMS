// src/v2/lib/rep.ts — the MainstreetAI rep app: the rep's zones, a zone's businesses, logging a
// visit, follow-ups and numbers (RUN_59: ms_rep_*), plus the admins' deal pipeline. A rep only ever
// sees their own visits. RUN_61 adds the home map, custom leads, retry, the day, photos, send info,
// the pitch kit and the board.
import { db, must } from './client';

export type Outcome = 'come_back' | 'not_interested' | 'follow_up' | 'interested' | 'closed' | 'cant_sell';
/** What a pin shows: never visited, the latest outcome, or a closed deal by where it is in the pipeline. */
export type PinState = 'new' | 'retry' | 'come_back' | 'not_interested' | 'follow_up' | 'interested' | 'pending' | 'closed' | 'rejected' | 'cant_sell';

export const OUTCOMES: { key: Outcome; label: string; hint: string; color: string }[] = [
  { key: 'come_back', label: 'Come back', hint: 'Closed, or the owner wasn’t in', color: '#64748b' },
  { key: 'not_interested', label: 'Not interested', hint: 'They said no', color: '#dc2626' },
  { key: 'follow_up', label: 'Follow-up', hint: 'A time to come back or call, and who to ask for', color: '#f59e0b' },
  { key: 'interested', label: 'Interested', hint: 'Sent them information', color: '#2563eb' },
  { key: 'closed', label: 'Closed deal', hint: 'Goes to an admin to approve', color: '#16a34a' },
  { key: 'cant_sell', label: 'Can’t sell here', hint: 'Shut down, wrong type, head office only: comes off your list', color: '#111827' },
];
export const outcomeOf = (k: string | null | undefined) => OUTCOMES.find(o => o.key === k) || null;

export const PIN: Record<PinState, { label: string; color: string }> = {
  new: { label: 'Not visited', color: '#ffffff' },
  retry: { label: 'Try again', color: '#fecaca' },
  come_back: { label: 'Come back', color: '#94a3b8' },
  not_interested: { label: 'Not interested', color: '#dc2626' },
  follow_up: { label: 'Follow-up', color: '#f59e0b' },
  interested: { label: 'Interested', color: '#2563eb' },
  pending: { label: 'Deal waiting for approval', color: '#86efac' },
  closed: { label: 'Closed deal', color: '#16a34a' },
  rejected: { label: 'Deal not approved', color: '#a855f7' },
  cant_sell: { label: 'Can’t sell here', color: '#111827' },
};
export const pinOf = (s: string | null | undefined) => PIN[(s as PinState) in PIN ? (s as PinState) : 'new'];
/** Still worth a knock: never visited, come back, follow-up, interested, a rejected deal, and a "not
 *  interested" from long enough ago (the campaign's retry days). */
export const isOpen = (s: PinState) => s === 'new' || s === 'retry' || s === 'come_back' || s === 'follow_up' || s === 'interested' || s === 'rejected';

// ───────────── home ─────────────
export interface RepZone {
  zone_id: string; zone_name: string; city: string | null; campaign_id: string; campaign_name: string; color: string;
  total: number; left: number; visited: number; followups_due: number; deals_pending: number; deals_approved: number; leads?: number;
}
export interface RepHome { name: string; first_name: string; today: string; zones: RepZone[] }
export async function repHome(): Promise<RepHome> {
  const r = must(await db.rpc('ms_rep_home')) as RepHome;
  return { ...r, zones: r.zones || [] };
}

// ───────────── a zone ─────────────
export interface RepBusiness {
  id: string; name: string; address: string | null; lat: number; lng: number; kind: string; plaza: string | null; plaza_id: string | null;
  state: PinState; last_at: string | null; follow_up_at: string | null; visits: number; hours?: unknown; lead?: boolean;
}
export interface RepZoneView {
  zone: { id: string; name: string; city: string | null; polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon; center: [number, number] };
  campaign: { id: string; name: string; color: string };
  businesses: RepBusiness[];
}
export async function repZone(zone: string, campaign: string): Promise<RepZoneView> {
  const r = must(await db.rpc('ms_rep_zone', { p_zone: zone, p_campaign: campaign })) as RepZoneView;
  return { ...r, businesses: (r.businesses || []).map(b => ({ ...b, lat: Number(b.lat), lng: Number(b.lng) })) };
}

/** The list, as the rep walks it: plaza by plaza (biggest first), then the rest by street and number. */
export function walkOrder(list: RepBusiness[]): { group: string; items: RepBusiness[] }[] {
  const plazas = new Map<string, RepBusiness[]>();
  const streets = new Map<string, RepBusiness[]>();
  for (const b of list) {
    if (b.plaza_id) { const k = b.plaza || 'Plaza'; plazas.set(k, [...(plazas.get(k) || []), b]); continue; }
    const st = streetOf(b.address) || 'Other';
    streets.set(st, [...(streets.get(st) || []), b]);
  }
  const byNo = (a: RepBusiness, b: RepBusiness) => (houseNo(a.address) - houseNo(b.address)) || a.name.localeCompare(b.name);
  return [
    ...[...plazas].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([group, items]) => ({ group, items: items.sort(byNo) })),
    ...[...streets].sort((a, b) => a[0].localeCompare(b[0])).map(([group, items]) => ({ group, items: items.sort(byNo) })),
  ];
}
/** "123 Main St W, Oakville" → "Main St W". */
export function streetOf(address: string | null | undefined): string {
  const first = (address || '').split(',')[0].trim();
  return first.replace(/^(unit|suite|#)\s*\S+\s*[-–]?\s*/i, '').replace(/^\d+[a-z]?(-\d+)?\s+/i, '').trim();
}
export function houseNo(address: string | null | undefined): number {
  const m = /(\d+)/.exec((address || '').split(',')[0]);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// ───────────── one business, logging a visit ─────────────
export interface RepVisit {
  id: string; at: string; outcome: Outcome; notes?: string; contact_name?: string; contact_phone?: string; contact_email?: string;
  follow_up_at?: string; far?: boolean; distance_m?: number; resolution?: 'removed' | 'kept'; deal?: 'pending' | 'approved' | 'rejected'; deal_note?: string;
  photos?: string[];
}
export interface RepBusinessView {
  id: string; name: string; address: string | null; lat: number; lng: number; kind: string; phone: string | null; website: string | null;
  hours: unknown; plaza: string | null; zone_id: string | null; campaign_id: string; visits: RepVisit[]; lead?: boolean;
  sends: { at: string; channel: 'sms' | 'email' | 'whatsapp' | 'link' | 'qr'; to: string | null }[];
}
export async function repBusiness(business: string, campaign: string): Promise<RepBusinessView> {
  const r = must(await db.rpc('ms_rep_business', { p_business: business, p_campaign: campaign })) as RepBusinessView;
  return { ...r, visits: r.visits || [], sends: r.sends || [] };
}

export interface VisitInput {
  outcome: Outcome; notes?: string; contact_name?: string; contact_phone?: string; contact_email?: string;
  follow_up_at?: string | null; lat?: number | null; lng?: number | null; accuracy?: number | null;
}
/** What's missing before a visit can be saved (null when it can). */
export function visitProblem(v: VisitInput, now = new Date()): string | null {
  if (!v.outcome) return 'Pick what happened.';
  if (v.outcome === 'follow_up') {
    if (!v.follow_up_at) return 'When should you follow up?';
    const t = new Date(v.follow_up_at);
    if (Number.isNaN(t.getTime())) return 'When should you follow up?';
    if (t.getTime() < now.getTime() - 60 * 60 * 1000) return 'That follow-up time has already passed.';
  }
  if (v.outcome === 'cant_sell' && !(v.notes || '').trim()) return 'Say why you can’t sell here.';
  if (v.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contact_email.trim())) return 'That email doesn’t look right.';
  return null;
}
export interface LoggedVisit { id: string; far: boolean; distance_m: number | null; state: PinState; again?: boolean }
/** The call's arguments: the phone's id and time go with it, so it can wait for signal and be sent twice safely. */
export function visitArgs(business: string, campaign: string, v: VisitInput & { at: string; client_id: string; photos?: string[] }): Record<string, unknown> {
  return {
    p_business: business, p_campaign: campaign, p_outcome: v.outcome, p_notes: v.notes || null,
    p_contact_name: v.contact_name || null, p_contact_phone: v.contact_phone || null, p_contact_email: v.contact_email || null,
    p_follow_up_at: v.outcome === 'follow_up' ? v.follow_up_at : null, p_lat: v.lat ?? null, p_lng: v.lng ?? null, p_accuracy: v.accuracy ?? null,
    p_at: v.at, p_client_id: v.client_id, p_photos: v.photos?.length ? v.photos : null,
  };
}
export async function logVisit(business: string, campaign: string, v: VisitInput & { at: string; client_id: string; photos?: string[] }): Promise<LoggedVisit> {
  return must(await db.rpc('ms_rep_log_visit', visitArgs(business, campaign, v))) as LoggedVisit;
}
/** What the pin turns into straight after a visit (before the server says). */
export const stateAfter = (o: Outcome): PinState => (o === 'closed' ? 'pending' : o);

/** Where the phone is, or nothing after a few seconds (the visit still saves; admins see it had no location). */
export function hereNow(timeoutMs = 8000): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    const t = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(t); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 20000 });
  });
}

// ───────────── follow-ups and numbers ─────────────
export interface FollowUp {
  business_id: string; name: string; address: string | null; zone_id: string; zone_name: string; campaign_id: string; campaign_name: string;
  follow_up_at: string; when: 'overdue' | 'today' | 'later'; contact_name: string | null; contact_phone: string | null; notes: string | null;
}
export async function repFollowups(): Promise<FollowUp[]> { return (must(await db.rpc('ms_rep_followups')) as FollowUp[]) || []; }

export interface RepNumbers {
  today: string; days: { day: string; visits: number; deals: number }[]; visits_total: number;
  deals: { pending: number; approved: number; rejected: number };
  recent_deals: { id: string; business: string; campaign: string; at: string; status: 'pending' | 'approved' | 'rejected'; note: string | null }[];
}
export async function repNumbers(): Promise<RepNumbers> { return must(await db.rpc('ms_rep_numbers')) as RepNumbers; }

// ───────────── the admins' pipeline ─────────────
export interface PipelineDeal {
  id: string; status: 'pending' | 'approved' | 'rejected'; at: string; decided_at?: string; decision_note?: string; decided_by?: string;
  business: { id: string; name: string; address: string | null; kind: string; phone: string | null };
  campaign: string; color: string; zone?: string; rep: string; rep_id: string;
  notes?: string; contact_name?: string; contact_phone?: string; contact_email?: string; far: boolean; distance_m?: number;
}
export async function dealsList(status: 'pending' | 'approved' | 'rejected'): Promise<PipelineDeal[]> {
  return (must(await db.rpc('ms_deals_list', { p_status: status })) as PipelineDeal[]) || [];
}
export async function decideDeal(id: string, approve: boolean, note?: string): Promise<void> {
  must(await db.rpc('ms_decide_deal', { p_deal: id, p_approve: approve, p_note: note || null }));
}
export interface Flag { id: string; at: string; notes: string; far: boolean; distance_m?: number; business: { id: string; name: string; address: string | null; kind: string }; campaign: string; zone?: string; rep: string }
export async function flagsList(): Promise<Flag[]> { return (must(await db.rpc('ms_flags_list')) as Flag[]) || []; }
export async function resolveFlag(id: string, remove: boolean): Promise<void> { must(await db.rpc('ms_resolve_flag', { p_visit: id, p_remove: remove })); }

// ───────────── sign-in (rep-auth Edge Function) ─────────────
/** Signs a rep in with their email. */
export async function repSignIn(email: string, password: string): Promise<void> {
  const { data, error } = await db.functions.invoke('rep-auth', { body: { action: 'sign_in', email: email.trim(), password } });
  const r = (data || {}) as { access_token?: string; refresh_token?: string; error?: string };
  if (!r.access_token || !r.refresh_token) throw new Error(r.error || (await fnError(error)) || 'Wrong email or password.');
  const { error: se } = await db.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
  if (se) throw new Error(se.message);
}
/** Emails a reset link when the email is a rep's (the answer is the same either way). */
export async function repForgot(email: string): Promise<void> {
  const { data, error } = await db.functions.invoke('rep-auth', { body: { action: 'forgot', email: email.trim() } });
  if (error && !(data as { ok?: boolean } | null)?.ok) throw new Error((await fnError(error)) || 'Couldn’t send the link. Try again.');
}
async function fnError(e: unknown): Promise<string | null> {
  const ctx = (e as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); return (b as { error?: string }).error || null; } catch { /* not json */ } }
  return e instanceof Error ? e.message : null;
}

// ───────────── words ─────────────
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const tom = new Date(now); tom.setDate(now.getDate() + 1);
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  if (day(d) === day(now)) return `Today ${time}`;
  if (day(d) === day(tom)) return `Tomorrow ${time}`;
  if (day(d) === day(yest)) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}
export const kindLabel = (k: string) => (k || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// ───────────── the home map (RUN_61) ─────────────
export interface MapPair { zone_id: string; zone_name: string; city: string | null; polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon; campaign_id: string; campaign_name: string; color: string }
/** One business on the map: short keys keep the download small. */
export interface MapBiz { id: string; n: string; a?: string; lat: number; lng: number; k: string; p?: string; z?: string; c: string; h?: string[]; lead?: boolean; s: PinState; at?: string; f?: string }
export interface RepMap { pairs: MapPair[]; businesses: MapBiz[] }
export async function repMap(): Promise<RepMap> {
  const r = must(await db.rpc('ms_rep_map')) as RepMap;
  return { pairs: r.pairs || [], businesses: (r.businesses || []).map(b => ({ ...b, lat: Number(b.lat), lng: Number(b.lng) })) };
}

export interface LeadInput { name: string; kind: string; address: string; lat: number; lng: number; phone?: string; website?: string; campaign?: string | null }
export async function addLead(l: LeadInput): Promise<{ id: string; zone_id: string | null; zone_name: string | null; campaign_id: string; in_my_zone: boolean }> {
  return must(await db.rpc('ms_rep_add_lead', {
    p_name: l.name, p_kind: l.kind, p_address: l.address || null, p_lat: l.lat, p_lng: l.lng,
    p_phone: l.phone || null, p_website: l.website || null, p_campaign: l.campaign || null,
  })) as { id: string; zone_id: string | null; zone_name: string | null; campaign_id: string; in_my_zone: boolean };
}
/** An address typed by the rep → a point (Mapbox), nudged toward where they are. */
export async function geocode(q: string, near?: { lat: number; lng: number } | null): Promise<{ lat: number; lng: number; label: string }[]> {
  const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN;
  if (!token || !q.trim()) return [];
  const prox = near ? `&proximity=${near.lng},${near.lat}` : '';
  const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json?access_token=${token}&country=ca&types=address,poi&limit=5${prox}`);
  if (!res.ok) throw new Error('Couldn’t look up that address.');
  const j = await res.json() as { features?: { center: [number, number]; place_name: string }[] };
  return (j.features || []).map(f => ({ lng: f.center[0], lat: f.center[1], label: f.place_name.replace(/, Canada$/, '') }));
}
/** A point → its street address (for a dropped pin). */
export async function reverseGeocode(p: { lat: number; lng: number }): Promise<string | null> {
  const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${p.lng},${p.lat}.json?access_token=${token}&types=address&limit=1`);
    const j = await res.json() as { features?: { place_name: string }[] };
    return j.features?.[0]?.place_name.replace(/, Canada$/, '') || null;
  } catch { return null; }
}

// ───────────── the pitch kit, send info ─────────────
export interface Kit {
  id: string; name: string; color: string; pitch: string | null; objections: { q: string; a: string }[];
  info_url: string | null; info_sms: string | null; info_email_subject: string | null; info_email_body: string | null;
  onepager_url: string | null; present_url?: string | null; pay_per_deal: number | null; retry_days: number; ref: string;
}
export async function repKit(campaign: string): Promise<Kit> {
  const k = must(await db.rpc('ms_rep_kit', { p_campaign: campaign })) as Kit;
  return { ...k, objections: Array.isArray(k.objections) ? k.objections : [] };
}

// ───────────── the day ─────────────
export interface RepToday {
  day: string; started_at: string | null; ended_at: string | null; distance_m: number; minutes: number;
  visits: number; deals: number; followups: number; goal_visits: number; goal_deals: number;
}
export async function repToday(): Promise<RepToday> { return must(await db.rpc('ms_rep_today')) as RepToday; }
export async function dayStart(p: { lat: number; lng: number } | null): Promise<RepToday> {
  return must(await db.rpc('ms_rep_day_start', { p_lat: p?.lat ?? null, p_lng: p?.lng ?? null })) as RepToday;
}
export async function dayPing(p: { lat: number; lng: number; accuracy: number }): Promise<void> {
  must(await db.rpc('ms_rep_day_ping', { p_lat: p.lat, p_lng: p.lng, p_accuracy: p.accuracy }));
}
export async function dayEnd(p: { lat: number; lng: number } | null): Promise<RepToday> {
  return must(await db.rpc('ms_rep_day_end', { p_lat: p?.lat ?? null, p_lng: p?.lng ?? null })) as RepToday;
}
export const hoursLabel = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

// ───────────── goals, the board ─────────────
export interface Board {
  week_of: string; goal_visits: number; goal_deals: number; streak: number;
  board: { me: boolean; name: string; visits: number; approved: number; pending: number }[];
  earnings: { week: number; total: number; unpriced: number };
}
export async function repBoard(): Promise<Board> { const b = must(await db.rpc('ms_rep_board')) as Board; return { ...b, board: b.board || [] }; }
export const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: n % 1 ? 2 : 0 });

// ───────────── photos ─────────────
/** Signed links for private photos (an hour). */
export async function photoUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await db.storage.from('ms-visit-photos').createSignedUrls(paths, 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data || []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}
/** A phone photo made small enough to send on a weak signal (longest side 1600 px, JPEG). */
export async function shrinkPhoto(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.82));
  } catch { return file; }   // HEIC on some browsers: send as it is
}

// ───────────── admins: the kit, goals, leads, who's working ─────────────
export interface KitInput {
  pay_per_deal: string; retry_days: string; info_url: string; info_sms: string; info_email_subject: string; info_email_body: string;
  pitch: string; objections: { q: string; a: string }[]; onepager_url: string; present_url: string;
}
export async function saveCampaignKit(id: string, k: KitInput): Promise<void> {
  must(await db.rpc('ms_save_campaign_kit', { p_id: id, p_kit: { ...k, objections: k.objections.filter(o => o.q.trim() || o.a.trim()) } }));
}
export async function getGoals(): Promise<{ visits_per_day: number; deals_per_day: number }> {
  return must(await db.rpc('ms_get_goals')) as { visits_per_day: number; deals_per_day: number };
}
export async function saveGoals(visits: number, deals: number): Promise<void> { must(await db.rpc('ms_save_goals', { p_visits: visits, p_deals: deals })); }

export interface Lead {
  id: string; name: string; address: string | null; kind: string; phone: string | null; lat: number; lng: number; at: string;
  rep: string; zone: string | null; campaign: string | null; nearby: { id: string; name: string; address: string | null; m: number }[];
}
export async function leadsList(): Promise<Lead[]> { return (must(await db.rpc('ms_leads_list')) as Lead[]) || []; }
export async function resolveLead(id: string, action: 'keep' | 'remove' | 'merge', target?: string): Promise<void> {
  must(await db.rpc('ms_resolve_lead', { p_lead: id, p_action: action, p_target: target || null }));
}
export interface RepNow {
  rep_id: string; name: string; started_at: string | null; ended_at: string | null; last_at: string | null; lat: number | null; lng: number | null;
  distance_m: number; visits: number; deals: number; zones: number;
}
export async function repsToday(): Promise<RepNow[]> { return (must(await db.rpc('ms_reps_today')) as RepNow[]) || []; }
export async function dealPhotos(deal: string): Promise<string[]> { return (must(await db.rpc('ms_deal_photos', { p_deal: deal })) as string[] | null) || []; }

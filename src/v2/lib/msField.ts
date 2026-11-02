// src/v2/lib/msField.ts — MainstreetAI at the door: what's at the rep's spot (businesses already added, names from
// map data), the people at a business (typed, or read off business cards), and do-not-knock.
// Database: supabase/migrations/20261246100000_mainstreet_at_the_door.sql.
import { db, must } from './client';
import { metres, parseCard, type CardFields } from './repField';

// ───────────── people at a business ─────────────
export const ROLES = ['Owner', 'Partner', 'Manager', 'Bookkeeper', 'Other'] as const;
export interface BizContact {
  id: string; name?: string; role?: string; title?: string; phone?: string; email?: string;
  decides?: boolean; best_time?: string; card_photo?: string; source?: string; email_ok?: boolean | null; updated_at: string;
}
export interface ContactInput { name: string; role: string; title: string; phone: string; email: string; decides: boolean; best_time: string; email_ok?: boolean | null }
export const emptyContact = (): ContactInput => ({ name: '', role: '', title: '', phone: '', email: '', decides: false, best_time: '' });

export async function contactsList(business: string, campaign: string): Promise<BizContact[]> {
  return (must(await db.rpc('ms_business_contacts_list', { p_business: business, p_campaign: campaign })) as BizContact[]) || [];
}
export async function saveContact(business: string, campaign: string, c: ContactInput, opts: { id?: string | null; cardPhoto?: string | null; source?: 'card' | 'typed' } = {}): Promise<string> {
  const id = must(await db.rpc('ms_contact_save', {
    p_id: opts.id || null, p_business: business, p_campaign: campaign, p_name: c.name, p_role: c.role, p_title: c.title,
    p_phone: c.phone, p_email: c.email, p_decides: c.decides, p_best_time: c.best_time, p_card_photo: opts.cardPhoto || null, p_source: opts.source || 'typed',
  })) as string;
  if (c.email_ok !== undefined && c.email_ok !== null) must(await db.rpc('ms_contact_email_ok', { p_id: id, p_campaign: campaign, p_ok: c.email_ok }));
  return id;
}
export async function hideContact(id: string, campaign: string): Promise<void> { must(await db.rpc('ms_contact_hide', { p_id: id, p_campaign: campaign })); }
export async function setWebsite(business: string, campaign: string, website: string): Promise<void> {
  must(await db.rpc('ms_business_set_website', { p_business: business, p_campaign: campaign, p_website: website }));
}

/** A role from a card's title line. */
export function roleFromTitle(title: string | null | undefined): string {
  const t = (title || '').toLowerCase();
  if (/\b(owner|founder|president|ceo|proprietor|principal)\b/.test(t)) return 'Owner';
  if (/\bpartner\b/.test(t)) return 'Partner';
  if (/\b(manager|director|supervisor|gm)\b/.test(t)) return 'Manager';
  if (/\b(bookkeep|accountant|cpa|controller|cfo|finance)/.test(t)) return 'Bookkeeper';
  return t ? 'Other' : '';
}

/** Read one card photo on the phone (the reader loads the first time it's used, so it needs signal once). */
export async function readCards(files: File[], shrink: (f: File, max?: number) => Promise<Blob>): Promise<(CardFields & { file: File })[]> {
  const { createWorker } = await import('tesseract.js');
  const w = await createWorker('eng');
  try {
    const out: (CardFields & { file: File })[] = [];
    for (const file of files) {
      const { data } = await w.recognize(await shrink(file, 2000));
      out.push({ ...parseCard(data.text || ''), file });
    }
    return out;
  } finally { await w.terminate(); }
}

/** Upload a card photo into the rep's own folder; returns its path. */
export async function uploadCard(uid: string, blob: Blob): Promise<string> {
  const path = `${uid}/cards/${crypto.randomUUID()}.jpg`;
  const { error } = await db.storage.from('ms-visit-photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

// ───────────── what's at the rep's spot ─────────────
/** Businesses already known at a spot (loaded with the city, not on the map yet): offered when adding one. */
export interface KnownBiz { id: string; name: string; address?: string; kind: string; phone?: string; website?: string; lat: number; lng: number; m: number }
export async function knownNear(p: { lat: number; lng: number }): Promise<KnownBiz[]> {
  return (must(await db.rpc('ms_rep_known_near', { p_lat: p.lat, p_lng: p.lng })) as KnownBiz[]) || [];
}
export interface NearbyBiz { id: string; name: string; address?: string; kind: string; m: number; by?: string; at?: string; dnk?: string }
export async function nearbyAdded(p: { lat: number; lng: number }): Promise<NearbyBiz[]> {
  return (must(await db.rpc('ms_rep_nearby', { p_lat: p.lat, p_lng: p.lng })) as NearbyBiz[]) || [];
}

export interface MapPlace { name: string; address: string | null; kind: string | null; category: string; lat: number; lng: number; m: number }
/** Business names from map data at a point (Mapbox points of interest), nearest first. */
export async function mapPlaces(p: { lat: number; lng: number }): Promise<MapPlace[]> {
  const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${p.lng},${p.lat}.json?access_token=${token}&types=poi&limit=5`);
    if (!res.ok) return [];
    const j = await res.json() as { features?: { text: string; center: [number, number]; properties?: { category?: string; address?: string } }[] };
    return (j.features || []).map(f => {
      const at = { lat: f.center[1], lng: f.center[0] };
      return { name: f.text, address: f.properties?.address || null, category: f.properties?.category || '', kind: kindFromCategory(f.properties?.category),
        lat: at.lat, lng: at.lng, m: Math.round(metres(p, at)) };
    }).filter(x => x.m <= 120).sort((a, b) => a.m - b.m);
  } catch { return []; }
}

/** Map data's category → one of our business kinds (null: the rep picks). */
export function kindFromCategory(c: string | null | undefined): string | null {
  const t = (c || '').toLowerCase();
  if (!t) return null;
  if (/restaurant|cafe|coffee|bar|pub|bakery|food|pizza|sushi|diner|deli|grill/.test(t)) return 'restaurant';
  if (/dentist|doctor|clinic|medical|physio|chiro|optometr|pharmac|health|veterinar/.test(t)) return 'clinic';
  if (/salon|spa|barber|beauty|nail|hair|massage|tattoo/.test(t)) return 'salon';
  if (/car|auto|garage|tire|mechanic|body shop|dealer/.test(t)) return 'auto';
  if (/gym|fitness|yoga|martial|pilates|crossfit/.test(t)) return 'fitness';
  if (/real estate|realtor|brokerage/.test(t)) return 'brokerage';
  if (/plumb|electric|contractor|hvac|roof|construction|renovat|landscap|locksmith/.test(t)) return 'trades';
  if (/law|account|insurance|marketing|agency|consult|architect|engineer|office|financial/.test(t)) return 'agency';
  if (/warehouse|industrial|manufactur|factory/.test(t)) return 'industrial';
  if (/shop|store|boutique|retail|clothing|florist|gift|hardware|book|jewel/.test(t)) return 'retail';
  return null;
}

// ───────────── do not knock ─────────────
export const DNK_REASONS = [
  { key: 'no_soliciting', label: 'No soliciting sign' },
  { key: 'asked_not_to_return', label: 'Asked us not to return' },
  { key: 'closed_for_good', label: 'Closed for good' },
] as const;
export type DnkReason = typeof DNK_REASONS[number]['key'];
export const dnkLabel = (k: string | null | undefined) => DNK_REASONS.find(r => r.key === k)?.label || k || '';
export async function setDoNotKnock(business: string, campaign: string | null, reason: DnkReason | null): Promise<void> {
  must(await db.rpc('ms_set_do_not_knock', { p_business: business, p_campaign: campaign, p_reason: reason }));
}
export interface DnkRow { id: string; name: string; address: string | null; reason: string; at: string; by: string | null }
export async function doNotKnockList(): Promise<DnkRow[]> { return (must(await db.rpc('ms_do_not_knock_list')) as DnkRow[]) || []; }

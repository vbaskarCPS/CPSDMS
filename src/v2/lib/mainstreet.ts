// src/v2/lib/mainstreet.ts — MainstreetAI: zones, campaigns and reps (RUN_50).
// Zones are polygons drawn on the map; a zone carries campaigns, and each zone+campaign pair has
// one rep. Nothing here is tied to a command center or a season.
import { db, must } from './client';

export interface Campaign { id: string; name: string; color: string; is_active: boolean; notes: string | null; created_at: string; updated_at: string }
export interface ZoneCampaign { campaign_id: string; name: string; color: string; is_active: boolean; rep_id: string | null; rep_name: string | null; assigned_at: string | null }
export interface Zone {
  id: string; name: string; polygon: GeoJSON.Polygon; center_lat: number | null; center_lng: number | null;
  city: string | null; area: string | null; status: 'active' | 'retired'; created_at: string; updated_at: string; campaigns: ZoneCampaign[];
}
export interface Rep {
  id: string; username: string; full_name: string; email: string | null; phone: string | null; is_active: boolean; must_change_password: boolean;
  created_at: string; setup_sent_at: string | null; setup_used_at: string | null; setup_error: string | null; zones: number;
}

/** The colour swatches offered for a campaign. */
export const CAMPAIGN_COLORS = ['#0ea5e9', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0d9488', '#2563eb', '#db2777', '#65a30d', '#475569'] as const;
export const UNASSIGNED_COLOR = '#94a3b8';

// ───────────── campaigns ─────────────
export async function listCampaigns(): Promise<Campaign[]> {
  return must(await db.from('ms_campaigns').select('*').order('name')) as Campaign[];
}
export async function saveCampaign(c: { id: string | null; name: string; color: string; notes: string }): Promise<string> {
  return must(await db.rpc('ms_save_campaign', { p_id: c.id, p_name: c.name, p_color: c.color, p_notes: c.notes || null })) as string;
}
export async function setCampaignActive(id: string, active: boolean): Promise<void> {
  must(await db.rpc('ms_set_campaign_active', { p_id: id, p_active: active }));
}

// ───────────── zones ─────────────
export async function listZones(): Promise<Zone[]> {
  return must(await db.rpc('ms_zones_list')) as Zone[];
}
export async function saveZone(z: { id: string | null; name: string; polygon: GeoJSON.Polygon | null; city: string | null; area: string | null }): Promise<string> {
  return must(await db.rpc('ms_save_zone', { p_id: z.id, p_name: z.name, p_polygon: z.polygon, p_city: z.city, p_area: z.area })) as string;
}
export async function setZoneStatus(id: string, status: 'active' | 'retired'): Promise<void> {
  must(await db.rpc('ms_set_zone_status', { p_id: id, p_status: status }));
}
export async function deleteZone(id: string): Promise<void> {
  must(await db.rpc('ms_delete_zone', { p_id: id }));
}
export async function setZoneCampaigns(zoneId: string, campaignIds: string[]): Promise<void> {
  must(await db.rpc('ms_set_zone_campaigns', { p_zone: zoneId, p_campaigns: campaignIds }));
}
export async function assignRep(zoneId: string, campaignId: string, repId: string | null): Promise<void> {
  must(await db.rpc('ms_assign_rep', { p_zone: zoneId, p_campaign: campaignId, p_rep: repId }));
}

// ───────────── reps ─────────────
export async function listReps(): Promise<Rep[]> {
  return must(await db.rpc('ms_reps')) as Rep[];
}
export async function createRep(r: { full_name: string; email: string; phone: string }): Promise<{ id: string; username: string }> {
  const rows = must(await db.rpc('ms_admin_create_rep', { p_full_name: r.full_name, p_email: r.email, p_phone: r.phone || null })) as { id: string; username: string }[];
  return rows[0];
}
export async function updateRep(id: string, r: { full_name: string; email: string; phone: string; is_active: boolean }): Promise<void> {
  must(await db.rpc('ms_admin_update_rep', { p_user: id, p_full_name: r.full_name, p_email: r.email || null, p_phone: r.phone || null, p_active: r.is_active }));
}

// ───────────── pure helpers (tested) ─────────────
/** The ring must close, have at least three distinct corners, and use [lng, lat] inside the world. */
export function polygonProblem(ring: [number, number][]): string | null {
  const pts = ring.length && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length < 3) return 'A zone needs at least three corners';
  if (pts.some(([lng, lat]) => !isFinite(lng) || !isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)) return 'A corner is off the map';
  if (new Set(pts.map(p => p.join(','))).size < 3) return 'A zone needs at least three different corners';
  return null;
}

/** A closed GeoJSON polygon from the corners the admin clicked. */
export function closeRing(corners: [number, number][]): GeoJSON.Polygon {
  const ring = corners.slice();
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (!l || f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** "Area, City" / "City" / "—" for the list. */
export function placeLabel(z: Pick<Zone, 'city' | 'area'>): string {
  return [z.area, z.city].filter(Boolean).join(', ') || '—';
}

/** The zone list's filters: all, no rep on any campaign, or one campaign. */
export type ZoneFilter = 'all' | 'unassigned' | string;
export function filterZones(zones: Zone[], f: ZoneFilter, showRetired: boolean, q: string): Zone[] {
  const needle = q.trim().toLowerCase();
  return zones.filter(z => (showRetired || z.status === 'active')
    && (f === 'all' || (f === 'unassigned' ? z.campaigns.every(c => !c.rep_id) : z.campaigns.some(c => c.campaign_id === f)))
    && (!needle || z.name.toLowerCase().includes(needle) || placeLabel(z).toLowerCase().includes(needle)
        || z.campaigns.some(c => c.name.toLowerCase().includes(needle) || (c.rep_name || '').toLowerCase().includes(needle))));
}

/** The colour a zone is drawn in: grey until a rep works it, then its (first assigned) campaign's colour. */
export function zoneColor(z: Pick<Zone, 'campaigns' | 'status'>): string {
  if (z.status === 'retired') return '#64748b';
  return z.campaigns.find(c => c.rep_id)?.color || UNASSIGNED_COLOR;
}

/** Mapbox features for the zone shapes and their labels. */
export function zoneFeatures(zones: Zone[], selectedId: string | null): { shapes: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection } {
  return {
    shapes: { type: 'FeatureCollection', features: zones.map(z => ({
      type: 'Feature', geometry: z.polygon, properties: { id: z.id, color: zoneColor(z), sel: z.id === selectedId ? 1 : 0, retired: z.status === 'retired' ? 1 : 0 } })) },
    labels: { type: 'FeatureCollection', features: zones.filter(z => z.center_lat != null && z.center_lng != null).map(z => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [z.center_lng!, z.center_lat!] }, properties: { id: z.id, label: z.name } })) },
  };
}

/** City (place) and area (neighbourhood / locality) at a point, from Mapbox. Null when there's no token. */
export async function placeAt(lng: number, lat: number): Promise<{ city: string | null; area: string | null }> {
  const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN;
  if (!token || token === 'pk.test') return { city: null, area: null };
  const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,neighborhood,locality&limit=3&access_token=${token}`);
  if (!r.ok) return { city: null, area: null };
  const j = await r.json() as { features?: { text?: string; place_type?: string[] }[] };
  const f = j.features || [];
  const city = f.find(x => x.place_type?.includes('place'))?.text?.trim() || null;
  const area = f.find(x => x.place_type?.includes('neighborhood') || x.place_type?.includes('locality'))?.text?.trim() || null;
  return { city, area: area && area !== city ? area : null };
}

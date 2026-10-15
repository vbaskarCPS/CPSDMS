// src/v2/lib/masterBookings.ts — Master Bookings: rounds, the three levels' data, and settings.
//
// A round is one time through a master map for one service in one season (Sealing 2026 · Round 1).
// Level 1 lists the center's master maps; level 2 shows the picked maps (filters, heat map by
// street); level 3 one route (every house, its knock history). The database does the counting
// (RUN_26: app_mb_*); this reads it and holds the small pure helpers the screens share.
import { db, must } from './client';

export type Service = 'aeration' | 'sealing';
export const SERVICES: Service[] = ['aeration', 'sealing'];
export const serviceLabel = (s: Service) => (s === 'aeration' ? 'Aeration' : 'Sealing');

export interface Season { service: Service; season: number }
export const seasonKey = (s: Season) => `${s.service}-${s.season}`;
export function parseSeason(k: string | null | undefined): Season | null {
  const m = /^(aeration|sealing)-(\d{4})$/.exec(k || '');
  return m ? { service: m[1] as Service, season: Number(m[2]) } : null;
}
export const seasonLabel = (s: Season) => `${serviceLabel(s.service)} ${s.season}`;

/** The round picker: each map's current round, or one round number for every map. */
export type RoundPick = 'current' | number;
export const parseRound = (v: string | null | undefined): RoundPick => {
  const n = Number(v);
  return v && v !== 'current' && Number.isInteger(n) && n >= 1 ? n : 'current';
};
export const roundParam = (r: RoundPick) => (r === 'current' ? null : r);

// ───────────── settings ─────────────
export interface MbSettings { service: Service | null; season: number | null; round: number | null; done_pct: number }
export async function getSettings(centerId: string): Promise<MbSettings> {
  const r = must(await db.rpc('app_mb_settings', { p_center: centerId })) as Partial<MbSettings>;
  return { service: r.service || null, season: r.season || null, round: r.round || null, done_pct: Number(r.done_pct) || 50 };
}
export async function saveSettings(centerId: string, s: MbSettings): Promise<MbSettings> {
  const r = must(await db.rpc('app_mb_save_settings', {
    p_center: centerId, p_service: s.service, p_season: s.season, p_round: s.round, p_done_pct: s.done_pct,
  })) as Partial<MbSettings>;
  return { service: r.service || null, season: r.season || null, round: r.round || null, done_pct: Number(r.done_pct) || 50 };
}

/** Where the picker opens: the URL's choice, else the center's default, else this year's season of the center's service. */
export function startingSeason(fromUrl: Season | null, settings: MbSettings | null, centerServices: string[] | undefined, year: number): Season {
  if (fromUrl) return fromUrl;
  if (settings?.service && settings.season) return { service: settings.service, season: settings.season };
  const svc = (centerServices || []).find((s): s is Service => s === 'sealing' || s === 'aeration') || 'sealing';
  return { service: svc, season: year };
}

// ───────────── level 1 ─────────────
export interface RoundSummary {
  no: number; started: string; ended: string | null; open: boolean;
  routes: number; done: number; started_routes: number; flagged: number; doors: number; knocked: number; days: string[];
}
export interface MapCard {
  area: string; prefix: string; start: number; count: number | null; city: string | null; region: string | null;
  routes: number; first: string | null; last: string | null;
  prev_aeration: number; prev_sealing: number; done_aeration: number; done_sealing: number; bookings: number;
  rounds: RoundSummary[]; shown: number | null; current: number | null; last_day: string | null;
  suggest_new: boolean; loose: number; loose_from: string | null;
}
export interface Overview { maps: MapCard[]; seasons: Season[]; done_pct: number; today: string }

export async function overview(centerId: string, s: Season, round: RoundPick): Promise<Overview> {
  const r = must(await db.rpc('app_mb_overview', { p_center: centerId, p_service: s.service, p_season: s.season, p_round: roundParam(round) })) as Overview;
  return { maps: r.maps || [], seasons: r.seasons || [], done_pct: Number(r.done_pct) || 50, today: r.today };
}

export async function outlines(centerId: string): Promise<Record<string, GeoJSON.Geometry>> {
  return (must(await db.rpc('app_mb_outlines', { p_center: centerId })) as Record<string, GeoJSON.Geometry> | null) || {};
}

/** The round a card shows: the picked number, else the map's open round, else its last. */
export function shownRound(m: MapCard): RoundSummary | null {
  return m.rounds.find(r => r.no === m.shown) || null;
}
export const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

// ───────────── level 2 ─────────────
export interface RouteStat { code: string; area: string; doors: number; knocked: number; pct: number; done: boolean; flagged: boolean; days: string[] }
export interface StreetHeat { route: string; street: string; doors: number; knocked: number; line: GeoJSON.Geometry | null }
export interface KnockDot { lat: number; lng: number; status: string; route: string; fast: boolean }
export interface ClientDot { id: string; lat: number; lng: number; route: string; flags: number; address: string; name: string | null }
export interface MapRound { area: string; round: number | null; open: boolean; started: string | null; ended: string | null }
export interface AreaView { maps: MapRound[]; routes: RouteStat[]; streets: StreetHeat[]; knocks: KnockDot[]; clients: ClientDot[]; bookings: number; done_pct: number }

type Raw = Record<string, unknown>;
export function parseAreaView(r: Raw): AreaView {
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []);
  return {
    maps: arr('maps') as MapRound[],
    routes: arr('routes') as RouteStat[],
    streets: arr('streets').map(x => { const a = x as unknown[]; return { route: String(a[0]), street: String(a[1]), doors: Number(a[2]) || 0, knocked: Number(a[3]) || 0, line: (a[4] as GeoJSON.Geometry) || null }; }),
    knocks: arr('knocks').map(x => { const a = x as unknown[]; return { lat: Number(a[0]), lng: Number(a[1]), status: String(a[2]), route: String(a[3]), fast: !!a[4] }; })
      .filter(k => Number.isFinite(k.lat) && Number.isFinite(k.lng)),
    clients: arr('clients').map(x => { const a = x as unknown[]; return { id: String(a[0]), lat: Number(a[1]), lng: Number(a[2]), route: String(a[3]), flags: Number(a[4]) || 0, address: String(a[5] || ''), name: (a[6] as string) || null }; })
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)),
    bookings: Number(r.bookings) || 0,
    done_pct: Number(r.done_pct) || 50,
  };
}
export async function areaView(areas: string[], s: Season, round: RoundPick): Promise<AreaView> {
  return parseAreaView(must(await db.rpc('app_mb_area_view', { p_areas: areas, p_service: s.service, p_season: s.season, p_round: roundParam(round) })) as Raw);
}

// ───────────── level 3 ─────────────
export interface HouseRow {
  k: string; lat: number; lng: number; a: string; s: string; st: string | null; fast: boolean; day: string | null;
  carried: boolean; c: string | null; n: string | null; f: number;
  /** civic number, suffix and unit (RUN_27; missing before it's run) */
  no?: number | null; sx?: string | null; u?: string | null;
}
export interface RouteView {
  route: string; area: string; round: number | null; open: boolean; started: string | null; ended: string | null; done_pct: number;
  doors: number; knocked: number; flagged: boolean; done: boolean; days: string[];
  line: { coordinates: [number, number][] }[] | null; houses: HouseRow[]; streets: StreetHeat[];
  /** the route's pending bookings (RUN_28; empty before it's run) */
  bookings: RouteBooking[];
}
export interface RouteBooking {
  id: string; name?: string; address?: string; phone?: string; type?: string; price?: string; prepaid?: boolean; notes?: string;
  services?: Record<string, unknown> | null; day?: string;
}
export async function routeView(route: string, s: Season, round: RoundPick): Promise<RouteView> {
  const r = must(await db.rpc('app_mb_route', { p_route: route, p_service: s.service, p_season: s.season, p_round: roundParam(round) })) as Raw;
  const streets = parseAreaView({ streets: r.streets }).streets;
  return { ...(r as unknown as RouteView), houses: (r.houses as HouseRow[]) || [], streets, days: (r.days as string[]) || [],
    bookings: Array.isArray(r.bookings) ? (r.bookings as RouteBooking[]) : [] };
}

export interface HouseVisit { day: string; at?: string; status: string; note?: string; first_name?: string; worker_id?: string; worker?: string; rounds?: { service: Service; season: number; no: number }[] }
export interface HouseJob { year?: number | string; line?: string; price?: string; service?: string; product?: string; contractor?: string; date?: string; paid?: string }
export interface House {
  route: string; area: string; key: string; address: string | null; visits: HouseVisit[];
  carried: { service: Service; season: number; no: number }[];
  client: { id: string; name: string | null; services: string[] | null; jobs: HouseJob[]; call_first?: string | null; notes?: string | null } | null;
}
export async function house(route: string, key: string): Promise<House> {
  const r = must(await db.rpc('app_mb_house', { p_route: route, p_house_key: key })) as House;
  return { ...r, visits: r.visits || [], carried: r.carried || [] };
}

export async function startRound(area: string, s: Season): Promise<{ round: number; cleared: number; carried: number }> {
  return must(await db.rpc('app_mb_start_round', { p_area: area, p_service: s.service, p_season: s.season })) as { round: number; cleared: number; carried: number };
}

// ───────────── colours ─────────────
/** Heat: green at 10% or less, through amber, to red at 70% or more. */
export function heatColor(pct: number): string {
  const t = Math.max(0, Math.min(1, (pct - 10) / 60));
  const mix = (a: number[], b: number[], u: number) => `#${a.map((v, i) => Math.round(v + (b[i] - v) * u).toString(16).padStart(2, '0')).join('')}`;
  const G = [0x16, 0xa3, 0x4a], A = [0xf5, 0x9e, 0x0b], R = [0xdc, 0x26, 0x26];
  return t < 0.5 ? mix(G, A, t * 2) : mix(A, R, (t - 0.5) * 2);
}
export const NO_DOORS = '#cbd5e1';

/** Knock statuses as the workers' map colours them. */
export const KNOCKS: { key: string; label: string; color: string }[] = [
  { key: 'not_home', label: 'Not home', color: '#8b8f98' },
  { key: 'no', label: 'No', color: '#dc2626' },
  { key: 'go_back', label: 'Go back', color: '#f97316' },
  { key: 'invalid', label: 'Invalid', color: '#ec4899' },
];
export const NEVER = { key: 'never', label: 'Not knocked this round', color: '#ffffff' };
export const knockOf = (s: string | null) => KNOCKS.find(k => k.key === s) || null;

/** Customer layers. Bits match the database: 1 aeration before, 2 sealing before, 4/8 this season. */
export type ClientLayer = 'prev_aeration' | 'prev_sealing' | 'done_aeration' | 'done_sealing';
export const CLIENT_LAYERS: { key: ClientLayer; bit: number; service: Service; label: (season: number) => string; color: string; hint: string }[] = [
  { key: 'done_sealing', bit: 8, service: 'sealing', label: y => `Sealing jobs ${y}`, color: '#7c3aed', hint: 'Sealing done this season (the RM map’s sales and completed)' },
  { key: 'done_aeration', bit: 4, service: 'aeration', label: y => `Aeration jobs ${y}`, color: '#15803d', hint: 'Aeration done this season' },
  { key: 'prev_sealing', bit: 2, service: 'sealing', label: () => 'Previous sealing clients', color: '#1d4ed8', hint: 'Sealing customers from earlier years (the sealing PCL)' },
  { key: 'prev_aeration', bit: 1, service: 'aeration', label: () => 'Previous aeration clients', color: '#84cc16', hint: 'Aeration customers from earlier years (the aeration PCL)' },
];
/** The layer a customer shows as: this season's job first, then past clients; only switched-on layers. */
export function clientLayerOf(flags: number, on: Set<ClientLayer>, service: Service): ClientLayer | null {
  const order = [...CLIENT_LAYERS].sort((a, b) => {
    const rank = (l: typeof a) => (l.bit >= 4 ? 0 : 2) + (l.service === service ? 0 : 1);
    return rank(a) - rank(b);
  });
  for (const l of order) if (on.has(l.key) && (flags & l.bit)) return l.key;
  return null;
}

/**
 * A house's colour on the route level, as the RM map colours it: this season's job for the
 * season's service (purple) wins; then no / go back / invalid; then not home (lighter for a past
 * client); then past clients (blue for the season's service, lime / sky for the other); else black.
 * Only customer layers switched on in the filters count.
 */
export const RM_HOUSE = {
  none: '#111111', not_home: '#8b8f98', no: '#dc2626', go_back: '#f97316', invalid: '#ec4899',
  done: '#7c3aed', pcl: '#1d4ed8', pclNotHome: '#93b4f5',
  other: { aeration: { pcl: '#84cc16', notHome: '#c3e88d' }, sealing: { pcl: '#0ea5e9', notHome: '#a5d8f5' } },
} as const;
export function houseLook(st: string | null, flags: number, on: Set<ClientLayer>, service: Service): { color: string; strong: boolean } {
  const bits = CLIENT_LAYERS.filter(l => on.has(l.key)).reduce((b, l) => b | l.bit, 0);
  const f = flags & bits;
  const mine = service === 'sealing' ? { prev: 2, done: 8 } : { prev: 1, done: 4 };
  const otherLine: Service = service === 'sealing' ? 'aeration' : 'sealing';
  const otherBits = service === 'sealing' ? 1 | 4 : 2 | 8;
  if (f & mine.done) return { color: RM_HOUSE.done, strong: true };
  if (st === 'no' || st === 'go_back' || st === 'invalid') return { color: RM_HOUSE[st], strong: true };
  const pcl = !!(f & mine.prev), other = !pcl && !!(f & otherBits);
  if (st === 'not_home') return { color: pcl ? RM_HOUSE.pclNotHome : other ? RM_HOUSE.other[otherLine].notHome : RM_HOUSE.not_home, strong: true };
  return { color: pcl ? RM_HOUSE.pcl : other ? RM_HOUSE.other[otherLine].pcl : RM_HOUSE.none, strong: false };
}
/** "Jane Doe" → "Jane D."; one word stays as it is. */
export function shortName(full: string | null | undefined): string | null {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
/** Aeration customer (any year) → leaf; sealing customer → black drop. */
export const serviceMarks = (flags: number) => ({ leaf: !!(flags & (1 | 4)), drop: !!(flags & (2 | 8)) });

// ───────────── words ─────────────
/** "2026-10-12" → "Oct 12". */
export function shortDay(d: string): string {
  const dt = new Date(`${d.slice(0, 10)}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
/** Days worked, compact: "Oct 5, 6, 12" (month repeated only when it changes). */
export function daysLabel(days: string[]): string {
  const out: string[] = []; let month = '';
  for (const d of [...days].sort()) {
    const dt = new Date(`${d.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(dt.getTime())) continue;
    const m = dt.toLocaleDateString('en-CA', { month: 'short' });
    out.push(m === month ? String(dt.getDate()) : `${m} ${dt.getDate()}`); month = m;
  }
  return out.join(', ');
}
export const roundName = (n: number | null) => (n ? `Round ${n}` : 'No round yet');

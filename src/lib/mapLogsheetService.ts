// src/lib/mapLogsheetService.ts
//
// Data layer for the map logsheet (SalesRabbit-style house map).
//
// Responsibilities
//   - Street / house-key normalisation (MUST mirror norm_street() and
//     house_key() in the Supabase schema — delivery 1 SQL).
//   - Loading the per-route house list: National Address Register first
//     (build_route_houses RPC), OpenStreetMap as the gap-filler, building
//     footprints from OpenStreetMap for every house that has one.
//   - Reading / writing house dispositions (No, Not Home, Go Back).
//   - Small helpers for turning pending sales, bookings, transactions and
//     PCL records into house keys so the map can colour them.
//
// Everything money-related still goes through sessionService; this file
// never writes a transaction or a pending sale.

import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { Worker, MasterBooking, PendingSale, HistoricalProperty } from '../types';
import { PCLClientGroup } from './pclCacheService';

// ---------------------------------------------------------------------------
// GATE — approved contractor ids live in public.map_logsheet_access (global
// list, managed from Super Admin → Map Logsheet Access). Fails CLOSED: if the
// table can't be read the worker gets the ordinary logsheet.
// ---------------------------------------------------------------------------
export const MAP_LOGSHEET_PATH = '/map-logsheet';

export interface MapAccessEntry {
  contractorId: string;
  note: string | null;
  createdAt: string;
}

export async function fetchMapAccessList(): Promise<MapAccessEntry[]> {
  const { data, error } = await supabase
    .from('map_logsheet_access')
    .select('contractor_id, note, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ contractorId: r.contractor_id, note: r.note ?? null, createdAt: r.created_at }));
}

export async function addMapAccess(contractorId: string, note: string): Promise<void> {
  const id = contractorId.trim().toUpperCase();
  if (!id) throw new Error('Contractor id is required');
  const { error } = await supabase
    .from('map_logsheet_access')
    .upsert({ contractor_id: id, note: note.trim() || null }, { onConflict: 'contractor_id' });
  if (error) throw error;
}

export async function removeMapAccess(contractorId: string): Promise<void> {
  const { error } = await supabase.from('map_logsheet_access').delete().eq('contractor_id', contractorId);
  if (error) throw error;
}

// --- Whole command centres (public.map_logsheet_cc_access) ---
export interface MapCcAccessEntry {
  commandCenterId: string;
  note: string | null;
  createdAt: string;
}

export async function fetchMapCcAccessList(): Promise<MapCcAccessEntry[]> {
  const { data, error } = await supabase
    .from('map_logsheet_cc_access')
    .select('command_center_id, note, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => ({ commandCenterId: r.command_center_id, note: r.note ?? null, createdAt: r.created_at }));
}

export async function addMapCcAccess(commandCenterId: string, note: string): Promise<void> {
  if (!commandCenterId) throw new Error('Command centre is required');
  const { error } = await supabase
    .from('map_logsheet_cc_access')
    .upsert({ command_center_id: commandCenterId, note: note.trim() || null }, { onConflict: 'command_center_id' });
  if (error) throw error;
}

export async function removeMapCcAccess(commandCenterId: string): Promise<void> {
  const { error } = await supabase.from('map_logsheet_cc_access').delete().eq('command_center_id', commandCenterId);
  if (error) throw error;
}

/** Is this worker allowed the map logsheet? Yes when their contractor id is on
 *  the contractor list, OR the command centre they're logged into is on the
 *  command-centre list. Never throws — a read failure counts as no. */
export async function isMapWorker(
  worker: { contractorId?: string } | null | undefined,
  commandCenterId: string | null = commandCenterService.getCurrentCommandCenterId(),
): Promise<boolean> {
  const id = (worker?.contractorId || '').trim().toUpperCase();
  if (!id) return false;
  try {
    const [byWorker, byCc] = await Promise.all([
      supabase.from('map_logsheet_access').select('contractor_id').eq('contractor_id', id).maybeSingle(),
      commandCenterId
        ? supabase.from('map_logsheet_cc_access').select('command_center_id').eq('command_center_id', commandCenterId).maybeSingle()
        : Promise.resolve({ data: null, error: null } as { data: any; error: any }),
    ]);
    if (byWorker.error) console.warn('[MapLogsheet] contractor access check failed', byWorker.error.message);
    if (byCc.error) console.warn('[MapLogsheet] command centre access check failed', byCc.error.message);
    return (!byWorker.error && !!byWorker.data) || (!byCc.error && !!byCc.data);
  } catch (err) {
    console.warn('[MapLogsheet] access check failed', err);
    return false;
  }
}

/** Where a freshly authenticated worker should land. Approved → the map page
 *  (which itself falls back to /logsheet if it can't run); everyone else →
 *  the ordinary logsheet. */
export async function workerLandingPath(worker: Worker | null | undefined): Promise<string> {
  return (await isMapWorker(worker)) ? MAP_LOGSHEET_PATH : '/logsheet';
}

// ---------------------------------------------------------------------------
// NORMALISATION — keep in lock-step with norm_street() in the SQL
// ---------------------------------------------------------------------------
const STREET_WORD_MAP: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr',
  crescent: 'cres', cr: 'cres', court: 'crt', ct: 'crt', boulevard: 'blvd',
  lane: 'ln', place: 'pl', circle: 'cir', trail: 'trl', terrace: 'terr', ter: 'terr',
  parkway: 'pky', pkwy: 'pky', gardens: 'gdns', heights: 'hts', grove: 'grv',
  square: 'sq', crossing: 'cross', sideroad: 'sdrd', concession: 'conc',
  highway: 'hwy', private: 'pvt', mews: 'mews', landing: 'landng', hollow: 'hollow',
  pathway: 'ptway', promenade: 'prom', esplanade: 'espl', extension: 'exten',
  expressway: 'expy', freeway: 'fwy',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
  nord: 'n', sud: 's', est: 'e', ouest: 'w',
};

export function normStreet(raw: string | null | undefined): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(w => STREET_WORD_MAP[w] ?? w)
    .join(' ');
}

/** "42A" → { civicNo: 42, suffix: 'a' }.  "42-1" → 42, ''.  "abc" → null. */
export function parseCivic(raw: string | null | undefined): { civicNo: number; suffix: string } | null {
  const m = (raw || '').trim().match(/^(\d+)\s*([a-zA-Z]?)/);
  if (!m) return null;
  return { civicNo: parseInt(m[1], 10), suffix: m[2].toLowerCase() };
}

export function houseKeyFromParts(civicNo: number, suffix: string, streetNorm: string): string {
  return `${civicNo}${(suffix || '').toLowerCase()}|${streetNorm}`;
}

/** Key from a split address (pending_sales, PCL). Null when unusable. */
export function houseKeyFromAddress(houseNumber: string | undefined, streetName: string | undefined): string | null {
  const civ = parseCivic(houseNumber);
  const sn = normStreet(streetName);
  if (!civ || !sn) return null;
  return houseKeyFromParts(civ.civicNo, civ.suffix, sn);
}

/** Key from a one-string address ("42 Elm St E") — bookings + transactions. */
export function houseKeyFromFullAddress(full: string | undefined): string | null {
  const s = (full || '').trim();
  const m = s.match(/^(\d+[a-zA-Z]?)\s+(.+)$/);
  if (!m) return null;
  return houseKeyFromAddress(m[1], m[2]);
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------
export interface SavedRouteMap {
  id: string;
  route_code: string;
  route_color: string;
  route_number: number;
  segments: Array<{ osmId: number; name: string; coordinates: [number, number][] }>;
}

export interface RouteHouse {
  routeCode: string;
  houseKey: string;
  civicNo: number;
  civicSuffix: string | null;
  streetName: string;
  streetNorm: string;
  unitCount: number;
  lat: number;
  lng: number;
  footprint: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  source: 'nar' | 'osm' | 'manual';
}

export type HouseDispositionStatus = 'no' | 'not_home' | 'go_back' | 'invalid';

export interface HouseDisposition {
  routeCode: string;
  houseKey: string;
  status: HouseDispositionStatus;
  note: string | null;
  /** Name picked up before/at the door (neighbour referral). Shown on the map
   *  under the house number and pre-filled into the quick pending sale. */
  firstName: string | null;
  workerId: string | null;
  sessionId: string | null;
  updatedAt: string;
}

/** Everything the map needs to colour one house. */
export type HouseVisualState = 'none' | 'not_home' | 'no' | 'go_back' | 'invalid' | 'pending' | 'completed';

export interface HouseView {
  house: RouteHouse;
  state: HouseVisualState;
  isPcl: boolean;
  pclName: string | null;
  /** Map label under the number: "John M" + newline + "(24, 25)" (years of service). */
  pclLabel: string | null;
  /** What the map actually prints under the number: the sale's customer name
   *  for pending/completed houses (falling back to the PCL name), plus the
   *  PCL years line when there is history. Null when there's nothing to show. */
  mapLabel: string | null;
  pcl: PCLClientGroup | null;
  disposition: HouseDisposition | null;
  pendingSale: PendingSale | null;
  officeBooking: MasterBooking | null;   // pending office prebook at this house
  completed: MasterBooking | null;       // completed transaction at this house
  /** Previously-serviced rows from the Logsheets tab (Load Historical). One
   *  house can have several — a repeat customer, or a name change. Purple. */
  historical: HistoricalProperty[];
  isHistorical: boolean;
}

// Colours. Base map is light (streets-v12) so these are chosen to read on it.
export const HOUSE_COLORS = {
  none: '#111111',
  not_home: '#8b8f98',
  no: '#dc2626',
  go_back: '#f97316',
  invalid: '#ec4899',
  pending: '#d4a800',
  completed: '#16a34a',
  pcl: '#1d4ed8',
  pclNotHome: '#93b4f5',
  historical: '#7c3aed',
} as const;

export function houseColor(v: Pick<HouseView, 'state' | 'isPcl' | 'isHistorical'>): string {
  if (v.state === 'completed') return HOUSE_COLORS.completed;
  if (v.state === 'pending') return HOUSE_COLORS.pending;
  // Historical (previously serviced) wins over dispositions and PCL. Only a
  // sale in this session (pending / completed above) outranks it.
  if (v.isHistorical) return HOUSE_COLORS.historical;
  if (v.state === 'no') return HOUSE_COLORS.no;
  if (v.state === 'go_back') return HOUSE_COLORS.go_back;
  if (v.state === 'invalid') return HOUSE_COLORS.invalid;
  if (v.state === 'not_home') return v.isPcl ? HOUSE_COLORS.pclNotHome : HOUSE_COLORS.not_home;
  return v.isPcl ? HOUSE_COLORS.pcl : HOUSE_COLORS.none;
}

export const routeHouseId = (routeCode: string, houseKey: string) => `${routeCode}::${houseKey}`;

// ---------------------------------------------------------------------------
// HOUSE TILES — a drawn rectangle per house, turned to face its street.
// Used for EVERY house instead of real building outlines, so every route looks
// the same and each house (townhouses included) is its own colourable shape.
//
//   - Orientation: the nearest drawn segment of the house's own street on its
//     route (any segment of the route as a fallback; else the direction to the
//     nearest neighbour on the same street; else north-up).
//   - Width: 80% of the gap to the nearest neighbour on the same street and
//     same side (odd/even), clamped to 5–13 m, so tiles never overlap along a
//     street. 11 m when the house has no neighbour.
//   - Depth: 10 m, sitting just behind the address point, never closer than
//     4 m to the street line.
//   - Near corners (a house on the cross street close by) both width and depth
//     shrink to fit, so tiles from different streets don't overlap.
// ---------------------------------------------------------------------------
const TILE_DEPTH_M = 10;
const TILE_MIN_W_M = 5;
const TILE_MAX_W_M = 13;
const TILE_SOLO_W_M = 11;
const TILE_STREET_GAP_M = 4;
const TILE_SEGMENT_SEARCH_M = 80;

export function buildHouseTiles(houses: RouteHouse[], routeMaps: SavedRouteMap[]): Map<string, GeoJSON.Polygon> {
  const out = new Map<string, GeoJSON.Polygon>();
  if (!houses.length) return out;

  // Local metric frame around the first house (equirectangular — fine across a town).
  const lat0 = houses[0].lat;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320;
  const ky = 111320;
  const toXY = (lng: number, lat: number): [number, number] => [lng * kx, lat * ky];
  const toLL = (x: number, y: number): [number, number] => [x / kx, y / ky];

  // Segments per route, split by normalised street name, in metres.
  type Seg = { a: [number, number]; b: [number, number] };
  const segsByRoute = new Map<string, { all: Seg[]; byStreet: Map<string, Seg[]> }>();
  for (const rm of routeMaps) {
    const all: Seg[] = [];
    const byStreet = new Map<string, Seg[]>();
    for (const s of rm.segments || []) {
      const cs = s.coordinates || [];
      const sn = normStreet(s.name);
      for (let i = 0; i < cs.length - 1; i++) {
        const seg = { a: toXY(cs[i][0], cs[i][1]), b: toXY(cs[i + 1][0], cs[i + 1][1]) };
        all.push(seg);
        if (sn) { if (!byStreet.has(sn)) byStreet.set(sn, []); byStreet.get(sn)!.push(seg); }
      }
    }
    segsByRoute.set(rm.route_code, { all, byStreet });
  }

  const nearestOnSegs = (p: [number, number], segs: Seg[]) => {
    let best: { q: [number, number]; d: number; dir: [number, number] } | null = null;
    for (const { a, b } of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const q: [number, number] = [a[0] + t * dx, a[1] + t * dy];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) { const L = Math.sqrt(len2); best = { q, d, dir: [dx / L, dy / L] }; }
    }
    return best;
  };

  // Neighbours: same route, same street, same side (parity).
  const groups = new Map<string, Array<{ h: RouteHouse; p: [number, number] }>>();
  // Spatial grid (20 m cells) for "nearest house on ANY street" lookups.
  const CELL = 20;
  const grid = new Map<string, Array<{ h: RouteHouse; p: [number, number] }>>();
  for (const h of houses) {
    const p = toXY(h.lng, h.lat);
    const k = `${h.routeCode}|${h.streetNorm}|${h.civicNo % 2}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ h, p });
    const gk = `${Math.floor(p[0] / CELL)}|${Math.floor(p[1] / CELL)}`;
    if (!grid.has(gk)) grid.set(gk, []);
    grid.get(gk)!.push({ h, p });
  }
  const nearestOtherStreet = (h: RouteHouse, p: [number, number]): number => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const o of grid.get(`${cx + dx}|${cy + dy}`) || []) {
        if (o.h === h || o.h.streetNorm === h.streetNorm) continue;
        const d = Math.hypot(o.p[0] - p[0], o.p[1] - p[1]);
        if (d > 0.5 && d < best) best = d;
      }
    }
    return best;
  };

  for (const list of groups.values()) {
    for (const { h, p } of list) {
      // Gap to the nearest other house on this side of this street. Houses the
      // register puts on (almost) the same spot — e.g. both halves of a semi
      // with one point — are "stacked" and laid out side by side below.
      let gap = Infinity;
      let towardNeighbour: [number, number] | null = null;
      const stacked = [h];
      for (const o of list) {
        if (o.h === h) continue;
        const d = Math.hypot(o.p[0] - p[0], o.p[1] - p[1]);
        if (d <= 1.5) { stacked.push(o.h); continue; }
        if (d < gap) { gap = d; towardNeighbour = [(o.p[0] - p[0]) / d, (o.p[1] - p[1]) / d]; }
      }
      stacked.sort((a, b) => a.civicNo - b.civicNo || (a.civicSuffix || '').localeCompare(b.civicSuffix || ''));
      const stackIdx = stacked.indexOf(h);
      const stackN = stacked.length;
      let width = isFinite(gap)
        ? Math.max(TILE_MIN_W_M, Math.min(TILE_MAX_W_M, gap * 0.8))
        : TILE_SOLO_W_M;
      if (stackN > 1) width = Math.max(TILE_MIN_W_M, width / stackN);
      let depth = TILE_DEPTH_M;
      // Corner squeeze: a house on another street within reach.
      const cross = nearestOtherStreet(h, p);
      if (cross < 20) {
        const fit = Math.max(TILE_MIN_W_M, cross * 0.55);
        width = Math.min(width, fit);
        depth = Math.min(depth, fit);
      }

      // Street direction (along) and the way the house faces away from it (back).
      const route = segsByRoute.get(h.routeCode);
      let near = route ? nearestOnSegs(p, route.byStreet.get(h.streetNorm) || []) : null;
      if (!near || near.d > TILE_SEGMENT_SEARCH_M) {
        const any = route ? nearestOnSegs(p, route.all) : null;
        near = any && any.d <= TILE_SEGMENT_SEARCH_M ? any : null;
      }
      let along: [number, number];
      let back: [number, number];
      let centre: [number, number];
      if (near) {
        along = near.dir;
        const vx = p[0] - near.q[0], vy = p[1] - near.q[1];
        const vlen = Math.hypot(vx, vy);
        back = vlen > 0.5 ? [vx / vlen, vy / vlen] : [-along[1], along[0]];
        // Keep the tile's front edge at least TILE_STREET_GAP_M from the street line.
        const centreDist = Math.max(near.d + 2, TILE_STREET_GAP_M + depth / 2);
        centre = [near.q[0] + back[0] * centreDist, near.q[1] + back[1] * centreDist];
      } else {
        along = towardNeighbour || [1, 0];
        back = [-along[1], along[0]];
        centre = p;
      }

      // Stacked houses: shift each one along the street so they sit side by side.
      if (stackN > 1) {
        const shift = (stackIdx - (stackN - 1) / 2) * width * 1.05;
        centre = [centre[0] + along[0] * shift, centre[1] + along[1] * shift];
      }
      const hw = width / 2, hd = depth / 2;
      const corner = (sa: number, sb: number): [number, number] =>
        toLL(centre[0] + along[0] * hw * sa + back[0] * hd * sb, centre[1] + along[1] * hw * sa + back[1] * hd * sb);
      const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
      out.set(routeHouseId(h.routeCode, h.houseKey), { type: 'Polygon', coordinates: [ring] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ROUTE MAPS
// ---------------------------------------------------------------------------
export async function fetchRouteMaps(routeCodes: string[]): Promise<SavedRouteMap[]> {
  if (!routeCodes.length) return [];
  const { data, error } = await supabase
    .from('route_maps')
    .select('id, route_code, route_color, route_number, segments')
    .in('route_code', routeCodes)
    .eq('status', 'approved');
  if (error) throw error;
  return (data || []) as SavedRouteMap[];
}

// ---------------------------------------------------------------------------
// ROUTE HOUSES — read
// ---------------------------------------------------------------------------
function mapHouseRow(r: any): RouteHouse {
  return {
    routeCode: r.route_code,
    houseKey: r.house_key,
    civicNo: r.civic_no,
    civicSuffix: r.civic_suffix ?? null,
    streetName: r.street_name,
    streetNorm: r.street_norm,
    unitCount: r.unit_count ?? 1,
    lat: r.lat,
    lng: r.lng,
    footprint: r.footprint ?? null,
    source: r.source,
  };
}

export async function fetchRouteHouses(routeCodes: string[]): Promise<RouteHouse[]> {
  if (!routeCodes.length) return [];
  const out: RouteHouse[] = [];
  // Page in 1000s — a route can have several hundred houses; several routes
  // can pass the default row cap.
  for (const rc of routeCodes) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('route_houses')
        .select('*')
        .eq('route_code', rc)
        .order('id')
        .range(from, from + 999);
      if (error) throw error;
      (data || []).forEach(r => out.push(mapHouseRow(r)));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  return out;
}

interface RouteHouseBuild {
  route_code: string;
  built_at: string;
  source: string;
  house_count: number;
  footprints_at: string | null;
  footprint_count: number;
}

async function fetchBuild(routeCode: string): Promise<RouteHouseBuild | null> {
  const { data, error } = await supabase
    .from('route_house_builds')
    .select('*')
    .eq('route_code', routeCode)
    .maybeSingle();
  if (error) throw error;
  return (data as RouteHouseBuild) || null;
}

// ---------------------------------------------------------------------------
// GEOMETRY HELPERS (equirectangular — fine at neighbourhood scale)
// ---------------------------------------------------------------------------
const M_PER_DEG_LAT = 111320;

function metersBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const kx = Math.cos(((aLat + bLat) / 2) * Math.PI / 180) * M_PER_DEG_LAT;
  const dx = (bLng - aLng) * kx;
  const dy = (bLat - aLat) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentMeters(pLng: number, pLat: number, a: [number, number], b: [number, number]): number {
  const kx = Math.cos(pLat * Math.PI / 180) * M_PER_DEG_LAT;
  const px = pLng * kx, py = pLat * M_PER_DEG_LAT;
  const ax = a[0] * kx, ay = a[1] * M_PER_DEG_LAT;
  const bx = b[0] * kx, by = b[1] * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/** Distance from a point to the nearest segment of the route, plus that
 *  segment's street name. */
function nearestRouteSegment(rm: SavedRouteMap, lng: number, lat: number): { meters: number; name: string } {
  let best = { meters: Infinity, name: '' };
  for (const seg of rm.segments || []) {
    const cs = seg.coordinates || [];
    for (let i = 0; i < cs.length - 1; i++) {
      const d = pointToSegmentMeters(lng, lat, cs[i], cs[i + 1]);
      if (d < best.meters) best = { meters: d, name: seg.name || '' };
    }
  }
  return best;
}

function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function routeBbox(rm: SavedRouteMap, padDeg = 0.0009): { s: number; w: number; n: number; e: number } | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const seg of rm.segments || []) {
    for (const c of seg.coordinates || []) {
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    }
  }
  if (!isFinite(minLng)) return null;
  return { s: minLat - padDeg, w: minLng - padDeg, n: maxLat + padDeg, e: maxLng + padDeg };
}

// ---------------------------------------------------------------------------
// OPENSTREETMAP (Overpass) — gap-filler for houses, sole source for footprints
// ---------------------------------------------------------------------------
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

async function fetchOverpass(bbox: { s: number; w: number; n: number; e: number }): Promise<OsmElement[]> {
  const b = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  const query = `[out:json][timeout:60];
(
  node["addr:housenumber"](${b});
  way["addr:housenumber"](${b});
  way["building"](${b});
);
out body geom;`;
  let lastErr: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      return (json.elements || []) as OsmElement[];
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Overpass mirrors failed');
}

interface OsmBuilding {
  ring: [number, number][];       // closed ring [lng, lat]
  cLng: number;
  cLat: number;
}

interface OsmAddressPoint {
  civicNo: number;
  suffix: string;
  street: string;
  lat: number;
  lng: number;
  unit: boolean;
}

function wayCentroid(g: Array<{ lat: number; lon: number }>): { lat: number; lng: number } {
  let la = 0, lo = 0;
  for (const p of g) { la += p.lat; lo += p.lon; }
  return { lat: la / g.length, lng: lo / g.length };
}

function extractOsm(elements: OsmElement[]): { addresses: OsmAddressPoint[]; buildings: OsmBuilding[] } {
  const addresses: OsmAddressPoint[] = [];
  const buildings: OsmBuilding[] = [];
  for (const el of elements) {
    const tags = el.tags || {};
    let lat: number | undefined, lng: number | undefined;
    if (el.type === 'node') { lat = el.lat; lng = el.lon; }
    else if (el.type === 'way' && el.geometry && el.geometry.length >= 3) {
      const c = wayCentroid(el.geometry);
      lat = c.lat; lng = c.lng;
      if (tags.building) {
        const ring = el.geometry.map(p => [p.lon, p.lat] as [number, number]);
        const first = ring[0], last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
        buildings.push({ ring, cLng: c.lng, cLat: c.lat });
      }
    }
    if (lat == null || lng == null) continue;
    if (tags['addr:housenumber']) {
      const civ = parseCivic(tags['addr:housenumber']);
      if (!civ) continue;
      addresses.push({
        civicNo: civ.civicNo,
        suffix: civ.suffix,
        street: tags['addr:street'] || '',
        lat, lng,
        unit: !!tags['addr:unit'] || /^\d+\s*-\s*\d+/.test(tags['addr:housenumber']),
      });
    }
  }
  return { addresses, buildings };
}

/** Building polygon for a house point: containing polygon first, else nearest
 *  centroid within maxMeters. */
function footprintForPoint(lng: number, lat: number, buildings: OsmBuilding[], maxMeters = 18): GeoJSON.Polygon | null {
  let nearest: OsmBuilding | null = null;
  let nearestD = Infinity;
  for (const b of buildings) {
    if (pointInRing(lng, lat, b.ring)) return { type: 'Polygon', coordinates: [b.ring] };
    const d = metersBetween(lng, lat, b.cLng, b.cLat);
    if (d < nearestD) { nearestD = d; nearest = b; }
  }
  if (nearest && nearestD <= maxMeters) return { type: 'Polygon', coordinates: [nearest.ring] };
  return null;
}

// ---------------------------------------------------------------------------
// ROUTE HOUSES — ensure (build on first use)
// ---------------------------------------------------------------------------
export type HouseBuildProgress = (msg: string) => void;

const ROUTE_MATCH_METERS = 60;  // mirrors build_route_houses(p_buffer_m)
const DEDUPE_METERS = 8;        // OSM house this close to a NAR house = same house

/**
 * Guarantees a house list exists for the route, then returns it.
 *
 * 1. No build row yet → ask the DB to build from the National Address
 *    Register. If that yields houses, the route is "nar" sourced.
 * 2. Whenever the route has never had an OSM pass (no footprints_at), fetch
 *    OpenStreetMap once for the route's bbox:
 *      - add OSM addresses on the route's streets that aren't already known
 *        (fills gaps in the register, or the whole route if the register is
 *        empty or not yet imported);
 *      - attach building footprints to every house that lacks one.
 * 3. Return the fresh list.
 *
 * Overpass failures are non-fatal: whatever exists is returned and the OSM
 * pass is retried next load.
 */
export async function ensureRouteHouses(rm: SavedRouteMap, onProgress?: HouseBuildProgress): Promise<RouteHouse[]> {
  const rc = rm.route_code;
  let build = await fetchBuild(rc);

  if (!build) {
    onProgress?.(`Building ${rc} from the address register…`);
    try {
      const { error } = await supabase.rpc('build_route_houses', { p_route_code: rc });
      if (error) throw error;
    } catch (e) {
      console.warn('[mapLogsheet] build_route_houses failed (continuing to OSM):', e);
    }
    build = await fetchBuild(rc);
  }

  let houses = await fetchRouteHouses([rc]);

  const needsOsmPass = !build || !build.footprints_at;
  if (needsOsmPass) {
    const bbox = routeBbox(rm);
    if (bbox) {
      onProgress?.(`Fetching houses for ${rc} from OpenStreetMap…`);
      try {
        const elements = await fetchOverpass(bbox);
        const { addresses, buildings } = extractOsm(elements);

        // --- Gap-fill houses from OSM ---
        const routeNames = new Set(
          (rm.segments || []).map(s => normStreet(s.name)).filter(Boolean)
        );
        const candidates: Array<{ civicNo: number; suffix: string; street: string; lat: number; lng: number; unitCount: number }> = [];
        const byKey = new Map<string, { civicNo: number; suffix: string; street: string; lat: number; lng: number; unitCount: number }>();
        for (const a of addresses) {
          const near = nearestRouteSegment(rm, a.lng, a.lat);
          if (near.meters > ROUTE_MATCH_METERS) continue;
          const street = a.street || near.name;
          const sn = normStreet(street);
          if (!sn || !routeNames.has(sn)) continue;
          // Skip anything the register already covers.
          const dup = houses.some(h => metersBetween(a.lng, a.lat, h.lng, h.lat) <= DEDUPE_METERS
            || (h.civicNo === a.civicNo && h.streetNorm === sn));
          if (dup) continue;
          const key = houseKeyFromParts(a.civicNo, a.suffix, sn);
          const existing = byKey.get(key);
          if (existing) { existing.unitCount += 1; continue; }
          const c = { civicNo: a.civicNo, suffix: a.suffix, street, lat: a.lat, lng: a.lng, unitCount: 1 };
          byKey.set(key, c);
          candidates.push(c);
        }
        if (candidates.length) {
          const { error } = await supabase.rpc('upsert_route_houses', {
            p_route_code: rc,
            p_houses: candidates,
            p_source: 'osm',
          });
          if (error) throw error;
          houses = await fetchRouteHouses([rc]);
        } else if (!build) {
          // Nothing from either source — still record the attempt so we don't
          // hammer Overpass every load. upsert with an empty array does that.
          await supabase.rpc('upsert_route_houses', { p_route_code: rc, p_houses: [], p_source: 'osm' });
        }

        // --- Footprints ---
        onProgress?.(`Matching building outlines for ${rc}…`);
        const items: Array<{ houseKey: string; footprint: GeoJSON.Polygon }> = [];
        for (const h of houses) {
          if (h.footprint) continue;
          const fp = footprintForPoint(h.lng, h.lat, buildings);
          if (fp) items.push({ houseKey: h.houseKey, footprint: fp });
        }
        // Always call it (even with zero items) so footprints_at is stamped
        // and the OSM pass isn't repeated on every load.
        const { error: fpErr } = await supabase.rpc('set_route_house_footprints', {
          p_route_code: rc,
          p_items: items,
        });
        if (fpErr) throw fpErr;
        if (items.length) houses = await fetchRouteHouses([rc]);
      } catch (e) {
        console.warn('[mapLogsheet] OpenStreetMap pass failed for', rc, e);
      }
    }
  }

  return houses;
}

/** Worker-added house (the "house missing here" button). */
export async function addManualHouse(
  routeCode: string,
  civicNo: number,
  suffix: string,
  street: string,
  lat: number,
  lng: number,
): Promise<RouteHouse[]> {
  const { error } = await supabase.rpc('upsert_route_houses', {
    p_route_code: routeCode,
    p_houses: [{ civicNo, suffix, street, lat, lng, unitCount: 1 }],
    p_source: 'manual',
  });
  if (error) throw error;
  return fetchRouteHouses([routeCode]);
}

// ---------------------------------------------------------------------------
// STREET SEGMENT — load houses along a road that isn't part of the route
// ---------------------------------------------------------------------------
/** The street the worker tapped: every visible piece of road with that name.
 *  Each piece is a run of [lng, lat] points. */
export interface StreetSegmentPick {
  name: string;
  lines: [number, number][][];
}

const SEGMENT_PAD_DEG = 0.0009; // ~100 m around the tapped stretch

function segmentBbox(lines: [number, number][][], padDeg = SEGMENT_PAD_DEG) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const line of lines) for (const c of line) {
    if (c[0] < minLng) minLng = c[0];
    if (c[0] > maxLng) maxLng = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  if (!isFinite(minLng)) return null;
  return { s: minLat - padDeg, w: minLng - padDeg, n: maxLat + padDeg, e: maxLng + padDeg };
}

function pointToLinesMeters(lng: number, lat: number, lines: [number, number][][]): number {
  let best = Infinity;
  for (const coords of lines) {
    for (let i = 0; i < coords.length - 1; i++) {
      const d = pointToSegmentMeters(lng, lat, coords[i], coords[i + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Pulls every OpenStreetMap address along the tapped stretch of road (within
 * ROUTE_MATCH_METERS of the line, on that street), skips anything already on
 * the worker's map, and saves the rest under the worker's route so they
 * behave like any other house (dispositions, sales, go-backs all stick).
 * Building outlines are attached where OSM has them.
 *
 * Returns the route's refreshed house list and how many were added.
 */
export async function loadSegmentHouses(
  routeCode: string,
  seg: StreetSegmentPick,
  existing: RouteHouse[],
  onProgress?: HouseBuildProgress,
): Promise<{ houses: RouteHouse[]; added: number }> {
  const bbox = segmentBbox(seg.lines);
  if (!bbox || !seg.lines.some(l => l.length >= 2)) return { houses: existing.filter(h => h.routeCode === routeCode), added: 0 };

  onProgress?.(`Fetching houses on ${seg.name} from OpenStreetMap…`);
  const elements = await fetchOverpass(bbox);
  const { addresses, buildings } = extractOsm(elements);
  const segNorm = normStreet(seg.name);

  const byKey = new Map<string, { civicNo: number; suffix: string; street: string; lat: number; lng: number; unitCount: number }>();
  for (const a of addresses) {
    if (pointToLinesMeters(a.lng, a.lat, seg.lines) > ROUTE_MATCH_METERS) continue;
    // Keep addresses on this street. OSM points with no street tag are
    // assumed to be on the road they sit beside.
    const street = a.street || seg.name;
    const sn = normStreet(street);
    if (!sn || sn !== segNorm) continue;
    const dup = existing.some(h => metersBetween(a.lng, a.lat, h.lng, h.lat) <= DEDUPE_METERS
      || (h.civicNo === a.civicNo && h.streetNorm === sn));
    if (dup) continue;
    const key = houseKeyFromParts(a.civicNo, a.suffix, sn);
    const prev = byKey.get(key);
    if (prev) { prev.unitCount += 1; continue; }
    byKey.set(key, { civicNo: a.civicNo, suffix: a.suffix, street, lat: a.lat, lng: a.lng, unitCount: 1 });
  }
  const candidates = [...byKey.values()];
  if (!candidates.length) return { houses: existing.filter(h => h.routeCode === routeCode), added: 0 };

  onProgress?.(`Saving ${candidates.length} houses on ${seg.name}…`);
  const { error } = await supabase.rpc('upsert_route_houses', {
    p_route_code: routeCode,
    p_houses: candidates,
    p_source: 'manual',
  });
  if (error) throw error;
  let houses = await fetchRouteHouses([routeCode]);

  // Footprints for the new houses only.
  const newKeys = new Set(byKey.keys());
  const items: Array<{ houseKey: string; footprint: GeoJSON.Polygon }> = [];
  for (const h of houses) {
    if (h.footprint || !newKeys.has(h.houseKey)) continue;
    const fp = footprintForPoint(h.lng, h.lat, buildings);
    if (fp) items.push({ houseKey: h.houseKey, footprint: fp });
  }
  if (items.length) {
    const { error: fpErr } = await supabase.rpc('set_route_house_footprints', { p_route_code: routeCode, p_items: items });
    if (fpErr) console.warn('[mapLogsheet] segment footprints failed', fpErr);
    else houses = await fetchRouteHouses([routeCode]);
  }
  return { houses, added: candidates.length };
}

// ---------------------------------------------------------------------------
// DISPOSITIONS
// ---------------------------------------------------------------------------
function mapDisposition(r: any): HouseDisposition {
  return {
    routeCode: r.route_code,
    houseKey: r.house_key,
    status: r.status,
    note: r.note ?? null,
    firstName: r.first_name ?? null,
    workerId: r.worker_id ?? null,
    sessionId: r.session_id ?? null,
    updatedAt: r.updated_at,
  };
}

/** Map of routeHouseId → disposition for the given routes. */
export async function fetchDispositions(routeCodes: string[]): Promise<Map<string, HouseDisposition>> {
  const m = new Map<string, HouseDisposition>();
  if (!routeCodes.length) return m;
  const { data, error } = await supabase
    .from('house_dispositions')
    .select('*')
    .in('route_code', routeCodes);
  if (error) throw error;
  (data || []).forEach(r => {
    const d = mapDisposition(r);
    m.set(routeHouseId(d.routeCode, d.houseKey), d);
  });
  return m;
}

export async function setDisposition(input: {
  routeCode: string;
  houseKey: string;
  status: HouseDispositionStatus;
  note?: string | null;
  firstName?: string | null;
  commandCenterId?: string | null;
  workerId: string;
  sessionId?: string | null;
}): Promise<HouseDisposition> {
  const row = {
    route_code: input.routeCode,
    house_key: input.houseKey,
    status: input.status,
    note: input.note?.trim() ? input.note.trim() : null,
    first_name: input.firstName?.trim() ? input.firstName.trim() : null,
    command_center_id: input.commandCenterId ?? null,
    worker_id: input.workerId,
    session_id: input.sessionId ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('house_dispositions')
    .upsert(row, { onConflict: 'route_code,house_key' })
    .select()
    .single();
  if (error) throw error;
  return mapDisposition(data);
}

export async function clearDisposition(routeCode: string, houseKey: string): Promise<void> {
  const { error } = await supabase
    .from('house_dispositions')
    .delete()
    .eq('route_code', routeCode)
    .eq('house_key', houseKey);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// INDEXES — turn logsheet data into house-key lookups
// ---------------------------------------------------------------------------
/** A row with a house number but no street can't be keyed. If exactly one
 *  house on that route has that number, use it (a NewJob edit once wiped the
 *  street on resumed pending sales; this keeps those rows on the map). */
function streetlessHouseKey(routeCode: string, houseNumber: string | undefined, houses: RouteHouse[]): string | null {
  const civ = parseCivic(houseNumber);
  if (!civ || !routeCode) return null;
  const matches = houses.filter(h => h.routeCode === routeCode && h.civicNo === civ.civicNo && (h.civicSuffix || '').toLowerCase() === civ.suffix);
  return matches.length === 1 ? matches[0].houseKey : null;
}

export function indexPendingSales(sales: PendingSale[], houses: RouteHouse[] = []): Map<string, PendingSale> {
  const m = new Map<string, PendingSale>();
  for (const ps of sales) {
    // Asphalt children share the parent's address; the parent is what we open.
    if (ps.saleType === 'asphalt' && ps.parentId) continue;
    const rc = ps.routeCode || '';
    const key = houseKeyFromAddress(ps.houseNumber, ps.streetName)
      || (!ps.streetName?.trim() ? streetlessHouseKey(rc, ps.houseNumber, houses) : null);
    if (!key) continue;
    if (!m.has(routeHouseId(rc, key))) m.set(routeHouseId(rc, key), ps);
  }
  return m;
}

export function indexBookings(jobs: MasterBooking[], houses: RouteHouse[] = []): { pending: Map<string, MasterBooking>; completed: Map<string, MasterBooking> } {
  const pending = new Map<string, MasterBooking>();
  const completed = new Map<string, MasterBooking>();
  for (const b of jobs) {
    const rc = b['Route Number'] || '';
    const full = (b['Full Address'] || '').trim();
    // "42" alone (street lost) → match by number within the route.
    const key = houseKeyFromFullAddress(full)
      || (/^\d+[a-zA-Z]?$/.test(full) ? streetlessHouseKey(rc, full, houses) : null);
    if (!key) continue;
    const id = routeHouseId(rc, key);
    const isDone = b.Completed === 'x' || b.Status === 'completed';
    if (isDone) { if (!completed.has(id)) completed.set(id, b); }
    else if (!b.Status || b.Status === 'pending') { if (!pending.has(id)) pending.set(id, b); }
  }
  return { pending, completed };
}

/** This CC's Load Historical rows for the given routes (route_historical_properties). */
export async function fetchHistoricalForRoutes(commandCenterId: string, routeCodes: string[]): Promise<HistoricalProperty[]> {
  if (!commandCenterId || !routeCodes.length) return [];
  const { data, error } = await supabase
    .from('route_historical_properties')
    .select('*')
    .eq('command_center_id', commandCenterId)
    .in('route_code', routeCodes);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    routeCode: r.route_code,
    address: r.address,
    customerName: r.customer_name || undefined,
    phone: r.phone || undefined,
    email: r.email || undefined,
    clientType: r.client_type || undefined,
    propertyType: r.property_type || undefined,
    notes: r.notes || undefined,
    price: r.price || undefined,
    paymentType: r.payment_type || undefined,
    contractorName: r.contractor_name || undefined,
  }));
}

/** routeHouseId → every historical row at that house. */
export function indexHistorical(rows: HistoricalProperty[]): Map<string, HistoricalProperty[]> {
  const m = new Map<string, HistoricalProperty[]>();
  for (const h of rows) {
    const key = houseKeyFromFullAddress(h.address);
    if (!key || !h.routeCode) continue;
    const id = routeHouseId(h.routeCode, key);
    const list = m.get(id);
    if (list) list.push(h); else m.set(id, [h]);
  }
  return m;
}

/** "$450" → 450; "450.00" → 450; junk → 0. */
export function historicalPriceNumber(raw: string | undefined | null): number {
  const n = parseFloat((raw || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** What the map and the house sheet show for a historical house: the most
 *  recent name (last row wins), every price received, and their sum. */
export function historicalSummary(rows: HistoricalProperty[]): { name: string; shortName: string; prices: string[]; total: number } {
  const named = [...rows].reverse().find(r => r.customerName);
  const name = named?.customerName || '';
  const parts = name.split(/\s+/).filter(Boolean);
  const short = parts.length ? shortName(parts[0], parts.length > 1 ? parts[parts.length - 1] : null) : '';
  const prices = rows.map(r => (r.price || '').trim()).filter(Boolean).map(p => (p.startsWith('$') ? p : `$${p}`));
  const total = rows.reduce((sum, r) => sum + historicalPriceNumber(r.price), 0);
  return { name, shortName: short, prices, total };
}

export function indexPcl(pclByRoute: Map<string, PCLClientGroup[]>): Map<string, PCLClientGroup> {
  const m = new Map<string, PCLClientGroup>();
  pclByRoute.forEach((clients, rc) => {
    for (const c of clients) {
      const key = houseKeyFromAddress(c.houseNum, c.streetName);
      if (!key) continue;
      const id = routeHouseId(rc, key);
      if (!m.has(id)) m.set(id, c);
    }
  });
  return m;
}

/** "John M" — first name plus last initial. Empty string when there's no name. */
export function shortName(first: string | undefined | null, last: string | undefined | null): string {
  const f = (first || '').trim();
  const l = (last || '').trim().charAt(0).toUpperCase();
  return [f, l].filter(Boolean).join(' ');
}

/** "(24, 25)" — two-digit years of service oldest→newest. Empty when none. */
export function pclYearsLine(p: PCLClientGroup): string {
  const years = Array.from(new Set(
    (p.history || []).map(h => Number(h.year)).filter(y => Number.isFinite(y) && y > 0)
  )).sort((a, b) => a - b).map(y => String(y).slice(-2));
  return years.length ? `(${years.join(', ')})` : '';
}

/** "John M" on one line, "(24, 25)" on the next. Either line is dropped if empty. */
export function pclMapLabel(p: PCLClientGroup): string | null {
  const lines = [shortName(p.firstName, p.lastName), pclYearsLine(p)].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/** Customer name attached to a sale at this house, if any. Pending sales
 *  carry first/last; bookings and completed transactions carry the sheet-shaped
 *  'First Name' / 'Last Name' keys. */
function saleShortName(ps: PendingSale | null, ob: MasterBooking | null, done: MasterBooking | null): string {
  if (done) { const n = shortName(done['First Name'], done['Last Name']); if (n) return n; }
  if (ps) { const n = shortName(ps.firstName, ps.lastName); if (n) return n; }
  if (ob) { const n = shortName(ob['First Name'], ob['Last Name']); if (n) return n; }
  return '';
}

/** Combine everything into the per-house view the map renders. */
export function buildHouseViews(
  houses: RouteHouse[],
  dispositions: Map<string, HouseDisposition>,
  pendingSales: Map<string, PendingSale>,
  officePending: Map<string, MasterBooking>,
  completed: Map<string, MasterBooking>,
  pcl: Map<string, PCLClientGroup>,
  historical: Map<string, HistoricalProperty[]> = new Map(),
): HouseView[] {
  return houses.map(h => {
    const id = routeHouseId(h.routeCode, h.houseKey);
    const d = dispositions.get(id) || null;
    const ps = pendingSales.get(id) || null;
    const ob = officePending.get(id) || null;
    const done = completed.get(id) || null;
    const p = pcl.get(id) || null;
    const hist = historical.get(id) || [];
    const hs = hist.length ? historicalSummary(hist) : null;
    let state: HouseVisualState = 'none';
    if (done) state = 'completed';
    else if (ps || ob) state = 'pending';
    else if (d) state = d.status;
    const pclName = p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || null : null;
    // Name line: the sale's customer for pending/completed houses, else the
    // name jotted on the disposition, else the PCL name. Years line: from PCL
    // history when present.
    // Historical (previously serviced) outranks the disposition name and PCL.
    const dispoName = d?.firstName ? shortName(d.firstName, null) : '';
    const histName = hs?.shortName || '';
    const nameLine = (state === 'pending' || state === 'completed')
      ? (saleShortName(ps, ob, done) || histName || dispoName || (p ? shortName(p.firstName, p.lastName) : ''))
      : (histName || dispoName || (p ? shortName(p.firstName, p.lastName) : ''));
    // Second line: every price the house has paid (historical), else PCL years.
    const yearsLine = hs && hs.prices.length ? hs.prices.join(' + ') : (p ? pclYearsLine(p) : '');
    const mapLines = [nameLine, yearsLine].filter(Boolean);
    return {
      house: h,
      state,
      isPcl: !!p,
      pclName,
      pclLabel: p ? pclMapLabel(p) : null,
      mapLabel: mapLines.length ? mapLines.join('\n') : null,
      pcl: p,
      disposition: d,
      pendingSale: ps,
      officeBooking: ob,
      completed: done,
      historical: hist,
      isHistorical: hist.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// REALTIME — pending sales aren't covered by subscribeAsContractor
// ---------------------------------------------------------------------------
export function subscribeToPendingSales(commandCenterId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`ml-pending-${commandCenterId}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pending_sales', filter: `command_center_id=eq.${commandCenterId}` },
      () => onChange(),
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeToDispositions(routeCodes: string[], onChange: () => void): () => void {
  if (!routeCodes.length) return () => {};
  const channel = supabase
    .channel(`ml-dispo-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'house_dispositions' },
      (payload: any) => {
        const rc = payload?.new?.route_code || payload?.old?.route_code;
        if (!rc || routeCodes.includes(rc)) onChange();
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
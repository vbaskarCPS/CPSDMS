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
import { Worker, MasterBooking, PendingSale } from '../types';
import { PCLClientGroup } from './pclCacheService';

// ---------------------------------------------------------------------------
// GATE
// ---------------------------------------------------------------------------
export const H01_CONTRACTOR_ID = 'H01';
export const MAP_LOGSHEET_PATH = '/map-logsheet';

export function isH01(worker: { contractorId?: string } | null | undefined): boolean {
  return !!worker?.contractorId && worker.contractorId.trim().toUpperCase() === H01_CONTRACTOR_ID;
}

/** Where a freshly authenticated worker should land. H01 → the map page
 *  (which itself falls back to /logsheet if it can't run); everyone else →
 *  the ordinary logsheet. */
export function workerLandingPath(worker: Worker | null | undefined): string {
  return isH01(worker) ? MAP_LOGSHEET_PATH : '/logsheet';
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
} as const;

export function houseColor(v: Pick<HouseView, 'state' | 'isPcl'>): string {
  if (v.state === 'completed') return HOUSE_COLORS.completed;
  if (v.state === 'pending') return HOUSE_COLORS.pending;
  if (v.state === 'no') return HOUSE_COLORS.no;
  if (v.state === 'go_back') return HOUSE_COLORS.go_back;
  if (v.state === 'invalid') return HOUSE_COLORS.invalid;
  if (v.state === 'not_home') return v.isPcl ? HOUSE_COLORS.pclNotHome : HOUSE_COLORS.not_home;
  return v.isPcl ? HOUSE_COLORS.pcl : HOUSE_COLORS.none;
}

export const routeHouseId = (routeCode: string, houseKey: string) => `${routeCode}::${houseKey}`;

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
// DISPOSITIONS
// ---------------------------------------------------------------------------
function mapDisposition(r: any): HouseDisposition {
  return {
    routeCode: r.route_code,
    houseKey: r.house_key,
    status: r.status,
    note: r.note ?? null,
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
  commandCenterId?: string | null;
  workerId: string;
  sessionId?: string | null;
}): Promise<HouseDisposition> {
  const row = {
    route_code: input.routeCode,
    house_key: input.houseKey,
    status: input.status,
    note: input.note?.trim() ? input.note.trim() : null,
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
export function indexPendingSales(sales: PendingSale[]): Map<string, PendingSale> {
  const m = new Map<string, PendingSale>();
  for (const ps of sales) {
    // Asphalt children share the parent's address; the parent is what we open.
    if (ps.saleType === 'asphalt' && ps.parentId) continue;
    const key = houseKeyFromAddress(ps.houseNumber, ps.streetName);
    if (!key) continue;
    const rc = ps.routeCode || '';
    if (!m.has(routeHouseId(rc, key))) m.set(routeHouseId(rc, key), ps);
  }
  return m;
}

export function indexBookings(jobs: MasterBooking[]): { pending: Map<string, MasterBooking>; completed: Map<string, MasterBooking> } {
  const pending = new Map<string, MasterBooking>();
  const completed = new Map<string, MasterBooking>();
  for (const b of jobs) {
    const key = houseKeyFromFullAddress(b['Full Address']);
    if (!key) continue;
    const rc = b['Route Number'] || '';
    const id = routeHouseId(rc, key);
    const isDone = b.Completed === 'x' || b.Status === 'completed';
    if (isDone) { if (!completed.has(id)) completed.set(id, b); }
    else if (!b.Status || b.Status === 'pending') { if (!pending.has(id)) pending.set(id, b); }
  }
  return { pending, completed };
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
): HouseView[] {
  return houses.map(h => {
    const id = routeHouseId(h.routeCode, h.houseKey);
    const d = dispositions.get(id) || null;
    const ps = pendingSales.get(id) || null;
    const ob = officePending.get(id) || null;
    const done = completed.get(id) || null;
    const p = pcl.get(id) || null;
    let state: HouseVisualState = 'none';
    if (done) state = 'completed';
    else if (ps || ob) state = 'pending';
    else if (d) state = d.status;
    const pclName = p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || null : null;
    // Name line: the sale's customer for pending/completed houses, else the PCL
    // name. Years line: from PCL history when present.
    const nameLine = (state === 'pending' || state === 'completed')
      ? (saleShortName(ps, ob, done) || (p ? shortName(p.firstName, p.lastName) : ''))
      : (p ? shortName(p.firstName, p.lastName) : '');
    const yearsLine = p ? pclYearsLine(p) : '';
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
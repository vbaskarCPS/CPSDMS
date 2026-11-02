// src/v2/lib/msSplit.ts — split a city's main roads between N reps. Each road piece (an OpenStreetMap way) is
// ordered along a Hilbert curve through the city (pieces close on the map stay close in the order), then the
// order is cut into N runs of about equal length. Database: 20261246200000_mainstreet_split_by_reps.sql.
import { db, must } from './client';

export interface RoadPiece { id: number; name: string | null; m: number; coords: [number, number][] }
export interface Share { pieces: RoadPiece[]; m: number; name: string; roads: string[] }

export const SHARE_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#db2777', '#059669', '#dc2626', '#0891b2', '#65a30d', '#9333ea', '#ea580c', '#0d9488', '#4f46e5'];

/** Distance along a Hilbert curve of order `n` (2^n × 2^n cells) for cell (x, y). */
export function hilbert(n: number, x: number, y: number): number {
  let d = 0;
  for (let s = (1 << n) >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
  }
  return d;
}

const mid = (c: [number, number][]): [number, number] => c[Math.floor(c.length / 2)] || c[0];

/** Split pieces into `n` shares of about equal length, each a compact run of roads. */
export function splitRoads(pieces: RoadPiece[], n: number): Share[] {
  const ps = pieces.filter(p => p.coords.length > 1 && p.m > 0);
  n = Math.max(1, Math.min(n, ps.length || 1));
  if (!ps.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ps) { const [x, y] = mid(p.coords); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const span = Math.max(maxX - minX, maxY - minY) || 1, N = 10, cells = (1 << N) - 1;
  const ordered = ps.map(p => {
    const [x, y] = mid(p.coords);
    return { p, h: hilbert(N, Math.round(((x - minX) / span) * cells), Math.round(((y - minY) / span) * cells)) };
  }).sort((a, b) => a.h - b.h).map(o => o.p);
  const total = ordered.reduce((s, p) => s + p.m, 0);
  const shares: RoadPiece[][] = Array.from({ length: n }, () => []);
  let acc = 0;
  for (const p of ordered) {
    // the piece goes to the share its middle falls in
    const k = Math.min(n - 1, Math.floor(((acc + p.m / 2) / total) * n));
    shares[k].push(p); acc += p.m;
  }
  return shares.filter(s => s.length).map(s => {
    const byName = new Map<string, number>();
    for (const p of s) if (p.name) byName.set(p.name, (byName.get(p.name) || 0) + p.m);
    const roads = [...byName.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { pieces: s, m: s.reduce((t, p) => t + p.m, 0), roads, name: shareName(roads) };
  });
}

/** "Trafalgar Rd & Dundas St E" from the share's longest roads. */
export function shareName(roads: string[]): string {
  const short = (r: string) => r.replace(/\bRoad\b/g, 'Rd').replace(/\bStreet\b/g, 'St').replace(/\bAvenue\b/g, 'Ave').replace(/\bBoulevard\b/g, 'Blvd')
    .replace(/\bDrive\b/g, 'Dr').replace(/\bEast\b/g, 'E').replace(/\bWest\b/g, 'W').replace(/\bNorth\b/g, 'N').replace(/\bSouth\b/g, 'S');
  const top = roads.slice(0, 2).map(short);
  return top.length ? top.join(' & ') : 'Main roads';
}

export const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

// ───────────── the database ─────────────
export interface CityRoads { city: { id: string; name: string; boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null; status: string }; zones: number; pieces: RoadPiece[] }
export async function cityRoads(city: string): Promise<CityRoads> {
  const r = must(await db.rpc('ms_city_road_pieces', { p_city: city })) as { city: CityRoads['city']; zones: number; pieces: [number, string | null, number, [number, number][]][] };
  return { city: r.city, zones: r.zones, pieces: (r.pieces || []).map(([id, name, m, coords]) => ({ id, name, m, coords })) };
}
export async function createRoadZones(city: string, campaign: string, shares: { name: string; rep_id: string | null; pieces: number[] }[], replace: boolean): Promise<number> {
  return (must(await db.rpc('ms_create_road_zones', { p_city: city, p_campaign: campaign, p_shares: shares, p_replace: replace })) as { zones: number }).zones;
}
export interface RoadZone { id: string; name: string; km: number; rep: string | null; rep_id: string | null; businesses: number }
export async function roadZones(city: string): Promise<RoadZone[]> { return (must(await db.rpc('ms_road_zones', { p_city: city })) as RoadZone[]) || []; }
export interface Walked { total_m: number; walked_m: number; roads: GeoJSON.FeatureCollection['features'] }
export async function zoneWalked(zone: string, rep?: string | null): Promise<Walked> {
  return must(await db.rpc('ms_zone_walked', { p_zone: zone, p_rep: rep || null })) as Walked;
}

/** The shares as map lines, coloured. */
export function sharesGeo(shares: Share[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: shares.flatMap((s, i) => s.pieces.map(p => ({
    type: 'Feature' as const, properties: { color: SHARE_COLORS[i % SHARE_COLORS.length], share: i },
    geometry: { type: 'LineString' as const, coordinates: p.coords } }))) };
}

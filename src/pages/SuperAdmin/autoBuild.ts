// src/pages/SuperAdmin/autoBuild.ts — Map Builder › Auto-build: gathers what the route cutter (src/lib/autoRoutes.ts)
// needs for one master map, then runs it.
//   streets   the published street tiles (with each road's class), else the roads the builder has loaded
//   main      main roads and highways from the published main-road tiles (the class, when the street tiles have it)
//   exclude   commercial, industrial and retail land from the same tiles
//   taken     the streets of every master map whose outline comes near (a street is never on two maps)
//   neighbours  the other maps' outlines (saved ones, and the ones their routes make), for who owns an edge road
//   homes     every civic address around (BC's address register, published as tiles): which stretches have houses
import { autoRoutes, type AutoHome, type AutoResult, type AutoWay, type LngLat, type MainKind } from '../../lib/autoRoutes';
import { fetchLines, fetchPlazas } from '../../v2/lib/msCity';
import { supabase } from '../../lib/supabase';
import type { Outlines } from '../../lib/mapOutlines';

const OSM_DATA = 'https://raw.githubusercontent.com/vbaskarCPS/CPSDMS/osm-data';
const ST_TILE = 0.1;
const HOMES_DATA = 'https://raw.githubusercontent.com/vbaskarCPS/CPSDMS/homes-data/homes';
const HOME_TILE = 0.05;
interface Box { s: number; w: number; n: number; e: number }

export const outlineBox = (ring: LngLat[], pad = 0): Box => {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  return { s: Math.min(...ys) - pad, w: Math.min(...xs) - pad * 1.5, n: Math.max(...ys) + pad, e: Math.max(...xs) + pad * 1.5 };
};
const overlaps = (a: Box, b: Box) => !(a.e < b.w || a.w > b.e || a.n < b.s || a.s > b.n);
const touches = (g: LngLat[], b: Box) => g.some(([x, y]) => x >= b.w && x <= b.e && y >= b.s && y <= b.n);

/** Streets in a box from the published tiles, with their class; null when the tiles can't be reached. */
export async function streetsFromTiles(b: Box): Promise<AutoWay[] | null> {
  try {
    const idx = await fetch(`${OSM_DATA}/index.json`).then(r => (r.ok ? r.json() : null)) as { streets?: string[] } | null;
    if (!idx?.streets) return null;
    const have = new Set(idx.streets);
    const keys: string[] = [];
    for (let i = Math.floor(b.s / ST_TILE + 1e-9); i <= Math.floor(b.n / ST_TILE + 1e-9); i++)
      for (let j = Math.floor(b.w / ST_TILE + 1e-9); j <= Math.floor(b.e / ST_TILE + 1e-9); j++) if (have.has(`${i}_${j}`)) keys.push(`${i}_${j}`);
    if (!keys.length) return null;
    const ways = new Map<number, AutoWay>();
    await Promise.all(keys.map(async k => {
      const r = await fetch(`${OSM_DATA}/streets/${k}.json`);
      if (!r.ok) throw new Error(`streets ${k}: ${r.status}`);
      for (const w of await r.json() as { id: number; name: string; unnamed?: boolean; h?: string; g: LngLat[] }[])
        if (!ways.has(w.id) && touches(w.g, b)) ways.set(w.id, { id: w.id, name: w.name, unnamed: w.unnamed, kind: w.h, geometry: w.g });
    }));
    return [...ways.values()];
  } catch { return null; }
}

/** The civic addresses in a box (BC only for now); null when there are none for it or they can't be reached. */
export async function homesFromTiles(b: Box): Promise<AutoHome[] | null> {
  try {
    const idx = await fetch(`${HOMES_DATA}/index.json`).then(r => (r.ok ? r.json() : null)) as { tiles?: string[] } | null;
    if (!idx?.tiles) return null;
    const have = new Set(idx.tiles);
    const keys: string[] = [];
    for (let i = Math.floor(b.s / HOME_TILE + 1e-9); i <= Math.floor(b.n / HOME_TILE + 1e-9); i++)
      for (let j = Math.floor(b.w / HOME_TILE + 1e-9); j <= Math.floor(b.e / HOME_TILE + 1e-9); j++) if (have.has(`${i}_${j}`)) keys.push(`${i}_${j}`);
    if (!keys.length) return null;
    const out: AutoHome[] = [];
    await Promise.all(keys.map(async k => {
      const r = await fetch(`${HOMES_DATA}/${k}.json`);
      if (!r.ok) throw new Error(`homes ${k}: ${r.status}`);
      const t = await r.json() as { streets: string[]; h: [number, number, number, number, number][] };
      for (const [lng, lat, si, , units] of t.h)
        if (lng >= b.w && lng <= b.e && lat >= b.s && lat <= b.n) out.push({ at: [lng, lat], street: t.streets[si], units });
    }));
    return out;
  } catch { return null; }
}

/** The civic addresses in a box straight from BC's address register (when the tiles don't cover it yet). The register
 *  gives at most 500 a call, so a full box is split in four. */
export async function homesFromGeocoder(b: Box): Promise<AutoHome[] | null> {
  const civic = new Map<string, AutoHome>();
  const one = async (s: number, w: number, n: number, e: number, depth: number): Promise<void> => {
    const url = `https://geocoder.api.gov.bc.ca/sites/within.json?bbox=${w},${s},${e},${n}&maxResults=500&outputSRS=4326`;
    let f: { geometry: { coordinates: LngLat }; properties: Record<string, string | number | null> }[] = [];
    for (let k = 0; k < 4; k++) {
      try { const r = await fetch(url); if (r.ok) { f = (await r.json()).features || []; break; } } catch { /* try again */ }
      await new Promise(res => setTimeout(res, 400 * (k + 1)));
    }
    if (f.length >= 500 && depth < 12) {
      const my = (s + n) / 2, mx = (w + e) / 2;
      await Promise.all([one(s, w, my, mx, depth + 1), one(s, mx, my, e, depth + 1), one(my, w, n, mx, depth + 1), one(my, mx, n, e, depth + 1)]);
      return;
    }
    for (const x of f) {
      const p = x.properties;
      if (!p.civicNumber || !p.streetName) continue;
      const street = `${p.streetName}|${p.streetType || ''}|${p.streetDirection || ''}`;
      const k = `${street}|${p.civicNumber}|${p.civicNumberSuffix || ''}|${p.localityName || ''}`;
      const unit = p.unitNumber || p.unitDesignator ? 1 : 0;
      const h = civic.get(k);
      if (h) { h.units = (h.units || 0) + unit; if (!unit) h.at = x.geometry.coordinates; }
      else civic.set(k, { at: x.geometry.coordinates, street, units: unit });
    }
  };
  try {
    // a grid of about 1 km boxes, a few at a time
    const boxes: [number, number, number, number][] = [];
    for (let s = b.s; s < b.n; s += 0.01) for (let w = b.w; w < b.e; w += 0.015) boxes.push([s, w, Math.min(b.n, s + 0.01), Math.min(b.e, w + 0.015)]);
    for (let i = 0; i < boxes.length; i += 6) await Promise.all(boxes.slice(i, i + 6).map(x => one(...x, 0)));
    return civic.size ? [...civic.values()] : null;
  } catch { return null; }
}

/** The outer rings of a map outline (a Polygon or MultiPolygon). */
const rings = (g: GeoJSON.Geometry | undefined): LngLat[][] =>
  !g ? [] : g.type === 'Polygon' ? [g.coordinates[0] as LngLat[]] : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0] as LngLat[]) : [];

export interface AutoBuildArgs {
  areaName: string;
  outline: LngLat[];
  /** Every map's outline as the territory draws it (from its routes). */
  outlines?: Outlines | null;
  /** Other maps' saved outlines (area name → ring). */
  savedOutlines?: Map<string, LngLat[]>;
  /** The roads the builder has loaded: used when the street tiles can't be reached. */
  loadedWays?: AutoWay[];
  targetM?: number;
  onStep?: (msg: string) => void;
  /** Filling the gaps in a map that's already drawn: its own routes' street lines. They count as taken, and only
   *  streets within 250 m of them are looked at. */
  fillAround?: LngLat[][];
}
export interface AutoBuildResult extends AutoResult { source: 'tiles' | 'loaded'; nearbyMaps: string[] }

export async function autoBuild(a: AutoBuildArgs): Promise<AutoBuildResult> {
  const box = outlineBox(a.outline, 0.004);
  a.onStep?.('Reading the streets…');
  const tileWays = await streetsFromTiles(box);
  const ways = tileWays && tileWays.length ? tileWays : (a.loadedWays || []);
  if (!ways.length) throw new Error('No streets came back for this area — try again in a moment.');

  a.onStep?.('Finding the main roads, the commercial land and the houses…');
  const [lines, plazas, homes] = await Promise.all([fetchLines(box).catch(() => []), fetchPlazas(box).catch(() => []), homesFromTiles(outlineBox(a.outline, 0.005)).then(h => h || homesFromGeocoder(outlineBox(a.outline, 0.005)))]);
  const main = new Map<number, MainKind>();
  for (const l of lines) if (l.kind === 'arterial' || l.kind === 'highway') main.set(l.osm_id, l.kind);
  const exclude = plazas.filter(p => p.kind !== 'building').map(p => p.coordinates as LngLat[]);

  a.onStep?.('Checking the maps next door…');
  const near = new Map<string, LngLat[][]>();
  for (const [name, g] of Object.entries(a.outlines || {})) {
    if (name === a.areaName) continue;
    const rs = rings(g).filter(r => overlaps(outlineBox(r), box));
    if (rs.length) near.set(name, rs);
  }
  for (const [name, r] of a.savedOutlines || []) {
    if (name === a.areaName || r.length < 3 || !overlaps(outlineBox(r), box)) continue;
    near.set(name, [...(near.get(name) || []), r]);
  }
  const taken: LngLat[][] = [...(a.fillAround || [])];
  const nearbyMaps = [...near.keys()];
  if (nearbyMaps.length) {
    const { data, error } = await supabase.from('route_maps').select('segments').in('area_name', nearbyMaps);
    if (error) throw new Error('Couldn’t read the maps next door, so streets could end up on two maps. Try again.');
    for (const row of (data || []) as { segments: { coordinates: LngLat[] }[] | null }[])
      for (const s of row.segments || []) if (s.coordinates?.length >= 2 && touches(s.coordinates, box)) taken.push(s.coordinates);
  }

  a.onStep?.('Cutting the routes…');
  const r = autoRoutes({ ways, outline: a.outline, main, exclude, taken, neighbours: [...near.values()].flat(), targetM: a.targetM, homes: homes || undefined,
    near: a.fillAround ? { lines: a.fillAround, m: 250 } : undefined });
  return { ...r, source: tileWays && tileWays.length ? 'tiles' : 'loaded', nearbyMaps };
}

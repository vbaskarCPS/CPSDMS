// src/pages/SuperAdmin/autoBuild.ts — Map Builder › Auto-build: gathers what the route cutter (src/lib/autoRoutes.ts)
// needs for one master map, then runs it.
//   streets   the published street tiles (with each road's class), else the roads the builder has loaded
//   main      main roads and highways from the published main-road tiles (the class, when the street tiles have it)
//   exclude   commercial, industrial and retail land from the same tiles
//   taken     the streets of every master map whose outline comes near (a street is never on two maps)
//   neighbours  the other maps' outlines (saved ones, and the ones their routes make), for who owns an edge road
import { autoRoutes, type AutoResult, type AutoWay, type LngLat, type MainKind } from '../../lib/autoRoutes';
import { fetchLines, fetchPlazas } from '../../v2/lib/msCity';
import { supabase } from '../../lib/supabase';
import type { Outlines } from '../../lib/mapOutlines';

const OSM_DATA = 'https://raw.githubusercontent.com/vbaskarCPS/CPSDMS/osm-data';
const ST_TILE = 0.1;
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
}
export interface AutoBuildResult extends AutoResult { source: 'tiles' | 'loaded'; nearbyMaps: string[] }

export async function autoBuild(a: AutoBuildArgs): Promise<AutoBuildResult> {
  const box = outlineBox(a.outline, 0.004);
  a.onStep?.('Reading the streets…');
  const tileWays = await streetsFromTiles(box);
  const ways = tileWays && tileWays.length ? tileWays : (a.loadedWays || []);
  if (!ways.length) throw new Error('No streets came back for this area — try again in a moment.');

  a.onStep?.('Finding the main roads and the commercial land…');
  const [lines, plazas] = await Promise.all([fetchLines(box).catch(() => []), fetchPlazas(box).catch(() => [])]);
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
  const taken: LngLat[][] = [];
  const nearbyMaps = [...near.keys()];
  if (nearbyMaps.length) {
    const { data, error } = await supabase.from('route_maps').select('segments').in('area_name', nearbyMaps);
    if (error) throw new Error('Couldn’t read the maps next door, so streets could end up on two maps. Try again.');
    for (const row of (data || []) as { segments: { coordinates: LngLat[] }[] | null }[])
      for (const s of row.segments || []) if (s.coordinates?.length >= 2 && touches(s.coordinates, box)) taken.push(s.coordinates);
  }

  a.onStep?.('Cutting the routes…');
  const r = autoRoutes({ ways, outline: a.outline, main, exclude, taken, neighbours: [...near.values()].flat(), targetM: a.targetM });
  return { ...r, source: tileWays && tileWays.length ? 'tiles' : 'loaded', nearbyMaps };
}

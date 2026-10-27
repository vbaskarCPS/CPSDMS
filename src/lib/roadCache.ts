// src/lib/roadCache.ts — the map builder's roads, saved once and read back after (RUN_56).
//
// The free Overpass road servers are often overloaded, so the builder could take minutes and
// several presses of "Load" per area. The ground is cut into cells 0.02° on a side. Cells somebody
// already loaded come straight from our database; only the rest go to Overpass, and what comes back
// is saved for next time. If the cache can't be reached, the builder simply asks Overpass as before.

export const CELL = 0.02;
/** Past this many cells (a huge box), skip the cache and ask Overpass directly. */
export const MAX_CELLS = 400;

export interface CachedWay { id: number; name: string; unnamed?: boolean; geometry: [number, number][] }
export interface Box { s: number; w: number; n: number; e: number }

export const parseBbox = (bbox: string): Box => { const [s, w, n, e] = bbox.split(',').map(Number); return { s, w, n, e }; };
const idx = (v: number) => Math.floor(v / CELL + 1e-9);

/** The cells ("lat:lng" grid indexes) a box touches. */
export function cellsFor(b: Box): string[] {
  const out: string[] = [];
  for (let i = idx(b.s); i <= idx(b.n); i++) for (let j = idx(b.w); j <= idx(b.e); j++) out.push(`${i}:${j}`);
  return out;
}

/** The box that covers these cells exactly. */
export function cellsBox(cells: string[]): Box {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const c of cells) {
    const [i, j] = c.split(':').map(Number);
    s = Math.min(s, i * CELL); n = Math.max(n, (i + 1) * CELL);
    w = Math.min(w, j * CELL); e = Math.max(e, (j + 1) * CELL);
  }
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { s: r(s), w: r(w), n: r(n), e: r(e) };
}
export const boxString = (b: Box) => `${b.s},${b.w},${b.n},${b.e}`;

/** Both lists, each road once (the newer copy wins). */
export function mergeWays(a: CachedWay[], b: CachedWay[]): CachedWay[] {
  const m = new Map<number, CachedWay>();
  for (const w of a) m.set(w.id, w);
  for (const w of b) m.set(w.id, w);
  return [...m.values()];
}

export interface RoadCacheDeps {
  /** Overpass for a "s,w,n,e" box */
  overpass: (bbox: string) => Promise<CachedWay[]>;
  /** road_cache_get */
  get: (cells: string[], b: Box) => Promise<{ have: string[]; ways: { id: number; name: string; unnamed?: boolean; g: [number, number][] }[] }>;
  /** road_cache_put */
  put: (cells: string[] | null, ways: { id: number; name: string; unnamed: boolean; g: [number, number][] }[]) => Promise<unknown>;
  onSaveError?: (e: unknown) => void;
}

const BATCH = 1500;

/** Save roads in batches; the cells are marked loaded with the last batch only, so a failed save
 *  never leaves a cell marked loaded with roads missing. */
export async function saveWays(deps: RoadCacheDeps, cells: string[], ways: CachedWay[]): Promise<void> {
  const rows = ways.filter(w => w.geometry.length >= 2).map(w => ({ id: w.id, name: w.name || '', unnamed: !!w.unnamed, g: w.geometry }));
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const last = i + BATCH >= rows.length;
    await deps.put(last ? cells : null, rows.slice(i, i + BATCH));
  }
}

/** The roads for a box: saved ones, plus Overpass for any cells not loaded yet (then saved). */
export async function fetchRoadsCached(bbox: string, deps: RoadCacheDeps): Promise<CachedWay[]> {
  const box = parseBbox(bbox);
  const cells = cellsFor(box);
  if (cells.length > MAX_CELLS) return deps.overpass(bbox);

  let cached: CachedWay[] = [];
  let have = new Set<string>();
  try {
    const r = await deps.get(cells, box);
    have = new Set(r.have);
    cached = r.ways.map(w => ({ id: w.id, name: w.name || '', unnamed: !!w.unnamed, geometry: w.g }));
  } catch {
    return deps.overpass(bbox);   // cache unreachable: as before
  }
  const missing = cells.filter(c => !have.has(c));
  if (!missing.length) return cached;

  // fetch whole cells, so a cell is complete once saved
  const fresh = await deps.overpass(boxString(cellsBox(missing)));
  if (fresh.length) {
    saveWays(deps, missing, fresh).catch(e => deps.onSaveError?.(e));   // don't make the builder wait for the save
  }
  return mergeWays(cached, fresh);
}

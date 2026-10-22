// src/v2/lib/buildHouses.ts — Territory › Build houses: build every route of a master map ahead of
// time, the same way the worker's map does on a route's first opening (address register, then
// OpenStreetMap, then Mapbox rooftops, then empty streets), with a Mapbox-only fallback for a route
// OpenStreetMap has nothing for. Runs in the browser; each route is independent, so it can stop and
// pick up again.
import { supabase } from '../../lib/supabase';
import { ensureRouteHouses, fetchRouteMaps, fillRouteGaps, placeRouteOnRoofs } from '../../lib/mapLogsheetService';

export type RouteBuildState = 'ready' | 'unplaced' | 'empty';
export interface RouteBuildRow { route_code: string; route_number: number; houses: number; state: RouteBuildState; note: string | null }

/** ready: houses, on their rooftops · unplaced: houses not yet put on rooftops · empty: no houses. */
export function buildState(houses: number, build: { geocoded_at: string | null } | null): RouteBuildState {
  if (!houses) return 'empty';
  return build && !build.geocoded_at ? 'unplaced' : 'ready';
}

export async function mapRoutesStatus(area: string): Promise<RouteBuildRow[]> {
  const { data: maps, error } = await supabase.from('route_maps').select('route_code, route_number').eq('area_name', area).eq('status', 'approved').order('route_number');
  if (error) throw new Error(error.message);
  const codes = (maps || []).map(m => m.route_code as string);
  if (!codes.length) return [];
  const { data: builds } = await supabase.from('route_house_builds').select('route_code, geocoded_at, geocode_note').in('route_code', codes);
  const b = new Map((builds || []).map(x => [x.route_code as string, x as { geocoded_at: string | null; geocode_note: string | null }]));
  const out: RouteBuildRow[] = [];
  for (const m of maps || []) {
    const rc = m.route_code as string;
    const { count } = await supabase.from('route_houses').select('id', { count: 'exact', head: true }).eq('route_code', rc);
    out.push({ route_code: rc, route_number: m.route_number as number, houses: count || 0, state: buildState(count || 0, b.get(rc) || null), note: b.get(rc)?.geocode_note || null });
  }
  return out;
}

const houseCount = async (rc: string) =>
  (await supabase.from('route_houses').select('id', { count: 'exact', head: true }).eq('route_code', rc)).count || 0;

/** Build one route. Returns a line saying what happened. Never throws for an unreachable service. */
export async function buildRoute(routeCode: string, onProgress: (msg: string) => void): Promise<string> {
  const [rm] = await fetchRouteMaps([routeCode]);
  if (!rm) return 'not an approved route';
  const before = await houseCount(routeCode);
  // 1–4: the worker map's own first-opening build
  try { await ensureRouteHouses(rm, onProgress); } catch (e) { console.warn('[build] ensure failed', routeCode, e); }
  let n = await houseCount(routeCode);
  let how = 'OpenStreetMap';
  // OpenStreetMap had nothing (or didn't answer): find the houses along each street with Mapbox
  if (!n) {
    onProgress('OpenStreetMap had nothing for this route — asking Mapbox along each street…');
    await fillRouteGaps(rm, [], onProgress, { fromScratch: true, maxLookups: 5000 });
    n = await houseCount(routeCode);
    how = 'Mapbox';
  }
  // houses there but not yet on their rooftops
  if (n) { try { await placeRouteOnRoofs(routeCode, onProgress); } catch (e) { console.warn('[build] place failed', routeCode, e); } }
  if (!n) return 'no houses found (the address services had nothing or didn’t answer) — try again later';
  return before ? `${n} houses (had ${before}), placed on rooftops` : `${n} houses from ${how}, placed on rooftops`;
}

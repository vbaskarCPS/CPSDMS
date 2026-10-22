// src/pages/Demo/prepareMap.ts — the demo copies its houses from the real BRIDLEWOOD routes. Any of
// those not built yet (no houses, or houses not yet placed on their rooftops) are built here, once,
// by the first visitor to press Start: the same build the worker's map does when a route is first
// opened (OpenStreetMap, then Mapbox). After that they stay built, for every demo and every crew.
import { supabase } from '../../lib/supabase';
import { ensureRouteHouses, fetchRouteMaps } from '../../lib/mapLogsheetService';

export const DEMO_SOURCE_AREA = 'BRIDLEWOOD';

/** The real routes the demo still needs built: never built, or built but never placed on rooftops. */
export async function routesToBuild(): Promise<string[]> {
  const { data: maps, error } = await supabase.from('route_maps').select('route_code').eq('area_name', DEMO_SOURCE_AREA).eq('status', 'approved').order('route_number');
  if (error) throw new Error(error.message);
  const codes = (maps || []).map(m => m.route_code as string);
  if (!codes.length) return [];
  const { data: builds } = await supabase.from('route_house_builds').select('route_code, geocoded_at, house_count').in('route_code', codes);
  const byCode = new Map((builds || []).map(b => [b.route_code as string, b]));
  const need: string[] = [];
  for (const rc of codes) {
    const b = byCode.get(rc);
    if (!b) { need.push(rc); continue; }
    if (b.geocoded_at) continue;
    const { count } = await supabase.from('route_houses').select('id', { count: 'exact', head: true }).eq('route_code', rc);
    if ((count || 0) > 0) need.push(rc);   // houses there, not yet on their rooftops
  }
  return need;
}

/** Build them, one route at a time; a route that fails is left for next time. Returns how many were built. */
export async function prepareDemoMap(onProgress: (msg: string) => void): Promise<number> {
  const need = await routesToBuild();
  if (!need.length) return 0;
  const maps = await fetchRouteMaps(need);
  let done = 0;
  for (const [i, rm] of maps.entries()) {
    const head = `Preparing the demo map, first time only: route ${i + 1} of ${maps.length}`;
    onProgress(`${head}…`);
    try {
      await ensureRouteHouses(rm, msg => onProgress(`${head} · ${msg}`));
      done++;
    } catch (e) {
      console.warn('[demo] building', rm.route_code, 'failed — left for next time:', e);
    }
  }
  return done;
}

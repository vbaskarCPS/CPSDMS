// src/v2/lib/territory.ts — approved digital-map areas and which command center each belongs to.
import { db, must } from './client';

export interface RouteRow { area_name: string; route_number: number; route_code: string }
export interface Area { name: string; prefix: string; routes: RouteRow[]; first: number; last: number; centerId: string | null }

/** Bare letters of a route code: "GA01" → "GA". */
export const routePrefix = (code: string) => (code.match(/^[A-Za-z]+/)?.[0] || '').toUpperCase();

let cache: Promise<RouteRow[]> | null = null;

/** Every approved route (≈4,600). PostgREST returns at most 1,000 rows per request, so read in pages. */
export function allRoutes(): Promise<RouteRow[]> {
  if (!cache) {
    cache = (async () => {
      const out: RouteRow[] = [];
      for (let from = 0; ; from += 1000) {
        const page = must(await db.from('route_maps').select('area_name, route_number, route_code')
          .eq('status', 'approved').order('area_name').order('route_number').range(from, from + 999)) as RouteRow[];
        out.push(...page);
        if (page.length < 1000) break;
      }
      return out;
    })().catch(e => { cache = null; throw e; });
  }
  return cache;
}

export function groupAreas(routes: RouteRow[], assigned: Map<string, string>): Area[] {
  const by = new Map<string, RouteRow[]>();
  for (const r of routes) {
    if (!by.has(r.area_name)) by.set(r.area_name, []);
    by.get(r.area_name)!.push(r);
  }
  return [...by.entries()].map(([name, rs]) => {
    rs.sort((a, b) => a.route_number - b.route_number);
    return { name, prefix: routePrefix(rs[0].route_code), routes: rs, first: rs[0].route_number, last: rs[rs.length - 1].route_number, centerId: assigned.get(name) || null };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function listAssignments(): Promise<Map<string, string>> {
  const rows = must(await db.from('map_area_centers').select('area_name, center_id')) as { area_name: string; center_id: string }[];
  return new Map(rows.map(r => [r.area_name, r.center_id]));
}

export async function assignAreas(areaNames: string[], centerId: string | null): Promise<void> {
  if (!areaNames.length) return;
  if (centerId) must(await db.from('map_area_centers').upsert(areaNames.map(a => ({ area_name: a, center_id: centerId, assigned_at: new Date().toISOString() }))));
  else must(await db.from('map_area_centers').delete().in('area_name', areaNames));
}

/** Areas a center may use: its assigned ones. */
export async function centerAreas(centerId: string): Promise<Area[]> {
  const [routes, assigned] = await Promise.all([allRoutes(), listAssignments()]);
  return groupAreas(routes, assigned).filter(a => a.centerId === centerId);
}

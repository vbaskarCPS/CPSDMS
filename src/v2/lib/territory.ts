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

export interface RouteShape { code: string; area: string; number: number; lines: [number, number][][] }

/** Route lines for the given areas (for the Start session map). */
export async function routeShapes(areaNames: string[]): Promise<RouteShape[]> {
  if (!areaNames.length) return [];
  const out: RouteShape[] = [];
  for (let from = 0; ; from += 500) {
    const page = must(await db.from('route_maps').select('area_name, route_number, route_code, segments')
      .eq('status', 'approved').in('area_name', areaNames).order('route_code').range(from, from + 499)) as
      { area_name: string; route_number: number; route_code: string; segments: { coordinates: [number, number][] }[] | null }[];
    for (const r of page) {
      out.push({ code: r.route_code, area: r.area_name, number: r.route_number,
        lines: (r.segments || []).map(s => s.coordinates).filter(c => Array.isArray(c) && c.length > 1) });
    }
    if (page.length < 500) break;
  }
  return out;
}

/** Callbook clients (PCL) per route for the given areas: route code → count. */
export async function pclCounts(areaNames: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < areaNames.length; i += 40) {
    const rows = must(await db.from('map_pcl_cache').select('route_code, client_count').in('area_name', areaNames.slice(i, i + 40))) as
      { route_code: string; client_count: number | null }[];
    for (const r of rows) out.set(r.route_code, r.client_count || 0);
  }
  return out;
}

export interface PclDot { code: string; lat: number; lng: number }

/** Where one map's callbook clients are (coordinates only; names and phones are dropped here). */
export async function pclDots(areaName: string): Promise<PclDot[]> {
  const rows = must(await db.from('map_pcl_cache').select('route_code, clients').eq('area_name', areaName)) as
    { route_code: string; clients: { lat?: unknown; lng?: unknown }[] | null }[];
  const out: PclDot[] = [];
  for (const r of rows) for (const c of r.clients || []) {
    if (typeof c.lat === 'number' && typeof c.lng === 'number') out.push({ code: r.route_code, lat: c.lat, lng: c.lng });
  }
  return out;
}

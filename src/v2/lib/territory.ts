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

/** Forget the cached routes (after the map builder saved some). */
export function refreshRoutes(): void { cache = null; }

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

// ───────────── areas (the map builder's list: name, prefix, region, route numbers) ─────────────
export const REGIONS = ['West', 'Central', 'East'] as const;
export type Region = typeof REGIONS[number];
export interface AreaPrefix { area_name: string; prefix: string; region: Region; route_start: number; route_count: number; pdf_page?: number | null }
export interface AreaRow extends Area {
  region: Region | null;
  /** route numbers planned for the area (start … start + count − 1); drawn = approved routes */
  start: number; planned: number;
  hasPrefixRow: boolean;
}
export const routeCodeOf = (prefix: string, n: number) => `${prefix}${String(n).padStart(2, '0')}`;

export async function listAreaPrefixes(): Promise<AreaPrefix[]> {
  return must(await db.from('area_prefixes').select('area_name, prefix, region, route_start, route_count, pdf_page').order('area_name')) as AreaPrefix[];
}

/** Every area: the builder's list, with its approved routes and center (areas with routes but no list row too). */
export function mergeAreas(prefixes: AreaPrefix[], routes: RouteRow[], assigned: Map<string, string>): AreaRow[] {
  const drawn = new Map(groupAreas(routes, assigned).map(a => [a.name, a]));
  const out: AreaRow[] = prefixes.map(p => {
    const d = drawn.get(p.area_name);
    const start = p.route_start ?? 1;
    return {
      name: p.area_name, prefix: p.prefix || d?.prefix || '', region: (REGIONS as readonly string[]).includes(p.region) ? p.region : null,
      routes: d?.routes || [], first: d?.first ?? start, last: d?.last ?? start + Math.max(1, p.route_count) - 1,
      centerId: assigned.get(p.area_name) || null, start, planned: p.route_count || 0, hasPrefixRow: true,
    };
  });
  for (const d of drawn.values()) if (!prefixes.some(p => p.area_name === d.name)) {
    out.push({ ...d, region: null, start: d.first, planned: d.routes.length, hasPrefixRow: false });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Sets the East / West / Central designation (also on the area's cached client counts). */
export async function setRegion(areaNames: string[], region: Region): Promise<void> {
  if (!areaNames.length) return;
  must(await db.from('area_prefixes').update({ region }).in('area_name', areaNames));
  await db.from('map_pcl_cache').update({ region }).in('area_name', areaNames);   // best effort: display only
}

export interface AreaInput { name: string; prefix: string; region: Region; start: number; end: number }
export function areaProblems(a: AreaInput, others: AreaPrefix[], editing: string | null): string[] {
  const out: string[] = [];
  if (!a.name.trim()) out.push('Give the area a name.');
  if (!/^[A-Za-z]{1,6}$/.test(a.prefix.trim())) out.push('The prefix is 1–6 letters, e.g. GA.');
  if (!(a.start >= 1) || !(a.end >= a.start)) out.push('The last route number must be at or after the first.');
  const name = a.name.trim().toUpperCase();
  if (others.some(o => o.area_name.toUpperCase() === name && o.area_name !== editing)) out.push('There’s already an area with that name.');
  const prefix = a.prefix.trim().toUpperCase();
  const clash = others.find(o => o.area_name !== editing && o.prefix.toUpperCase() === prefix
    && a.start <= (o.route_start ?? 1) + o.route_count - 1 && (o.route_start ?? 1) <= a.end);
  if (clash) out.push(`${routeCodeOf(prefix, a.start)}–${routeCodeOf(prefix, a.end)} overlaps ${clash.area_name} (${routeCodeOf(prefix, clash.route_start ?? 1)}–${routeCodeOf(prefix, (clash.route_start ?? 1) + clash.route_count - 1)}).`);
  return out;
}

/** New area, or changes to one (a rename carries its drawn routes, center and client counts with it). */
export async function saveArea(a: AreaInput, editing: AreaPrefix | null): Promise<void> {
  const record = { area_name: a.name.trim(), prefix: a.prefix.trim().toUpperCase(), region: a.region,
    route_start: a.start, route_count: a.end - a.start + 1, pdf_page: editing?.pdf_page ?? 0 };
  if (editing && editing.area_name !== record.area_name) {
    const old = editing.area_name;
    must(await db.from('area_prefixes').insert(record));
    must(await db.from('route_maps').update({ area_name: record.area_name }).eq('area_name', old));
    must(await db.from('map_area_centers').update({ area_name: record.area_name }).eq('area_name', old));
    await db.from('map_pcl_cache').update({ area_name: record.area_name }).eq('area_name', old);
    must(await db.from('area_prefixes').delete().eq('area_name', old));
  } else {
    must(await db.from('area_prefixes').upsert(record, { onConflict: 'area_name' }));
  }
  if (editing && editing.region !== a.region) await db.from('map_pcl_cache').update({ region: a.region }).eq('area_name', record.area_name);
  refreshRoutes();
}

/** Deletes an area and its drawn routes (and its center assignment). */
export async function deleteArea(name: string): Promise<void> {
  must(await db.from('map_area_centers').delete().eq('area_name', name));
  must(await db.from('route_maps').delete().eq('area_name', name));
  must(await db.from('area_prefixes').delete().eq('area_name', name));
  refreshRoutes();
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

/** Past clients (PCL) per route for the given areas: route code → count, from the client database. */
export async function pclCounts(areaNames: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!areaNames.length) return out;
  const { data, error } = await db.rpc('app_area_pcl_counts', { p_areas: areaNames });
  if (!error) {
    for (const r of (data || []) as { route_code: string; n: number }[]) out.set(r.route_code, Number(r.n) || 0);
    return out;
  }
  if (!missingFn(error)) throw new Error(error.message);
  // before the SQL is run: the old builder's PCL cache
  for (let i = 0; i < areaNames.length; i += 40) {
    const rows = must(await db.from('map_pcl_cache').select('route_code, client_count').in('area_name', areaNames.slice(i, i + 40))) as
      { route_code: string; client_count: number | null }[];
    for (const r of rows) out.set(r.route_code, r.client_count || 0);
  }
  return out;
}

const missingFn = (e: { message?: string; code?: string }) => e.code === 'PGRST202' || /could not find the function|schema cache/i.test(e.message || '');

export interface PclDot { code: string; lat: number; lng: number }

/** Where one map's past clients are (route code and position only; no names, phones or addresses). */
export async function pclDots(areaName: string): Promise<PclDot[]> {
  const { data, error } = await db.rpc('app_area_pcl_dots', { p_area: areaName });
  if (!error) return ((data || []) as { route_code: string; lat: number; lng: number }[])
    .filter(r => typeof r.lat === 'number' && typeof r.lng === 'number').map(r => ({ code: r.route_code, lat: r.lat, lng: r.lng }));
  if (!missingFn(error)) throw new Error(error.message);
  const rows = must(await db.from('map_pcl_cache').select('route_code, clients').eq('area_name', areaName)) as
    { route_code: string; clients: { lat?: unknown; lng?: unknown }[] | null }[];
  const out: PclDot[] = [];
  for (const r of rows) for (const c of r.clients || []) {
    if (typeof c.lat === 'number' && typeof c.lng === 'number') out.push({ code: r.route_code, lat: c.lat, lng: c.lng });
  }
  return out;
}

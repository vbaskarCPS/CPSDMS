// src/lib/routeOverlap.ts — one street, one route (Map Builder).
//
// Two checks keep a street from being drawn into two routes:
//   • on this map (the tab holds every route of it): Save refuses while a road is on two of its approved routes;
//   • on the maps next door: the database leaves a newly added piece out when another map's approved route already
//     has it (route_maps_no_overlap, supabase/migrations/20261251150000_route_maps_no_overlap.sql), and says so in
//     route_overlap_trims. A route's own pieces from before are never left out, so saving again changes nothing.

export type LngLatPair = [number, number];
export interface WayLike { id: number; rootId?: number | null; name: string; geometry: LngLatPair[] }
export interface RouteLike { num: number; status: string; selectedWayIds: Set<number> }
/** A piece the database left out of a route: the key of the saved piece and the routes that already have it. */
export interface Trim { route_code: string; route_number: number; seg_key: string; street: string | null; meters: number | null; kept_by: string[] | null }

/** A street piece as Map Builder saves it (route_maps.segments). */
export interface SavedSeg { osmId: number | string; name?: string | null; coordinates: LngLatPair[] }

/** The database's key for a saved street piece (route_seg_key): its OpenStreetMap id, first and last point, point count. */
export function savedSegKey(s: SavedSeg): string {
  const g = s.coordinates || [];
  const a = g[0] || [], b = g[g.length - 1] || [];
  return `${s.osmId}|${a[0] ?? ''},${a[1] ?? ''}|${b[0] ?? ''},${b[1] ?? ''}|${g.length}`;
}

/** The key of the piece a road becomes when saved (its id, or the road it was split from). */
export function segKey(w: WayLike): string {
  return savedSegKey({ osmId: w.rootId ?? w.id, coordinates: w.geometry });
}

/** The pieces sent that didn't come back from the save: the ones the database left out. */
export function leftOut(routeCode: string, routeNumber: number, sent: SavedSeg[], saved: SavedSeg[] | null | undefined): Trim[] {
  const back = new Set((saved || []).map(savedSegKey));
  return sent.filter(s => !back.has(savedSegKey(s)))
    .map(s => ({ route_code: routeCode, route_number: routeNumber, seg_key: savedSegKey(s), street: s.name ?? null, meters: null, kept_by: null }));
}

/** Roads that two or more approved routes of this map both have (by road), with the routes' numbers. */
export function sharedWays<R extends RouteLike>(routes: R[], ways: WayLike[]): { wayId: number; name: string; nums: number[] }[] {
  const byWay = new Map<number, number[]>();
  for (const r of routes) {
    if (r.status !== 'approved') continue;
    for (const id of r.selectedWayIds) byWay.set(id, [...(byWay.get(id) || []), r.num]);
  }
  const name = new Map(ways.map(w => [w.id, w.name]));
  return [...byWay.entries()]
    .filter(([id, nums]) => nums.length > 1 && name.has(id))
    .map(([wayId, nums]) => ({ wayId, name: name.get(wayId) || 'an unnamed road', nums: [...nums].sort((x, y) => x - y) }));
}

/** "158 Street (routes 42 and 70)", the first few, for the message that stops the save. */
export function sharedLabel(shared: { name: string; nums: number[] }[], code: (n: number) => string, max = 4): string {
  const seen = new Map<string, Set<number>>();
  for (const s of shared) { const k = s.name; seen.set(k, new Set([...(seen.get(k) || []), ...s.nums])); }
  const parts = [...seen.entries()].map(([n, nums]) => {
    const list = [...nums].sort((x, y) => x - y).map(code);
    return `${n} (${list.slice(0, -1).join(', ')}${list.length > 2 ? ',' : ''} and ${list[list.length - 1]})`;
  });
  return parts.slice(0, max).join('; ') + (parts.length > max ? `; and ${parts.length - max} more` : '');
}

/** The routes as saved: each piece the database left out comes off its route here too, so the tab matches the map. */
export function withoutTrimmed<R extends RouteLike>(routes: R[], ways: WayLike[], trims: Trim[]): R[] {
  if (!trims.length) return routes;
  const out = new Map<number, Set<string>>();
  for (const t of trims) out.set(t.route_number, new Set([...(out.get(t.route_number) || []), t.seg_key]));
  const byId = new Map(ways.map(w => [w.id, w]));
  return routes.map(r => {
    const keys = out.get(r.num);
    if (!keys) return r;
    const ids = new Set([...r.selectedWayIds].filter(id => { const w = byId.get(id); return !w || !keys.has(segKey(w)); }));
    return ids.size === r.selectedWayIds.size ? r : { ...r, selectedWayIds: ids };
  });
}

/** "Left out 3 street pieces already on other maps: 158 Street (on NSR42), 95 Avenue (on NSR38)." or ''. */
export function trimsLabel(trims: Trim[], max = 5): string {
  if (!trims.length) return '';
  const byStreet = new Map<string, Set<string>>();
  for (const t of trims) {
    const k = (t.street || '').trim() || 'an unnamed road';
    byStreet.set(k, new Set([...(byStreet.get(k) || []), ...(t.kept_by || [])]));
  }
  const parts = [...byStreet.entries()].map(([s, by]) => (by.size ? `${s} (on ${[...by].sort().join(', ')})` : s));
  const n = trims.length;
  return `Left out ${n} street piece${n === 1 ? '' : 's'} already on other maps: ${parts.slice(0, max).join(', ')}`
    + `${parts.length > max ? ` and ${parts.length - max} more` : ''}. To move a street here, take it off the other map first.`;
}

// src/lib/tidyGaps.ts — Map Builder › Tidy: the streets Fill gaps added to a map, cut again in one go.
//
// Fill gaps runs one map at a time, and more than once, so its routes come out in bits: a second run's new route wraps
// around the first run's, or two routes take turns along one block. Tidy keeps the map's own routes (the ones drawn
// from the master map, or Auto-built) exactly as they are, takes every street the Gap fill routes have, and:
//   - splits them into the patches that touch each other (streets that share a corner);
//   - a small patch (a cul-de-sac, a block or two) that touches one of the map's own routes joins it;
//   - a bigger patch is cut into compact routes by the route cutter (src/lib/autoRoutes.ts), each in one piece;
//   - nothing is left out: every street that was on a Gap fill route ends up on a route.
import { autoRoutes, type LngLat } from './autoRoutes';

export interface TidyLine { id: number; name: string; geometry: LngLat[] }
export interface TidyIn {
  /** The map's own routes (not Gap fill): its number and its street lines. */
  originals: { num: number; lines: LngLat[][] }[];
  /** Every street piece on the map's Gap fill routes. */
  gaps: TidyLine[];
  /** Metres a route (the cutter's default when left out). */
  targetM?: number;
  /** A patch under this many metres that touches one of the map's own routes joins it (default 600). */
  joinM?: number;
}
export interface TidyPiece { wayId: number; name: string; geometry: LngLat[] }
/** joinTo: the own route a small patch joins; otherwise a route of its own. */
export interface TidyGroup { joinTo?: number; pieces: TidyPiece[]; lengthM: number; streets: string[] }

type XY = [number, number];
const segD = (p: XY, a: XY, b: XY) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

export function tidyGaps(input: TidyIn): TidyGroup[] {
  const gaps = input.gaps.filter(g => g.geometry.length >= 2);
  if (!gaps.length) return [];
  const JOIN = input.joinM ?? 600;
  const lat0 = gaps[0].geometry[0][1];
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xy = (p: LngLat): XY => [p[0] * kx, p[1] * ky];
  const len = (g: LngLat[]) => { let t = 0; for (let i = 1; i < g.length; i++) { const a = xy(g[i - 1]), b = xy(g[i]); t += Math.hypot(b[0] - a[0], b[1] - a[1]); } return t; };

  // the patches: pieces that share a point (a corner, or where one street ends on another)
  const key = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const parent = gaps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const at = new Map<string, number>();
  gaps.forEach((g, i) => { for (const p of g.geometry) { const k = key(p); const j = at.get(k); if (j == null) at.set(k, i); else parent[find(i)] = find(j); } });
  const patches = new Map<number, number[]>();
  gaps.forEach((_, i) => { const r = find(i); const l = patches.get(r); if (l) l.push(i); else patches.set(r, [i]); });

  // the own routes' segments on a grid, to ask which ones a patch touches
  const cell = 200;
  const grid = new Map<string, { num: number; a: XY; b: XY }[]>();
  for (const o of input.originals) for (const l of o.lines) for (let i = 1; i < l.length; i++) {
    const a = xy(l[i - 1]), b = xy(l[i]);
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x}:${y}`; const v = grid.get(k); const e = { num: o.num, a, b }; if (v) v.push(e); else grid.set(k, [e]); }
  }
  const nearest = (p: XY, within: number) => {
    let best = { num: -1, d: within };
    const r = Math.ceil(within / cell), cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++)
      for (const s of grid.get(`${x}:${y}`) || []) { const d = segD(p, s.a, s.b); if (d < best.d) best = { num: s.num, d }; }
    return best;
  };

  const out: TidyGroup[] = [];
  const group = (ids: number[], joinTo?: number): TidyGroup => {
    const pieces = ids.map(i => ({ wayId: gaps[i].id, name: gaps[i].name, geometry: gaps[i].geometry }));
    return { joinTo, pieces, lengthM: Math.round(pieces.reduce((t, p) => t + len(p.geometry), 0)), streets: [...new Set(pieces.map(p => p.name))].sort() };
  };
  for (const ids of patches.values()) {
    const L = ids.reduce((t, i) => t + len(gaps[i].geometry), 0);
    if (L < JOIN) {
      // the own route its ends touch most (within 40 m); a scrap that touches none joins the nearest within 300 m
      const hits = new Map<number, number>();
      for (const i of ids) { const g = gaps[i].geometry; for (const p of [g[0], g[g.length - 1]]) { const n = nearest(xy(p), 40); if (n.num >= 0) hits.set(n.num, (hits.get(n.num) || 0) + 1); } }
      let to = [...hits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (to == null) {
        let best = { num: -1, d: 300 };
        for (const i of ids) for (const p of gaps[i].geometry) { const n = nearest(xy(p), best.d); if (n.num >= 0 && n.d < best.d) best = n; }
        if (best.num >= 0) to = best.num;
      }
      if (to != null) { out.push(group(ids, to)); continue; }
    }
    if (L < 1.3 * (input.targetM ?? 2700)) { out.push(group(ids)); continue; }
    // a big patch: cut into compact routes, each in one piece
    const pts = ids.flatMap(i => gaps[i].geometry);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const [w, e, s, n] = [Math.min(...xs) - 0.003, Math.max(...xs) + 0.003, Math.min(...ys) - 0.002, Math.max(...ys) + 0.002];
    const r = autoRoutes({ ways: ids.map(i => ({ id: gaps[i].id, name: gaps[i].name || 'Street', geometry: gaps[i].geometry })),
      outline: [[w, s], [e, s], [e, n], [w, n]], main: new Map(), targetM: input.targetM });
    const routes: TidyGroup[] = r.routes.map(rt => ({ pieces: rt.pieces.map(p => ({ wayId: p.wayId, name: p.name, geometry: p.geometry })), lengthM: rt.lengthM, streets: rt.streets }));
    if (!routes.length) { out.push(group(ids)); continue; }
    // anything the cutter didn't put on a route (a scrap under 12 m, a stub at a corner) goes to the route nearest it
    const used = new Set(routes.flatMap(rt => rt.pieces.map(p => p.wayId)));
    for (const i of ids) {
      if (used.has(gaps[i].id)) continue;
      const m = xy(gaps[i].geometry[Math.floor(gaps[i].geometry.length / 2)]);
      let best = { k: 0, d: Infinity };
      routes.forEach((rt, k) => { for (const p of rt.pieces) for (const q of p.geometry) { const d = Math.hypot(xy(q)[0] - m[0], xy(q)[1] - m[1]); if (d < best.d) best = { k, d }; } });
      routes[best.k].pieces.push({ wayId: gaps[i].id, name: gaps[i].name, geometry: gaps[i].geometry });
      routes[best.k].lengthM += Math.round(len(gaps[i].geometry));
      if (!routes[best.k].streets.includes(gaps[i].name)) routes[best.k].streets = [...routes[best.k].streets, gaps[i].name].sort();
    }
    out.push(...routes);
  }
  // the new routes in reading order: rows from the top, left to right (about 1 km a row)
  const centre = (g: TidyGroup): LngLat => { const p = g.pieces.flatMap(x => x.geometry); return [p.reduce((t, q) => t + q[0], 0) / p.length, p.reduce((t, q) => t + q[1], 0) / p.length]; };
  const own = out.filter(g => g.joinTo == null).map(g => ({ g, c: centre(g) }));
  own.sort((a, b) => Math.round(-a.c[1] * ky / 1000) - Math.round(-b.c[1] * ky / 1000) || a.c[0] - b.c[0]);
  return [...out.filter(g => g.joinTo != null), ...own.map(x => x.g)];
}

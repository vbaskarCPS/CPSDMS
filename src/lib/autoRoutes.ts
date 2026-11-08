// src/lib/autoRoutes.ts — Map Builder › Auto-build: cut a master map into walking routes from the streets.
//
// In: the roads loaded around the map (OpenStreetMap ways), the map's outline, which roads are main roads (from the
// published tiles: primary / secondary / tertiary are 'arterial', motorway / trunk are 'highway'), the street pieces
// other master maps already have, and the other maps' outlines. Out: routes in the order to number them (rows from
// the top, left to right), each a list of street pieces.
//
//  1. Streets inside the outline (with 25 m of slack, so an edge road counts) are cut at every corner. Unnamed ways,
//     trails, paths, service roads, highways and streets in commercial or industrial land are left out, and so is any piece another
//     master map already has: a street is never on two maps.
//  2. Pockets: side streets joined at their corners, never across a main road. A pocket too small to be a route
//     joins the smallest pocket beside it.
//  3. Each pocket is halved across its long side until the halves are about a route long; a stray bit cut off from
//     its route joins the route it touches most.
//  4. Main roads: each piece goes to exactly one route, the lightest one that meets it. A main road on the map's
//     north or east edge is left to the next map when there is one (a map owns its west and south edges), so a road
//     between two maps is counted once.
//  5. Routes even out by walking distance, not houses (estate routes have few): a street moves from a heavier route
//     to the lighter one beside it, keeping both in one piece; a route over 1.6 times the target is halved again, and
//     one under half the average is shared out (or, cut off by a highway, joins the nearest route).

export type LngLat = [number, number];
/** kind: OpenStreetMap's highway class when known (the published street tiles carry it). */
export interface AutoWay { id: number; name: string; unnamed?: boolean; kind?: string; geometry: LngLat[] }
export type MainKind = 'arterial' | 'highway';
export interface AutoInput {
  ways: AutoWay[];
  /** The master map's outline, a ring of [lng, lat] (closing point optional). */
  outline: LngLat[];
  /** OSM way id → main road kind. */
  main: Map<number, MainKind>;
  /** Street pieces other master maps' routes already have. */
  taken?: LngLat[][];
  /** Other master maps' outlines (rings), to know whether an edge road is the next map's. */
  neighbours?: LngLat[][];
  /** Commercial, industrial and retail land (rings): streets in it aren't door to door. */
  exclude?: LngLat[][];
  /** Metres of street a route (main roads included). Default 2700, about the average of the routes drawn by hand. */
  targetM?: number;
}
export interface AutoPiece { wayId: number; name: string; main: boolean; geometry: LngLat[]; lengthM: number }
export interface AutoRoute { pieces: AutoPiece[]; lengthM: number; mainM: number; streets: string[] }
export interface AutoResult {
  routes: AutoRoute[];
  /** Edge roads left to the next map. */
  leftToNext: AutoPiece[];
  /** Pieces another master map already has (left out). */
  alreadyMapped: number;
  /** Pieces in commercial or industrial land (left out). */
  notResidential: number;
  /** Metres of main road no route takes: no side street meets it, or it would make a route mostly main road. */
  mainNotWalkedM: number;
  /** Metres of street inside the outline that went into routes. */
  totalM: number;
}

const SLACK = 25;          // m: an edge road just outside the line still counts
// streets with homes on them; a way of any other known class (service roads, paths, ramps…) isn't walked door to door
// (unclassified is left out: in the cities it's mostly industrial roads)
const HOMES = new Set(['residential', 'living_street', 'road']);
const MAIN_KINDS = new Set(['primary', 'secondary', 'tertiary']);
const HIGHWAY_KINDS = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const SKIP = /\b(trail|path|greenway|walkway|bikeway|dike|dyke|connector|overpass|underpass|ramp|bridge|parking|driveway|access|crossing|sidewalk|alley)\b/i;

type XY = [number, number];
interface Piece {
  i: number; wayId: number; name: string; main: boolean;
  ll: LngLat[]; xy: XY[]; len: number; a: string; b: string; mid: XY; samples: XY[];
  /** The OSM ways it's made of (a street put back together across a bend keeps each way's own piece). */
  parts: { wayId: number; ll: LngLat[]; len: number }[];
}

// ───────────── geometry (metres, on a flat patch around the map) ─────────────
function projector(outline: LngLat[]) {
  const lat0 = outline.reduce((t, p) => t + p[1], 0) / outline.length;
  const lng0 = outline.reduce((t, p) => t + p[0], 0) / outline.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  return {
    xy: (p: LngLat): XY => [(p[0] - lng0) * kx, (p[1] - lat0) * ky],
    ll: (p: XY): LngLat => [round7(p[0] / kx + lng0), round7(p[1] / ky + lat0)],
  };
}
const round7 = (v: number) => Math.round(v * 1e7) / 1e7;
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lineLen = (l: XY[]) => { let t = 0; for (let k = 1; k < l.length; k++) t += dist(l[k - 1], l[k]); return t; };
function along(l: XY[], f: number): XY {
  const want = lineLen(l) * f; let t = 0;
  for (let k = 1; k < l.length; k++) {
    const d = dist(l[k - 1], l[k]);
    if (t + d >= want && d > 0) { const u = (want - t) / d; return [l[k - 1][0] + (l[k][0] - l[k - 1][0]) * u, l[k - 1][1] + (l[k][1] - l[k - 1][1]) * u]; }
    t += d;
  }
  return l[l.length - 1];
}
/** The part of a line from d0 to d1 metres along it. */
function slice(l: XY[], d0: number, d1: number): XY[] {
  const out: XY[] = []; let t = 0;
  for (let k = 1; k < l.length; k++) {
    const d = dist(l[k - 1], l[k]);
    const at = (v: number): XY => { const u = d ? (v - t) / d : 0; return [l[k - 1][0] + (l[k][0] - l[k - 1][0]) * u, l[k - 1][1] + (l[k][1] - l[k - 1][1]) * u]; };
    if (t + d >= d0 && t <= d1) {
      if (!out.length) out.push(at(Math.max(d0, t)));
      if (t + d <= d1) out.push(l[k]); else { out.push(at(d1)); break; }
    }
    t += d;
  }
  return out.length >= 2 ? out : [l[0], l[l.length - 1]];
}
function inside(p: XY, ring: XY[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function ringDist(p: XY, ring: XY[]): { d: number; k: number } {
  let best = { d: Infinity, k: 0 };
  for (let k = 0; k < ring.length; k++) { const d = segDist(p, ring[k], ring[(k + 1) % ring.length]); if (d < best.d) best = { d, k }; }
  return best;
}
/** Where segment p→q crosses segment a→b, as a fraction along p→q (null if it doesn't). */
function cross(p: XY, q: XY, a: XY, b: XY): number | null {
  const r = [q[0] - p[0], q[1] - p[1]], s = [b[0] - a[0], b[1] - a[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den;
  const u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1 ? t : null;
}
const signedArea = (ring: XY[]) => { let s = 0; for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; s += x1 * y2 - x2 * y1; } return s / 2; };

/** A small grid of segments, to ask "is this point within d of any of them" quickly. */
class SegGrid {
  private cells = new Map<string, [XY, XY][]>();
  constructor(private size: number) {}
  add(a: XY, b: XY) {
    const x0 = Math.floor(Math.min(a[0], b[0]) / this.size), x1 = Math.floor(Math.max(a[0], b[0]) / this.size);
    const y0 = Math.floor(Math.min(a[1], b[1]) / this.size), y1 = Math.floor(Math.max(a[1], b[1]) / this.size);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const k = `${i}:${j}`; const c = this.cells.get(k); if (c) c.push([a, b]); else this.cells.set(k, [[a, b]]);
    }
  }
  near(p: XY, d: number): boolean {
    const i0 = Math.floor((p[0] - d) / this.size), i1 = Math.floor((p[0] + d) / this.size);
    const j0 = Math.floor((p[1] - d) / this.size), j1 = Math.floor((p[1] + d) / this.size);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [a, b] of this.cells.get(`${i}:${j}`) || []) if (segDist(p, a, b) <= d) return true;
    return false;
  }
  get empty() { return this.cells.size === 0; }
}

// ───────────── the cutter ─────────────
export function autoRoutes(input: AutoInput): AutoResult {
  const T_ROUTE = input.targetM ?? 2700;
  let outlineLL = input.outline;
  if (outlineLL.length > 2 && outlineLL[0][0] === outlineLL[outlineLL.length - 1][0] && outlineLL[0][1] === outlineLL[outlineLL.length - 1][1]) outlineLL = outlineLL.slice(0, -1);
  if (outlineLL.length < 3) throw new Error('The outline needs at least three corners.');
  const P = projector(outlineLL);
  const ring = outlineLL.map(P.xy);
  const ccw = signedArea(ring) > 0;
  const near = (p: XY) => inside(p, ring) || ringDist(p, ring).d <= SLACK;
  const neighbourRings = (input.neighbours || []).filter(r => r.length >= 3).map(r => r.map(P.xy));
  const excl = (input.exclude || []).filter(r => r.length >= 3).map(r => {
    const xy = r.map(P.xy); const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    return { xy, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }).filter(e => e.x1 > -1e5 && e.x0 < 1e5);
  const inExcluded = (p: XY) => excl.some(e => p[0] >= e.x0 && p[0] <= e.x1 && p[1] >= e.y0 && p[1] <= e.y1 && inside(p, e.xy));

  // 1. pieces: the streets that are walked, cut only where two of them meet (a driveway, lane or path isn't a corner),
  //    then at the outline; a stretch another map already has is cut out (only the rest is left); and a street that
  //    simply carries on past a bend or a change of OSM way is put back together, so it stays in one route
  const key = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const taken = new SegGrid(60);
  for (const l of input.taken || []) { const xy = l.map(P.xy); for (let k = 1; k < xy.length; k++) taken.add(xy[k - 1], xy[k]); }
  let alreadyMapped = 0, notResidential = 0;
  const kept: { w: AutoWay; name: string; isMain: boolean }[] = [];
  const seenWay = new Set<number>();
  for (const w of input.ways) {
    if (seenWay.has(w.id) || w.geometry.length < 2) continue;
    seenWay.add(w.id);
    const name = (w.name || '').trim();
    const kind: MainKind | undefined = input.main.get(w.id) ?? (w.kind && HIGHWAY_KINDS.has(w.kind) ? 'highway' : w.kind && MAIN_KINDS.has(w.kind) ? 'arterial' : undefined);
    if (kind === 'highway' || w.unnamed || !name) continue;
    const isMain = kind === 'arterial';
    if (!isMain && (SKIP.test(name) || (w.kind && !HOMES.has(w.kind)))) continue;
    const gxy = w.geometry.map(P.xy);
    if (!gxy.some(near) && !crossesRing(gxy, ring)) continue;     // nowhere near the outline
    kept.push({ w, name, isMain });
  }
  const use = new Map<string, number>();
  for (const { w } of kept) for (const p of new Set(w.geometry.map(key))) use.set(p, (use.get(p) || 0) + 1);
  interface Raw { wayId: number; name: string; main: boolean; ll: LngLat[]; xy: XY[]; len: number; a: string; b: string }
  const raws: Raw[] = [];
  let clipN = 0;
  for (const { w, name, isMain } of kept) {
    const g = w.geometry;
    const corner = (p: LngLat) => (use.get(key(p)) || 0) > 1;
    let cur: LngLat[] = [g[0]];
    for (let k = 1; k < g.length; k++) {
      cur.push(g[k]);
      if (!corner(g[k]) && k !== g.length - 1) continue;
      for (const run of clip(cur, P, ring, near)) {
        const xy = run.map(P.xy);
        const endKey = (p: LngLat) => (corner(p) || p === g[0] || p === g[g.length - 1] ? key(p) : `clip:${clipN++}`);
        const a0 = endKey(run[0]), b0 = endKey(run[run.length - 1]);
        // the stretches no other map has (sampled every 8 m), each a piece of its own
        const L0 = lineLen(xy);
        const n = Math.max(2, Math.ceil(L0 / 8));
        const free = Array.from({ length: n + 1 }, (_, t) => taken.empty || !taken.near(along(xy, t / n), 9));
        if (free.some(f => !f)) alreadyMapped++;
        let t0 = -1;
        for (let t = 0; t <= n; t++) {
          if (free[t] && t0 < 0) t0 = t;
          if ((!free[t] || t === n) && t0 >= 0) {
            const t1 = free[t] ? t : t - 1;
            const d0 = (t0 / n) * L0, d1 = (t1 / n) * L0;
            if (d1 - d0 >= (t0 === 0 && t1 === n ? 12 : 25)) {
              const part = t0 === 0 && t1 === n ? xy : slice(xy, d0, d1);
              raws.push({ wayId: w.id, name, main: isMain, xy: part, ll: t0 === 0 && t1 === n ? run : part.map(P.ll), len: lineLen(part),
                a: t0 === 0 ? a0 : `clip:${clipN++}`, b: t1 === n ? b0 : `clip:${clipN++}` });
            }
            t0 = -1;
          }
        }
      }
      cur = [g[k]];
    }
  }
  // put streets back together where only they meet (same name, both main or both not)
  const rawAt = new Map<string, number[]>();
  raws.forEach((r, i) => { for (const n of [r.a, r.b]) { const l = rawAt.get(n); if (l) l.push(i); else rawAt.set(n, [i]); } });
  const unitOf = raws.map((_, i) => i);
  const findU = (i: number): number => (unitOf[i] === i ? i : (unitOf[i] = findU(unitOf[i])));
  for (const [, ids] of rawAt) {
    if (ids.length !== 2) continue;
    const [x, y] = ids;
    if (x !== y && raws[x].name === raws[y].name && raws[x].main === raws[y].main) unitOf[findU(x)] = findU(y);
  }
  const groups = new Map<number, number[]>();
  raws.forEach((_, i) => { const u = findU(i); const l = groups.get(u); if (l) l.push(i); else groups.set(u, [i]); });
  const pieces: Piece[] = [];
  const mainNodes = new Set<string>();
  for (const ids of groups.values()) {
    const rs = ids.map(i => raws[i]);
    // the unit's ends: nodes used once within it
    const count = new Map<string, number>();
    for (const r of rs) for (const n of [r.a, r.b]) count.set(n, (count.get(n) || 0) + 1);
    const ends = [...count.entries()].filter(([, c]) => c === 1).map(([n]) => n);
    const a = ends[0] ?? rs[0].a, b = ends[1] ?? rs[rs.length - 1].b;
    const xy = rs.flatMap(r => r.xy);
    const len = rs.reduce((t, r) => t + r.len, 0);
    if (len < 12) continue;
    const longest = rs.reduce((m, r) => (r.len > m.len ? r : m), rs[0]);
    const samples = [0.15, 0.35, 0.5, 0.65, 0.85].map(f => along(longest.xy, f));
    if (!rs[0].main && excl.length && samples.filter(inExcluded).length >= 3) { notResidential++; continue; }
    if (rs[0].main) for (const r of rs) { mainNodes.add(r.a); mainNodes.add(r.b); }
    pieces.push({ i: pieces.length, wayId: rs[0].wayId, name: rs[0].name, main: rs[0].main, ll: rs.flatMap(r => r.ll), xy, len, a, b,
      mid: along(longest.xy, 0.5), samples: [...rs.flatMap(r => [r.xy[0], r.xy[r.xy.length - 1]]), ...samples], parts: rs.map(r => ({ wayId: r.wayId, ll: r.ll, len: r.len })) });
  }
  const res = pieces.filter(p => !p.main), mains = pieces.filter(p => p.main);
  const totalRes = res.reduce((t, p) => t + p.len, 0);
  const totalMain = mains.reduce((t, p) => t + p.len, 0);
  if (!res.length) return { routes: [], leftToNext: [], alreadyMapped, notResidential, mainNotWalkedM: 0, totalM: 0 };

  const byNode = new Map<string, number[]>();
  for (const p of pieces) for (const n of [p.a, p.b]) { const l = byNode.get(n); if (l) l.push(p.i); else byNode.set(n, [p.i]); }
  // side streets off the same main road a short walk apart (250 m along it) count as next to each other, so a
  // cul-de-sac off a main road joins the route across or along the road, not one on the far side of a park
  const mainEdges = new Map<string, { to: string; len: number }[]>();
  for (const m of pieces) if (m.main) for (const [x, y] of [[m.a, m.b], [m.b, m.a]]) { const l = mainEdges.get(x); const e = { to: y, len: m.len }; if (l) l.push(e); else mainEdges.set(x, [e]); }
  const reach = new Map<string, string[]>();
  const along250 = (start: string): string[] => {
    const got = reach.get(start); if (got) return got;
    const best = new Map<string, number>([[start, 0]]); const todo = [start];
    while (todo.length) {
      const n = todo.shift()!; const d = best.get(n)!;
      for (const e of mainEdges.get(n) || []) { const nd = d + e.len; if (nd <= 250 && nd < (best.get(e.to) ?? Infinity)) { best.set(e.to, nd); todo.push(e.to); } }
    }
    const out = [...best.keys()]; reach.set(start, out); return out;
  };
  const neighboursOf = (i: number, onlyRes: boolean, crossMain: boolean) => {
    const out: number[] = []; const p = pieces[i];
    for (const n of [p.a, p.b]) {
      if (!crossMain && mainNodes.has(n)) continue;
      for (const j of byNode.get(n) || []) if (j !== i && (!onlyRes || !pieces[j].main)) out.push(j);
      if (crossMain && !p.main && mainNodes.has(n))
        for (const m of along250(n)) if (m !== n) for (const j of byNode.get(m) || []) if (j !== i && !pieces[j].main) out.push(j);
    }
    return out;
  };
  const L = (s: Iterable<number>) => { let t = 0; for (const i of s) t += pieces[i].len; return t; };
  const components = (ids: Set<number>, onlyRes: boolean, crossMain: boolean): Set<number>[] => {
    const seen = new Set<number>(), out: Set<number>[] = [];
    for (const s of ids) {
      if (seen.has(s)) continue;
      const comp = new Set<number>([s]); seen.add(s); const stack = [s];
      while (stack.length) { const i = stack.pop()!; for (const j of neighboursOf(i, onlyRes, crossMain)) if (ids.has(j) && !seen.has(j)) { seen.add(j); comp.add(j); stack.push(j); } }
      out.push(comp);
    }
    return out;
  };
  const setDist = (a: Set<number>, b: Set<number>) => {
    let best = Infinity;
    for (const i of a) for (const j of b) for (const p of pieces[i].samples) for (const q of pieces[j].samples) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  };

  // 2. pockets between main roads; a pocket too small for a route joins its smallest neighbour
  const T = T_ROUTE * totalRes / (totalRes + 0.75 * totalMain);
  let cells = components(new Set(res.map(p => p.i)), true, false);
  for (;;) {
    cells.sort((x, y) => L(x) - L(y));
    const c = cells[0];
    if (cells.length < 2 || L(c) >= 0.55 * T) break;
    const others = cells.slice(1).map(o => ({ o, d: setDist(c, o) }));
    const close = others.filter(x => x.d < 80);
    const into = (close.length ? close.sort((x, y) => L(x.o) - L(y.o))[0] : others.sort((x, y) => x.d - y.d)[0]).o;
    c.forEach(i => into.add(i));
    cells = cells.slice(1);
  }

  // 3. halve each pocket across its long side until the halves are about a route long
  const halve = (ids: number[], n: number): Set<number>[] => {
    if (n <= 1 || ids.length < 2) return [new Set(ids)];
    const w = ids.map(i => pieces[i].len), W = w.reduce((t, v) => t + v, 0);
    const cx = ids.reduce((t, i, k) => t + pieces[i].mid[0] * w[k], 0) / W, cy = ids.reduce((t, i, k) => t + pieces[i].mid[1] * w[k], 0) / W;
    let sxx = 0, syy = 0, sxy = 0;
    ids.forEach((i, k) => { const dx = pieces[i].mid[0] - cx, dy = pieces[i].mid[1] - cy; sxx += w[k] * dx * dx; syy += w[k] * dy * dy; sxy += w[k] * dx * dy; });
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);           // the long side
    const ax = [Math.cos(ang), Math.sin(ang)];
    const order = ids.map((i, k) => ({ i, k, t: (pieces[i].mid[0] - cx) * ax[0] + (pieces[i].mid[1] - cy) * ax[1] })).sort((x, y) => x.t - y.t);
    const n1 = Math.floor(n / 2); let acc = 0; const a: number[] = [], b: number[] = [];
    for (const o of order) { (acc < W * n1 / n ? a : b).push(o.i); acc += w[o.k]; }
    if (!a.length || !b.length) return [new Set(ids)];
    return [...halve(a, n1), ...halve(b, n - n1)];
  };
  let routes: Set<number>[] = [];
  for (const c of cells) {
    let n = Math.max(1, Math.round(L(c) / T));
    if (L(c) / n > 1.3 * T) n++;
    routes.push(...halve([...c], n));
  }

  // a route in pieces keeps its biggest piece; the rest joins the route it touches most
  for (let pass = 0; pass < 6; pass++) {
    let moved = 0;
    const owner = new Map<number, number>(); routes.forEach((r, k) => r.forEach(i => owner.set(i, k)));
    routes.forEach((r, k) => {
      const comps = components(r, true, true).sort((x, y) => L(y) - L(x));
      for (const s of comps.slice(1)) {
        const votes = new Map<number, number>();
        for (const i of s) for (const j of neighboursOf(i, true, true)) { const t = owner.get(j); if (t != null && t !== k) votes.set(t, (votes.get(t) || 0) + 1); }
        if (!votes.size) continue;
        const t = [...votes.entries()].sort((x, y) => y[1] - x[1])[0][0];
        s.forEach(i => { r.delete(i); routes[t].add(i); owner.set(i, t); }); moved++;
      }
    });
    routes = routes.filter(r => r.size);
    if (!moved) break;
  }

  // 4. main roads: each piece to exactly one route; the north and east edges are the next map's when there is one
  const leftToNext: Piece[] = [];
  const outward = (p: XY): XY | null => {
    const { d, k } = ringDist(p, ring);
    if (d > 40) return null;
    const a = ring[k], b = ring[(k + 1) % ring.length]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return ccw ? [dy / l, -dx / l] : [-dy / l, dx / l];
  };
  const size = routes.map(r => L(r));
  const resLen = [...size], mainLen = routes.map(() => 0);
  const notWalked: Piece[] = [];
  {
    const owner = new Map<number, number>(); routes.forEach((r, k) => r.forEach(i => owner.set(i, k)));
    // pieces that meet a side street first, then the ones that only meet those (a main road walked a block further)
    const queue = [...mains].sort((x, y) => y.len - x.len);
    for (let pass = 0; pass < 3; pass++) for (const m of queue.splice(0)) {
      if (owner.has(m.i)) continue;
      const nrm = outward(m.mid);
      if (nrm && (nrm[0] > 0.5 || nrm[1] > 0.5)) {
        const beyond: XY = [m.mid[0] + nrm[0] * 120, m.mid[1] + nrm[1] * 120];
        if (neighbourRings.some(r => inside(beyond, r))) { leftToNext.push(m); continue; }
      }
      // a route that meets it at a corner, whose main road stays under its side streets (a main road through shops
      // and towers with no side streets meeting it isn't walked)
      const cand = new Set<number>();
      for (const j of neighboursOf(m.i, false, true)) { const t = owner.get(j); if (t != null) cand.add(t); }
      const ok = [...cand].filter(k => mainLen[k] + m.len <= 0.6 * resLen[k] + 200).sort((x, y) => size[x] - size[y]);
      if (!ok.length) { if (pass < 2) queue.push(m); else notWalked.push(m); continue; }
      const k = ok[0];
      routes[k].add(m.i); owner.set(m.i, k); size[k] += m.len; mainLen[k] += m.len;
    }
  }

  // 5. even them out, keeping every route in one piece
  const connected = (ids: Set<number>) => ids.size > 0 && components(ids, false, true).length === 1;
  const balance = () => {
    const blocked = new Set<string>();
    for (let it = 0; it < 3000; it++) {
      const sz = routes.map(r => L(r));
      const owner = new Map<number, number>(); routes.forEach((r, k) => r.forEach(i => owner.set(i, k)));
      const pairs = new Map<string, { k: number; t: number; cand: Set<number> }>();
      for (const [i, k] of owner) for (const j of neighboursOf(i, false, true)) {
        const t = owner.get(j);
        if (t == null || t === k || sz[k] - sz[t] <= 350 || blocked.has(`${k}>${t}`)) continue;
        const pk = `${k}>${t}`; const e = pairs.get(pk); if (e) e.cand.add(i); else pairs.set(pk, { k, t, cand: new Set([i]) });
      }
      if (!pairs.size) break;
      const { k, t, cand } = [...pairs.values()].sort((x, y) => (sz[y.k] - sz[y.t]) - (sz[x.k] - sz[x.t]))[0];
      const diff = sz[k] - sz[t];
      const ct = centre(routes[t]);
      let done = false;
      for (const i of [...cand].sort((x, y) => dist(pieces[x].mid, ct) - dist(pieces[y].mid, ct))) {
        if (pieces[i].len >= diff * 0.9) continue;
        const rest = new Set(routes[k]); rest.delete(i);
        if (connected(rest)) { routes[k] = rest; routes[t].add(i); done = true; break; }
      }
      if (!done) blocked.add(`${k}>${t}`);
    }
  };
  const centre = (r: Set<number>): XY => { let x = 0, y = 0, w = 0; for (const i of r) { x += pieces[i].mid[0] * pieces[i].len; y += pieces[i].mid[1] * pieces[i].len; w += pieces[i].len; } return [x / w, y / w]; };
  const shareOutSmall = () => {
    for (;;) {
      if (routes.length < 2) return;
      const sz = routes.map(r => L(r)); const mean = sz.reduce((t, v) => t + v, 0) / sz.length;
      const k = sz.indexOf(Math.min(...sz));
      if (sz[k] >= 0.5 * mean) return;
      const left = new Set(routes[k]); routes[k] = new Set();
      for (let pass = 0; pass < 60 && left.size; pass++) {
        const owner = new Map<number, number>(); routes.forEach((r, t) => r.forEach(i => owner.set(i, t)));
        for (const i of [...left]) {
          const nb = [...new Set(neighboursOf(i, false, true).map(j => owner.get(j)).filter((t): t is number => t != null))];
          if (!nb.length) continue;
          const t = nb.sort((x, y) => L(routes[x]) - L(routes[y]))[0];
          routes[t].add(i); left.delete(i);
        }
      }
      if (left.size) {
        // cut off from the rest (by a highway, a park or the map's edge): it joins a route within 150 m, or stays its own
        let best = { d: Infinity, t: -1 };
        routes.forEach((r, t) => { if (t !== k && r.size) { const d = setDist(left, r); if (d < best.d) best = { d, t }; } });
        if (best.t < 0 || best.d > 150) { if (L(left) >= 400) routes[k] = left; routes = routes.filter(r => r.size); return; }
        left.forEach(i => routes[best.t].add(i));
      }
      routes = routes.filter(r => r.size);
    }
  };
  /** Two halves that are each in one piece: grow from the far end of the long side, street by street, to half the length. */
  const splitConnected = (r: Set<number>): Set<number>[] | null => {
    const ids = [...r]; const c = centre(r);
    const far = ids.reduce((best, i) => (dist(pieces[i].mid, c) > dist(pieces[best].mid, c) ? i : best), ids[0]);
    const half = L(r) / 2; const a = new Set<number>([far]); let got = pieces[far].len;
    const frontier = [far];
    while (got < half && frontier.length) {
      frontier.sort((x, y) => dist(pieces[y].mid, c) - dist(pieces[x].mid, c));   // the far side first
      const i = frontier.shift()!;
      for (const j of neighboursOf(i, false, true)) if (r.has(j) && !a.has(j) && got < half) { a.add(j); got += pieces[j].len; frontier.push(j); }
    }
    const b = new Set(ids.filter(i => !a.has(i)));
    if (!b.size) return null;
    const comps = components(b, false, true).sort((x, y) => L(y) - L(x));
    for (const s of comps.slice(1)) s.forEach(i => { b.delete(i); a.add(i); });
    return connected(a) && connected(b) ? [a, b] : null;
  };
  const splitBig = () => {
    const out: Set<number>[] = [];
    const queue = [...routes];
    while (queue.length) {
      const r = queue.pop()!;
      if (L(r) > 1.6 * T_ROUTE) {
        let halves: Set<number>[] | null = halve([...r], 2).filter(h => h.size);
        if (halves.length !== 2 || !halves.every(connected)) halves = splitConnected(r);
        if (halves) { queue.push(...halves); continue; }
      }
      out.push(r);
    }
    routes = out;
  };
  balance(); shareOutSmall(); splitBig(); balance(); shareOutSmall();
  routes = routes.filter(r => r.size);

  // a main road isn't shared out piece by piece: a piece between two pieces of the same road that another route has
  // goes to that route too (when the route meets it)
  for (let pass = 0; pass < 3; pass++) {
    const owner = new Map<number, number>(); routes.forEach((r, k) => r.forEach(i => owner.set(i, k)));
    let moved = 0;
    for (const m of mains) {
      const k = owner.get(m.i); if (k == null) continue;
      const sameRoad = neighboursOf(m.i, false, true).filter(j => pieces[j].main && pieces[j].name === m.name);
      const others = sameRoad.map(j => owner.get(j)).filter((t): t is number => t != null && t !== k);
      if (others.length < 2 || others[0] !== others[1]) continue;
      const t = others[0];
      const rest = new Set(routes[k]); rest.delete(m.i);
      if (rest.size && !connected(rest)) continue;
      routes[k] = rest; routes[t].add(m.i); moved++;
    }
    if (!moved) break;
  }
  // every route in one piece: a bit cut off from its route joins the route it touches (or one within 150 m), or is a
  // route of its own; a cut-off scrap under 400 m (usually a road through shops at the map's edge) is left out
  {
    const owner = new Map<number, number>(); routes.forEach((r, k) => r.forEach(i => owner.set(i, k)));
    routes.forEach((r, k) => {
      const comps = components(r, false, true).sort((x, y) => L(y) - L(x));
      for (const c of comps.slice(1)) {
        const votes = new Map<number, number>();
        for (const i of c) for (const j of neighboursOf(i, false, true)) { const t = owner.get(j); if (t != null && t !== k) votes.set(t, (votes.get(t) || 0) + 1); }
        c.forEach(i => r.delete(i));
        let t = votes.size ? [...votes.entries()].sort((x, y) => y[1] - x[1])[0][0] : -1;
        if (t < 0) {
          let best = { d: Infinity, t: -1 };
          routes.forEach((o, u) => { if (u !== k && o.size) { const d = setDist(c, o); if (d < best.d) best = { d, t: u }; } });
          if (best.d <= 150) t = best.t;
        }
        if (t >= 0) c.forEach(i => { routes[t].add(i); owner.set(i, t); });
        else if (L(c) >= 400) { routes.push(c); c.forEach(i => owner.set(i, routes.length - 1)); }
        else c.forEach(i => owner.delete(i));
      }
    });
    routes = routes.filter(r => r.size && [...r].some(i => !pieces[i].main));
  }

  // number them: rows from the top, left to right
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1;
  const rows = Math.max(1, Math.round(Math.sqrt(routes.length * h / w)));
  const top = Math.max(...ys), band = h / rows;
  const cs = routes.map(centre);
  const order = routes.map((_, k) => k).sort((a, b) => {
    const ra = Math.min(rows - 1, Math.floor((top - cs[a][1]) / band)), rb = Math.min(rows - 1, Math.floor((top - cs[b][1]) / band));
    return ra - rb || cs[a][0] - cs[b][0];
  });
  const out = (p: Piece): AutoPiece[] => p.parts.map(q => ({ wayId: q.wayId, name: p.name, main: p.main, geometry: q.ll, lengthM: Math.round(q.len) }));
  return {
    routes: order.map(k => {
      const ps = [...routes[k]].map(i => pieces[i]);
      return {
        pieces: ps.flatMap(out),
        lengthM: Math.round(ps.reduce((t, p) => t + p.len, 0)),
        mainM: Math.round(ps.filter(p => p.main).reduce((t, p) => t + p.len, 0)),
        streets: [...new Set(ps.map(p => p.name))].sort(),
      };
    }),
    leftToNext: leftToNext.flatMap(out),
    alreadyMapped,
    notResidential,
    mainNotWalkedM: Math.round(notWalked.reduce((t, p) => t + p.len, 0)),
    totalM: Math.round(routes.reduce((t, r) => t + L(r), 0)),
  };
}

function crossesRing(l: XY[], ring: XY[]): boolean {
  for (let k = 1; k < l.length; k++) for (let j = 0; j < ring.length; j++) if (cross(l[k - 1], l[k], ring[j], ring[(j + 1) % ring.length]) != null) return true;
  return false;
}

/** The parts of a line inside the outline (or within the slack of its edge), split where it crosses the edge. */
function clip(line: LngLat[], P: { xy: (p: LngLat) => XY; ll: (p: XY) => LngLat }, ring: XY[], near: (p: XY) => boolean): LngLat[][] {
  const xy = line.map(P.xy);
  // the line with a point added wherever it crosses the outline
  const pts: { xy: XY; ll: LngLat }[] = [{ xy: xy[0], ll: line[0] }];
  for (let k = 1; k < xy.length; k++) {
    const ts: number[] = [];
    for (let j = 0; j < ring.length; j++) { const t = cross(xy[k - 1], xy[k], ring[j], ring[(j + 1) % ring.length]); if (t != null) ts.push(t); }
    ts.sort((a, b) => a - b);
    for (const t of ts) { const p: XY = [xy[k - 1][0] + (xy[k][0] - xy[k - 1][0]) * t, xy[k - 1][1] + (xy[k][1] - xy[k - 1][1]) * t]; pts.push({ xy: p, ll: P.ll(p) }); }
    pts.push({ xy: xy[k], ll: line[k] });
  }
  const runs: LngLat[][] = []; let cur: LngLat[] | null = null;
  for (let k = 1; k < pts.length; k++) {
    const m: XY = [(pts[k - 1].xy[0] + pts[k].xy[0]) / 2, (pts[k - 1].xy[1] + pts[k].xy[1]) / 2];
    if (near(m)) { if (!cur) { cur = [pts[k - 1].ll]; runs.push(cur); } cur.push(pts[k].ll); }
    else cur = null;
  }
  return runs.filter(r => r.length >= 2);
}

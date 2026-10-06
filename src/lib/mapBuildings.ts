// src/lib/mapBuildings.ts
//
// Draw houses as Mapbox's own building shapes.
//
// Mapbox's map already has a building outline for most houses (each townhouse
// unit is usually its own building). We don't copy or store those shapes —
// we colour Mapbox's buildings in place with feature-state, which is ordinary
// styling of their map:
//
//   1. matchHousesToBuildings: for every house point, find the Mapbox building
//      it sits inside (from the building tiles already loaded on screen).
//   2. A building holding exactly ONE house becomes that house: coloured with
//      the house's colour, tappable. Its tile is hidden.
//   3. A building with 2–10 houses is split into equal-width slices, one
//      per house, with the cuts running straight front-to-back (parallel to
//      the building's side walls). Each slice gets its house's colour.
//      The slices are worked out on the device each time, never stored.
//      A long building with up to 12 houses that clearly sit in a line (a
//      townhouse row) is sliced the same way.
//   4. A building with more houses, or bunched ones (condos, plazas), or a
//      house in no building, keeps the drawn tile as before.
//
// Mapbox only sends building shapes from about zoom 15, so below that every
// house shows its tile (the callers use two tile layers split at
// BUILDING_MIN_ZOOM). Matching re-runs when the map finishes loading new
// tiles, so houses fill in as you pan.

import type { Map as MapboxMap } from 'mapbox-gl';
// Ships with mapbox-gl (one of its own dependencies), so it's always installed.
import { union as polygonUnion } from 'martinez-polygon-clipping';

export const BUILDING_MIN_ZOOM = 15;
const SRC = 'composite';
const SRC_LAYER = 'building';

export interface BuildingMatch {
  /** houseId → building id, only for buildings that hold exactly one house. */
  houseToBuilding: Map<string, number>;
  /** building id → houseId (the reverse, for taps). */
  buildingToHouse: Map<number, string>;
  /** houseId → its slice of a shared building (2–10 houses, or a row of up to 12), as a polygon ring [lng,lat][]. */
  houseToSlice?: Map<string, { bid: number; ring: number[][] }>;
  /** Gap-fill result (see gapFill below). Absent when gap-fill is off. */
  gapFill?: GapFillInfo;
}

// ---------------------------------------------------------------------------
// GAP-FILL — placing a house by elimination.
//
// Some house points land outside every building (curb/driveway points). When
// such houses sit between two neighbours on the same side of the street that
// ARE in buildings, and there are exactly as many empty buildings between
// those two neighbours as there are unplaced houses, the houses take the empty
// buildings in house-number order. Anything less certain stays a tile.
//
// Nothing is stored — it's recomputed on every match, like the slices.
//   off — not run.   dry — worked out and outlined, houses keep their tiles.
//   on  — the houses are drawn as those buildings.
// Set with ?gapfill=dry|on|off (remembered on the device).
// ---------------------------------------------------------------------------
export type GapFillMode = 'off' | 'dry' | 'on';

export interface GapFillInfo {
  mode: GapFillMode;
  /** houseId → the empty building it takes (dry: would take). */
  proposals: Map<string, { bid: number; ring: number[][]; label: string }>;
  /** Addresses filled (dry: would be filled). */
  filled: number;
  /** Addresses still outside a building, by reason. */
  held: { noAnchor: number; countMismatch: number; contested: number; tooFar: number; noAddress: number };
}

const GAP_MAX_SIDEWAYS_M = 15;    // empty building centre within 15 m of the line between the two neighbours
const GAP_MAX_HOUSE_TO_BLD_M = 40; // each house's own point within 40 m of the building it takes
const GAP_MAX_SPACING_M = 35;     // neighbours at most 35 m apart per house slot
const GAP_MIN_AREA_M2 = 30, GAP_MAX_AREA_M2 = 800;

export function gapFillMode(): GapFillMode {
  try {
    const q = new URLSearchParams(window.location.search).get('gapfill');
    if (q === 'off' || q === 'dry' || q === 'on') {
      try { localStorage.setItem('gapfill', q); } catch { /* private mode */ }
      return q;
    }
    const s = localStorage.getItem('gapfill');
    if (s === 'dry' || s === 'on') return s;
  } catch { /* no window / storage */ }
  return 'off';
}

export function emptyGapFill(mode: GapFillMode): GapFillInfo {
  return { mode, proposals: new Map(), filled: 0, held: { noAnchor: 0, countMismatch: 0, contested: 0, tooFar: 0, noAddress: 0 } };
}

export function gapFillHeldTotal(g: GapFillInfo): number {
  const h = g.held;
  return h.noAnchor + h.countMismatch + h.contested + h.tooFar + h.noAddress;
}

export type GapHouse = { id: string; lng: number; lat: number; key?: string; street?: string | null; civic?: number | null; suffix?: string | null; unit?: string | null };

function gapFill(
  mode: GapFillMode,
  houses: GapHouse[],
  housesIn: Map<number, string[]>,
  houseToBuilding: Map<string, number>,
  houseToSlice: Map<string, { bid: number; ring: number[][] }>,
  biggest: Map<number, number[][]>,
): GapFillInfo {
  const out = emptyGapFill(mode);
  const lat0 = houses[0].lat, lng0 = houses[0].lng;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const toM = (lng: number, lat: number): [number, number] => [(lng - lng0) * kx, (lat - lat0) * ky];
  const centre = (ring: number[][]): [number, number] => {
    const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    let x = 0, y = 0;
    for (const p of r) { x += p[0]; y += p[1]; }
    return toM(x / r.length, y / r.length);
  };

  // Every building that already holds a house (any number) is taken.
  const inBuilding = new Set<string>();
  housesIn.forEach(ids => ids.forEach(id => inBuilding.add(id)));

  // Empty buildings of house size.
  const empties: Array<{ bid: number; c: [number, number]; ring: number[][] }> = [];
  biggest.forEach((ring, bid) => {
    if (housesIn.has(bid)) return;
    const a = ringArea(ring.map(p => toM(p[0], p[1])));
    if (a < GAP_MIN_AREA_M2 || a > GAP_MAX_AREA_M2) return;
    empties.push({ bid, c: centre(ring), ring });
  });

  // One entry per address (the same address can be loaded on two routes).
  type Addr = { key: string; ids: string[]; street: string; civic: number; suffix: string; p: [number, number]; placedAt: [number, number] | null; inBld: boolean };
  const addrs = new Map<string, Addr>();
  let noAddress = 0;
  for (const h of houses) {
    const k = h.key ?? h.id;
    const ex = addrs.get(k);
    if (ex) { ex.ids.push(h.id); continue; }
    if (!h.street || h.civic == null || h.unit) {
      if (!inBuilding.has(h.id)) noAddress++;
      continue;
    }
    let placedAt: [number, number] | null = null;
    const bid = houseToBuilding.get(h.id);
    const sl = houseToSlice.get(h.id);
    if (bid != null && biggest.get(bid)) placedAt = centre(biggest.get(bid)!);
    else if (sl) placedAt = centre(sl.ring);
    addrs.set(k, { key: k, ids: [h.id], street: h.street, civic: h.civic, suffix: h.suffix || '', p: toM(h.lng, h.lat), placedAt, inBld: inBuilding.has(h.id) });
  }
  out.held.noAddress = noAddress;

  // Each side of each street, in house-number order.
  const sides = new Map<string, Addr[]>();
  addrs.forEach(a => {
    const k = `${a.street}|${a.civic % 2}`;
    const l = sides.get(k); if (l) l.push(a); else sides.set(k, [a]);
  });

  type Run = { houses: Addr[]; bids: number[]; rings: number[][][] };
  const runs: Run[] = [];
  sides.forEach(list => {
    list.sort((a, b) => a.civic - b.civic || a.suffix.localeCompare(b.suffix));
    let anchor: Addr | null = null;
    let pending: Addr[] = [];
    let blocked = false;   // a house inside a building it couldn't be drawn as (big block) breaks the run
    const close = (next: Addr | null) => {
      if (!pending.length) return;
      if (!anchor || !next || blocked) { out.held.noAnchor += pending.length; return; }
      const A = anchor.placedAt!, B = next.placedAt!;
      const ux = B[0] - A[0], uy = B[1] - A[1];
      const L = Math.hypot(ux, uy);
      if (L < 4 || L > (pending.length + 1) * GAP_MAX_SPACING_M) { out.held.countMismatch += pending.length; return; }
      const cands = empties
        .map(e => {
          const dx = e.c[0] - A[0], dy = e.c[1] - A[1];
          return { e, along: (dx * ux + dy * uy) / L, side: Math.abs(dx * uy - dy * ux) / L };
        })
        .filter(c => c.along > 2 && c.along < L - 2 && c.side <= GAP_MAX_SIDEWAYS_M)
        .sort((a, b) => a.along - b.along);
      if (cands.length !== pending.length) { out.held.countMismatch += pending.length; return; }
      // Sanity: each house's own point is near the building it would take.
      const far = pending.some((h, i) => Math.hypot(h.p[0] - cands[i].e.c[0], h.p[1] - cands[i].e.c[1]) > GAP_MAX_HOUSE_TO_BLD_M);
      if (far) { out.held.tooFar += pending.length; return; }
      runs.push({ houses: pending, bids: cands.map(c => c.e.bid), rings: cands.map(c => c.e.ring) });
    };
    for (const a of list) {
      if (a.placedAt) { close(a); anchor = a; pending = []; blocked = false; }
      else if (a.inBld) { blocked = true; }
      else pending.push(a);
    }
    close(null);
  });

  // A building wanted by two runs goes to neither.
  const uses = new Map<number, number>();
  runs.forEach(r => r.bids.forEach(b => uses.set(b, (uses.get(b) || 0) + 1)));
  for (const r of runs) {
    if (r.bids.some(b => (uses.get(b) || 0) > 1)) { out.held.contested += r.houses.length; continue; }
    r.houses.forEach((a, i) => {
      const label = `${a.civic}${a.suffix.toUpperCase()}`;
      for (const id of a.ids) out.proposals.set(id, { bid: r.bids[i], ring: r.rings[i], label });
      out.filled++;
    });
  }
  return out;
}

/** Shared buildings with more houses than this keep their tiles... */
export const SPLIT_MAX_HOUSES = 10;
/** ...unless the houses clearly sit in a line (a townhouse row), up to this many. */
export const SPLIT_ROW_MAX_HOUSES = 12;

export function emptyBuildingMatch(): BuildingMatch {
  return { houseToBuilding: new Map(), buildingToHouse: new Map(), houseToSlice: new Map() };
}

/** Same matches? (used to skip needless redraws) */
export function buildingMatchSig(x: BuildingMatch): string {
  const a = [...x.houseToBuilding].map(([h, b]) => `${h}:${b}`);
  const b = [...(x.houseToSlice || new Map())].map(([h, s]) => `${h}:s${s.bid}:${s.ring.length}`);
  const g = x.gapFill ? [`g:${x.gapFill.mode}:${x.gapFill.filled}:${gapFillHeldTotal(x.gapFill)}`, ...[...x.gapFill.proposals].map(([h, p]) => `${h}:g${p.bid}`)] : [];
  return [...a, ...b, ...g].sort().join(',');
}

// Keep the part of a polygon on the side of the line where f(x,y) >= 0
// (one step of Sutherland–Hodgman; f is linear). Works in local metres.
function clipHalf(poly: number[][], f: (p: number[]) => number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

function ringArea(r: number[][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

/**
 * Split one building outline between the houses inside it, the way real
 * semis and townhouse rows are built: the cuts run straight front-to-back,
 * parallel to the building's own side walls, and the units are equal width.
 * The house points only decide the ORDER of the units along the building.
 */
function splitBuilding(
  outer: number[][],
  pts: Array<{ id: string; lng: number; lat: number }>,
  rowOnly = false,
  /** Direction the street runs here ([dLng·cos, dLat], any length), when known. */
  streetDir: [number, number] | null = null,
): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  const lat0 = pts[0].lat, lng0 = pts[0].lng;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const toM = (lng: number, lat: number) => [(lng - lng0) * kx, (lat - lat0) * ky];
  const toLL = (p: number[]) => [p[0] / kx + lng0, p[1] / ky + lat0];
  // drop the closing point; clipping works on an open ring
  const closed = outer.length > 1 && outer[0][0] === outer[outer.length - 1][0] && outer[0][1] === outer[outer.length - 1][1];
  const ring = (closed ? outer.slice(0, -1) : outer).map(c => toM(c[0], c[1]));
  if (ring.length < 3) return out;
  const P = pts.map(p => toM(p.lng, p.lat));

  // 1. Which way is the building squared up? Average its edge directions,
  //    weighted by length (folded so walls at 90° to each other agree).
  let C = 0, S = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const th = Math.atan2(y2 - y1, x2 - x1);
    C += len * Math.cos(4 * th); S += len * Math.sin(4 * th);
  }
  const th0 = Math.atan2(S, C) / 4;
  const axA = [Math.cos(th0), Math.sin(th0)], axB = [-Math.sin(th0), Math.cos(th0)];
  const dot = (p: number[], ax: number[]) => p[0] * ax[0] + p[1] * ax[1];
  const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);

  // 2. The units sit side by side along one of those two directions: the one
  //    the house points are clearly spread along (1.5× more than the other
  //    way). If the points don't say clearly, the building's longer side.
  const pA = spread(P.map(p => dot(p, axA))), pB = spread(P.map(p => dot(p, axB)));
  const longer = spread(ring.map(p => dot(p, axA))) >= spread(ring.map(p => dot(p, axB))) ? axA : axB;
  let row = longer;
  // Best guide: units sit side by side ALONG THE STREET, so the cuts run
  // front-to-back, square to the street. Used when the street's direction
  // clearly matches one of the building's two sides.
  const sl = streetDir ? Math.hypot(streetDir[0], streetDir[1]) : 0;
  const cA = sl ? Math.abs(dot(streetDir!, axA)) / sl : 0, cB = sl ? Math.abs(dot(streetDir!, axB)) / sl : 0;
  if (sl && Math.abs(cA - cB) >= 0.3) row = cA > cB ? axA : axB;
  // Otherwise: the way the house points are clearly spread.
  else if (pA >= 1 && pA >= 1.5 * pB) row = axA;
  else if (pB >= 1 && pB >= 1.5 * pA) row = axB;
  // Big groups are only sliced when they're plainly a row: points spread
  // along the building at least 3× more than across it, and every unit at
  // least 4 m wide.
  if (rowOnly) {
    const along = row === axA ? pA : pB, across = row === axA ? pB : pA;
    const len = spread(ring.map(p => dot(p, row)));
    if (along < 3 * Math.max(across, 1) || len / pts.length < 4) return out;
  }

  // 3. Equal-width units along that direction, in the order of the points.
  const proj = ring.map(p => dot(p, row));
  const lo = Math.min(...proj), hi = Math.max(...proj);
  const w = (hi - lo) / pts.length;
  const order = pts.map((_, i) => i).sort((i, j) => dot(P[i], row) - dot(P[j], row));
  order.forEach((hi_, k) => {
    const from = lo + k * w, to = lo + (k + 1) * w;
    let cell = ring;
    if (k > 0) cell = clipHalf(cell, p => dot(p, row) - from);
    if (k < pts.length - 1 && cell.length >= 3) cell = clipHalf(cell, p => to - dot(p, row));
    if (cell.length >= 3 && ringArea(cell) >= 4) {   // at least ~4 m²
      const ll = cell.map(toLL);
      ll.push(ll[0]);
      out.set(pts[hi_].id, ll);
    }
  });
  return out;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

export function hasBuildingSource(map: MapboxMap): boolean {
  try { return !!map.getSource(SRC); } catch { return false; }
}

/** Match house points to the Mapbox buildings currently loaded. */
export function matchHousesToBuildings(
  map: MapboxMap,
  /** key = the address (same for one house loaded on two routes); defaults to id. */
  houses: GapHouse[],
  /** Place leftover houses by elimination between neighbours (see GAP-FILL). */
  gapMode: GapFillMode = 'off',
): BuildingMatch {
  const houseToBuilding = new Map<string, number>();
  const buildingToHouse = new Map<number, string>();
  const houseToSlice = new Map<string, { bid: number; ring: number[][] }>();
  const none: BuildingMatch = { houseToBuilding, buildingToHouse, houseToSlice, gapFill: gapMode === 'off' ? undefined : emptyGapFill(gapMode) };
  if (!hasBuildingSource(map) || !houses.length) return none;

  let feats: any[] = [];
  try { feats = map.querySourceFeatures(SRC, { sourceLayer: SRC_LAYER }) as any[]; } catch { return none; }

  // Bounding boxes so each house only tests nearby buildings.
  type B = { id: number; rings: number[][][]; minX: number; minY: number; maxX: number; maxY: number; area: number };
  const blds: B[] = [];
  for (const f of feats) {
    if (f.id == null || !f.geometry) continue;
    if (f.properties?.underground === 'true') continue;
    const polys: number[][][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of outer) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      blds.push({ id: Number(f.id), rings: poly, minX, minY, maxX, maxY, area: ringArea(outer) });
    }
  }
  if (!blds.length) return none;

  // A building comes back in several pieces when it crosses a map-tile edge
  // (each tile sends its own clipped piece). Splitting just one piece cut
  // the row short and its straight tile-edge threw the cut direction off, so
  // glue the pieces back together first. Falls back to the biggest piece.
  const biggest = new Map<number, number[][]>();
  const pieces = new Map<number, B[]>();
  for (const b of blds) { const l = pieces.get(b.id); if (l) l.push(b); else pieces.set(b.id, [b]); }
  pieces.forEach((ps, id) => {
    let best = ps[0];
    for (const p of ps) if (p.area > best.area) best = p;
    biggest.set(id, best.rings[0]);
  });
  const merged = new Set<number>();
  /** The whole outline of a building, pieces glued (only worked out for buildings we split). */
  const wholeOutline = (bid: number): number[][] | undefined => {
    const ps = pieces.get(bid);
    if (!ps || ps.length < 2 || merged.has(bid)) return biggest.get(bid);
    merged.add(bid);
    try {
      let acc: any = [ps[0].rings[0]];
      for (let i = 1; i < ps.length; i++) acc = polygonUnion(acc, [ps[i].rings[0]] as any) || acc;
      // Polygon (rings) or MultiPolygon (polygons of rings)? Take the largest outer ring.
      const polys: number[][][][] = typeof acc?.[0]?.[0]?.[0] === 'number' ? [acc] : acc;
      let ring: number[][] | null = null, area = -1;
      for (const poly of polys) { const r = poly?.[0]; if (r && r.length >= 4) { const a = ringArea(r); if (a > area) { area = a; ring = r; } } }
      if (ring) biggest.set(bid, ring);
    } catch { /* keep the biggest piece */ }
    return biggest.get(bid);
  };

  // Grid of ~50 m cells.
  const CELL = 0.0005;
  const grid = new Map<string, B[]>();
  for (const b of blds) {
    for (let gx = Math.floor(b.minX / CELL); gx <= Math.floor(b.maxX / CELL); gx++) {
      for (let gy = Math.floor(b.minY / CELL); gy <= Math.floor(b.maxY / CELL); gy++) {
        const k = `${gx}|${gy}`;
        const l = grid.get(k); if (l) l.push(b); else grid.set(k, [b]);
      }
    }
  }

  const housesIn = new Map<number, string[]>();
  const byId = new Map(houses.map(h => [h.id, h]));

  // Houses by street, so a shared building can be cut square to its street.
  const byStreet = new Map<string, GapHouse[]>();
  for (const h of houses) {
    if (!h.street || h.unit || h.civic == null) continue;
    const k = `${h.street}|${h.civic % 2}`;   // one side of the street
    const l = byStreet.get(k); if (l) l.push(h); else byStreet.set(k, [h]);
  }
  /**
   * Which way the street runs at these houses: the main direction of the
   * neighbouring house points on the same street (within ~80 m). Null unless
   * they clearly line up (spread ≥ 15 m, 4× longer than wide).
   */
  const streetDirAt = (reps: GapHouse[]): [number, number] | null => {
    const r0 = reps.find(r => r.street && r.civic != null);
    if (!r0) return null;
    const st = `${r0.street}|${r0.civic! % 2}`;
    const c = r0;
    const kx = Math.cos(c.lat * Math.PI / 180) * 111320, ky = 111320;
    const pts: Array<[number, number]> = [];
    for (const h of byStreet.get(st) || []) {
      const x = (h.lng - c.lng) * kx, y = (h.lat - c.lat) * ky;
      if (x * x + y * y <= 80 * 80) pts.push([x, y]);
    }
    if (pts.length < 3) return null;
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of pts) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr - l1;
    if (l1 / pts.length < 15 * 15 / 12 || l1 < 16 * Math.max(l2, 1e-6)) return null;   // spread ≥ ~15 m, 4× longer than wide (λ ratio 16)
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return [Math.cos(th), Math.sin(th)];   // metres east, metres north — same frame splitBuilding uses
  };
  for (const h of houses) {
    const cand = grid.get(`${Math.floor(h.lng / CELL)}|${Math.floor(h.lat / CELL)}`) || [];
    // A house can sit inside two outlines (e.g. a unit drawn on top of a big
    // lot/podium outline). Take the SMALLEST one — that's the unit itself.
    let found: number | null = null, foundArea = Infinity;
    for (const b of cand) {
      if (h.lng < b.minX || h.lng > b.maxX || h.lat < b.minY || h.lat > b.maxY) continue;
      if (b.area >= foundArea) continue;
      if (inRing(h.lng, h.lat, b.rings[0]) && !b.rings.slice(1).some(hole => inRing(h.lng, h.lat, hole))) { found = b.id; foundArea = b.area; }
    }
    if (found == null) continue;
    const l = housesIn.get(found); if (l) l.push(h.id); else housesIn.set(found, [h.id]);
  }
  housesIn.forEach((ids, bid) => {
    // The same address can be loaded twice (a boundary street on two routes).
    // Count addresses, not copies: every copy shares its address's shape.
    const keyOf = (id: string) => byId.get(id)?.key ?? id;
    const byKey = new Map<string, string[]>();
    for (const id of ids) { const k = keyOf(id); const l = byKey.get(k); if (l) l.push(id); else byKey.set(k, [id]); }
    if (byKey.size === 1) {
      for (const id of ids) houseToBuilding.set(id, bid);
      buildingToHouse.set(bid, ids[0]);
      return;
    }
    // Shared building: slice it between its addresses (big ones keep tiles).
    if (byKey.size > SPLIT_ROW_MAX_HOUSES) return;
    const outer = wholeOutline(bid);
    if (!outer) return;
    const reps = [...byKey.values()].map(l => byId.get(l[0])!).filter(Boolean);
    splitBuilding(outer, reps, byKey.size > SPLIT_MAX_HOUSES, streetDirAt(reps)).forEach((ring, repId) => {
      for (const id of byKey.get(keyOf(repId)) || [repId]) houseToSlice.set(id, { bid, ring });
    });
  });
  let gap: GapFillInfo | undefined;
  if (gapMode !== 'off') {
    gap = gapFill(gapMode, houses, housesIn, houseToBuilding, houseToSlice, biggest);
    if (gapMode === 'on') {
      gap.proposals.forEach((g, id) => {
        houseToBuilding.set(id, g.bid);
        if (!buildingToHouse.has(g.bid)) buildingToHouse.set(g.bid, id);
      });
    }
  }
  return { houseToBuilding, buildingToHouse, houseToSlice, gapFill: gap };
}

/** Add the coloured-building layers (once). `before` keeps them under labels. */
export function addBuildingLayers(map: MapboxMap, prefix: string, before?: string): { fill: string; line: string } {
  const fill = `${prefix}-bld-fill`, line = `${prefix}-bld-line`;
  if (!hasBuildingSource(map)) return { fill, line };
  if (!map.getLayer(fill)) {
    map.addLayer({
      id: fill, type: 'fill', source: SRC, 'source-layer': SRC_LAYER, minzoom: BUILDING_MIN_ZOOM,
      filter: ['!=', ['get', 'underground'], 'true'],
      paint: {
        // Matched houses: their colour. Every other building: a faint outline
        // fill so the real neighbourhood shows through.
        'fill-color': ['coalesce', ['feature-state', 'color'], '#9ca3af'],
        'fill-opacity': ['coalesce', ['feature-state', 'fill'], 0.12],
      },
    } as any, before);
  }
  if (!map.getLayer(line)) {
    map.addLayer({
      id: line, type: 'line', source: SRC, 'source-layer': SRC_LAYER, minzoom: BUILDING_MIN_ZOOM,
      filter: ['!=', ['get', 'underground'], 'true'],
      paint: {
        'line-color': ['coalesce', ['feature-state', 'color'], '#9ca3af'],
        'line-opacity': ['coalesce', ['feature-state', 'line'], 0.35],
        'line-width': ['coalesce', ['feature-state', 'width'], 0.8],
      },
    } as any, before);
  }
  return { fill, line };
}

/** Layers for the slices of shared buildings (drawn above the buildings). */
export function addSliceLayers(map: MapboxMap, prefix: string, before?: string): { fill: string; line: string; source: string } {
  const source = `${prefix}-slice-src`, fill = `${prefix}-slice-fill`, line = `${prefix}-slice-line`;
  if (!map.getSource(source)) map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as any);
  if (!map.getLayer(fill)) {
    map.addLayer({
      id: fill, type: 'fill', source, minzoom: BUILDING_MIN_ZOOM,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fill'] },
    } as any, before);
  }
  if (!map.getLayer(line)) {
    map.addLayer({
      id: line, type: 'line', source, minzoom: BUILDING_MIN_ZOOM,
      paint: { 'line-color': ['get', 'color'], 'line-opacity': ['get', 'line'], 'line-width': ['get', 'width'] },
    } as any, before);
  }
  // Gap-fill dry run: dashed outline + number on each building a house would take.
  const gsrc = `${prefix}-gap-src`;
  if (!map.getSource(gsrc)) map.addSource(gsrc, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } as any);
  if (!map.getLayer(`${prefix}-gap-line`)) {
    map.addLayer({
      id: `${prefix}-gap-line`, type: 'line', source: gsrc, minzoom: BUILDING_MIN_ZOOM,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': '#e879f9', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    } as any, before);
  }
  if (!map.getLayer(`${prefix}-gap-num`)) {
    map.addLayer({
      id: `${prefix}-gap-num`, type: 'symbol', source: gsrc, minzoom: BUILDING_MIN_ZOOM + 1,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-allow-overlap': true, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] },
      paint: { 'text-color': '#f5d0fe', 'text-halo-color': '#4a044e', 'text-halo-width': 1.5 },
    } as any, before);
  }
  return { fill, line, source };
}

/** Draw the slices: one feature per house, coloured like its building would be. */
export function setSliceData(map: MapboxMap, prefix: string, match: BuildingMatch, styleFor: (houseId: string) => BuildingStyle | null): void {
  const src = map.getSource(`${prefix}-slice-src`) as any;
  if (!src) return;
  // One feature per slice. Copies of the same address share a slice — draw
  // it once, in the stronger colour (a knocked copy beats an unknocked one).
  const best = new Map<number[][], { id: string; st: BuildingStyle }>();
  (match.houseToSlice || new Map()).forEach((s, id) => {
    const st = styleFor(id);
    if (!st) return;
    const cur = best.get(s.ring);
    if (!cur || Number(st.fill) > Number(cur.st.fill)) best.set(s.ring, { id, st });
  });
  const features: any[] = [];
  best.forEach(({ id, st }, ring) => {
    features.push({ type: 'Feature', properties: { id, ...st }, geometry: { type: 'Polygon', coordinates: [ring] } });
  });
  src.setData({ type: 'FeatureCollection', features });

  // Gap-fill dry run outlines (nothing in other modes).
  const gsrc = map.getSource(`${prefix}-gap-src`) as any;
  if (gsrc) {
    const gf: any[] = [];
    const g = match.gapFill;
    if (g && g.mode === 'dry') {
      const seen = new Set<number>();
      g.proposals.forEach(p => {
        if (seen.has(p.bid)) return;
        seen.add(p.bid);
        gf.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [p.ring] } });
        let x = 0, y = 0; const n = Math.max(1, p.ring.length - 1);
        for (let i = 0; i < n; i++) { x += p.ring[i][0]; y += p.ring[i][1]; }
        gf.push({ type: 'Feature', properties: { label: p.label }, geometry: { type: 'Point', coordinates: [x / n, y / n] } });
      });
    }
    gsrc.setData({ type: 'FeatureCollection', features: gf });
  }
}

/** Remove the slice layers + source. */
export function removeSliceLayers(map: MapboxMap, prefix: string): void {
  try {
    [`${prefix}-gap-num`, `${prefix}-gap-line`, `${prefix}-slice-line`, `${prefix}-slice-fill`].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(`${prefix}-slice-src`)) map.removeSource(`${prefix}-slice-src`);
    if (map.getSource(`${prefix}-gap-src`)) map.removeSource(`${prefix}-gap-src`);
  } catch { /* map gone */ }
}

export interface BuildingStyle { color: string; fill: number; line: number; width: number; [k: string]: string | number }

/** Apply colours to matched buildings; clears buildings no longer matched. */
export function applyBuildingStyles(map: MapboxMap, styles: Map<number, BuildingStyle>, previous: Set<number>): Set<number> {
  if (!hasBuildingSource(map)) return new Set();
  previous.forEach(id => {
    if (!styles.has(id)) { try { map.removeFeatureState({ source: SRC, sourceLayer: SRC_LAYER, id }); } catch { /* gone */ } }
  });
  styles.forEach((st, id) => {
    try { map.setFeatureState({ source: SRC, sourceLayer: SRC_LAYER, id }, { ...st }); } catch { /* not loaded */ }
  });
  return new Set(styles.keys());
}

/**
 * The outline of one Mapbox building (by id) as a polygon, for drawing an
 * effect over it (e.g. the last-knock pulse). If the building comes in
 * pieces (it crosses a map tile edge), the biggest piece. Null if its tile
 * isn't loaded.
 */
export function buildingShape(map: MapboxMap, bid: number): GeoJSON.Polygon | null {
  if (!hasBuildingSource(map)) return null;
  let feats: any[] = [];
  try { feats = map.querySourceFeatures(SRC, { sourceLayer: SRC_LAYER, filter: ['==', ['id'], bid] } as any) as any[]; } catch { feats = []; }
  if (!feats.length) {
    try { feats = (map.querySourceFeatures(SRC, { sourceLayer: SRC_LAYER }) as any[]).filter(f => Number(f.id) === bid); } catch { return null; }
  }
  let best: number[][][] | null = null, bestArea = -1;
  for (const f of feats) {
    const polys: number[][][][] = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates]
      : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const a = poly[0] ? ringArea(poly[0]) : 0;
      if (a > bestArea) { bestArea = a; best = poly; }
    }
  }
  return best ? { type: 'Polygon', coordinates: best } : null;
}

/** Building id under a tap, if any (only buildings that are matched to a house). */
export function buildingIdAt(map: MapboxMap, point: { x: number; y: number }, fillLayer: string): number | null {
  try {
    const f = map.queryRenderedFeatures([point.x, point.y] as any, { layers: [fillLayer] })[0];
    return f && f.id != null ? Number(f.id) : null;
  } catch { return null; }
}

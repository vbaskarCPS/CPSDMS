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
//   3. A building with 2–6 houses is split into one slice per house: a
//      dividing line halfway between each pair of neighbouring house points,
//      trimmed to the building outline. Each slice gets its house's colour.
//      The slices are worked out on the device each time, never stored.
//   4. A building with more houses (condos, plazas), or a house in no
//      building, keeps the drawn tile as before.
//
// Mapbox only sends building shapes from about zoom 15, so below that every
// house shows its tile (the callers use two tile layers split at
// BUILDING_MIN_ZOOM). Matching re-runs when the map finishes loading new
// tiles, so houses fill in as you pan.

import type { Map as MapboxMap } from 'mapbox-gl';

export const BUILDING_MIN_ZOOM = 15;
const SRC = 'composite';
const SRC_LAYER = 'building';

export interface BuildingMatch {
  /** houseId → building id, only for buildings that hold exactly one house. */
  houseToBuilding: Map<string, number>;
  /** building id → houseId (the reverse, for taps). */
  buildingToHouse: Map<number, string>;
  /** houseId → its slice of a shared building (2–6 houses), as a polygon ring [lng,lat][]. */
  houseToSlice?: Map<string, { bid: number; ring: number[][] }>;
}

/** Shared buildings with more houses than this keep their tiles. */
export const SPLIT_MAX_HOUSES = 6;

export function emptyBuildingMatch(): BuildingMatch {
  return { houseToBuilding: new Map(), buildingToHouse: new Map(), houseToSlice: new Map() };
}

/** Same matches? (used to skip needless redraws) */
export function buildingMatchSig(x: BuildingMatch): string {
  const a = [...x.houseToBuilding].map(([h, b]) => `${h}:${b}`);
  const b = [...(x.houseToSlice || new Map())].map(([h, s]) => `${h}:s${s.bid}:${s.ring.length}`);
  return [...a, ...b].sort().join(',');
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
 * Split one building outline between the houses inside it: each house gets
 * the part of the building closer to its point than to any other house's
 * (so the dividing lines sit halfway between neighbours).
 */
function splitBuilding(outer: number[][], pts: Array<{ id: string; lng: number; lat: number }>): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  const lat0 = pts[0].lat, lng0 = pts[0].lng;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 111320;
  const toM = (lng: number, lat: number) => [(lng - lng0) * kx, (lat - lat0) * ky];
  const toLL = (p: number[]) => [p[0] / kx + lng0, p[1] / ky + lat0];
  // drop the closing point; clipping works on an open ring
  const ring = outer.slice(0, outer.length > 1 && outer[0][0] === outer[outer.length - 1][0] && outer[0][1] === outer[outer.length - 1][1] ? -1 : undefined)
    .map(c => toM(c[0], c[1]));
  const P = pts.map(p => toM(p.lng, p.lat));
  pts.forEach((h, i) => {
    let cell = ring;
    for (let j = 0; j < P.length && cell.length >= 3; j++) {
      if (j === i) continue;
      const [ax, ay] = P[i], [bx, by] = P[j];
      if (ax === bx && ay === by) continue;           // same spot — can't split
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = ax - bx, dy = ay - by;
      cell = clipHalf(cell, p => (p[0] - mx) * dx + (p[1] - my) * dy);
    }
    if (cell.length >= 3 && ringArea(cell) >= 4) {   // at least ~4 m²
      const ll = cell.map(toLL);
      ll.push(ll[0]);
      out.set(h.id, ll);
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
  houses: Array<{ id: string; lng: number; lat: number }>,
): BuildingMatch {
  const houseToBuilding = new Map<string, number>();
  const buildingToHouse = new Map<number, string>();
  const houseToSlice = new Map<string, { bid: number; ring: number[][] }>();
  const none = { houseToBuilding, buildingToHouse, houseToSlice };
  if (!hasBuildingSource(map) || !houses.length) return none;

  let feats: any[] = [];
  try { feats = map.querySourceFeatures(SRC, { sourceLayer: SRC_LAYER }) as any[]; } catch { return none; }

  // Bounding boxes so each house only tests nearby buildings.
  type B = { id: number; rings: number[][][]; minX: number; minY: number; maxX: number; maxY: number };
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
      blds.push({ id: Number(f.id), rings: poly, minX, minY, maxX, maxY });
    }
  }
  if (!blds.length) return none;

  // A building can come back in several pieces (one per map tile it
  // crosses). For splitting, use its biggest piece.
  const biggest = new Map<number, number[][]>();
  const bigArea = new Map<number, number>();
  for (const b of blds) {
    const a = ringArea(b.rings[0]);
    if (a > (bigArea.get(b.id) ?? -1)) { bigArea.set(b.id, a); biggest.set(b.id, b.rings[0]); }
  }

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
  for (const h of houses) {
    const cand = grid.get(`${Math.floor(h.lng / CELL)}|${Math.floor(h.lat / CELL)}`) || [];
    let found: number | null = null;
    for (const b of cand) {
      if (h.lng < b.minX || h.lng > b.maxX || h.lat < b.minY || h.lat > b.maxY) continue;
      if (inRing(h.lng, h.lat, b.rings[0]) && !b.rings.slice(1).some(hole => inRing(h.lng, h.lat, hole))) { found = b.id; break; }
    }
    if (found == null) continue;
    const l = housesIn.get(found); if (l) l.push(h.id); else housesIn.set(found, [h.id]);
  }
  housesIn.forEach((ids, bid) => {
    if (ids.length === 1) {
      houseToBuilding.set(ids[0], bid);
      buildingToHouse.set(bid, ids[0]);
      return;
    }
    // Shared building: slice it between its houses (big ones keep tiles).
    if (ids.length > SPLIT_MAX_HOUSES) return;
    const outer = biggest.get(bid);
    if (!outer) return;
    const pts = ids.map(id => byId.get(id)!).filter(Boolean);
    splitBuilding(outer, pts).forEach((ring, hid) => houseToSlice.set(hid, { bid, ring }));
  });
  return { houseToBuilding, buildingToHouse, houseToSlice };
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
  return { fill, line, source };
}

/** Draw the slices: one feature per house, coloured like its building would be. */
export function setSliceData(map: MapboxMap, prefix: string, match: BuildingMatch, styleFor: (houseId: string) => BuildingStyle | null): void {
  const src = map.getSource(`${prefix}-slice-src`) as any;
  if (!src) return;
  const features: any[] = [];
  (match.houseToSlice || new Map()).forEach((s, id) => {
    const st = styleFor(id);
    if (!st) return;
    features.push({ type: 'Feature', properties: { id, ...st }, geometry: { type: 'Polygon', coordinates: [s.ring] } });
  });
  src.setData({ type: 'FeatureCollection', features });
}

/** Remove the slice layers + source. */
export function removeSliceLayers(map: MapboxMap, prefix: string): void {
  try {
    [`${prefix}-slice-line`, `${prefix}-slice-fill`].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(`${prefix}-slice-src`)) map.removeSource(`${prefix}-slice-src`);
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

/** Building id under a tap, if any (only buildings that are matched to a house). */
export function buildingIdAt(map: MapboxMap, point: { x: number; y: number }, fillLayer: string): number | null {
  try {
    const f = map.queryRenderedFeatures([point.x, point.y] as any, { layers: [fillLayer] })[0];
    return f && f.id != null ? Number(f.id) : null;
  } catch { return null; }
}

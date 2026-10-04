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
//   3. A building with two or more houses, or a house in no building, keeps
//      the drawn tile as before.
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
  if (!hasBuildingSource(map) || !houses.length) return { houseToBuilding, buildingToHouse };

  let feats: any[] = [];
  try { feats = map.querySourceFeatures(SRC, { sourceLayer: SRC_LAYER }) as any[]; } catch { return { houseToBuilding, buildingToHouse }; }

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
  if (!blds.length) return { houseToBuilding, buildingToHouse };

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
    if (ids.length !== 1) return;          // shared building → those houses keep tiles
    houseToBuilding.set(ids[0], bid);
    buildingToHouse.set(bid, ids[0]);
  });
  return { houseToBuilding, buildingToHouse };
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

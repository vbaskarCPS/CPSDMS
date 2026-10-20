// src/lib/roadBox.ts — the box of roads the map builder asks OpenStreetMap for. Zoomed out, the
// view can cover a whole city; a request that size takes the road servers minutes and usually
// times out. So the request is capped to the middle of the view, and the builder says so.

/** Widest box asked for in one go, in degrees (about 5.5 km north–south). */
export const MAX_ROAD_SPAN_LAT = 0.05;

export interface Bounds { south: number; west: number; north: number; east: number }

/** The Overpass bbox string "south,west,north,east" for a view, with a 10% margin, capped to the
 *  middle of the view when the view is too big. `capped` says whether it was. */
export function roadBox(b: Bounds): { bbox: string; capped: boolean } {
  const midLat = (b.north + b.south) / 2, midLng = (b.east + b.west) / 2;
  const latSpan = b.north - b.south;
  // longitude degrees are shorter than latitude degrees away from the equator: keep the box square-ish on the ground
  const lngPerLat = 1 / Math.max(Math.cos(midLat * Math.PI / 180), 0.2);
  const capped = latSpan > MAX_ROAD_SPAN_LAT;
  const halfLat = (capped ? MAX_ROAD_SPAN_LAT : latSpan) / 2;
  const halfLng = capped ? halfLat * lngPerLat : (b.east - b.west) / 2;
  const latPad = halfLat * 0.2, lngPad = halfLng * 0.2;
  const s = midLat - halfLat - latPad, n = midLat + halfLat + latPad, w = midLng - halfLng - lngPad, e = midLng + halfLng + lngPad;
  return { bbox: `${s},${w},${n},${e}`, capped };
}

/** Where to look up a new map by name: the city (which carries its province) first, then the map's
 *  name, all within Canada rather than assuming Ontario. */
export function placeSearches(areaName: string, city: string | null | undefined): string[] {
  const name = areaName.toLowerCase().replace(/#\d+/g, '').trim();
  const c = (city || '').trim();
  const out = [
    ...(c ? [`${name}, ${c}, Canada`, `${c}, Canada`] : []),
    `${name}, Canada`,
  ];
  return out.filter((v, i, a) => v.trim() !== ', Canada' && a.indexOf(v) === i);
}

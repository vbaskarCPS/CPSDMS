// src/lib/mapOutlines.ts: every master map's outline as map features (Territory, All maps, and the map builder).
export type Outlines = Record<string, GeoJSON.Geometry>;

type Region = 'West' | 'Central' | 'East';

export const REGION_COLOR: Record<Region | 'none', string> = { West: '#2563eb', Central: '#7c3aed', East: '#d97706', none: '#64748b' };

/** Every coordinate of a geometry. */
function pointsOf(g: GeoJSON.Geometry): [number, number][] {
  const out: [number, number][] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number') { out.push([x[0], x[1]]); return; }
    if (Array.isArray(x)) x.forEach(walk);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach(x => out.push(...pointsOf(x)));
  else walk((g as { coordinates: unknown }).coordinates);
  return out;
}

export interface OutlineInfo { region?: Region | null; centerName?: string | null }
/** The outlines as map features (colour by region, a label point in the middle), leaving out `skip`. */
export function outlineFeatures(outlines: Outlines, info: Map<string, OutlineInfo>, skip?: string | null, picked?: string | null):
  { shapes: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection; points: [number, number][] } {
  const shapes: GeoJSON.Feature[] = [], labels: GeoJSON.Feature[] = [], points: [number, number][] = [];
  for (const [area, g] of Object.entries(outlines).sort(([a], [b]) => a.localeCompare(b))) {
    if (!g || area === skip) continue;
    const pts = pointsOf(g);
    if (!pts.length) continue;
    const region = info.get(area)?.region || null;
    const color = REGION_COLOR[region || 'none'];
    shapes.push({ type: 'Feature', geometry: g, properties: { area, color, sel: area === picked ? 1 : 0 } });
    const mid: [number, number] = [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
    labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: mid }, properties: { area, label: area } });
    points.push(...pts);
  }
  return { shapes: { type: 'FeatureCollection', features: shapes }, labels: { type: 'FeatureCollection', features: labels }, points };
}

// src/v2/features/bookings/mbMap.ts — the Master Bookings map: one Mapbox map for all three levels.
// The layers are added once; each level fills the ones it uses and empties the rest.
//   level 1  map outlines (tap to pick)
//   level 2  route lines in their colours, or (heat map) route outlines with each street coloured
//            by its knocks; route numbers; customers and knocks as the filters say
//   level 3  the route, its streets (heat map), every house coloured by its knock this round
import mapboxgl from 'mapbox-gl';
import { RM_LINE, RM_NUMBER, RM_STYLE, tidyRmBaseMap } from '../../../lib/rmMapStyle';

export const BLANK_STYLE: mapboxgl.StyleSpecification = {
  version: 8, sources: {}, glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f3' } }],
};
export const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export type AreaSource = 'mb-area';
export const SOURCES = ['mb-outline', 'mb-outline-labels', 'mb-routes', 'mb-hull', 'mb-heat', 'mb-nums', 'mb-clients', 'mb-knocks', 'mb-sel'] as const;
export type SourceId = typeof SOURCES[number];

export function createMap(box: HTMLDivElement, onReady: (m: mapboxgl.Map) => void, onFail: (msg: string) => void): mapboxgl.Map | null {
  const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
  try {
    if (token) mapboxgl.accessToken = token;
    const m = new mapboxgl.Map({ container: box, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE,
      center: [-79.73, 43.45], zoom: 10, attributionControl: false });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    let loaded = false;
    m.on('load', () => { loaded = true; tidyRmBaseMap(m); addLayers(m); onReady(m); });
    m.on('error', e => { if (!loaded) onFail(String((e as { error?: Error }).error?.message || 'Map failed to load')); });
    const ro = new ResizeObserver(() => m.resize()); ro.observe(box); (m as unknown as { __ro?: ResizeObserver }).__ro = ro;
    (box as HTMLDivElement & { __map?: mapboxgl.Map }).__map = m;
    return m;
  } catch (e) { onFail(e instanceof Error ? e.message : 'Map failed to load'); return null; }
}

export function removeMap(m: mapboxgl.Map | null): void {
  (m as unknown as { __ro?: ResizeObserver } | null)?.__ro?.disconnect();
  try { m?.remove(); } catch { /* gone */ }
}

function addLayers(m: mapboxgl.Map): void {
  for (const id of SOURCES) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: EMPTY });
  // level 2: each route's area, so a tap anywhere on a route opens it (lit up under the pointer)
  if (!m.getSource('mb-area')) m.addSource('mb-area', { type: 'geojson', data: EMPTY, promoteId: 'code' });
  // level 1: map outlines
  m.addLayer({ id: 'mb-outline-fill', type: 'fill', source: 'mb-outline', paint: {
    'fill-color': ['case', ['==', ['get', 'sel'], 1], '#f59e0b', '#64748b'],
    'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.32, 0.08] } });
  m.addLayer({ id: 'mb-outline-line', type: 'line', source: 'mb-outline', paint: {
    'line-color': ['case', ['==', ['get', 'sel'], 1], '#b45309', '#475569'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 3, 1.5] } });
  // labels on their own source: a symbol layer waits for its font, and must not hold up the shapes
  m.addLayer({ id: 'mb-outline-label', type: 'symbol', source: 'mb-outline-labels', layout: {
    'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 13, 'text-allow-overlap': false },
    paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
  // level 2/3: routes in their colours (heat map off), or their outlines (heat map on)
  m.addLayer({ id: 'mb-area-fill', type: 'fill', source: 'mb-area', paint: {
    'fill-color': '#2563eb', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.16, 0.02] } });
  m.addLayer({ id: 'mb-area-line', type: 'line', source: 'mb-area', paint: {
    'line-color': '#1d4ed8', 'line-width': 2.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0] } });
  m.addLayer({ id: 'mb-routes', type: 'line', source: 'mb-routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': RM_LINE.width, 'line-opacity': RM_LINE.opacity } });
  m.addLayer({ id: 'mb-hull', type: 'line', source: 'mb-hull', paint: { 'line-color': '#334155', 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } });
  m.addLayer({ id: 'mb-heat-case', type: 'line', source: 'mb-heat', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 17, 11] } });
  m.addLayer({ id: 'mb-heat', type: 'line', source: 'mb-heat', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 17, 8], 'line-opacity': 0.95 } });
  // customers and knocks (level 2)
  m.addLayer({ id: 'mb-clients', type: 'circle', source: 'mb-clients', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 17, 5.5], 'circle-color': ['get', 'color'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 17, 1.5] } });
  m.addLayer({ id: 'mb-knocks', type: 'circle', source: 'mb-knocks', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 17, 5], 'circle-color': ['get', 'color'],
    'circle-opacity': ['case', ['==', ['get', 'fast'], 1], 0.45, 0.9],
    'circle-stroke-color': ['case', ['==', ['get', 'fast'], 1], '#facc15', '#111827'], 'circle-stroke-width': ['case', ['==', ['get', 'fast'], 1], 1.5, 0.4] } });
  m.addLayer({ id: 'mb-sel', type: 'circle', source: 'mb-sel', paint: {
    'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2.5 } });
  m.addLayer({ id: 'mb-nums', type: 'symbol', source: 'mb-nums', layout: {
    'text-field': ['get', 'num'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': ['get', 'size'],
    'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': RM_NUMBER.halo, 'text-halo-width': RM_NUMBER.haloWidth } });
}

export function setData(m: mapboxgl.Map | null, id: SourceId | AreaSource, fc: GeoJSON.FeatureCollection): void {
  (m?.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(fc);
}

export const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

/** Convex hull (monotone chain) of points: a route's outline for the heat map. */
export function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Middle of a set of points (for route numbers). */
export function middle(points: [number, number][]): [number, number] | null {
  if (!points.length) return null;
  return [points.reduce((t, q) => t + q[0], 0) / points.length, points.reduce((t, q) => t + q[1], 0) / points.length];
}

/** Every coordinate in a GeoJSON geometry. */
export function coordsOf(g: GeoJSON.Geometry | null | undefined): [number, number][] {
  if (!g) return [];
  const out: [number, number][] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number') { out.push([x[0], x[1]]); return; }
    if (Array.isArray(x)) x.forEach(walk);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach(x => out.push(...coordsOf(x)));
  else walk((g as { coordinates: unknown }).coordinates);
  return out;
}

export function fit(m: mapboxgl.Map | null, points: [number, number][], maxZoom = 16): void {
  if (!m || !points.length) return;
  const b = new mapboxgl.LngLatBounds();
  for (const p of points) b.extend(p);
  try { m.fitBounds(b, { padding: 50, animate: false, maxZoom }); } catch { /* sized 0 */ }
}

/** A route's tap area: the hull of its streets, widened about 30 m so a thin route is easy to hit. */
export function routeArea(lines: [number, number][][]): [number, number][] | null {
  const d = 0.0003, pts: [number, number][] = [];
  for (const l of lines) for (const [x, y] of l) pts.push([x - d, y], [x + d, y], [x, y - d], [x, y + d]);
  const h = hull(pts);
  return h.length >= 3 ? [...h, h[0]] : null;
}

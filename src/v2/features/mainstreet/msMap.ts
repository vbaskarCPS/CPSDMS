// src/v2/features/mainstreet/msMap.ts — the MainstreetAI zones map: every zone as a polygon in its colour,
// the selected one lit up, and a drawing layer for a new or redrawn zone (click to add a corner,
// double-click or "Finish" to close).
import mapboxgl from 'mapbox-gl';
import { RM_STYLE, tidyRmBaseMap } from '../../../lib/rmMapStyle';
import { BLANK_STYLE, EMPTY, coordsOf, fit, removeMap } from '../bookings/mbMap';

export { coordsOf, fit, removeMap };

export function createZonesMap(box: HTMLDivElement, onReady: (m: mapboxgl.Map) => void, onFail: (msg: string) => void): mapboxgl.Map | null {
  const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
  try {
    if (token) mapboxgl.accessToken = token;
    const m = new mapboxgl.Map({ container: box, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE,
      center: [-79.75, 43.45], zoom: 10, attributionControl: false, doubleClickZoom: false });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    let loaded = false;
    m.on('load', () => {
      loaded = true; tidyRmBaseMap(m);
      for (const id of ['ms-zones', 'ms-labels', 'ms-draw', 'ms-draw-pts', 'ms-prop', 'ms-prop-labels']) m.addSource(id, { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'ms-zone-fill', type: 'fill', source: 'ms-zones', paint: {
        'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.38, ['==', ['get', 'retired'], 1], 0.06, 0.16] } });
      m.addLayer({ id: 'ms-zone-line', type: 'line', source: 'ms-zones', paint: {
        'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 1.8],
        'line-dasharray': ['case', ['==', ['get', 'retired'], 1], ['literal', [2, 2]], ['literal', [1, 0]]] } });
      m.addLayer({ id: 'ms-zone-label', type: 'symbol', source: 'ms-labels', layout: {
        'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 12.5, 'text-allow-overlap': false },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      // a proposal under review: candidates, lit up when picked for a merge
      m.addLayer({ id: 'ms-prop-fill', type: 'fill', source: 'ms-prop', paint: {
        'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.45, 0.2] } });
      m.addLayer({ id: 'ms-prop-line', type: 'line', source: 'ms-prop', paint: { 'line-color': '#111827', 'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 2], 'line-dasharray': [1.5, 1] } });
      m.addLayer({ id: 'ms-prop-label', type: 'symbol', source: 'ms-prop-labels', layout: {
        'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      // drawing: the shape so far, and a dot on each corner
      m.addLayer({ id: 'ms-draw-fill', type: 'fill', source: 'ms-draw', paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.22 } });
      m.addLayer({ id: 'ms-draw-line', type: 'line', source: 'ms-draw', paint: { 'line-color': '#0f766e', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      m.addLayer({ id: 'ms-draw-pts', type: 'circle', source: 'ms-draw-pts', paint: {
        'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#0f766e', 'circle-stroke-width': 2.5 } });
      onReady(m);
    });
    m.on('error', e => { if (!loaded) onFail(String((e as { error?: Error }).error?.message || 'Map failed to load')); });
    const ro = new ResizeObserver(() => m.resize()); ro.observe(box); (m as unknown as { __ro?: ResizeObserver }).__ro = ro;
    return m;
  } catch (e) { onFail(e instanceof Error ? e.message : 'Map failed to load'); return null; }
}

export function setSource(m: mapboxgl.Map | null, id: string, data: GeoJSON.FeatureCollection): void {
  (m?.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(data);
}

/** The drawing layer: a line while there are fewer than three corners, then a filled shape. */
export function drawFeatures(corners: [number, number][]): { shape: GeoJSON.FeatureCollection; points: GeoJSON.FeatureCollection } {
  const shape: GeoJSON.Feature[] = [];
  if (corners.length >= 3) shape.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] } });
  else if (corners.length === 2) shape.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: corners } });
  return {
    shape: { type: 'FeatureCollection', features: shape },
    points: { type: 'FeatureCollection', features: corners.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })) },
  };
}

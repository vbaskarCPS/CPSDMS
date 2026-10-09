// src/lib/rmMapStyle.ts — the RM map's look, for other maps that should match it (the customer map).
//
// The RM map uses Mapbox streets-v12 with the clutter taken out: no POIs, house numbers, transit,
// shields or building fills, and street names bold black on white so they read over the route
// lines. Routes are drawn 7 px wide in their own colour at 75 %, with the route number large in
// the same colour at the middle of the route.

import type { Map as MapboxMap } from 'mapbox-gl';

export const RM_STYLE = 'mapbox://styles/mapbox/streets-v12';
export const RM_LINE = { width: 7, opacity: 0.75 } as const;
export const RM_NUMBER = { size: 28, halo: 'rgba(255,255,255,0.85)', haloWidth: 2 } as const;

/** Take the clutter out of streets-v12, as the RM map does (call once the style has loaded). */
export function tidyRmBaseMap(map: MapboxMap): void {
  const style = map.getStyle();
  if (!style?.layers) return;
  const hide = (id: string) => { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch { /* not in this style */ } };
  ['poi-label', 'housenum-label', 'road-number-shield', 'transit-label'].forEach(id => { if (map.getLayer(id)) hide(id); });
  for (const layer of style.layers as { id: string; type: string; layout?: Record<string, unknown> }[]) {
    const id = layer.id.toLowerCase();
    if (id.includes('transit') || id.includes('bus-stop') || id.includes('busstop')) { hide(layer.id); continue; }
    if ((layer.type === 'fill' || layer.type === 'fill-extrusion') && (id.includes('building') || id.includes('structure'))) { hide(layer.id); continue; }
    if (layer.type !== 'symbol') continue;
    const tf = JSON.stringify(layer.layout?.['text-field'] ?? '');
    const houseNumbers = /house.?num|address/.test(id) || /housenumber|house_num|addr|ref/.test(tf);
    const notARoadLabel = !id.includes('label') && !id.includes('shield') && !id.includes('motorway') && !id.includes('road') && !id.includes('street');
    if (houseNumbers || notARoadLabel) { hide(layer.id); continue; }
    if (id.includes('label')) {
      try {
        map.setLayoutProperty(layer.id, 'text-size', 13);
        map.setLayoutProperty(layer.id, 'text-font', ['DIN Pro Bold', 'Arial Unicode MS Bold']);
        map.setPaintProperty(layer.id, 'text-color', '#111111');
        map.setPaintProperty(layer.id, 'text-halo-color', '#ffffff');
        map.setPaintProperty(layer.id, 'text-halo-width', 2);
      } catch { /* layer without text */ }
    }
  }
}

/** The first label layer, so route lines go under the street names (as on the RM map). */
export function rmLabelAnchor(map: MapboxMap, ownPrefix: string): string | undefined {
  if (map.getLayer('road-label')) return 'road-label';
  const layers = (map.getStyle()?.layers || []) as { id: string; type: string }[];
  return layers.find(l => l.type === 'symbol' && !l.id.startsWith(ownPrefix))?.id;
}

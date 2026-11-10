// src/v2/features/benny/BennyMap.tsx — the map the Benny shows in the chat: the master maps outlined and named,
// the routes it's about in colour with their numbers, every other route grey, and pins (e.g. prebooks).
// Drawn like the map builder: street-line routes. Tap "Full screen" to open it as a modal.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Maximize2, X } from 'lucide-react';
import { RM_STYLE, tidyRmBaseMap } from '../../../lib/rmMapStyle';
import { BLANK_STYLE } from '../bookings/mbMap';
import { routeShapes, territoryOutlines, type RouteShape } from '../../lib/territory';
import type { BennyMap as Spec } from '../../lib/benny';

const HL = '#f97316', GREY = '#9ca3af', OUTLINE = '#334155';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** The map's features, from the spec and the routes' lines (pure, so it's tested). */
export function bennyFeatures(spec: Spec, shapes: RouteShape[], outlines: Record<string, GeoJSON.Geometry>) {
  const hl = new Set(spec.highlight.map(c => c.toUpperCase()));
  const routes: GeoJSON.Feature[] = []; const nums: GeoJSON.Feature[] = [];
  for (const r of shapes) {
    const on = hl.has(r.code.toUpperCase());
    for (const line of r.lines) routes.push({ type: 'Feature', properties: { on: on ? 1 : 0, code: r.code }, geometry: { type: 'LineString', coordinates: line } });
    if (on && r.lines.length) {
      const all = r.lines.flat(); const mid = all[Math.floor(all.length / 2)];
      nums.push({ type: 'Feature', properties: { label: r.code }, geometry: { type: 'Point', coordinates: mid } });
    }
  }
  const outs: GeoJSON.Feature[] = spec.maps.filter(m => outlines[m]).map(m => ({ type: 'Feature', properties: { name: m }, geometry: outlines[m] }));
  const pins: GeoJSON.Feature[] = spec.pins.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map(p => ({ type: 'Feature', properties: { label: p.label, route: p.route || '' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
  return {
    routes: { type: 'FeatureCollection', features: routes } as GeoJSON.FeatureCollection,
    nums: { type: 'FeatureCollection', features: nums } as GeoJSON.FeatureCollection,
    outlines: { type: 'FeatureCollection', features: outs } as GeoJSON.FeatureCollection,
    pins: { type: 'FeatureCollection', features: pins } as GeoJSON.FeatureCollection,
  };
}

function bboxOf(fcs: GeoJSON.FeatureCollection[]): mapboxgl.LngLatBounds | null {
  const b = new mapboxgl.LngLatBounds(); let any = false;
  const add = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { b.extend(c as [number, number]); any = true; } else if (Array.isArray(c)) c.forEach(add); };
  for (const fc of fcs) for (const f of fc.features) add((f.geometry as { coordinates?: unknown }).coordinates);
  return any ? b : null;
}

const MapBox: React.FC<{ spec: Spec; tall?: boolean }> = ({ spec, tall }) => {
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ shapes: RouteShape[]; outlines: Record<string, GeoJSON.Geometry> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    Promise.all([routeShapes(spec.maps), territoryOutlines()])
      .then(([shapes, outlines]) => { if (!off) setData({ shapes, outlines: outlines as unknown as Record<string, GeoJSON.Geometry> }); })
      .catch(e => { if (!off) setErr(e instanceof Error ? e.message : 'Map data didn’t load'); });
    return () => { off = true; };
  }, [spec.maps.join('|')]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useMemo(() => data ? bennyFeatures(spec, data.shapes, data.outlines) : null, [data, spec]);

  useEffect(() => {
    if (!box.current || !fc) return;
    const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
    if (token) mapboxgl.accessToken = token;
    let m: mapboxgl.Map;
    try {
      m = new mapboxgl.Map({ container: box.current, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE, center: [-122.9, 49.2], zoom: 10, attributionControl: false });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Map failed to load'); return; }
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      tidyRmBaseMap(m);
      m.addSource('b-out', { type: 'geojson', data: fc.outlines });
      m.addSource('b-routes', { type: 'geojson', data: fc.routes });
      m.addSource('b-nums', { type: 'geojson', data: fc.nums });
      m.addSource('b-pins', { type: 'geojson', data: fc.pins });
      m.addLayer({ id: 'b-out', type: 'line', source: 'b-out', paint: { 'line-color': OUTLINE, 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      m.addLayer({ id: 'b-out-name', type: 'symbol', source: 'b-out', layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'symbol-placement': 'point', 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] },
        paint: { 'text-color': OUTLINE, 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      m.addLayer({ id: 'b-routes-grey', type: 'line', source: 'b-routes', filter: ['==', ['get', 'on'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GREY, 'line-width': 4, 'line-opacity': 0.55 } });
      m.addLayer({ id: 'b-routes-on', type: 'line', source: 'b-routes', filter: ['==', ['get', 'on'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': HL, 'line-width': 6, 'line-opacity': 0.9 } });
      m.addLayer({ id: 'b-nums', type: 'symbol', source: 'b-nums', layout: { 'text-field': ['get', 'label'], 'text-size': 14, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': false },
        paint: { 'text-color': '#7c2d12', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      m.addLayer({ id: 'b-pins', type: 'circle', source: 'b-pins', paint: { 'circle-radius': 6, 'circle-color': '#dc2626', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.on('click', 'b-pins', e => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties as { label: string; route: string };
        new mapboxgl.Popup({ closeButton: false }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setText(`${p.label}${p.route ? ` · ${p.route}` : ''}`).addTo(m);
      });
      m.on('mouseenter', 'b-pins', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'b-pins', () => { m.getCanvas().style.cursor = ''; });
      const focus = fc.pins.features.length ? [fc.pins] : fc.nums.features.length ? [fc.routes] : [fc.outlines, fc.routes];
      const b = bboxOf(focus.map(f => f === fc.routes ? { ...fc.routes, features: fc.routes.features.filter(x => !fc.nums.features.length || (x.properties as { on: number }).on) } : f));
      if (b) m.fitBounds(b, { padding: 40, maxZoom: 15, duration: 0 });
    });
    const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
    return () => { ro.disconnect(); try { m.remove(); } catch { /* gone */ } };
  }, [fc]);

  if (err) return <div className="benny-map-msg">{err}</div>;
  return <div ref={box} className={`benny-map${tall ? ' tall' : ''}`} aria-label={spec.title || 'Map'}>{!fc && <div className="benny-map-msg">Loading the map…</div>}</div>;
};

export const BennyMapCard: React.FC<{ spec: Spec }> = ({ spec }) => {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [full]);
  const caption = `${spec.highlight.length} route${spec.highlight.length === 1 ? '' : 's'} highlighted${spec.pins.length ? ` · ${spec.pins.length} pin${spec.pins.length === 1 ? '' : 's'}` : ''}`;
  return (
    <div className="benny-mapcard">
      <div className="benny-mapcard-h"><b>{spec.title || 'Map'}</b><span className="v2-small v2-mut">{caption}</span>
        <button type="button" className="benny-icon" onClick={() => setFull(true)} aria-label="Open the map full screen"><Maximize2 size={15} /></button></div>
      {!full && <MapBox spec={spec} />}
      {full && (
        <div className="benny-fullmap" role="dialog" aria-modal="true" aria-label={spec.title || 'Map'}>
          <div className="benny-fullmap-h"><b>{spec.title || 'Map'}</b><span className="v2-small">{caption}</span><span className="v2-spacer" />
            <button type="button" className="benny-icon light" onClick={() => setFull(false)} aria-label="Close the map"><X size={18} /></button></div>
          <MapBox spec={spec} tall />
        </div>
      )}
    </div>
  );
};

export { EMPTY };

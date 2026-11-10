// src/v2/features/benny/BennyMap.tsx — the map the Benny shows in the chat: the master maps outlined and named,
// the routes it's about in colour with their numbers, every other route grey, and pins (e.g. prebooks).
// Drawn like the map builder: street-line routes. Tap "Full screen" to open it as a modal.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Maximize2, X } from 'lucide-react';
import { RM_STYLE, tidyRmBaseMap } from '../../../lib/rmMapStyle';
import { BLANK_STYLE } from '../bookings/mbMap';
import { routeShapes, territoryOutlines, type RouteShape } from '../../lib/territory';
import type { BennyMap as Spec } from '../../lib/benny';

const HL = '#f97316', GREY = '#9ca3af', OUTLINE = '#334155';

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
  // each map's name sits at the top of its outline (its own point source: a failed font download must not hide the outlines)
  const names: GeoJSON.Feature[] = outs.map((o): GeoJSON.Feature | null => {
    const pts: [number, number][] = [];
    const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as [number, number]); else if (Array.isArray(c)) c.forEach(walk); };
    walk((o.geometry as { coordinates?: unknown }).coordinates);
    if (!pts.length) return null;
    const top = pts.reduce((a, b) => (b[1] > a[1] ? b : a), pts[0]);
    const midLng = (Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2;
    return { type: 'Feature', properties: { name: o.properties!.name }, geometry: { type: 'Point', coordinates: [midLng, top[1]] } } as GeoJSON.Feature;
  }).filter((n): n is GeoJSON.Feature => !!n);
  const pins: GeoJSON.Feature[] = spec.pins.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map(p => ({ type: 'Feature', properties: { label: p.label, route: p.route || '' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
  return {
    routes: { type: 'FeatureCollection', features: routes } as GeoJSON.FeatureCollection,
    nums: { type: 'FeatureCollection', features: nums } as GeoJSON.FeatureCollection,
    outlines: { type: 'FeatureCollection', features: outs } as GeoJSON.FeatureCollection,
    names: { type: 'FeatureCollection', features: names } as GeoJSON.FeatureCollection,
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
    (box.current as HTMLDivElement & { __map?: mapboxgl.Map }).__map = m;   // as mbMap does: lets a check read the drawn map
    m.on('load', () => {
      tidyRmBaseMap(m);
      m.addSource('b-out', { type: 'geojson', data: fc.outlines });
      m.addSource('b-routes', { type: 'geojson', data: fc.routes });
      m.addSource('b-nums', { type: 'geojson', data: fc.nums });
      m.addSource('b-pins', { type: 'geojson', data: fc.pins });
      m.addSource('b-names', { type: 'geojson', data: fc.names });
      // lines thin out when the map is zoomed out, so a whole city still reads as streets, not a blob
      const w = (far: number, near: number) => ['interpolate', ['linear'], ['zoom'], 10, far, 13, (far + near) / 2, 15.5, near] as mapboxgl.Expression;
      m.addLayer({ id: 'b-routes-grey', type: 'line', source: 'b-routes', filter: ['==', ['get', 'on'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GREY, 'line-width': w(0.8, 4), 'line-opacity': 0.6 } });
      m.addLayer({ id: 'b-routes-on', type: 'line', source: 'b-routes', filter: ['==', ['get', 'on'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': HL, 'line-width': w(1.4, 6), 'line-opacity': 0.92 } });
      m.addLayer({ id: 'b-out', type: 'line', source: 'b-out', layout: { 'line-join': 'round' }, paint: { 'line-color': OUTLINE, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      m.addLayer({ id: 'b-nums', type: 'symbol', source: 'b-nums', layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': false, 'text-padding': 3 },
        paint: { 'text-color': '#7c2d12', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      m.addLayer({ id: 'b-out-name', type: 'symbol', source: 'b-names', layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-anchor': 'bottom', 'text-offset': [0, -0.4], 'text-allow-overlap': true,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      m.addLayer({ id: 'b-pins', type: 'circle', source: 'b-pins', paint: { 'circle-radius': 6, 'circle-color': '#dc2626', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.on('click', 'b-pins', e => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties as { label: string; route: string };
        new mapboxgl.Popup({ closeButton: false }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setText(`${p.label}${p.route ? ` · ${p.route}` : ''}`).addTo(m);
      });
      m.on('mouseenter', 'b-pins', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'b-pins', () => { m.getCanvas().style.cursor = ''; });
      // frame: the highlighted routes and pins when there are some (with the outlines when that's all of a map), else the maps
      const on: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: fc.routes.features.filter(x => (x.properties as { on: number }).on) };
      const b = bboxOf(fc.pins.features.length || on.features.length ? [fc.pins, on] : [fc.outlines, fc.routes]);
      if (b) m.fitBounds(b, { padding: { top: 44, bottom: 36, left: 36, right: 48 }, maxZoom: 15, duration: 0 });
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
      <div className="benny-mapcard-h"><span className="benny-mapcard-t"><b>{spec.title || 'Map'}</b><span className="v2-small">{caption}</span></span>
        <button type="button" className="benny-icon" onClick={() => setFull(true)} aria-label="Open the map full screen"><Maximize2 size={15} /></button></div>
      {!full && <MapBox spec={spec} />}
      {full && createPortal(
        <div className="benny-root"><div className="benny-fullmap" role="dialog" aria-modal="true" aria-label={spec.title || 'Map'}>
          <div className="benny-fullmap-h"><b>{spec.title || 'Map'}</b><span className="v2-small">{caption}</span><span className="v2-spacer" />
            <button type="button" className="benny-icon light" onClick={() => setFull(false)} aria-label="Close the map"><X size={18} /></button></div>
          <MapBox spec={spec} tall />
        </div></div>, document.body)}
    </div>
  );
};


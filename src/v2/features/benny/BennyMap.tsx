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
import { routeShapes, type RouteShape } from '../../lib/territory';
import { bennyOutlines, type BennyMap as Spec } from '../../lib/benny';

const HL = '#f97316', GREY = '#9ca3af', OUTLINE = '#334155', STOP = '#1d4ed8';

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
    .map(p => ({ type: 'Feature', properties: { label: p.label, route: p.route || '', ...(typeof p.n === 'number' ? { n: p.n } : {}) }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }));
  // an order: its stops joined in order, from where the manager is when that is known
  const stops = spec.pins.filter(p => typeof p.n === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)).sort((a, b) => a.n! - b.n!);
  const start = spec.start && Number.isFinite(spec.start.lat) && Number.isFinite(spec.start.lng) ? spec.start : null;
  const line = [...(start && stops.length ? [[start.lng, start.lat]] : []), ...stops.map(p => [p.lng, p.lat])];
  const path: GeoJSON.Feature[] = [
    ...(line.length > 1 ? [{ type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: line } } as GeoJSON.Feature] : []),
    ...(start && stops.length ? [{ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: [start.lng, start.lat] } } as GeoJSON.Feature] : []),
  ];
  return {
    path: { type: 'FeatureCollection', features: path } as GeoJSON.FeatureCollection,
    routes: { type: 'FeatureCollection', features: routes } as GeoJSON.FeatureCollection,
    nums: { type: 'FeatureCollection', features: nums } as GeoJSON.FeatureCollection,
    outlines: { type: 'FeatureCollection', features: outs } as GeoJSON.FeatureCollection,
    names: { type: 'FeatureCollection', features: names } as GeoJSON.FeatureCollection,
    pins: { type: 'FeatureCollection', features: pins } as GeoJSON.FeatureCollection,
  };
}

/** The outline of a set of points (their convex hull), as a polygon: stands in when a map's kept outline isn't there. */
export function hullOutline(points: [number, number][]): GeoJSON.Polygon | null {
  const pts = [...new Map(points.map(p => [`${p[0]},${p[1]}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return null;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => { const h: [number, number][] = []; for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
  const ring = [...half(pts), ...half([...pts].reverse())];
  return ring.length < 3 ? null : { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

/** Each asked-for map's outline: the kept one, or the hull of its routes when that's missing. */
export function outlinesFor(maps: string[], kept: Record<string, GeoJSON.Geometry>, shapes: RouteShape[]): Record<string, GeoJSON.Geometry> {
  const out: Record<string, GeoJSON.Geometry> = {};
  for (const m of maps) {
    const g = kept[m] || hullOutline(shapes.filter(s => s.area === m).flatMap(s => s.lines.flat()));
    if (g) out[m] = g;
  }
  return out;
}

/**
 * The map's box. Anything said about the map (loading, an error) is drawn INSIDE this box: a message must never sit
 * over the chat (an error once covered the whole panel and blocked every tap).
 */
export const MapFrame = React.forwardRef<HTMLDivElement, { tall?: boolean; label?: string; message?: string | null; error?: boolean; onRetry?: () => void }>(
  ({ tall, label, message, error, onRetry }, ref) => (
    <div ref={ref} className={`benny-map${tall ? ' tall' : ''}`} aria-label={label || 'Map'}>
      {message && <div className={`benny-map-msg${error ? ' err' : ''}`} role={error ? 'alert' : 'status'}>
        <span>{message}</span>{error && onRetry && <button type="button" className="benny-link" onClick={onRetry}>Try again</button>}
      </div>}
    </div>
  ));
MapFrame.displayName = 'MapFrame';

function bboxOf(fcs: GeoJSON.FeatureCollection[]): mapboxgl.LngLatBounds | null {
  const b = new mapboxgl.LngLatBounds(); let any = false;
  const add = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { b.extend(c as [number, number]); any = true; } else if (Array.isArray(c)) c.forEach(add); };
  for (const fc of fcs) for (const f of fc.features) add((f.geometry as { coordinates?: unknown }).coordinates);
  return any ? b : null;
}

const OUTLINE_WAIT_MS = 4000;

const MapBox: React.FC<{ spec: Spec; centerId?: string | null; tall?: boolean }> = ({ spec, centerId, tall }) => {
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ shapes: RouteShape[]; outlines: Record<string, GeoJSON.Geometry> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let off = false;
    setErr(null);
    // The routes are the map; the outlines are a nicety. A slow or failed outline request never holds the map up or
    // breaks it: after a few seconds the map draws with each map's routes' own outline instead.
    const kept = Promise.race([
      bennyOutlines(centerId || null, spec.maps).catch(() => ({} as Record<string, GeoJSON.Geometry>)),
      new Promise<Record<string, GeoJSON.Geometry>>(r => window.setTimeout(() => r({}), OUTLINE_WAIT_MS)),
    ]);
    Promise.all([routeShapes(spec.maps), kept])
      .then(([shapes, outlines]) => { if (!off) setData({ shapes, outlines: outlinesFor(spec.maps, outlines, shapes) }); })
      .catch(e => { if (!off) setErr(e instanceof Error ? e.message : 'The map’s routes didn’t load'); });
    return () => { off = true; };
  }, [spec.maps.join('|'), centerId, tries]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useMemo(() => data ? bennyFeatures(spec, data.shapes, data.outlines) : null, [data, spec]);

  useEffect(() => {
    if (!box.current || !fc) return;
    const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
    if (token) mapboxgl.accessToken = token;
    let m: mapboxgl.Map;
    try {
      m = new mapboxgl.Map({ container: box.current, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE, center: [-122.9, 49.2], zoom: 10, attributionControl: false });
    } catch (e) { setErr(e instanceof Error ? e.message : 'the map couldn’t start'); return; }
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
      // route codes, except under an order: its numbered stops sit where the codes would, and the card names each stop's route
      const ordered = fc.pins.features.some(f => typeof (f.properties as { n?: number }).n === 'number');
      m.addLayer({ id: 'b-nums', type: 'symbol', source: 'b-nums', layout: { visibility: ordered ? 'none' : 'visible', 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': false, 'text-padding': 3 },
        paint: { 'text-color': '#7c2d12', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      m.addLayer({ id: 'b-out-name', type: 'symbol', source: 'b-names', layout: { 'text-field': ['get', 'name'], 'text-size': 13, 'text-anchor': 'bottom', 'text-offset': [0, -0.4], 'text-allow-overlap': true,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
      // an order's line and "you are here", under the pins
      m.addSource('b-path', { type: 'geojson', data: fc.path });
      m.addLayer({ id: 'b-path', type: 'line', source: 'b-path', filter: ['==', ['get', 'kind'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': STOP, 'line-width': 3, 'line-dasharray': [0.6, 1.8], 'line-opacity': 0.9 } });
      m.addLayer({ id: 'b-start', type: 'circle', source: 'b-path', filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 7, 'circle-color': '#16a34a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      // pins: a stop in an order is bigger and carries its number
      m.addLayer({ id: 'b-pins', type: 'circle', source: 'b-pins', paint: { 'circle-radius': ['case', ['has', 'n'], 12, 6], 'circle-color': ['case', ['has', 'n'], STOP, '#dc2626'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'b-pin-n', type: 'symbol', source: 'b-pins', filter: ['has', 'n'], layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 13, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#fff' } });
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
      const b = bboxOf(fc.pins.features.length || on.features.length ? [fc.pins, on, fc.path] : [fc.outlines, fc.routes]);
      if (b) m.fitBounds(b, { padding: { top: 44, bottom: 36, left: 36, right: 48 }, maxZoom: 15, duration: 0 });
    });
    const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
    return () => { ro.disconnect(); try { m.remove(); } catch { /* gone */ } };
  }, [fc]);

  return <MapFrame ref={box} tall={tall} label={spec.title} error={!!err}
    message={err ? `The map didn’t load: ${err}` : !fc ? 'Loading the map…' : null} onRetry={() => { setData(null); setTries(t => t + 1); }} />;
};

export const BennyMapCard: React.FC<{ spec: Spec; centerId?: string | null }> = ({ spec, centerId }) => {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [full]);
  const ordered = spec.pins.some(p => typeof p.n === 'number');
  const caption = [
    spec.highlight.length || !spec.pins.length ? `${spec.highlight.length} route${spec.highlight.length === 1 ? '' : 's'} highlighted` : '',
    spec.pins.length ? (ordered ? `${spec.pins.length} stop${spec.pins.length === 1 ? '' : 's'} in order` : `${spec.pins.length} pin${spec.pins.length === 1 ? '' : 's'}`) : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="benny-mapcard">
      <div className="benny-mapcard-h"><span className="benny-mapcard-t"><b>{spec.title || 'Map'}</b><span className="v2-small">{caption}</span></span>
        <button type="button" className="benny-icon" onClick={() => setFull(true)} aria-label="Open the map full screen"><Maximize2 size={15} /></button></div>
      {!full && <MapBox spec={spec} centerId={centerId} />}
      {full && createPortal(
        <div className="benny-root"><div className="benny-fullmap" role="dialog" aria-modal="true" aria-label={spec.title || 'Map'}>
          <div className="benny-fullmap-h"><b>{spec.title || 'Map'}</b><span className="v2-small">{caption}</span><span className="v2-spacer" />
            <button type="button" className="benny-icon light" onClick={() => setFull(false)} aria-label="Close the map"><X size={18} /></button></div>
          <MapBox spec={spec} centerId={centerId} tall />
        </div></div>, document.body)}
    </div>
  );
};


// src/v2/features/workerbook/RoutePickerMap.tsx — pick the day's routes on the digital map, in each manager's colour.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Area, RouteShape } from '../../lib/territory';
import type { PlanManager, PlanRoute } from '../../lib/startSession';

export const MANAGER_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#0d9488', '#e11d48', '#0284c7', '#65a30d', '#c026d3'];
const OFF = '#9ca3af';

// Without a Mapbox token (local builds) the routes still draw, on a plain background.
const BLANK_STYLE: mapboxgl.StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f3f4f6' } }],
};

interface Props {
  areas: Area[];
  shapes: RouteShape[];
  routes: Map<string, PlanRoute>;
  managers: PlanManager[];
  active: string;                      // manager id that clicks assign to
  onRouteClick: (shape: RouteShape) => void;
}

export const RoutePickerMap: React.FC<Props> = ({ areas, shapes, routes, managers, active, onRouteClick }) => {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const hasToken = useRef(false);
  const clickRef = useRef(onRouteClick);
  clickRef.current = onRouteClick;
  const shapeByCode = useMemo(() => new Map(shapes.map(s => [s.code, s])), [shapes]);
  const shapesRef = useRef(shapeByCode);
  shapesRef.current = shapeByCode;
  const colorOf = useMemo(() => {
    const m = new Map(managers.map((x, i) => [x.id, MANAGER_COLORS[i % MANAGER_COLORS.length]]));
    return (code: string) => { const r = routes.get(code); return r ? m.get(r.managerId) || OFF : OFF; };
  }, [managers, routes]);

  const bounds = useMemo(() => {
    const b = new mapboxgl.LngLatBounds();
    let any = false;
    for (const s of shapes) for (const line of s.lines) for (const c of line) { b.extend(c); any = true; }
    return any ? b : null;
  }, [shapes]);

  // create the map once
  useEffect(() => {
    if (!box.current || map.current) return;
    const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
    hasToken.current = !!token;
    try {
      if (token) mapboxgl.accessToken = token;
      const m = new mapboxgl.Map({
        container: box.current, style: token ? 'mapbox://styles/mapbox/light-v11' : BLANK_STYLE,
        center: [-79.73, 43.45], zoom: 12, attributionControl: false, cooperativeGestures: false,
      });
      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      m.on('load', () => setReady(true));
      m.on('error', e => { if (!m.isStyleLoaded()) setFailed(String((e as { error?: Error }).error?.message || 'Map failed to load')); });
      map.current = m;
      (box.current as HTMLDivElement & { __map?: mapboxgl.Map }).__map = m; // lets browser tests inspect what was drawn
    } catch (e) { setFailed(e instanceof Error ? e.message : 'Map failed to load'); }
    return () => { try { map.current?.remove(); } catch { /* already gone */ } map.current = null; setReady(false); };
  }, []);

  // route lines + labels
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const lines: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    const labels: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    for (const s of shapes) {
      const color = colorOf(s.code); const on = routes.has(s.code);
      for (const line of s.lines) lines.features.push({ type: 'Feature', properties: { code: s.code, color, on: on ? 1 : 0 }, geometry: { type: 'LineString', coordinates: line } });
      const all = s.lines.flat(); if (!all.length) continue;
      const mid = all[Math.floor(all.length / 2)];
      labels.features.push({ type: 'Feature', properties: { code: s.code, color, on: on ? 1 : 0 }, geometry: { type: 'Point', coordinates: mid } });
    }
    const src = m.getSource('routes') as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(lines); (m.getSource('route-labels') as mapboxgl.GeoJSONSource).setData(labels); return; }
    m.addSource('routes', { type: 'geojson', data: lines });
    m.addSource('route-labels', { type: 'geojson', data: labels });
    m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });
    m.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'on'], 1], 6, 3], 'line-opacity': ['case', ['==', ['get', 'on'], 1], 0.95, 0.55] } });
    if (hasToken.current) m.addLayer({ id: 'routes-label', type: 'symbol', source: 'route-labels',
      layout: { 'text-field': ['get', 'code'], 'text-size': 12, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': false },
      paint: { 'text-color': ['case', ['==', ['get', 'on'], 1], ['get', 'color'], '#4b5563'], 'text-halo-color': '#fff', 'text-halo-width': 2 } });
    const pick = (e: mapboxgl.MapLayerMouseEvent) => {
      const code = e.features?.[0]?.properties?.code as string | undefined;
      const shape = code ? shapesRef.current.get(code) : undefined;
      if (shape) clickRef.current(shape);
    };
    for (const id of hasToken.current ? ['routes-hit', 'routes-label'] : ['routes-hit']) {
      m.on('click', id, pick);
      m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; });
    }
  }, [ready, shapes, routes, colorOf]);

  // fit to the center's areas when they load
  useEffect(() => {
    if (map.current && ready && bounds) map.current.fitBounds(bounds, { padding: 40, animate: false, maxZoom: 15 });
  }, [ready, bounds]);

  const activeColor = MANAGER_COLORS[Math.max(0, managers.findIndex(m => m.id === active)) % MANAGER_COLORS.length];
  return (
    <div className="v2-routemap">
      <div ref={box} className="v2-routemap-canvas" aria-label="Map of this center's routes. Tap a route to pick it." />
      {failed && <div className="v2-routemap-msg">The map couldn’t load ({failed}). Use the list instead.</div>}
      {!failed && areas.length > 0 && shapes.length === 0 && <div className="v2-routemap-msg">Loading routes…</div>}
      {active && <div className="v2-routemap-hint"><span style={{ background: activeColor }} />Tap routes to give them to {managers.find(m => m.id === active)?.full_name.split(' ')[0]}</div>}
    </div>
  );
};

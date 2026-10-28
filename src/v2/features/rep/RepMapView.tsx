// src/v2/features/rep/RepMapView.tsx — the rep's map: zone outlines (in their campaign's colour) and a
// pin per business, coloured by where it stands. Closed-right-now businesses are dimmed. Used by the
// home map (every zone at once) and a single zone.
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { PIN, type PinState } from '../../lib/rep';
import { RM_STYLE, tidyRmBaseMap } from '../../../lib/rmMapStyle';
import { BLANK_STYLE, EMPTY, removeMap } from '../bookings/mbMap';

export interface MapZone { id: string; name: string; color: string; polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon }
export interface MapPin { id: string; name: string; state: PinState; lat: number; lng: number; dim?: boolean; lead?: boolean }
export interface RepMapHandle { flyTo: (p: { lat: number; lng: number }, zoom?: number) => void }

const STATE_COLOR: unknown[] = ['match', ['get', 'state'], ...Object.entries(PIN).flatMap(([k, v]) => [k, v.color]), '#ffffff'];

function boundsOf(zones: MapZone[], pins: MapPin[]): mapboxgl.LngLatBounds | null {
  const pts: [number, number][] = [];
  for (const z of zones) pts.push(...((z.polygon.type === 'Polygon' ? [z.polygon.coordinates] : z.polygon.coordinates).flat(2) as [number, number][]));
  if (!pts.length) for (const p of pins) pts.push([p.lng, p.lat]);
  if (!pts.length) return null;
  return pts.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(pts[0], pts[0]));
}

export const RepMapView = React.forwardRef<RepMapHandle, {
  zones: MapZone[]; pins: MapPin[]; onPick: (id: string) => void; onMapTap?: ((p: { lat: number; lng: number }) => void) | null;
  fitKey: string; showCounts?: boolean; children?: React.ReactNode;
}>(({ zones, pins, onPick, onMapTap, fitKey, showCounts = true, children }, ref) => {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const tap = useRef(onMapTap); tap.current = onMapTap;

  useImperativeHandle(ref, () => ({
    flyTo: (p, zoom = 17) => map.current?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(zoom, map.current.getZoom()), duration: 600 }),
  }), []);

  useEffect(() => {
    if (!box.current || map.current) return;
    const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
    try {
      if (token) mapboxgl.accessToken = token;
      const m = new mapboxgl.Map({ container: box.current, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE,
        center: [-79.69, 43.45], zoom: 12, attributionControl: false });
      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      m.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true }), 'top-right');
      m.on('load', () => {
        tidyRmBaseMap(m);
        m.addSource('rep-zone', { type: 'geojson', data: EMPTY });
        m.addSource('rep-pins', { type: 'geojson', data: EMPTY });
        m.addSource('rep-zone-label', { type: 'geojson', data: EMPTY });   // apart, so a font that won't load can't hide the outlines
        m.addLayer({ id: 'rep-zone-fill', type: 'fill', source: 'rep-zone', paint: { 'fill-color': ['get', 'color'] as never, 'fill-opacity': 0.06 } });
        m.addLayer({ id: 'rep-zone-line', type: 'line', source: 'rep-zone', paint: { 'line-color': ['get', 'color'] as never, 'line-width': 3 } });
        m.addLayer({ id: 'rep-zone-name', type: 'symbol', source: 'rep-zone-label', maxzoom: 14.5, layout: {
          'text-field': ['get', 'name'], 'text-size': 13, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] },
          paint: { 'text-color': ['get', 'color'] as never, 'text-halo-color': '#fff', 'text-halo-width': 2 } });
        m.addLayer({ id: 'rep-pins', type: 'circle', source: 'rep-pins', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 17, 9.5], 'circle-color': STATE_COLOR as never,
          'circle-opacity': ['case', ['==', ['get', 'dim'], 1], 0.35, 1],
          'circle-stroke-color': ['case', ['==', ['get', 'lead'], 1], '#0f766e', '#111827'],
          'circle-stroke-width': ['case', ['==', ['get', 'lead'], 1], 2.5, 1.4],
          'circle-stroke-opacity': ['case', ['==', ['get', 'dim'], 1], 0.4, 1] } });
        m.addLayer({ id: 'rep-names', type: 'symbol', source: 'rep-pins', minzoom: 16, layout: {
          'text-field': ['get', 'name'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
          paint: { 'text-color': '#111827', 'text-halo-color': '#fff', 'text-halo-width': 1.6, 'text-opacity': ['case', ['==', ['get', 'dim'], 1], 0.5, 1] } });
        m.on('click', e => {
          if (tap.current) { tap.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }); return; }
          const f = m.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['rep-pins'] })[0];
          const id = f?.properties?.id;
          if (id) pick.current(String(id));
        });
        m.on('mouseenter', 'rep-pins', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'rep-pins', () => { m.getCanvas().style.cursor = tap.current ? 'crosshair' : ''; });
        setReady(true);
      });
      m.on('error', e => { if (!m.loaded()) setFailed(String((e as { error?: Error }).error?.message || 'The map didn’t load')); });
      const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
      map.current = m;
      return () => { ro.disconnect(); removeMap(m); map.current = null; };
    } catch (e) { setFailed(e instanceof Error ? e.message : 'The map didn’t load'); }
  }, []);

  useEffect(() => { const m = map.current; if (m && ready) m.getCanvas().style.cursor = onMapTap ? 'crosshair' : ''; }, [onMapTap, ready]);

  // outlines, and fit once per fitKey
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    (m.getSource('rep-zone') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: zones.map(z => ({
      type: 'Feature', properties: { id: z.id, name: z.name, color: z.color }, geometry: z.polygon })) });
    (m.getSource('rep-zone-label') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: zones.filter(z => z.name).map(z => ({
      type: 'Feature', properties: { name: z.name, color: z.color }, geometry: z.polygon })) });
    if (fitted.current !== fitKey) {
      const b = boundsOf(zones, pins);
      if (b) { m.fitBounds(b, { padding: 36, duration: 0, maxZoom: 16 }); fitted.current = fitKey; }
    }
  }, [ready, zones, fitKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    (m.getSource('rep-pins') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pins.map(b => ({
      type: 'Feature', properties: { id: b.id, name: b.name, state: b.state, dim: b.dim ? 1 : 0, lead: b.lead ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [b.lng, b.lat] } })) });
  }, [ready, pins]);

  const counts = useMemo(() => { const c: Partial<Record<PinState, number>> = {}; for (const b of pins) c[b.state] = (c[b.state] || 0) + 1; return c; }, [pins]);
  return (
    <div className="v2-rep-map">
      <div ref={box} className="box" />
      {failed && <div className="v2-err" style={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 3 }}>{failed}</div>}
      {showCounts && (
        <div className="v2-rep-legend">
          {(Object.keys(PIN) as PinState[]).filter(k => counts[k]).map(k => <span key={k}><i className="v2-rep-dot" style={{ background: PIN[k].color }} />{PIN[k].label} {counts[k]}</span>)}
          {!pins.length && <span>Nothing left to visit here.</span>}
        </div>)}
      {children}
    </div>
  );
});
RepMapView.displayName = 'RepMapView';

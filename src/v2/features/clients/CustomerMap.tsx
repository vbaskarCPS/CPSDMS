// src/v2/features/clients/CustomerMap.tsx — Customers: opens on a map of the person's territory.
// Pick a route map; every customer is a dot coloured by what happened this season (back again, new,
// owed, said no, past customer). Tap a dot for the house, then open its customer page.
//
// Drawn like the RM map: the same tidied streets map, routes in their own colours with big route
// numbers, past customers as the RM's small grey dots, and every house in the workers' knock
// colours once zoomed in to street level.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Search, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { routeShapes } from '../../lib/territory';
import { RM_LINE, RM_NUMBER, RM_STYLE, rmLabelAnchor, tidyRmBaseMap } from '../../../lib/rmMapStyle';
import { useRouteHouseLayer } from '../../../pages/Management/components/useRouteHouseLayer';
import type { SavedRouteMap } from '../../../lib/mapLogsheetService';
import { getWorkerPCL, type PCLClientGroup } from '../../../lib/pclCacheService';
import { db, must } from '../../lib/client';
import { areaCustomers, CATS, catOf, countByCat, fmtMoney, myAreas, type AreaPoint, type Cat } from '../../lib/customers';
import { Btn, ErrorBox, Loading } from '../../ui';

const BLANK_STYLE: mapboxgl.StyleSpecification = {
  version: 8, sources: {}, glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f3' } }],
};
const LAST = 'v2.crm.area';
const NONE: never[] = [];
/** Categories done this season: drawn as an X, like the RM map's "previously done". */
const DONE_NOW = new Set<Cat>(['done', 'new', 'owed']);
/** The RM map's X (16 px, drawn at 2×), in a colour, with a white edge so it reads on any street. */
function xImage(color: string): ImageData | null {
  const n = 20, c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d'); if (!g) return null;
  const pad = 4; g.lineCap = 'round';
  const draw = (w: number, col: string) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(pad, pad); g.lineTo(n - pad, n - pad); g.moveTo(n - pad, pad); g.lineTo(pad, n - pad); g.stroke(); };
  draw(6, '#ffffff'); draw(3.2, color);
  return g.getImageData(0, 0, n, n);
}
const remember = (a: string) => { try { localStorage.setItem(LAST, a); } catch { /* private window */ } };
const recall = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

export const canReadCustomers = (can: (p: 'dialer' | 'bookings' | 'workerbook' | 'sa_territory') => boolean) =>
  can('dialer') || can('bookings') || can('workerbook') || can('sa_territory');

export const CustomerMap: React.FC = () => {
  const { can, center } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const allowed = canReadCustomers(can);
  // Only the route maps assigned to the center picked in the top bar (its territory).
  const areas = useLoad(async () => {
    if (!allowed || !center) return [];
    const [mine, assigned] = await Promise.all([
      myAreas(),
      db.from('map_area_centers').select('area_name').eq('center_id', center.id).then(r => must(r) as { area_name: string }[]),
    ]);
    const here = new Set(assigned.map(a => a.area_name));
    return mine.filter(a => here.has(a.area));
  }, [allowed, center?.id]);
  const list = areas.data || [];
  const fromUrl = params.get('area');
  const area = (fromUrl && list.some(a => a.area === fromUrl) ? fromUrl : null)
    || (() => { const r = recall(); return r && list.some(a => a.area === r) ? r : null; })()
    || [...list].sort((a, b) => b.done - a.done || b.customers - a.customers)[0]?.area || null;
  const pick = (a: string) => { remember(a); setParams({ area: a }, { replace: true }); setSel(null); };

  const data = useLoad(() => area ? areaCustomers(area) : Promise.resolve(null), [area]);
  const shapes = useLoad(() => area ? routeShapes([area]) : Promise.resolve([]), [area]);
  const [hidden, setHidden] = useState<Set<Cat>>(new Set(['none']));
  const [sel, setSel] = useState<AreaPoint | null>(null);
  const [q, setQ] = useState('');

  const pts = useMemo(() => data.data?.points || [], [data.data]);
  const counts = useMemo(() => countByCat(pts), [pts]);
  const shown = useMemo(() => pts.filter(p => !hidden.has(p.cat)), [pts, hidden]);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase(); if (s.length < 2) return [];
    return pts.filter(p => `${p.address} ${p.name || ''} ${p.route}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, pts]);
  const flip = (c: Cat) => setHidden(h => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  // ── the map ──
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const ptsRef = useRef<AreaPoint[]>([]); ptsRef.current = shown;
  useEffect(() => {
    if (!box.current || map.current) return;
    const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
    try {
      if (token) mapboxgl.accessToken = token;
      const m = new mapboxgl.Map({ container: box.current, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE,
        center: [-79.73, 43.45], zoom: 11, attributionControl: false });
      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      let loaded = false;
      m.on('load', () => { loaded = true; tidyRmBaseMap(m); setReady(true); });
      const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current); (m as unknown as { __ro?: ResizeObserver }).__ro = ro;
      // Only a map that never loaded is a failure; later hiccups (a tile, a font) aren't.
      m.on('error', e => { if (!loaded) setFailed(String((e as { error?: Error }).error?.message || 'Map failed to load')); });
      map.current = m;
      (box.current as HTMLDivElement & { __map?: mapboxgl.Map }).__map = m;
    } catch (e) { setFailed(e instanceof Error ? e.message : 'Map failed to load'); }
    return () => { (map.current as unknown as { __ro?: ResizeObserver } | null)?.__ro?.disconnect(); try { map.current?.remove(); } catch { /* gone */ } map.current = null; setReady(false); };
  }, []);

  // route lines in their own colours, with big route numbers (as on the RM map)
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const list = shapes.data || [];
    const lines: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: list.flatMap(s => s.lines.map(l => ({ type: 'Feature' as const, properties: { code: s.code, color: s.color || '#6b7280' }, geometry: { type: 'LineString' as const, coordinates: l } }))) };
    const nums: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: list.flatMap(s => {
      const cs = s.lines.flat(); if (!cs.length) return [];
      const c: [number, number] = [cs.reduce((t, p) => t + p[0], 0) / cs.length, cs.reduce((t, p) => t + p[1], 0) / cs.length];
      return [{ type: 'Feature' as const, properties: { num: String(s.number), color: s.color || '#6b7280' }, geometry: { type: 'Point' as const, coordinates: c } }];
    }) };
    const src = m.getSource('crm-routes') as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(lines); (m.getSource('crm-nums') as mapboxgl.GeoJSONSource | undefined)?.setData(nums); return; }
    m.addSource('crm-routes', { type: 'geojson', data: lines });
    m.addLayer({ id: 'crm-routes', type: 'line', source: 'crm-routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': RM_LINE.width, 'line-opacity': RM_LINE.opacity } }, rmLabelAnchor(m, 'crm-'));
    m.addSource('crm-nums', { type: 'geojson', data: nums });
    m.addLayer({ id: 'crm-nums', type: 'symbol', source: 'crm-nums',
      layout: { 'text-field': ['get', 'num'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': RM_NUMBER.size, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': RM_NUMBER.halo, 'text-halo-width': RM_NUMBER.haloWidth } });
  }, [ready, shapes.data]);

  // every house in the workers' knock colours once zoomed in (the RM map's house layer)
  const routeMaps = useMemo<SavedRouteMap[]>(() => (shapes.data || []).map(s => ({
    id: s.id || s.code, route_code: s.code, route_color: s.color || '#6b7280', route_number: s.number,
    segments: s.lines.map((coordinates, i) => ({ osmId: i, name: '', coordinates })),
  })), [shapes.data]);
  const noPcl = useMemo(() => new Map<string, PCLClientGroup[]>(), []);
  // The route's past clients, as the RM map has them: PCL houses blue, done this season purple.
  const pcl = useLoad(async () => {
    const codes = routeMaps.map(r => r.route_code);
    if (!codes.length || !center) return new Map<string, PCLClientGroup[]>();
    return getWorkerPCL(codes, center.id).catch(() => new Map<string, PCLClientGroup[]>());
  }, [routeMaps, center?.id]);
  useRouteHouseLayer({ map: map.current, mapLoaded: ready, routeMaps, skipRoutes: NONE, bookings: NONE, pendingSales: NONE, pclByRoute: pcl.data || noPcl, historical: NONE });

  // customers: done this season (back again, new, owed) as the RM map's X, coloured by category;
  // said no as a small dark-edged dot; past customers as the RM's small grey PCL dots
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: shown.map((p, i) => ({ type: 'Feature', properties: {
      i, cat: p.cat, x: DONE_NOW.has(p.cat) ? 1 : 0, color: p.cat === 'past' ? '#6b7280' : catOf(p.cat).color, big: p.cat === 'none' || p.cat === 'past' ? 0 : 1,
    }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) };
    const src = m.getSource('crm-pts') as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(fc); return; }
    for (const c of CATS) if (DONE_NOW.has(c.key) && !m.hasImage(`crm-x-${c.key}`)) { const img = xImage(c.color); if (img) m.addImage(`crm-x-${c.key}`, img, { pixelRatio: 2 }); }
    m.addSource('crm-pts', { type: 'geojson', data: fc });
    m.addLayer({ id: 'crm-pts', type: 'circle', source: 'crm-pts', filter: ['==', ['get', 'x'], 0], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'big'], 1], 3.33, 1.75], 17, ['case', ['==', ['get', 'big'], 1], 6, 3.5]],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': ['case', ['==', ['get', 'big'], 1], '#000000', '#374151'],
      'circle-stroke-width': ['case', ['==', ['get', 'big'], 1], 1.67, 0.5],
      'circle-opacity': ['case', ['==', ['get', 'big'], 1], 0.95, 0.7] } });
    m.addLayer({ id: 'crm-x', type: 'symbol', source: 'crm-pts', filter: ['==', ['get', 'x'], 1], layout: {
      'icon-image': ['concat', 'crm-x-', ['get', 'cat']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 17, 1.6],
      'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    m.addSource('crm-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'crm-sel', type: 'circle', source: 'crm-sel', paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2.5 } });
    for (const layer of ['crm-pts', 'crm-x']) {
      m.on('click', layer, e => { const i = e.features?.[0]?.properties?.i; const p = typeof i === 'number' ? ptsRef.current[i] : undefined; if (p) setSel(p); });
      m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
    }
  }, [ready, shown]);

  // customers, the picked house and route numbers stay on top of the house layer
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const lift = () => ['crm-pts', 'crm-x', 'crm-sel', 'crm-nums'].forEach(id => { try { if (m.getLayer(id)) m.moveLayer(id); } catch { /* */ } });
    lift();
    const t = setTimeout(lift, 500);
    return () => clearTimeout(t);
  }, [ready, shown, shapes.data, routeMaps]);

  // the picked house
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const src = m.getSource('crm-sel') as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: sel ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [sel.lng, sel.lat] } }] : [] });
  }, [ready, sel, shown]);

  // zoom to the map's routes (or its customers)
  useEffect(() => {
    const m = map.current; if (!m || !ready || shapes.loading || data.loading) return;
    const b = new mapboxgl.LngLatBounds(); let any = false;
    for (const s of shapes.data || []) for (const l of s.lines) for (const c of l) { b.extend(c); any = true; }
    if (!any) for (const p of pts) { b.extend([p.lng, p.lat]); any = true; }
    if (any) m.fitBounds(b, { padding: 40, animate: false, maxZoom: 15.5 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, area, shapes.loading, data.loading]);

  const goTo = (p: AreaPoint) => { setSel(p); setQ(''); if (hidden.has(p.cat)) flip(p.cat); map.current?.flyTo({ center: [p.lng, p.lat], zoom: 17 }); };

  if (!allowed) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to customers.</div></div>;
  const t = data.data?.totals;
  const year = data.data?.year || new Date().getFullYear();
  return (
    <div className="v2-crm">
      <aside className="v2-crm-side">
        <div className="v2-crm-top">
          <div className="v2-row" style={{ gap: 8 }}>
            <span className="v2-h1" style={{ fontSize: 20 }}>Customers</span>
            <span className="v2-spacer" />
            {(can('dialer') || can('sa_territory')) && <Link className="v2-chip" to="/app/clients/list">List</Link>}
          </div>
          <ErrorBox error={areas.error} />
          {areas.loading && !areas.data ? <Loading label="Finding your route maps…" /> : !list.length ? (
            <div className="v2-card v2-mut">{center ? `No route maps are assigned to ${center.display_name} yet. A Super Admin assigns them under Territory.` : 'Pick a center in the top bar to see its route maps.'}</div>
          ) : <>
            {center && <div className="v2-mut v2-small">{center.display_name}’s territory · {list.length} map{list.length === 1 ? '' : 's'}</div>}
            <select className="v2-input" value={area || ''} onChange={e => pick(e.target.value)} aria-label="Route map">
              {list.map(a => <option key={a.area} value={a.area}>{a.area} · {a.customers.toLocaleString()} customers</option>)}
            </select>
            <div className="v2-crm-search">
              <Search size={14} />
              <input className="v2-input" placeholder="Find an address or name" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a customer" />
              {matches.length > 0 && (
                <div className="v2-crm-found v2-island">
                  {matches.map((p, i) => (
                    <button key={i} type="button" onClick={() => goTo(p)}>
                      <i style={{ background: catOf(p.cat).color }} /><b>{p.address}</b><span>{p.name || ''} · {p.route}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>}
        </div>
        {list.length > 0 && <div className="v2-crm-stats">
          <ErrorBox error={data.error || shapes.error} />
          <div className="v2-crm-kpis">
            <Kpi label={`Done in ${year}`} value={t ? t.done.toLocaleString() : '…'} />
            <Kpi label="Paid this season" value={t ? fmtMoney(t.paid) : '…'} />
            <Kpi label="New customers" value={t ? t.new.toLocaleString() : '…'} />
            <Kpi label="Back again" value={t ? t.back.toLocaleString() : '…'} />
            <Kpi label="Owed" value={t ? `${t.owed}` : '…'} sub={t && t.owed ? fmtMoney(t.owed_amount) : undefined} tone={t && t.owed ? 'a' : undefined} />
            <Kpi label="On file" value={t ? t.customers.toLocaleString() : '…'} sub={data.data ? `${data.data.routes} routes` : undefined} />
          </div>
          <div className="v2-card" style={{ padding: 8 }}>
            <div className="v2-card-h" style={{ margin: '4px 6px 6px' }}>On the map · tap to show or hide</div>
            {CATS.map(c => (
              <button key={c.key} type="button" className={`v2-crm-leg${hidden.has(c.key) ? ' off' : ''}`} onClick={() => flip(c.key)} title={c.hint} aria-pressed={!hidden.has(c.key)}>
                {DONE_NOW.has(c.key) ? <span className="v2-crm-x" style={{ color: c.color }} aria-hidden>✕</span> : <i style={{ background: c.color }} />}<span>{c.label}</span><b>{counts[c.key].toLocaleString()}</b>
              </button>
            ))}
          </div>
        </div>}
      </aside>
      <section className="v2-crm-map">
        <div ref={box} className="v2-crm-canvas" data-testid="crm-map" />
        {failed && <div className="v2-crm-over v2-island v2-err">{failed}</div>}
        {(data.loading || shapes.loading) && area && <div className="v2-crm-over v2-island v2-mut v2-small">Loading {area}…</div>}
        {sel && (
          <div className="v2-crm-pick v2-island" role="dialog" aria-label="House">
            <div className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <i className="dot" style={{ background: catOf(sel.cat).color }} />
              <b style={{ fontSize: 15 }}>{sel.address}</b>
              <span className="v2-spacer" />
              <button type="button" className="v2-x" onClick={() => setSel(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="v2-mut v2-small" style={{ margin: '4px 0 10px 18px' }}>
              {[sel.name, `route ${sel.route}`, catOf(sel.cat).label, sel.paid ? `${fmtMoney(sel.paid)} this season` : null].filter(Boolean).join(' · ')}
            </div>
            {sel.id ? <Btn size="sm" onClick={() => nav(`/app/clients/c/${sel.id}${area ? `?area=${encodeURIComponent(area)}` : ''}`)}>Open customer page</Btn>
              : <div className="v2-note" style={{ margin: 0 }}>Not a customer: this house said no or was marked invalid this season.</div>}
          </div>
        )}
      </section>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; sub?: string; tone?: 'a' }> = ({ label, value, sub, tone }) => (
  <div className={`v2-card v2-crm-kpi${tone ? ` ${tone}` : ''}`}>
    <span className="l">{label}</span><b>{value}</b>{sub && <span className="s">{sub}</span>}
  </div>
);

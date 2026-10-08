// src/v2/features/clients/CustomerMap.tsx — Customers: opens on a map of the person's territory.
// Pick a route map; every customer is a dot coloured by what happened this season (back again, new,
// owed, said no, past customer). Tap a dot for the house, then open its customer page.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Search, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { routeShapes } from '../../lib/territory';
import { areaCustomers, CATS, catOf, countByCat, fmtMoney, myAreas, type AreaPoint, type Cat } from '../../lib/customers';
import { Btn, ErrorBox, Loading } from '../../ui';

const BLANK_STYLE: mapboxgl.StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f3' } }],
};
const LAST = 'v2.crm.area';
const remember = (a: string) => { try { localStorage.setItem(LAST, a); } catch { /* private window */ } };
const recall = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

export const canReadCustomers = (can: (p: 'dialer' | 'bookings' | 'workerbook' | 'sa_territory') => boolean) =>
  can('dialer') || can('bookings') || can('workerbook') || can('sa_territory');

export const CustomerMap: React.FC = () => {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const allowed = canReadCustomers(can);
  const areas = useLoad(() => allowed ? myAreas() : Promise.resolve([]), [allowed]);
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
      const m = new mapboxgl.Map({ container: box.current, style: token && token !== 'pk.test' ? 'mapbox://styles/mapbox/light-v11' : BLANK_STYLE,
        center: [-79.73, 43.45], zoom: 11, attributionControl: false });
      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      m.on('load', () => setReady(true));
      const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current); (m as unknown as { __ro?: ResizeObserver }).__ro = ro;
      m.on('error', e => { if (!m.isStyleLoaded()) setFailed(String((e as { error?: Error }).error?.message || 'Map failed to load')); });
      map.current = m;
      (box.current as HTMLDivElement & { __map?: mapboxgl.Map }).__map = m;
    } catch (e) { setFailed(e instanceof Error ? e.message : 'Map failed to load'); }
    return () => { (map.current as unknown as { __ro?: ResizeObserver } | null)?.__ro?.disconnect(); try { map.current?.remove(); } catch { /* gone */ } map.current = null; setReady(false); };
  }, []);

  // route lines
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: (shapes.data || []).flatMap(s => s.lines.map(l => ({ type: 'Feature' as const, properties: { code: s.code }, geometry: { type: 'LineString' as const, coordinates: l } }))) };
    const src = m.getSource('crm-routes') as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else {
      m.addSource('crm-routes', { type: 'geojson', data: fc });
      m.addLayer({ id: 'crm-routes', type: 'line', source: 'crm-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#94a3b8', 'line-width': 3, 'line-opacity': 0.6 } });
    }
  }, [ready, shapes.data]);

  // customer dots
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: shown.map((p, i) => ({ type: 'Feature', properties: { i, color: catOf(p.cat).color, big: p.cat === 'none' ? 0 : 1 }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) };
    const src = m.getSource('crm-pts') as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(fc); return; }
    m.addSource('crm-pts', { type: 'geojson', data: fc });
    m.addLayer({ id: 'crm-pts', type: 'circle', source: 'crm-pts', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'big'], 1], 3.5, 2.5], 16, ['case', ['==', ['get', 'big'], 1], 8, 5]],
      'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
    m.addSource('crm-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'crm-sel', type: 'circle', source: 'crm-sel', paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2.5 } });
    m.on('click', 'crm-pts', e => { const i = e.features?.[0]?.properties?.i; const p = typeof i === 'number' ? ptsRef.current[i] : undefined; if (p) setSel(p); });
    m.on('mouseenter', 'crm-pts', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'crm-pts', () => { m.getCanvas().style.cursor = ''; });
  }, [ready, shown]);

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
            <div className="v2-card v2-mut">No route maps are assigned to your centers yet. A Super Admin assigns them under Territory.</div>
          ) : <>
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
                <i style={{ background: c.color }} /><span>{c.label}</span><b>{counts[c.key].toLocaleString()}</b>
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

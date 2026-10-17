// src/v2/features/admin/AllMapsPage.tsx — Territory › All maps: the outline of every master map on one map
// (like Master Bookings' first level), coloured by region. Tap a map for its details, then open it in
// the builder or see its routes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Map as MbMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Eye, Pencil, Search, X } from 'lucide-react';
import { listCenters, useLoad } from '../../lib/data';
import {
  allRoutes, listAreaPrefixes, listAssignments, mergeAreas, outlineFeatures, REGION_COLOR, REGIONS, territoryOutlines,
  type AreaRow, type OutlineInfo, type Region,
} from '../../lib/territory';
import { Btn, ErrorBox, Loading } from '../../ui';
import { coordsOf, createMap, fit, removeMap } from '../bookings/mbMap';
import { RegionTag, TerritoryTabs } from './Territory';

type RegionPick = Region | 'none' | 'all';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const AllMapsPage: React.FC = () => {
  const nav = useNavigate();
  const outlines = useLoad(territoryOutlines, []);
  const routes = useLoad(allRoutes, []);
  const assigned = useLoad(listAssignments, []);
  const prefixes = useLoad(listAreaPrefixes, []);
  const centers = useLoad(listCenters, []);
  const [region, setRegion] = useState<RegionPick>('all');
  const [centerId, setCenterId] = useState<string>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const areas: AreaRow[] = useMemo(() => routes.data && assigned.data && prefixes.data ? mergeAreas(prefixes.data, routes.data, assigned.data) : [],
    [routes.data, assigned.data, prefixes.data]);
  const byName = useMemo(() => new Map(areas.map(a => [a.name, a])), [areas]);
  const info = useMemo(() => new Map<string, OutlineInfo>(areas.map(a => [a.name, { region: a.region }])), [areas]);
  const centerName = (id: string | null) => (id && (centers.data || []).find(c => c.id === id)?.display_name) || null;
  // the maps the filters keep
  const shown = useMemo(() => {
    const all = outlines.data || {};
    return Object.fromEntries(Object.entries(all).filter(([name]) => {
      const a = byName.get(name);
      if (region !== 'all' && (a?.region || 'none') !== region) return false;
      if (centerId === 'unassigned' ? !!a?.centerId : centerId !== 'all' && a?.centerId !== centerId) return false;
      return true;
    }));
  }, [outlines.data, byName, region, centerId]);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return Object.keys(outlines.data || {}).filter(name => name.toLowerCase().includes(n) || (byName.get(name)?.city || '').toLowerCase().includes(n)
      || (byName.get(name)?.prefix || '').toLowerCase() === n).slice(0, 8);
  }, [q, outlines.data, byName]);

  // ── the map ──
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MbMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const pickRef = useRef<(a: string | null) => void>(() => {});
  pickRef.current = setPicked;
  useEffect(() => {
    if (!box.current || map.current) return;
    map.current = createMap(box.current, m => {
      m.addSource('ta-out', { type: 'geojson', data: EMPTY });
      m.addSource('ta-labels', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'ta-fill', type: 'fill', source: 'ta-out', paint: {
        'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.35, 0.12] } });
      m.addLayer({ id: 'ta-line', type: 'line', source: 'ta-out', paint: {
        'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 3.5, 1.5] } });
      m.addLayer({ id: 'ta-label', type: 'symbol', source: 'ta-labels', layout: {
        'text-field': ['get', 'label'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
      m.on('click', 'ta-fill', e => { const a = e.features?.[0]?.properties?.area; if (a) pickRef.current(String(a)); });
      m.on('mouseenter', 'ta-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'ta-fill', () => { m.getCanvas().style.cursor = ''; });
      setReady(true);
    }, setFailed);
    return () => { removeMap(map.current); map.current = null; setReady(false); };
  }, []);
  const features = useMemo(() => outlineFeatures(shown, info, null, picked), [shown, info, picked]);
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    (m.getSource('ta-out') as mapboxgl.GeoJSONSource | undefined)?.setData(features.shapes);
    (m.getSource('ta-labels') as mapboxgl.GeoJSONSource | undefined)?.setData(features.labels);
  }, [ready, features]);
  // fit to what's shown when the data or the filters change (not when a map is picked)
  useEffect(() => {
    if (!ready) return;
    fit(map.current, Object.values(shown).flatMap(g => coordsOf(g)), 13);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, outlines.data, region, centerId]);
  const goTo = (name: string) => {
    setPicked(name); setQ('');
    const g = (outlines.data || {})[name];
    if (g) fit(map.current, coordsOf(g), 14);
  };

  const p = picked ? byName.get(picked) : null;
  const loading = outlines.loading && !outlines.data;
  const missing = areas.filter(a => a.routes.length > 0 && !(outlines.data || {})[a.name]).length;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const name of Object.keys(outlines.data || {})) { const r = byName.get(name)?.region || 'none'; m.set(r, (m.get(r) || 0) + 1); }
    return m;
  }, [outlines.data, byName]);

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Territory & Client Data</span>
        <span className="v2-spacer" />
        <span className="v2-mut v2-small">{Object.keys(shown).length} of {Object.keys(outlines.data || {}).length} maps shown{missing ? ` · ${missing} with routes still being outlined` : ''}</span>
      </div>
      <TerritoryTabs on="all" />
      <div className="v2-row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <button className={`v2-chip${region === 'all' ? ' on' : ''}`} onClick={() => setRegion('all')}>All regions</button>
        {[...REGIONS, 'none' as const].map(r => (
          <button key={r} className={`v2-chip${region === r ? ' on' : ''}`} onClick={() => setRegion(r)}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: REGION_COLOR[r], marginRight: 6 }} />
            {r === 'none' ? 'No region' : r} {counts.get(r) || 0}
          </button>
        ))}
        <select className="v2-sel" style={{ width: 200 }} value={centerId} onChange={e => setCenterId(e.target.value)} aria-label="Filter by center">
          <option value="all">Every center</option>
          <option value="unassigned">Unassigned</option>
          {(centers.data || []).map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
        <span className="v2-spacer" />
        <div style={{ position: 'relative', width: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} aria-hidden="true" />
          <input className="v2-input" style={{ paddingLeft: 30 }} placeholder="Find a map, city or prefix" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a map" />
          {matches.length > 0 && (
            <div className="v2-card" style={{ position: 'absolute', top: 40, left: 0, right: 0, zIndex: 5, padding: 4 }}>
              {matches.map(m => (
                <button key={m} className="v2-menu-row" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => goTo(m)}>
                  <b>{m}</b> <span className="v2-mut v2-small">{byName.get(m)?.city || ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <ErrorBox error={outlines.error || routes.error || prefixes.error} />
      <div style={{ position: 'relative', height: 'calc(100vh - 310px)', minHeight: 420, borderRadius: 12, overflow: 'hidden', background: '#eef0f3' }}>
        <div ref={box} data-testid="ta-map" style={{ position: 'absolute', inset: 0 }} />
        {(loading || !ready) && !failed && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loading label="Outlining every map (the first time takes a few seconds)…" /></div>}
        {failed && <div className="v2-err" style={{ position: 'absolute', left: 12, top: 12 }}>{failed}</div>}
        {p && (
          <div className="v2-card" style={{ position: 'absolute', left: 12, bottom: 12, width: 320, maxWidth: 'calc(100% - 24px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="v2-row" style={{ gap: 8 }}>
              <b style={{ fontSize: 16, flex: 1 }}>{p.name}</b>
              <button className="v2-gbtn" onClick={() => setPicked(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="v2-row v2-small" style={{ gap: 8, flexWrap: 'wrap' }}>
              <RegionTag r={p.region} />
              <span className="v2-mut">{p.city || 'No city yet'}</span>
              <span className="v2-mut">· {centerName(p.centerId) || 'Unassigned'}</span>
            </div>
            <div className="v2-small">{p.routes.length} route{p.routes.length === 1 ? '' : 's'} · {p.numbers || p.prefix}</div>
            <div className="v2-row" style={{ gap: 8 }}>
              <Btn size="sm" icon={Pencil} onClick={() => nav(`/app/admin/territory/builder/${encodeURIComponent(p.name)}`)}>Open in builder</Btn>
              <Btn size="sm" kind="o" icon={Eye} onClick={() => nav(`/app/admin/territory/view?areas=${encodeURIComponent(p.name)}`)}>See its routes</Btn>
            </div>
          </div>
        )}
      </div>
      <p className="v2-mut v2-small" style={{ marginTop: 8 }}>Each outline is drawn around a map’s approved routes. Tap one for its details. <Link className="v2-link" to="/app/admin/territory">Back to the list</Link></p>
    </div>
  );
};

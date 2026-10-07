// src/v2/features/workerbook/MapRoutePicker.tsx — the route picker (Start session, and adding
// routes to a live session). Always a map, Digimaps-style:
//
//   1. pick a map (an area) — from the list, or by tapping its name on the map
//   2. the map zooms to it: its routes with big tappable route numbers, and the callbook
//      clients (PCL) as small grey dots; each number also shows that route's PCL count
//   3. assign the whole map to the manager you're picking for, or tap route numbers one by one
//
// Every manager's routes show in their own colour, so you can see how the day is split.
// Routes in `locked` (already on a live session) can't be changed.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ChevronLeft, Lock } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { pclCounts, pclDots, type Area, type PclDot, type RouteShape } from '../../lib/territory';
import type { PlanManager, PlanRoute } from '../../lib/startSession';
import { Btn } from '../../ui';

export const MANAGER_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#0d9488', '#e11d48', '#0284c7', '#65a30d', '#c026d3'];
const FREE = '#6b7280';
const DIM = '#cbd5e1';

const BLANK_STYLE: mapboxgl.StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f3' } }],
};

interface Props {
  areas: Area[];
  shapes: RouteShape[];
  managers: PlanManager[];
  routes: Map<string, PlanRoute>;          // what's picked (editable)
  locked?: Map<string, string>;            // route code → manager id; can't be changed
  active: string;                          // the manager taps assign to
  onActive: (managerId: string) => void;
  onChange: (next: Map<string, PlanRoute>) => void;
  footer?: React.ReactNode;
}

export const MapRoutePicker: React.FC<Props> = ({ areas, shapes, managers, routes, locked, active, onActive, onChange, footer }) => {
  const [areaName, setAreaName] = useState<string | null>(null);
  const area = areas.find(a => a.name === areaName) || null;
  const counts = useLoad(() => pclCounts(areas.map(a => a.name)), [areas.map(a => a.name).join('|')]);
  const dots = useLoad(() => area ? pclDots(area.name) : Promise.resolve([] as PclDot[]), [area?.name]);
  const pcl = counts.data || new Map<string, number>();

  const colorOf = (id: string) => MANAGER_COLORS[Math.max(0, managers.findIndex(m => m.id === id)) % MANAGER_COLORS.length];
  const ownerOf = (code: string): string | null => locked?.get(code) || routes.get(code)?.managerId || null;
  const isLocked = (code: string) => !!locked?.has(code);
  const activeName = managers.find(m => m.id === active)?.full_name || '';

  // ── assigning ──
  const toggle = (code: string, a: string, number: number) => {
    if (!active || isLocked(code)) return;
    const n = new Map(routes); const cur = n.get(code);
    if (cur && cur.managerId === active) n.delete(code); else n.set(code, { code, area: a, number, managerId: active });
    onChange(n);
  };
  const assignArea = (a: Area) => {
    if (!active) return;
    const n = new Map(routes);
    for (const r of a.routes) if (!isLocked(r.route_code)) n.set(r.route_code, { code: r.route_code, area: a.name, number: r.route_number, managerId: active });
    onChange(n);
  };
  const clearArea = (a: Area, onlyActive: boolean) => {
    const n = new Map(routes);
    for (const r of a.routes) { const cur = n.get(r.route_code); if (cur && (!onlyActive || cur.managerId === active)) n.delete(r.route_code); }
    onChange(n);
  };
  const toggleRef = useRef(toggle); toggleRef.current = toggle;
  const selectRef = useRef(setAreaName); selectRef.current = setAreaName;

  // ── the map ──
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

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
    return () => { (map.current as unknown as { __ro?: ResizeObserver } | null)?.__ro?.disconnect(); markers.current.forEach(x => x.remove()); markers.current = []; try { map.current?.remove(); } catch { /* gone */ } map.current = null; setReady(false); };
  }, []);

  const shapeMap = useMemo(() => new Map(shapes.map(s => [s.code, s])), [shapes]);
  const shapesRef = useRef(shapeMap); shapesRef.current = shapeMap;
  const areaRef = useRef<string | null>(null); areaRef.current = area?.name || null;
  const byArea = useMemo(() => { const m = new Map<string, RouteShape[]>(); for (const s of shapes) { if (!m.has(s.area)) m.set(s.area, []); m.get(s.area)!.push(s); } return m; }, [shapes]);
  const boundsOf = (list: RouteShape[]) => { const b = new mapboxgl.LngLatBounds(); let any = false; for (const s of list) for (const l of s.lines) for (const c of l) { b.extend(c); any = true; } return any ? b : null; };

  // route lines: manager colour when assigned; the open map's free routes darker than the rest
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
    for (const s of shapes) {
      const owner = ownerOf(s.code);
      const inArea = !area || s.area === area.name;
      const color = owner ? colorOf(owner) : inArea && area ? FREE : DIM;
      const w = owner ? (inArea ? 5 : 3) : (inArea && area ? 3 : 2);
      for (const line of s.lines) fc.features.push({ type: 'Feature', properties: { code: s.code, color, w, op: inArea ? 0.95 : 0.45 }, geometry: { type: 'LineString', coordinates: line } });
    }
    const src = m.getSource('routes') as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(fc); return; }
    m.addSource('routes', { type: 'geojson', data: fc });
    m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } });
    m.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'] } });
    m.on('click', 'routes-hit', e => {
      const code = e.features?.[0]?.properties?.code as string | undefined;
      const s = code ? shapesRef.current.get(code) : undefined;
      if (!s) return;
      if (s.area !== areaRef.current) { selectRef.current(s.area); return; }   // first tap opens that map
      toggleRef.current(s.code, s.area, s.number);
    });
    m.on('mouseenter', 'routes-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'routes-hit', () => { m.getCanvas().style.cursor = ''; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shapes, routes, locked, area?.name, managers]);

  // PCL dots for the open map
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: (dots.data || []).map(d => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d.lng, d.lat] } })) };
    const src = m.getSource('pcl') as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(fc); return; }
    m.addSource('pcl', { type: 'geojson', data: fc });
    m.addLayer({ id: 'pcl-dots', type: 'circle', source: 'pcl', paint: { 'circle-radius': 3, 'circle-color': '#4b5563', 'circle-opacity': 0.75, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
  }, [ready, dots.data]);

  // markers: the open map's route numbers (tap to pick), or every map's name (tap to open)
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    markers.current.forEach(x => x.remove()); markers.current = [];
    // halfway along the route's longest piece, so the number sits on the street
    const mid = (s: RouteShape): [number, number] | null => {
      const line = [...s.lines].sort((a, b) => b.length - a.length)[0]; if (!line?.length) return null;
      const len = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      let total = 0; for (let i = 1; i < line.length; i++) total += len(line[i - 1], line[i]);
      let left = total / 2;
      for (let i = 1; i < line.length; i++) {
        const d = len(line[i - 1], line[i]);
        if (d >= left && d > 0) { const t = left / d; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; }
        left -= d;
      }
      return line[0];
    };
    if (area) {
      for (const s of byArea.get(area.name) || []) {
        const at = mid(s); if (!at) continue;
        const owner = ownerOf(s.code); const lockedHere = isLocked(s.code);
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `v2-rnum${owner ? ' on' : ''}${lockedHere ? ' locked' : ''}`;
        el.style.setProperty('--c', owner ? colorOf(owner) : '#ffffff');
        el.setAttribute('aria-label', `Route ${s.code}${owner ? `, ${managers.find(x => x.id === owner)?.full_name || 'assigned'}` : ', free'}${lockedHere ? ' (on the live session)' : ''}`);
        const n = pcl.get(s.code) || 0;
        el.innerHTML = `<b>${s.number}</b>${n ? `<i>${n}</i>` : ''}`;
        el.addEventListener('click', ev => { ev.stopPropagation(); toggleRef.current(s.code, s.area, s.number); });
        markers.current.push(new mapboxgl.Marker({ element: el }).setLngLat(at).addTo(m));
      }
    } else {
      for (const a of areas) {
        const b = boundsOf(byArea.get(a.name) || []); if (!b) continue;
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'v2-aname';
        const picked = a.routes.filter(r => ownerOf(r.route_code)).length;
        el.innerHTML = `${a.name}<span>${picked}/${a.routes.length}</span>`;
        el.addEventListener('click', ev => { ev.stopPropagation(); selectRef.current(a.name); });
        markers.current.push(new mapboxgl.Marker({ element: el }).setLngLat(b.getCenter()).addTo(m));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, area?.name, byArea, routes, locked, managers, counts.data, areas]);

  // zoom: the open map, or all of them
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const b = boundsOf(area ? byArea.get(area.name) || [] : shapes);
    if (b) m.fitBounds(b, { padding: 50, animate: !!area, maxZoom: 15.5 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, area?.name, shapes]);

  // ── panel ──
  const areaStats = (a: Area) => {
    const own = new Map<string, number>();
    for (const r of a.routes) { const o = ownerOf(r.route_code); if (o) own.set(o, (own.get(o) || 0) + 1); }
    return { picked: [...own.values()].reduce((x, y) => x + y, 0), own, pcl: a.routes.reduce((x, r) => x + (pcl.get(r.route_code) || 0), 0) };
  };
  const held = (id: string) => { let n = 0; for (const a of areas) for (const r of a.routes) if (ownerOf(r.route_code) === id) n++; return n; };

  return (
    <div className="v2-split map">
      <div className="v2-routemap">
        <div ref={box} className="v2-routemap-canvas" aria-label="Map of this center’s routes" />
        {failed && <div className="v2-routemap-msg">The map couldn’t load ({failed}).</div>}
        {!failed && areas.length > 0 && shapes.length === 0 && <div className="v2-routemap-msg">Loading routes…</div>}
        <div className="v2-routemap-hint">
          {area ? <><button type="button" className="v2-link" onClick={() => setAreaName(null)} style={{ display: 'inline-flex', alignItems: 'center' }}><ChevronLeft size={14} />All maps</button>
            <b style={{ marginLeft: 6 }}>{area.name}</b>{dots.loading && <span className="v2-mut" style={{ marginLeft: 6 }}>loading PCL…</span>}</>
            : <>Tap a map to open it</>}
        </div>
        {active && <div className="v2-routemap-hint bottom"><span style={{ background: colorOf(active) }} />Taps go to <b>{activeName}</b></div>}
      </div>

      <div className="v2-stack" style={{ gap: 10 }}>
        <div className="v2-card" style={{ padding: 12 }}>
          <div className="v2-card-h">Assign to</div>
          <div className="v2-stack" style={{ gap: 6 }}>
            {managers.map(m => (
              <button key={m.id} type="button" className={`v2-mgr${active === m.id ? ' on' : ''}`} onClick={() => onActive(m.id)} aria-pressed={active === m.id}>
                <span className="dot" style={{ background: colorOf(m.id) }} /><b>{m.full_name}</b><span className="v2-spacer" /><span className="v2-mut v2-small">{held(m.id)} route{held(m.id) === 1 ? '' : 's'}</span>
              </button>
            ))}
            {managers.length === 0 && <div className="v2-mut v2-small">No managers available.</div>}
          </div>
        </div>

        {!area ? (
          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-card-h" style={{ padding: '12px 12px 0' }}>Maps</div>
            <div className="v2-maplist">
              {areas.map(a => {
                const st = areaStats(a);
                return (
                  <button key={a.name} type="button" className="v2-maprow" onClick={() => setAreaName(a.name)}>
                    <span style={{ minWidth: 0, flex: 1 }}><b>{a.name}</b>
                      <span className="v2-small v2-mut" style={{ display: 'block' }}>{a.prefix} · {a.routes.length} routes · {st.pcl} PCL</span></span>
                    <span className="v2-row" style={{ gap: 3 }}>{[...st.own.keys()].map(id => <span key={id} className="dot-sm" style={{ background: colorOf(id) }} />)}</span>
                    <span className="v2-small" style={{ fontWeight: 700 }}>{st.picked}/{a.routes.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (() => {
          const st = areaStats(area);
          const mineHere = area.routes.some(r => routes.get(r.route_code)?.managerId === active);
          return (
            <div className="v2-card" style={{ padding: 12 }}>
              <div className="v2-row" style={{ marginBottom: 8 }}>
                <button type="button" className="v2-link" onClick={() => setAreaName(null)} aria-label="All maps"><ChevronLeft size={16} /></button>
                <b>{area.name}</b><span className="v2-spacer" /><span className="v2-small v2-mut">{st.picked}/{area.routes.length} · {st.pcl} PCL</span>
              </div>
              <div className="v2-row" style={{ gap: 6, marginBottom: 10 }}>
                <Btn size="sm" disabled={!active} onClick={() => assignArea(area)}>Whole map to {activeName.split(' ')[0] || '…'}</Btn>
                {mineHere && <Btn size="sm" kind="o" onClick={() => clearArea(area, true)}>Clear {activeName.split(' ')[0]}’s</Btn>}
              </div>
              <div className="v2-rgrid">
                {area.routes.map(r => {
                  const owner = ownerOf(r.route_code); const lk = isLocked(r.route_code); const n = pcl.get(r.route_code) || 0;
                  return (
                    <button key={r.route_code} type="button" className={`v2-rchip${owner ? ' on' : ''}`} disabled={lk} onClick={() => toggle(r.route_code, area.name, r.route_number)}
                      style={owner ? { ['--c' as string]: colorOf(owner) } : undefined}
                      title={`${r.route_code}${owner ? ` · ${managers.find(m => m.id === owner)?.full_name || ''}` : ''}${lk ? ' · on the live session' : ''}`}>
                      <b>{r.route_number}</b><span>{n} PCL</span>{lk && <Lock size={10} className="lk" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}
        {footer}
      </div>
    </div>
  );
};

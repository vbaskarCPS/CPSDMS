// src/v2/features/mainstreet/Split.tsx — MainstreetAI › Split: pick a city and how many reps, and its main roads
// are split into that many shares of about equal length. Each share becomes a zone (the roads and the storefronts
// either side), assigned to a rep. No business list needed. Below: the city's road zones and how much each rep
// has walked.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MbMap } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Minus, Plus } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { listCampaigns, listReps } from '../../lib/mainstreet';
import { listCities } from '../../lib/msCity';
import { SHARE_COLORS, cityRoads, createRoadZones, km, roadZones, sharesGeo, splitRoads, zoneWalked, type Walked } from '../../lib/msSplit';
import { Btn, Card, ErrorBox, Loading } from '../../ui';
import { createZonesMap, fit, removeMap, setSource } from './msMap';

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export const Split: React.FC = () => {
  const cities = useLoad(listCities, []);
  const campaigns = useLoad(listCampaigns, []);
  const reps = useLoad(listReps, []);
  const ready = (cities.data || []).filter(c => c.boundary);
  const [city, setCity] = useState('');
  useEffect(() => { if (!city && ready.length) setCity(ready[0].id); }, [ready, city]);
  const activeCamps = (campaigns.data || []).filter(c => c.is_active);
  const [campaign, setCampaign] = useState('');
  useEffect(() => { if (!campaign && activeCamps.length) setCampaign(activeCamps[0].id); }, [activeCamps, campaign]);
  const [n, setN] = useState(4);
  const [tick, setTick] = useState(0);
  const roads = useLoad(() => (city ? cityRoads(city) : Promise.resolve(null)), [city, tick]);
  const shares = useMemo(() => (roads.data ? splitRoads(roads.data.pieces, n) : []), [roads.data, n]);
  const [names, setNames] = useState<Record<number, string>>({});
  const [assign, setAssign] = useState<Record<number, string>>({});
  useEffect(() => { setNames({}); }, [city, n]);
  const made = useLoad(() => (city ? roadZones(city) : Promise.resolve([])), [city, tick]);
  const [walked, setWalked] = useState<{ id: string; w: Walked } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null); const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const activeReps = (reps.data || []).filter(r => r.is_active);
  const total = shares.reduce((s, x) => s + x.m, 0);

  // ── the map ──
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MbMap | null>(null);
  const [mapOk, setMapOk] = useState(false);
  useEffect(() => {
    if (!box.current || map.current) return;
    map.current = createZonesMap(box.current, m => {
      m.addSource('split-city', { type: 'geojson', data: EMPTY });
      m.addSource('split-roads', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'split-city', type: 'line', source: 'split-city', paint: { 'line-color': '#0f766e', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      m.addLayer({ id: 'split-roads', type: 'line', source: 'split-roads', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#94a3b8'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6] } });
      setMapOk(true);
    }, () => {});
    return () => { removeMap(map.current); map.current = null; };
  }, []);
  useEffect(() => {
    if (!mapOk || !map.current) return;
    const b = roads.data?.city.boundary;
    setSource(map.current, 'split-city', b ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: b }] } : EMPTY);
    if (walked) {
      setSource(map.current, 'split-roads', { type: 'FeatureCollection', features: walked.w.roads.map(f => ({ ...f,
        properties: { ...f.properties, color: (f.properties as { walked: string }).walked === 'yes' ? '#0f766e' : (f.properties as { walked: string }).walked === 'partly' ? '#5eead4' : '#94a3b8' } })) });
    } else setSource(map.current, 'split-roads', sharesGeo(shares));
  }, [mapOk, roads.data, shares, walked]);
  useEffect(() => {
    if (!mapOk || !roads.data?.city.boundary) return;
    const b = roads.data.city.boundary;
    const pts = (b.type === 'Polygon' ? b.coordinates.flat() : b.coordinates.flat(2)) as [number, number][];
    fit(map.current, pts, 13);
  }, [mapOk, roads.data?.city.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!roads.data || !campaign) return;
    if (roads.data.zones > 0 && !confirm) { setConfirm(true); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const k = await createRoadZones(city, campaign, shares.map((s, i) => ({ name: names[i] ?? s.name, rep_id: assign[i] || null, pieces: s.pieces.map(p => p.id) })), roads.data.zones > 0);
      setMsg(`${k} zones made in ${roads.data.city.name}. Reps see theirs when they next open the app.`);
      setConfirm(false); setAssign({}); setTick(t => t + 1);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const showWalked = async (id: string, rep: string | null) => {
    if (walked?.id === id) { setWalked(null); return; }
    try { setWalked({ id, w: await zoneWalked(id, rep) }); } catch (e) { setError(e); }
  };

  return (
    <div className="v2-main v2-ms">
      <div className="v2-head"><span className="v2-h1">Split a city</span></div>
      <div className="v2-split">
        <div className="v2-card v2-ms-mapcard" style={{ padding: 0, overflow: 'hidden' }}>
          <div ref={box} className="v2-ms-map" />
        </div>
        <div className="v2-split-side">
          <Card>
            <label className="v2-label" htmlFor="sp-city">City or area</label>
            <select id="sp-city" className="v2-sel" value={city} onChange={e => { setCity(e.target.value); setWalked(null); setConfirm(false); }}>
              {ready.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="v2-small v2-mut" style={{ margin: '4px 0 10px' }}>Uses the city’s (or area’s) own boundary and its main roads, from free map data. Add one under Cities.</div>
            {activeCamps.length > 1 && <>
              <label className="v2-label" htmlFor="sp-camp">Campaign</label>
              <select id="sp-camp" className="v2-sel" value={campaign} onChange={e => setCampaign(e.target.value)} style={{ marginBottom: 10 }}>
                {activeCamps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>}
            <label className="v2-label">How many reps?</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Btn kind="o" icon={Minus} aria-label="Fewer reps" onClick={() => setN(x => Math.max(1, x - 1))} />
              <b style={{ fontSize: 20, minWidth: 30, textAlign: 'center' }}>{n}</b>
              <Btn kind="o" icon={Plus} aria-label="More reps" onClick={() => setN(x => Math.min(40, x + 1))} />
              {total > 0 && <span className="v2-small v2-mut">about {km(total / Math.max(1, shares.length))} of main road each</span>}
            </div>
          </Card>
          {roads.loading && !roads.data ? <Loading label="Loading the city’s roads…" /> : roads.error ? <ErrorBox error={roads.error} />
            : roads.data && !roads.data.pieces.length ? <div className="v2-card">No main roads saved for {roads.data.city.name} yet. Build it under Cities (the streets step).</div>
            : (
              <Card title={`${shares.length} shares`} right={<span className="v2-small v2-mut">{km(total)} in all</span>}>
                <div className="v2-split-list">
                  {shares.map((s, i) => (
                    <div key={i} className="r">
                      <i style={{ background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
                      <span className="t">
                        <input className="v2-input" value={names[i] ?? s.name} onChange={e => setNames(x => ({ ...x, [i]: e.target.value }))} aria-label={`Name of share ${i + 1}`} />
                        <span className="v2-small v2-mut">{km(s.m)} · {s.roads.slice(0, 4).join(', ')}{s.roads.length > 4 ? ` +${s.roads.length - 4}` : ''}</span>
                      </span>
                      <select className="v2-sel" value={assign[i] || ''} onChange={e => setAssign(x => ({ ...x, [i]: e.target.value }))} aria-label={`Rep for share ${i + 1}`}>
                        <option value="">No rep yet</option>
                        {activeReps.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                      </select>
                    </div>))}
                </div>
                {confirm && roads.data && <div className="v2-note" style={{ margin: '10px 0' }}>{roads.data.city.name} already has {roads.data.zones} zone{roads.data.zones === 1 ? '' : 's'}. Making these retires them (they’re kept, just off). Press again to go ahead.</div>}
                <ErrorBox error={error} />
                {msg && <div className="v2-note" style={{ margin: '10px 0' }}>{msg}</div>}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {confirm && <Btn kind="o" onClick={() => setConfirm(false)}>Cancel</Btn>}
                  <Btn kind={confirm ? 'r' : undefined} disabled={busy || !shares.length || !campaign} onClick={create} style={{ flex: 1, justifyContent: 'center' }}>
                    {busy ? 'Making zones…' : confirm ? `Replace with ${shares.length} zones` : `Create ${shares.length} zones`}</Btn>
                </div>
              </Card>)}
          {!!made.data?.length && (
            <Card title="Road zones now" right={<span className="v2-small v2-mut">Tap one to see what’s been walked</span>}>
              <div className="v2-split-list">
                {made.data.map(z => (
                  <button key={z.id} type="button" className={`r btn${walked?.id === z.id ? ' on' : ''}`} onClick={() => showWalked(z.id, z.rep_id)}>
                    <span className="t"><b>{z.name}</b><span className="v2-small v2-mut">{z.km} km · {z.rep || 'no rep'} · {z.businesses} businesses</span></span>
                    {walked?.id === z.id && <span className="v2-small"><b>{km(walked.w.walked_m)}</b> of {km(walked.w.total_m)} walked</span>}
                  </button>))}
              </div>
              {walked && <div className="v2-small v2-mut" style={{ marginTop: 6 }}>On the map: dark = walked, light = partly, grey = not yet.</div>}
            </Card>)}
        </div>
      </div>
    </div>
  );
};

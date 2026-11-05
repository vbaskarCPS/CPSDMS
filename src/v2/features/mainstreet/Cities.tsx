// src/v2/features/mainstreet/Cities.tsx — MainstreetAI › Cities: the cities and areas reps work in. Building one
// is free (OpenStreetMap): its boundary, streets and commercial land load here; then the blocks, their density and
// which blocks touch are worked out in the background. Then Zones › Generate makes zones of equal density. An area
// can be part of a city: one or more neighbourhoods or wards (Kanata, Barrhaven).
// Preloading businesses (OpenStreetMap, Google) is parked in CitiesParked.tsx: reps only see what they add.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Plus, RefreshCw, Square } from 'lucide-react';
import { useLoad } from '../../lib/data';
import { cityJob, cityLineCount, fetchBoundary, fetchLines, fetchPlazas, joinAreas, listCities, queueCityBuild, replaceLines, replacePlazas, saveCity, searchAreas, setCityStatus, type AreaHit, type City, type CityJob } from '../../lib/msCity';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

type StepState = 'todo' | 'running' | 'done' | 'failed';
interface Step { key: 'boundary' | 'lines' | 'land' | 'blocks'; label: string; state: StepState; note?: string }

export const Cities: React.FC = () => {
  const cities = useLoad(listCities, []);
  const [adding, setAdding] = useState(false);
  const [building, setBuilding] = useState<City | null>(null);
  const statusTag = (c: City) => c.status === 'built' ? <Tag tone="g">Ready</Tag> : c.status === 'building' ? <Tag tone="a">Building…</Tag> : c.status === 'failed' ? <Tag tone="r">Failed</Tag> : <Tag>New</Tag>;
  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head">
        <span className="v2-h1">Cities</span>
        <span className="v2-spacer" />
        <Btn icon={Plus} onClick={() => setAdding(true)}>Add a city or area</Btn>
      </div>
      <ErrorBox error={cities.error} />
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        {cities.loading ? <Loading /> : !cities.data?.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No cities yet. Add one and build it (free map data), then Zones › Generate makes zones of equal density.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>City or area</th><th>Status</th><th>Zones</th><th /></tr></thead>
            <tbody>
              {cities.data.map(c => (
                <tr key={c.id}>
                  <td className="lead" data-label="City"><b>{c.name}</b> <span className="v2-mut v2-small">{c.province}</span>{c.build_note && c.status === 'failed' && <div className="v2-small" style={{ color: 'var(--rose)' }}>{c.build_note}</div>}</td>
                  <td data-label="Status">{statusTag(c)}{c.status === 'building' && c.build_note && <div className="v2-small v2-mut">{c.build_note}…</div>}</td>
                  <td data-label="Zones">{c.zones}</td>
                  <td className="full" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.status === 'built' && <Link to="/app/mainstreet/zones" className="v2-btn o sm">Make zones</Link>}{' '}
                    <Btn kind="o" size="sm" icon={RefreshCw} onClick={() => setBuilding(c)}>{c.status === 'built' ? 'Rebuild' : c.status === 'building' ? 'Progress' : 'Build'}</Btn>
                  </td>
                </tr>))}
            </tbody>
          </table></div>)}
      </div>
      {adding && <AddCity onClose={() => setAdding(false)} onAdded={c => { setAdding(false); cities.reload(); setBuilding(c); }} />}
      {building && <Builder city={building} onClose={() => { setBuilding(null); cities.reload(); }} />}
    </div>
  );
};

const AddCity: React.FC<{ onClose: () => void; onAdded: (c: City) => void }> = ({ onClose, onAdded }) => {
  const [mode, setMode] = useState<'city' | 'part'>('city');
  const [name, setName] = useState('');
  const [province, setProvince] = useState('ON');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // part of a city: neighbourhoods or wards, joined into one area
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AreaHit[] | null>(null);
  const [picked, setPicked] = useState<AreaHit[]>([]);
  const search = async () => {
    setBusy(true); setError(null);
    try { setHits(await searchAreas(q, PROVINCE_NAME[province] || province)); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const toggle = (h: AreaHit) => {
    setPicked(p => (p.some(x => x.osm_id === h.osm_id) ? p.filter(x => x.osm_id !== h.osm_id) : [...p, h]));
    if (!name.trim()) setName(h.name);
  };
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const id = mode === 'part'
        ? await saveCity(name.trim(), province, picked.length === 1 ? picked[0].osm_id : null, joinAreas(picked.map(p => p.geometry)))
        : await saveCity(name.trim(), province, null, null);
      const list = await listCities();
      const c = list.find(x => x.id === id); if (!c) throw new Error('Saved, but it didn’t come back');
      onAdded(c);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={mode === 'city' ? 'Add a city' : 'Add part of a city'} onClose={onClose}
      footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !name.trim() || (mode === 'part' && !picked.length)} onClick={add}>{busy ? 'Working…' : 'Add and build'}</Btn></>}>
      <div className="v2-pipe-heat" role="group" aria-label="What to add" style={{ marginBottom: 12 }}>
        <button type="button" className={mode === 'city' ? 'on' : ''} onClick={() => setMode('city')}>A whole city</button>
        <button type="button" className={mode === 'part' ? 'on' : ''} onClick={() => setMode('part')}>Part of a city</button>
      </div>
      <Field label="Province">
        <select className="v2-sel" value={province} onChange={e => setProvince(e.target.value)}>
          {['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'].map(p => <option key={p}>{p}</option>)}
        </select>
      </Field>
      {mode === 'city' ? (
        <Field label="City" hint="The municipality as OpenStreetMap knows it, e.g. Oakville."><input className="v2-input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Oakville" /></Field>
      ) : <>
        <Field label="Find neighbourhoods or wards" hint="For example Kanata, Barrhaven, Orléans. Pick one or more; they become one area.">
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="v2-input" autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} placeholder="Kanata" />
            <Btn kind="o" disabled={busy || !q.trim()} onClick={search}>Search</Btn>
          </div>
        </Field>
        {hits && !hits.length && <div className="v2-small v2-mut" style={{ marginBottom: 8 }}>Nothing with a boundary by that name. Try the ward’s name (e.g. “Kanata North”).</div>}
        {!!hits?.length && <div className="v2-area-hits">{hits.map(h => (
          <label key={h.osm_id}><input type="checkbox" checked={picked.some(x => x.osm_id === h.osm_id)} onChange={() => toggle(h)} />
            <span><b>{h.name}</b> <span className="v2-small v2-mut">{h.kind} · {h.label}</span></span></label>))}</div>}
        {!!picked.length && <div className="v2-small" style={{ margin: '6px 0 10px' }}>Picked: {picked.map(p => p.name).join(', ')}</div>}
        <Field label="Name for the area"><input className="v2-input" value={name} onChange={e => setName(e.target.value)} placeholder="Kanata" /></Field>
      </>}
      <ErrorBox error={error} />
    </Modal>
  );
};

const PROVINCE_NAME: Record<string, string> = { ON: 'Ontario', BC: 'British Columbia', AB: 'Alberta', QC: 'Quebec', MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island' };
function bboxOf(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): { s: number; w: number; n: number; e: number } {
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  let s = 90, n = -90, w = 180, e = -180;
  for (const r of rings) for (const [x, y] of r) { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; }
  return { s, w, n, e };
}

/** Boundary, streets and commercial land load here; the blocks and their density are worked out in the background. */
const Builder: React.FC<{ city: City; onClose: () => void }> = ({ city, onClose }) => {
  const [steps, setSteps] = useState<Step[]>([
    { key: 'boundary', label: 'Boundary', state: city.boundary ? 'done' : 'todo', note: city.boundary ? 'Saved' : undefined },
    { key: 'lines', label: 'Streets', state: 'todo' },
    { key: 'land', label: 'Commercial land (plazas, business parks)', state: 'todo' },
    { key: 'blocks', label: 'Blocks and density (in the background)', state: 'todo' },
  ]);
  const [error, setError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [job, setJob] = useState<CityJob | null>(null);
  const abort = useRef<AbortController | null>(null);
  const set = (key: Step['key'], state: StepState, note?: string) => setSteps(ss => ss.map(s => s.key === key ? { ...s, state, note: note ?? s.note } : s));
  const jobNote = (j: CityJob) => j.stage === 'blocks' ? 'Cutting the blocks along the main roads…'
    : j.stage === 'density' ? `Scoring density: ${j.scored} of ${j.blocks} blocks` : j.stage === 'adjacency' ? 'Joining neighbouring blocks…'
    : j.stage === 'done' ? `${j.blocks} blocks` : j.note || 'Failed';
  // a build already in the background: show where it's at
  useEffect(() => {
    if (city.status !== 'building') return;
    cityJob(city.id).then(j => {
      if (!j || j.stage === 'done' || j.stage === 'failed') return;
      setSteps(ss => ss.map(s => ({ ...s, state: s.key === 'blocks' ? 'running' : 'done', note: s.key === 'blocks' ? jobNote(j) : s.note })));
      setJob(j);
    }).catch(() => undefined);
  }, [city.id, city.status]);   // eslint-disable-line react-hooks/exhaustive-deps
  // follow the background part every few seconds
  useEffect(() => {
    if (!job || job.stage === 'done' || job.stage === 'failed') return;
    const t = setTimeout(async () => {
      try {
        const j = await cityJob(city.id); if (!j) return;
        setJob(j);
        if (j.stage === 'done') { set('blocks', 'done', jobNote(j)); setDone(true); }
        else if (j.stage === 'failed') { set('blocks', 'failed', jobNote(j)); setError(new Error(j.note || 'The background step failed')); }
        else set('blocks', 'running', jobNote(j));
      } catch (e) { setError(e); }
    }, 4000);
    return () => clearTimeout(t);
  }, [job, city.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setRunning(true); setError(null);
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      await setCityStatus(city.id, 'building');
      let geometry = city.boundary;
      if (!geometry) {
        set('boundary', 'running');
        const b = await fetchBoundary(city.name, PROVINCE_NAME[city.province] || city.province);
        if (!b) throw new Error(`OpenStreetMap has no boundary for “${city.name}, ${city.province}”. Check the spelling, or add it as part of a city.`);
        await saveCity(city.name, city.province, b.osm_id, b.geometry);
        geometry = b.geometry;
        set('boundary', 'done', b.name);
      }
      // streets already saved (the boundary didn't change): keep them
      const have = city.boundary ? await cityLineCount(city.id) : 0;
      if (have > 0) set('lines', 'done', `${have.toLocaleString('en-CA')} road pieces, already saved`);
      else {
        set('lines', 'running');
        const lines = await fetchLines(bboxOf(geometry), ctrl.signal, (d, of) => set('lines', 'running', `OpenStreetMap · tile ${d} of ${of}`));
        set('lines', 'done', `${await replaceLines(city.id, lines)} road pieces`);
      }
      set('land', 'running');
      const land = await fetchPlazas(bboxOf(geometry), ctrl.signal, (d, of) => set('land', 'running', `OpenStreetMap · tile ${d} of ${of}`));
      set('land', 'done', `${await replacePlazas(city.id, land)} areas`);
      set('blocks', 'running', 'Queued: it starts within a minute');
      setJob(await queueCityBuild(city.id));
    } catch (e) {
      const stopped = ctrl.signal.aborted;
      setError(stopped ? new Error('Stopped. Press Start to try again.') : e);
      setSteps(ss => ss.map(s => s.state === 'running' ? { ...s, state: stopped ? 'todo' : 'failed' } : s));
      await setCityStatus(city.id, stopped ? 'new' : 'failed', stopped ? undefined : e instanceof Error ? e.message : String(e)).catch(() => undefined);
    } finally { setRunning(false); abort.current = null; }
  };
  useEffect(() => () => abort.current?.abort(), []);
  return (
    <Modal title={`Build ${city.name}`} onClose={running ? () => undefined : onClose}
      footer={<>
        {running ? <Btn kind="r" icon={Square} onClick={() => abort.current?.abort()}>Stop</Btn> : <Btn kind="o" onClick={onClose}>{done ? 'Done' : 'Close'}</Btn>}
        {!running && !done && !(job && job.stage !== 'failed' && job.stage !== 'done') && <Btn onClick={run}>{city.status === 'built' ? 'Rebuild' : 'Start'}</Btn>}
        {done && <Link to="/app/mainstreet/zones" className="v2-btn">Make zones</Link>}
      </>}>
      <div className="v2-small v2-mut" style={{ marginBottom: 10 }}>Free map data from OpenStreetMap. The last step runs in the background: you can close this and come back; a big city takes a few minutes.</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {steps.map(s => (
          <div key={s.key} className="v2-row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', marginTop: 2 }}>
              {s.state === 'done' ? <Check size={16} color="var(--green)" /> : s.state === 'running' ? <Loader2 size={16} className="v2-spin" /> : s.state === 'failed' ? <span style={{ color: 'var(--rose)' }}>✕</span> : <span className="v2-mut">·</span>}
            </span>
            <span><b style={{ color: s.state === 'todo' ? 'var(--mut)' : undefined }}>{s.label}</b>{s.note && <div className="v2-mut v2-small">{s.note}</div>}</span>
          </div>))}
      </div>
      {done && <div className="v2-note" style={{ marginTop: 10 }}>{city.name} is ready.</div>}
      <ErrorBox error={error} />
    </Modal>
  );
};

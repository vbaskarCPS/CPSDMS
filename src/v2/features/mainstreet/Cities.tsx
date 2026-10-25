// src/v2/features/mainstreet/Cities.tsx — MainstreetAI › Cities: the cities whose businesses are loaded, and the
// builder that loads one (boundary → streets → blocks → plazas → OSM businesses → Google sweep → finish).
// The Google step is paid: it shows the estimate and waits for an OK.
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, Loader2, Plus, RefreshCw, Square } from 'lucide-react';
import { useLoad } from '../../lib/data';
import {
  cityBusinesses, estimateCalls, fetchBoundary, fetchLines, fetchOsmBusinesses, fetchPlazas, finishCity, googleKey, googleSweep, gridCells, GOOGLE_COST_PER_CALL,
  GOOGLE_MAX_CALLS, inPolygon, kindLabel, listCities, pinBusinesses, makeBlocks, replaceLines, replacePlazas, saveCity, setCityStatus, upsertBusinesses, type City,
} from '../../lib/msCity';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

type StepState = 'todo' | 'running' | 'done' | 'skipped' | 'failed';
interface Step { key: string; label: string; state: StepState; note?: string }
const STEPS: Omit<Step, 'state'>[] = [
  { key: 'boundary', label: 'City boundary' }, { key: 'lines', label: 'Streets, rail and water' }, { key: 'blocks', label: 'Blocks' },
  { key: 'plazas', label: 'Plazas and industrial parks' }, { key: 'osm', label: 'Businesses from OpenStreetMap' },
  { key: 'google', label: 'Businesses from Google Places' }, { key: 'finish', label: 'Chains, blocks and counts' },
];

export const Cities: React.FC = () => {
  const cities = useLoad(listCities, []);
  const [adding, setAdding] = useState(false);
  const [building, setBuilding] = useState<City | null>(null);
  const [showing, setShowing] = useState<City | null>(null);
  const statusTag = (c: City) => c.status === 'built' ? <Tag tone="g">Built</Tag> : c.status === 'building' ? <Tag tone="a">Building…</Tag> : c.status === 'failed' ? <Tag tone="r">Failed</Tag> : <Tag>New</Tag>;

  return (
    <div className="v2-main v2-narrow v2-ms">
      <div className="v2-head">
        <span className="v2-h1">Cities</span>
        <span className="v2-spacer" />
        <Btn icon={Plus} onClick={() => setAdding(true)}>Add a city</Btn>
      </div>
      <ErrorBox error={cities.error} />
      <div className="v2-card" style={{ padding: 0, overflow: 'hidden' }}>
        {cities.loading ? <Loading /> : !cities.data?.length ? (
          <div className="v2-note" style={{ padding: 16 }}>No cities yet. Add one and build it: that loads its streets and every brick-and-mortar business, ready for zones to be generated.</div>
        ) : (
          <div className="v2-table-wrap"><table className="v2-table">
            <thead><tr><th>City</th><th>Status</th><th>Businesses</th><th>Eligible</th><th>Blocks</th><th>Plazas</th><th>Zones</th><th /></tr></thead>
            <tbody>
              {cities.data.map(c => (
                <tr key={c.id}>
                  <td><b>{c.name}</b> <span className="v2-mut v2-small">{c.province}</span>{c.build_note && <div className="v2-small" style={{ color: 'var(--rose)' }}>{c.build_note}</div>}</td>
                  <td>{statusTag(c)}</td>
                  <td>{c.businesses || '—'}</td>
                  <td title="Open, not a chain">{c.status === 'built' ? c.eligible_open : '—'}</td>
                  <td>{c.blocks || '—'}</td><td>{c.plazas || '—'}</td>
                  <td>{c.zones}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.status === 'built' && <Btn kind="o" size="sm" icon={Building2} onClick={() => setShowing(c)}>Businesses</Btn>}{' '}
                    <Btn kind="o" size="sm" icon={RefreshCw} onClick={() => setBuilding(c)}>{c.status === 'built' ? 'Rebuild' : 'Build'}</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      <div className="v2-note" style={{ marginTop: 10 }}>Build once per city. Then <Link to="/app/mainstreet/zones" style={{ textDecoration: 'underline' }}>Zones › Generate</Link> cuts it into zones for a campaign.</div>

      {adding && <AddCity onClose={() => setAdding(false)} onAdded={c => { setAdding(false); cities.reload(); setBuilding(c); }} />}
      {building && <Builder city={building} onClose={() => { setBuilding(null); cities.reload(); }} />}
      {showing && <BusinessList city={showing} onClose={() => setShowing(null)} />}
    </div>
  );
};

const AddCity: React.FC<{ onClose: () => void; onAdded: (c: City) => void }> = ({ onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [province, setProvince] = useState('ON');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const id = await saveCity(name.trim(), province, null, null);
      const list = await listCities();
      const c = list.find(x => x.id === id); if (!c) throw new Error('Saved, but the city didn’t come back');
      onAdded(c);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add a city" onClose={onClose} footer={<><Btn kind="o" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !name.trim()} onClick={add}>{busy ? 'Adding…' : 'Add and build'}</Btn></>}>
      <Field label="City" hint="The municipality as OpenStreetMap knows it, e.g. Oakville."><input className="v2-input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Oakville" /></Field>
      <Field label="Province">
        <select className="v2-sel" value={province} onChange={e => setProvince(e.target.value)}>
          {['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'].map(p => <option key={p}>{p}</option>)}
        </select>
      </Field>
      <ErrorBox error={error} />
    </Modal>
  );
};

/** Steps whose results are already saved for the city. */
function savedSteps(c: City): Step[] {
  const done: Record<string, string | null> = {
    boundary: c.boundary ? `${c.name} (saved)` : null,
    lines: c.blocks > 0 ? 'Saved earlier' : null,
    blocks: c.blocks > 0 ? `${c.blocks} blocks (saved)` : null,
    plazas: c.plazas > 0 ? `${c.plazas} plazas / parks (saved)` : null,
    osm: c.businesses > 0 || c.eligible_open > 0 ? `${Math.max(c.businesses, c.eligible_open)} businesses (saved)` : null,
  };
  return STEPS.map(s => done[s.key] ? { ...s, state: 'done', note: done[s.key]! } : { ...s, state: 'todo' });
}
function bboxOf(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): { s: number; w: number; n: number; e: number } {
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
  let s = 90, n = -90, w = 180, e = -180;
  for (const r of rings) for (const [x, y] of r) { if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x; }
  return { s, w, n, e };
}

const PROVINCE_NAME: Record<string, string> = { ON: 'Ontario', BC: 'British Columbia', AB: 'Alberta', QC: 'Quebec', MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island' };

/** Runs the build step by step, with the Google step gated on an OK. */
const Builder: React.FC<{ city: City; onClose: () => void }> = ({ city, onClose }) => {
  // what's already saved for this city counts as done, so reopening (or a page refresh) carries on
  const [steps, setSteps] = useState<Step[]>(() => savedSteps(city));
  const [error, setError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [google, setGoogle] = useState<{ cells: number; estimate: number; ask: boolean; decided: 'yes' | 'no' | null; calls: number; pending: number; found: number } | null>(null);
  const [cap, setCap] = useState(GOOGLE_MAX_CALLS);
  const abort = useRef<AbortController | null>(null);
  const decision = useRef<((yes: boolean) => void) | null>(null);
  const set = (key: string, state: StepState, note?: string) => setSteps(ss => ss.map(s => s.key === key ? { ...s, state, note: note ?? s.note } : s));

  // what's already done stays done: Start after a failure carries on from the failed step
  const stepsRef = useRef(steps); stepsRef.current = steps;
  const boundary = useRef<Awaited<ReturnType<typeof fetchBoundary>>>(city.boundary ? { osm_id: 0, name: city.name, geometry: city.boundary, bbox: bboxOf(city.boundary) } : null);
  const startOver = () => { boundary.current = null; setSteps(STEPS.map(s => ({ ...s, state: 'todo' }))); setError(null); setDone(null); setGoogle(null); };
  const isDone = (k: string) => stepsRef.current.find(s => s.key === k)?.state === 'done';
  const tileNote = (k: string) => (d: number, of: number) => set(k, 'running', `OpenStreetMap · tile ${d} of ${of}`);

  const run = async () => {
    setRunning(true); setError(null); setDone(null);
    const ctrl = new AbortController(); abort.current = ctrl;
    const key = googleKey();
    try {
      await setCityStatus(city.id, 'building');
      if (!boundary.current) {
        set('boundary', 'running');
        const b = await fetchBoundary(city.name, PROVINCE_NAME[city.province] || city.province);
        if (!b) throw new Error(`OpenStreetMap has no boundary for “${city.name}, ${city.province}”. Check the spelling.`);
        await saveCity(city.name, city.province, b.osm_id, b.geometry);
        boundary.current = b;
        set('boundary', 'done', b.name);
      }
      const b = boundary.current!;

      if (!isDone('lines')) {
        set('lines', 'running');
        const lines = await fetchLines(b.bbox, ctrl.signal, tileNote('lines'));
        const nl = await replaceLines(city.id, lines);
        set('lines', 'done', `${nl} street segments`);
      }
      if (!isDone('blocks')) {
        set('blocks', 'running');
        const nb = await makeBlocks(city.id);
        set('blocks', 'done', `${nb} blocks`);
      }
      if (!isDone('plazas')) {
        set('plazas', 'running');
        const plazas = await fetchPlazas(b.bbox, ctrl.signal, tileNote('plazas'));
        const np = await replacePlazas(city.id, plazas);
        set('plazas', 'done', `${np} plazas / parks`);
      }
      if (!isDone('osm')) {
        set('osm', 'running');
        const osm = await fetchOsmBusinesses(b.bbox, ctrl.signal, tileNote('osm'));
        const inside = osm.filter(r => inPolygon([r.lng, r.lat], b.geometry));
        const no = await upsertBusinesses(city.id, inside);
        set('osm', 'done', `${no} businesses`);
      }

      // Google: estimate, ask, sweep
      if (!isDone('google') && stepsRef.current.find(s => s.key === 'google')?.state !== 'skipped') {
        if (!key) { set('google', 'skipped', 'No Google key on this build (VITE_GOOGLE_PLACES_API_KEY)'); }
        else {
          const cells = gridCells(b.bbox, b.geometry, 1000);
          const est = estimateCalls(cells.length);
          setGoogle({ cells: cells.length, estimate: est, ask: true, decided: null, calls: 0, pending: cells.length, found: 0 });
          const yes = await new Promise<boolean>(resolve => { decision.current = resolve; });
          setGoogle(g => g && { ...g, ask: false, decided: yes ? 'yes' : 'no' });
          if (ctrl.signal.aborted) throw new Error('Stopped');
          if (!yes) set('google', 'skipped', 'Skipped');
          else {
            set('google', 'running');
            const r = await googleSweep(cells, key, cap, p => setGoogle(g => g && { ...g, ...p }), rows => upsertBusinesses(city.id, rows.filter(r => inPolygon([r.lng, r.lat], b.geometry))).then(() => undefined), ctrl.signal);
            set('google', 'done', `${r.found} places in ${r.calls} calls (~$${(r.calls * GOOGLE_COST_PER_CALL).toFixed(0)})${r.stopped ? ' · stopped before the end' : ''}`);
          }
        }
      }

      set('finish', 'running');
      for (let left = await pinBusinesses(city.id); left > 0; left = await pinBusinesses(city.id)) {
        if (ctrl.signal.aborted) throw new Error('Stopped');
        set('finish', 'running', `Placing businesses on blocks · ${left} to go`);
      }
      const f = await finishCity(city.id);
      set('finish', 'done', `${f.businesses} businesses · ${f.chains} chains · ${Object.entries(f.by_kind).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${kindLabel(k)} ${n}`).join(', ')}`);
      setDone(`${city.name} is built.`);
    } catch (e) {
      const stopped = e instanceof Error && e.message === 'Stopped';
      setError(stopped ? new Error('Stopped. Press Start to carry on from where it was.') : e);
      setSteps(ss => ss.map(s => s.state === 'running' ? { ...s, state: stopped ? 'todo' : 'failed' } : s));
      if (!stopped) await setCityStatus(city.id, 'failed', e instanceof Error ? e.message : String(e)).catch(() => undefined);
    } finally { setRunning(false); abort.current = null; }
  };
  useEffect(() => () => abort.current?.abort(), []);

  return (
    <Modal title={`Build ${city.name}`} onClose={running ? () => undefined : onClose}
      footer={<>
        {running ? <Btn kind="r" icon={Square} onClick={() => { abort.current?.abort(); decision.current?.(false); }}>Stop</Btn> : <Btn kind="o" onClick={onClose}>Close</Btn>}
        {!running && !done && steps.some(s => s.state === 'done') && <Btn kind="o" onClick={startOver}>Start over</Btn>}
        {!running && !done && <Btn onClick={run}>{steps.some(s => s.state === 'done' || s.state === 'failed') ? 'Carry on' : city.status === 'built' ? 'Rebuild' : 'Start'}</Btn>}
      </>}>
      {city.status === 'built' && !running && !done && <div className="v2-note" style={{ marginBottom: 10 }}>Rebuilding reloads streets, blocks, plazas and businesses. Businesses already in zones keep their zone.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {steps.map(s => (
          <div key={s.key} className="v2-row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', marginTop: 2 }}>
              {s.state === 'done' ? <Check size={16} color="var(--green)" /> : s.state === 'running' ? <Loader2 size={16} className="v2-spin" /> : s.state === 'failed' ? <span style={{ color: 'var(--rose)' }}>✕</span> : <span className="v2-mut">·</span>}
            </span>
            <span><b style={{ color: s.state === 'todo' ? 'var(--mut)' : undefined }}>{s.label}</b>{s.note && <div className="v2-mut v2-small">{s.note}</div>}</span>
          </div>
        ))}
      </div>
      {google && (
        <div className="v2-card" style={{ marginTop: 12, borderLeft: '4px solid var(--amber)' }}>
          {google.ask ? <>
            <b>Google Places sweep: this costs money.</b>
            <div className="v2-small" style={{ margin: '4px 0 8px' }}>
              {google.cells} starting cells over {city.name}; dense cells split further. Estimate: up to <b>{google.estimate} calls ≈ ${(google.estimate * GOOGLE_COST_PER_CALL).toFixed(0)}</b> at ${GOOGLE_COST_PER_CALL.toFixed(2)}/call (an upper bound; usually less).
            </div>
            <div className="v2-row" style={{ gap: 8 }}>
              <label className="v2-small">Cap at <input className="v2-input" type="number" min={50} max={GOOGLE_MAX_CALLS} value={cap} onChange={e => setCap(Math.max(50, Math.min(GOOGLE_MAX_CALLS, +e.target.value || 0)))} style={{ width: 90, display: 'inline-block', margin: '0 4px' }} /> calls (≈ ${(cap * GOOGLE_COST_PER_CALL).toFixed(0)})</label>
              <span className="v2-spacer" />
              <Btn kind="o" size="sm" onClick={() => decision.current?.(false)}>Skip Google</Btn>
              <Btn size="sm" onClick={() => decision.current?.(true)}>OK, run it</Btn>
            </div>
          </> : google.decided === 'yes' ? (
            <div className="v2-small">Google: {google.calls} calls (≈ ${(google.calls * GOOGLE_COST_PER_CALL).toFixed(0)}) · {google.found} places · {google.pending} cells to go</div>
          ) : null}
        </div>
      )}
      {done && <div className="v2-card" style={{ marginTop: 12, borderLeft: '4px solid var(--green)' }}>{done} Next: <Link to="/app/mainstreet/zones" style={{ textDecoration: 'underline' }}>generate zones</Link>.</div>}
      <ErrorBox error={error} />
    </Modal>
  );
};

const BusinessList: React.FC<{ city: City; onClose: () => void }> = ({ city, onClose }) => {
  const rows = useLoad(() => cityBusinesses(city.id), [city.id]);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const shown = (rows.data || []).filter(b => (kind === 'all' || (kind === 'chain' ? b.is_chain : b.kind === kind)) && (!q || b.name.toLowerCase().includes(q.toLowerCase()) || (b.address || '').toLowerCase().includes(q.toLowerCase())));
  const kinds = new Map<string, number>(); for (const b of rows.data || []) kinds.set(b.kind, (kinds.get(b.kind) || 0) + 1);
  return (
    <Modal title={`${city.name} · ${rows.data?.length ?? '…'} businesses`} onClose={onClose} wide>
      <div className="v2-row" style={{ marginBottom: 10 }}>
        <button className={`v2-chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>All</button>
        {[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => <button key={k} className={`v2-chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{kindLabel(k)} · {n}</button>)}
        <button className={`v2-chip${kind === 'chain' ? ' on' : ''}`} onClick={() => setKind('chain')}>Chains · {(rows.data || []).filter(b => b.is_chain).length}</button>
        <span className="v2-spacer" />
        <input className="v2-input" style={{ width: 200 }} placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <ErrorBox error={rows.error} />
      <div className="v2-table-wrap" style={{ maxHeight: '60vh', overflowY: 'auto' }}><table className="v2-table">
        <thead><tr><th>Business</th><th>Category</th><th>Address</th><th>Status</th><th>Source</th><th>Zone</th></tr></thead>
        <tbody>
          {shown.slice(0, 500).map(b => (
            <tr key={b.id}>
              <td><b>{b.name}</b>{b.is_chain && <> <Tag tone="a">Chain</Tag></>}{b.chain_note && b.is_chain && <div className="v2-mut v2-small">{b.chain_note}</div>}</td>
              <td>{kindLabel(b.kind)}</td>
              <td className="v2-small">{b.address || '—'}</td>
              <td>{b.status === 'closed' ? <Tag tone="r">Closed</Tag> : b.status === 'open' ? <Tag tone="g">Open</Tag> : <span className="v2-mut">?</span>}</td>
              <td className="v2-small v2-mut">{b.sources.join(' + ')}</td>
              <td className="v2-small">{b.zone_id ? <Tag tone="b">In zone</Tag> : <span className="v2-mut">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {shown.length > 500 && <div className="v2-note">Showing 500 of {shown.length}. Narrow it down with the filters.</div>}
    </Modal>
  );
};

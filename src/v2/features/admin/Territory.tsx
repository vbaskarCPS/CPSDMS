// src/v2/features/admin/Territory.tsx — Super Admin › Territory › Map assignments: every digital-map area,
// its East / West / Central designation, which center owns it, and a way into the map builder.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Map as MapIcon, Pencil, Plus, Search } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { listCenters, useLoad } from '../../lib/data';
import {
  allRoutes, areaProblems, assignAreas, deleteArea, listAreaPrefixes, listAssignments, mergeAreas, refreshRoutes, REGIONS, routeCodeOf, saveArea, setRegion,
  type AreaPrefix, type AreaRow, type Region,
} from '../../lib/territory';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

const REGION_TONE: Record<Region, 'b' | 'g' | 'a'> = { West: 'b', Central: 'g', East: 'a' };
export const RegionTag: React.FC<{ r: Region | null }> = ({ r }) => r ? <Tag tone={REGION_TONE[r]}>{r}</Tag> : <span className="v2-mut">—</span>;

type Show = 'all' | 'unassigned' | string;

/** The two halves of Territory & Client Data. */
export const TerritoryTabs: React.FC<{ on: 'maps' | 'clients' }> = ({ on }) => (
  <div className="v2-tabs" role="tablist">
    <Link role="tab" aria-selected={on === 'maps'} className={on === 'maps' ? 'on' : ''} to="/app/admin/territory">Map assignments</Link>
    <Link role="tab" aria-selected={on === 'clients'} className={on === 'clients' ? 'on' : ''} to="/app/admin/territory/clients">Client lists</Link>
  </div>
);

export const Territory: React.FC = () => {
  const { center } = useAuth();
  const nav = useNavigate();
  const centers = useLoad(listCenters, []);
  const routes = useLoad(() => { refreshRoutes(); return allRoutes(); }, []);
  const assigned = useLoad(listAssignments, []);
  const prefixes = useLoad(listAreaPrefixes, []);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [region, setRegionFilter] = useState<Region | 'all'>('all');
  const [newRegion, setNewRegion] = useState<Region | ''>('');
  const [editing, setEditing] = useState<AreaPrefix | 'new' | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const areas: AreaRow[] = useMemo(() => routes.data && assigned.data && prefixes.data ? mergeAreas(prefixes.data, routes.data, assigned.data) : [],
    [routes.data, assigned.data, prefixes.data]);
  const centerName = (id: string | null) => (id && (centers.data || []).find(c => c.id === id)?.display_name) || null;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return areas.filter(a => (show === 'all' || (show === 'unassigned' ? !a.centerId : a.centerId === show))
      && (region === 'all' || a.region === region)
      && (!needle || a.name.toLowerCase().includes(needle) || a.prefix.toLowerCase() === needle));
  }, [areas, q, show, region]);
  const regionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of areas) if (a.region) m.set(a.region, (m.get(a.region) || 0) + 1);
    return m;
  }, [areas]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of areas) if (a.centerId) m.set(a.centerId, (m.get(a.centerId) || 0) + 1);
    return m;
  }, [areas]);

  const toggle = (name: string) => setPicked(s => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const allShownPicked = shown.length > 0 && shown.every(a => picked.has(a.name));
  const apply = async (centerId: string | null) => {
    setBusy(true); setError(null);
    try { await assignAreas([...picked], centerId); setPicked(new Set()); assigned.reload(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const applyRegion = async () => {
    if (!newRegion) return;
    setBusy(true); setError(null);
    try { await setRegion([...picked], newRegion); setPicked(new Set()); setNewRegion(''); prefixes.reload(); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const builder = (name: string) => nav(`/app/admin/territory/builder/${encodeURIComponent(name)}`);
  const prefixOf = (name: string) => (prefixes.data || []).find(p => p.area_name === name) || null;

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Territory & Client Data</span>
        <span className="v2-spacer" />
        <span className="v2-mut v2-small">{areas.length} areas · {(routes.data || []).length} approved routes · {areas.filter(a => !a.centerId).length} unassigned</span>
        <Btn icon={Plus} onClick={() => setEditing('new')}>New area</Btn>
      </div>
      <TerritoryTabs on="maps" />
      <div className="v2-row" style={{ marginBottom: 12 }}>
        <button className={`v2-chip${show === 'all' ? ' on' : ''}`} onClick={() => setShow('all')}>All</button>
        <button className={`v2-chip${show === 'unassigned' ? ' on' : ''}`} onClick={() => setShow('unassigned')}>Unassigned</button>
        {(centers.data || []).map(c => (
          <button key={c.id} className={`v2-chip${show === c.id ? ' on' : ''}`} onClick={() => setShow(c.id)}>{c.display_name} · {counts.get(c.id) || 0}</button>
        ))}
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />
        <button className={`v2-chip${region === 'all' ? ' on' : ''}`} onClick={() => setRegionFilter('all')}>All regions</button>
        {REGIONS.map(r => <button key={r} className={`v2-chip${region === r ? ' on' : ''}`} onClick={() => setRegionFilter(r)}>{r} · {regionCounts.get(r) || 0}</button>)}
        <span className="v2-spacer" />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
          <input className="v2-input" style={{ paddingLeft: 30, width: 220 }} placeholder="Area or prefix" value={q} onChange={e => setQ(e.target.value)} aria-label="Search areas" />
        </div>
      </div>

      <div className="v2-card v2-row" style={{ marginBottom: 12, position: 'sticky', top: 66, zIndex: 5 }}>
        <b>{picked.size} selected</b>
        <select className="v2-sel" style={{ width: 220 }} value={target} onChange={e => setTarget(e.target.value)} aria-label="Assign to">
          <option value="">Choose a center…</option>
          {(centers.data || []).map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </select>
        <Btn disabled={!picked.size || !target || busy} onClick={() => apply(target)}>Assign</Btn>
        <Btn kind="r" disabled={!picked.size || busy} onClick={() => apply(null)}>Unassign</Btn>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 4px' }} />
        <select className="v2-sel" style={{ width: 150 }} value={newRegion} onChange={e => setNewRegion(e.target.value as Region | '')} aria-label="Set region to">
          <option value="">Region…</option>
          {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <Btn kind="o" disabled={!picked.size || !newRegion || busy} onClick={applyRegion}>Set region</Btn>
        <span className="v2-spacer" />
        {center && <span className="v2-note" style={{ margin: 0 }}>Each area belongs to one center; its routes show up in that center’s Start session.</span>}
      </div>

      <ErrorBox error={centers.error || routes.error || assigned.error || prefixes.error || error} />
      {routes.loading || assigned.loading || prefixes.loading ? <Loading label="Loading 4,600 routes…" /> : (
        <div className="v2-card" style={{ padding: 0 }}>
          <div className="v2-table-wrap" style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
            <table className="v2-table">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={allShownPicked}
                  onChange={() => setPicked(s => { const n = new Set(s); shown.forEach(a => allShownPicked ? n.delete(a.name) : n.add(a.name)); return n; })} /></th>
                <th>Area</th><th>Region</th><th>Prefix</th><th>Routes</th><th>Numbers</th><th>Center</th><th style={{ width: 150 }} />
              </tr></thead>
              <tbody>
                {shown.map(a => {
                  const notDrawn = a.planned > 0 && a.routes.length < a.planned;
                  return (
                    <tr key={a.name} className="click" onClick={() => toggle(a.name)}>
                      <td><input type="checkbox" checked={picked.has(a.name)} onChange={() => toggle(a.name)} onClick={e => e.stopPropagation()} aria-label={`Select ${a.name}`} /></td>
                      <td><b>{a.name}</b></td><td><RegionTag r={a.region} /></td><td>{a.prefix}</td>
                      <td>{a.routes.length}{notDrawn && <span className="v2-mut v2-small" title="Routes drawn and approved in the map builder, of the numbers planned"> of {a.planned}</span>}</td>
                      <td className="v2-small">{routeCodeOf(a.prefix, a.start)} – {routeCodeOf(a.prefix, a.start + Math.max(a.planned, 1) - 1)}</td>
                      <td>{centerName(a.centerId) ? <Tag tone="b">{centerName(a.centerId)}</Tag> : <span className="v2-mut">—</span>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                        {a.hasPrefixRow && <button type="button" className="v2-gbtn" style={{ width: 30, height: 30, display: 'inline-flex', marginRight: 6 }} aria-label={`Edit ${a.name}`} title="Name, prefix, region, route numbers"
                          onClick={() => setEditing(prefixOf(a.name))}><Pencil size={13} /></button>}
                        {a.hasPrefixRow && <Btn size="sm" kind="o" icon={MapIcon} onClick={() => builder(a.name)}>Builder</Btn>}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={8} className="v2-mut" style={{ padding: 20, textAlign: 'center' }}>No areas match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && prefixes.data && <AreaEditor area={editing === 'new' ? null : editing} all={prefixes.data}
        drawn={editing === 'new' ? 0 : (areas.find(a => a.name === editing.area_name)?.routes.length || 0)}
        onClose={() => setEditing(null)}
        onSaved={(name, open) => { setEditing(null); prefixes.reload(); routes.reload(); assigned.reload(); if (open && name) builder(name); }} />}
    </div>
  );
};

/** New area, or an area's name, prefix, region and route numbers (what the old builder's cards edited). */
const AreaEditor: React.FC<{ area: AreaPrefix | null; all: AreaPrefix[]; drawn: number; onClose: () => void; onSaved: (name: string | null, openBuilder: boolean) => void }> =
  ({ area, all, drawn, onClose, onSaved }) => {
    const [name, setName] = useState(area?.area_name || '');
    const [prefix, setPrefix] = useState(area?.prefix || '');
    const [region, setReg] = useState<Region>(area?.region || 'East');
    const [start, setStart] = useState(area?.route_start ?? 1);
    const [end, setEnd] = useState(area ? (area.route_start ?? 1) + area.route_count - 1 : 1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const input = { name, prefix, region, start, end };
    const problems = areaProblems(input, all, area?.area_name ?? null);
    const save = async (open: boolean) => {
      if (problems.length) return;
      setBusy(true); setError(null);
      try { await saveArea(input, area); onSaved(name.trim(), open); } catch (e) { setError(e); } finally { setBusy(false); }
    };
    const remove = async () => {
      if (!area) return;
      if (!confirmDelete) { setConfirmDelete(true); return; }
      setBusy(true); setError(null);
      try { await deleteArea(area.area_name); onSaved(null, false); } catch (e) { setError(e); } finally { setBusy(false); }
    };
    const count = end >= start ? end - start + 1 : 0;
    return (
      <Modal title={area ? `Edit ${area.area_name}` : 'New area'} onClose={onClose} footer={<>
        {area && <Btn kind="r" disabled={busy} onClick={remove}>{confirmDelete ? `Delete it${drawn ? ` and its ${drawn} drawn routes` : ''}` : 'Delete area'}</Btn>}
        <span className="v2-spacer" />
        <Btn kind="o" onClick={onClose}>Cancel</Btn>
        {!area && <Btn kind="o" disabled={busy || problems.length > 0} onClick={() => save(false)}>Create</Btn>}
        <Btn disabled={busy || problems.length > 0} onClick={() => save(!area)}>{busy ? 'Saving…' : area ? 'Save' : 'Create and open builder'}</Btn>
      </>}>
        <Field label="Area name"><input className="v2-input" value={name} onChange={e => setName(e.target.value.toUpperCase())} placeholder="e.g. GLEN ABBEY #3" /></Field>
        <div className="v2-grid2">
          <Field label="Prefix"><input className="v2-input" value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="GA" maxLength={6} /></Field>
          <div role="radiogroup" aria-label="Region">
            <div className="v2-label">Region</div>
            <div className="v2-row" style={{ gap: 6, marginBottom: 12 }}>{REGIONS.map(r => (
              <button key={r} type="button" role="radio" aria-checked={region === r} className={`v2-chip${region === r ? ' on' : ''}`} onClick={() => setReg(r)}>{r}</button>))}</div>
          </div>
          <Field label="First route number"><input className="v2-input" type="number" min={1} value={start} onChange={e => setStart(Number(e.target.value))} /></Field>
          <Field label="Last route number"><input className="v2-input" type="number" min={1} value={end} onChange={e => setEnd(Number(e.target.value))} /></Field>
        </div>
        {prefix && count > 0 && <div className="v2-note" style={{ marginTop: 0 }}>{count} route{count === 1 ? '' : 's'}: {routeCodeOf(prefix, start)} – {routeCodeOf(prefix, end)}.
          {area && area.area_name !== name.trim() && name.trim() ? ' Renaming keeps its drawn routes, center and clients.' : ''}</div>}
        {problems.length > 0 && (name || prefix) && <div className="v2-err">{problems.map(p => <div key={p}>{p}</div>)}</div>}
        <ErrorBox error={error} />
      </Modal>
    );
  };

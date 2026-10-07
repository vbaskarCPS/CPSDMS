// src/v2/features/admin/Territory.tsx — Super Admin › Territory › Assignments: which center owns each digital-map area.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { listCenters, useLoad } from '../../lib/data';
import { allRoutes, assignAreas, groupAreas, listAssignments } from '../../lib/territory';
import { Btn, ErrorBox, Loading, Tag } from '../../ui';

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
  const centers = useLoad(listCenters, []);
  const routes = useLoad(allRoutes, []);
  const assigned = useLoad(listAssignments, []);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const areas = useMemo(() => routes.data && assigned.data ? groupAreas(routes.data, assigned.data) : [], [routes.data, assigned.data]);
  const centerName = (id: string | null) => (id && (centers.data || []).find(c => c.id === id)?.display_name) || null;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return areas.filter(a => (show === 'all' || (show === 'unassigned' ? !a.centerId : a.centerId === show))
      && (!needle || a.name.toLowerCase().includes(needle) || a.prefix.toLowerCase() === needle));
  }, [areas, q, show]);
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

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Territory & Client Data</span>
        <span className="v2-spacer" />
        <span className="v2-mut v2-small">{areas.length} areas · {(routes.data || []).length} approved routes · {areas.filter(a => !a.centerId).length} unassigned</span>
      </div>
      <TerritoryTabs on="maps" />
      <div className="v2-row" style={{ marginBottom: 12 }}>
        <button className={`v2-chip${show === 'all' ? ' on' : ''}`} onClick={() => setShow('all')}>All</button>
        <button className={`v2-chip${show === 'unassigned' ? ' on' : ''}`} onClick={() => setShow('unassigned')}>Unassigned</button>
        {(centers.data || []).map(c => (
          <button key={c.id} className={`v2-chip${show === c.id ? ' on' : ''}`} onClick={() => setShow(c.id)}>{c.display_name} · {counts.get(c.id) || 0}</button>
        ))}
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
        <span className="v2-spacer" />
        {center && <span className="v2-note" style={{ margin: 0 }}>Each area belongs to one center; its routes show up in that center’s Start session.</span>}
      </div>

      <ErrorBox error={centers.error || routes.error || assigned.error || error} />
      {routes.loading || assigned.loading ? <Loading label="Loading 4,600 routes…" /> : (
        <div className="v2-card" style={{ padding: 0 }}>
          <div className="v2-table-wrap" style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto' }}>
            <table className="v2-table">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all shown" checked={allShownPicked}
                  onChange={() => setPicked(s => { const n = new Set(s); shown.forEach(a => allShownPicked ? n.delete(a.name) : n.add(a.name)); return n; })} /></th>
                <th>Area</th><th>Prefix</th><th>Routes</th><th>Numbers</th><th>Center</th>
              </tr></thead>
              <tbody>
                {shown.map(a => (
                  <tr key={a.name} className="click" onClick={() => toggle(a.name)}>
                    <td><input type="checkbox" checked={picked.has(a.name)} onChange={() => toggle(a.name)} onClick={e => e.stopPropagation()} aria-label={`Select ${a.name}`} /></td>
                    <td><b>{a.name}</b></td><td>{a.prefix}</td><td>{a.routes.length}</td>
                    <td className="v2-small">{a.routes[0].route_code} – {a.routes[a.routes.length - 1].route_code}</td>
                    <td>{centerName(a.centerId) ? <Tag tone="b">{centerName(a.centerId)}</Tag> : <span className="v2-mut">—</span>}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={6} className="v2-mut" style={{ padding: 20, textAlign: 'center' }}>No areas match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

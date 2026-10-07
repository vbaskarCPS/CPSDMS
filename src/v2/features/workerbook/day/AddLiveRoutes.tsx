// Session details on a live day: add routes (maps) to any manager on the session. Routes a
// manager already has show in their colour; another manager's are pink and can't be taken.
import React, { useMemo, useState } from 'react';
import { Check, Map as MapIcon } from 'lucide-react';
import { useLoad } from '../../../lib/data';
import { addLiveRoutes, liveRoutes } from '../../../lib/liveRoutes';
import type { PlanManager, PlanRoute } from '../../../lib/startSession';
import type { Area, RouteShape } from '../../../lib/territory';
import { Btn, ErrorBox, Loading } from '../../../ui';
import { MANAGER_COLORS, RoutePickerMap } from '../RoutePickerMap';

export const AddLiveRoutes: React.FC<{ centerId: string; areas: Area[]; shapes: RouteShape[]; canEdit: boolean }> = ({ centerId, areas, shapes, canEdit }) => {
  const live = useLoad(() => liveRoutes(centerId), [centerId]);
  const [active, setActive] = useState('');
  const [picks, setPicks] = useState<Map<string, PlanRoute>>(new Map());
  const [view, setView] = useState<'map' | 'list'>('map');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  const mgrs: PlanManager[] = useMemo(() => (live.data?.managers || []).map(m => ({ id: m.id, full_name: m.full_name, username: '', phone: null })), [live.data]);
  const painter = active && mgrs.some(m => m.id === active) ? active : mgrs[0]?.id || '';
  const areaOf = useMemo(() => { const m = new Map<string, { area: string; number: number }>(); for (const a of areas) for (const r of a.routes) m.set(r.route_code, { area: a.name, number: r.route_number }); return m; }, [areas]);
  // what the map shows: live routes (by owner) plus this manager's new picks
  const shown = useMemo(() => {
    const m = new Map<string, PlanRoute>();
    for (const [code, owner] of live.data?.owner || []) { const a = areaOf.get(code); m.set(code, { code, area: a?.area || '', number: a?.number || 0, managerId: owner }); }
    for (const [code, r] of picks) m.set(code, { ...r, managerId: painter });
    return m;
  }, [live.data, picks, painter, areaOf]);
  const color = (id: string) => MANAGER_COLORS[Math.max(0, mgrs.findIndex(m => m.id === id)) % MANAGER_COLORS.length];

  const toggle = (code: string, area: string, number: number) => {
    if (!canEdit || live.data?.owner.has(code)) return;   // already on the session: add-only
    setNote(null);
    setPicks(p => { const n = new Map(p); if (n.has(code)) n.delete(code); else n.set(code, { code, area, number, managerId: painter }); return n; });
  };
  const add = async () => {
    const m = mgrs.find(x => x.id === painter); if (!m) return;
    setBusy(true); setError(null);
    try {
      const n = await addLiveRoutes(centerId, painter, [...picks.values()]);
      setNote(`${n} route${n === 1 ? '' : 's'} added to ${m.full_name}. They see them the next time the RM map loads (refresh the page).`);
      setPicks(new Map()); live.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  if (live.loading && !live.data) return <div className="v2-card"><Loading label="Loading the live routes…" /></div>;
  if (!live.data) return null;
  const held = (id: string) => [...live.data!.owner.values()].filter(o => o === id).length;

  return (
    <div className="v2-card" style={{ marginTop: 14 }}>
      <div className="v2-row" style={{ marginBottom: 10 }}>
        <MapIcon size={18} /><span className="v2-h2" style={{ margin: 0 }}>Routes on the live session</span>
        <span className="v2-spacer" />
        <div className="v2-tabs" style={{ marginBottom: 0, borderBottom: 0 }}>
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>Map</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        </div>
      </div>
      <ErrorBox error={error || live.error} />
      {note && <div className="v2-row v2-small" style={{ color: '#047857', marginBottom: 8 }}><Check size={16} />{note}</div>}
      <div className="v2-split map">
        <div>
          {view === 'map' ? (
            <RoutePickerMap areas={areas} shapes={shapes} routes={shown} managers={mgrs} active={painter} onRouteClick={sh => toggle(sh.code, sh.area, sh.number)} />
          ) : areas.map(a => (
            <div key={a.name} style={{ marginBottom: 12 }}>
              <b>{a.name}</b>
              <div className="v2-row" style={{ gap: 6, marginTop: 6 }}>
                {a.routes.map(r => {
                  const owner = live.data!.owner.get(r.route_code); const mine = picks.has(r.route_code);
                  const bg = mine ? color(painter) : owner ? (owner === painter ? color(owner) : '#fbcfe8') : undefined;
                  return <button key={r.route_code} className="v2-chip" disabled={!!owner || !canEdit} onClick={() => toggle(r.route_code, a.name, r.route_number)}
                    title={owner ? `On the session (${mgrs.find(m => m.id === owner)?.full_name || owner})` : undefined}
                    style={bg ? { background: bg, borderColor: bg, color: owner && owner !== painter ? '#831843' : '#fff', outline: mine ? '2px dashed #111827' : undefined } : undefined}>{r.route_code}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="v2-stack" style={{ gap: 10 }}>
          <div className="v2-card-h" style={{ marginBottom: 0 }}>Add routes to</div>
          {mgrs.map(m => (
            <button key={m.id} className={`v2-mgr${painter === m.id ? ' on' : ''}`} onClick={() => { setActive(m.id); setPicks(new Map()); }} aria-pressed={painter === m.id}>
              <span className="dot" style={{ background: color(m.id) }} /><b>{m.full_name}</b><span className="v2-spacer" /><span className="v2-mut v2-small">{held(m.id)} routes</span>
            </button>
          ))}
          {mgrs.length === 0 && <div className="v2-mut v2-small">No managers are on the live session.</div>}
          <div className="v2-small">{picks.size ? <>New: <b>{[...picks.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}</b></> : <span className="v2-mut">Tap routes that aren’t on the session yet.</span>}</div>
          <Btn kind="g" disabled={!canEdit || busy || !picks.size || !painter} onClick={add}>
            {busy ? 'Adding…' : `Add ${picks.size || ''} route${picks.size === 1 ? '' : 's'} to ${mgrs.find(m => m.id === painter)?.full_name || 'manager'}`}</Btn>
          <div className="v2-note" style={{ marginTop: 0 }}>Routes can only be added mid-session, not moved or removed. Pink routes belong to another manager.</div>
        </div>
      </div>
    </div>
  );
};

// Session details on a live day: add routes (maps) to any manager on the session, on the same
// map picker as Start session. Routes already on the session are locked (dashed).
import React, { useMemo, useState } from 'react';
import { Check, Map as MapIcon } from 'lucide-react';
import { useLoad } from '../../../lib/data';
import { addLiveRoutes, liveRoutes } from '../../../lib/liveRoutes';
import type { PlanManager, PlanRoute } from '../../../lib/startSession';
import type { Area, RouteShape } from '../../../lib/territory';
import { Btn, ErrorBox, Loading } from '../../../ui';
import { MapRoutePicker } from '../MapRoutePicker';

export const AddLiveRoutes: React.FC<{ centerId: string; areas: Area[]; shapes: RouteShape[]; canEdit: boolean }> = ({ centerId, areas, shapes, canEdit }) => {
  const live = useLoad(() => liveRoutes(centerId), [centerId]);
  const [active, setActive] = useState('');
  const [picks, setPicks] = useState<Map<string, PlanRoute>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  const mgrs: PlanManager[] = useMemo(() => (live.data?.managers || []).map(m => ({ id: m.id, full_name: m.full_name, username: '', phone: null })), [live.data]);
  const painter = active && mgrs.some(m => m.id === active) ? active : mgrs[0]?.id || '';

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

  return (
    <div style={{ marginTop: 14 }}>
      <div className="v2-row" style={{ marginBottom: 10 }}>
        <MapIcon size={18} color="#9ca3af" /><span className="v2-h2" style={{ margin: 0 }}>Add routes to the live session</span>
      </div>
      <ErrorBox error={error || live.error} />
      {note && <div className="v2-card v2-row v2-small" style={{ color: '#047857', marginBottom: 10, padding: 10 }}><Check size={16} />{note}</div>}
      <MapRoutePicker areas={areas} shapes={shapes} managers={mgrs} routes={picks} locked={live.data.owner} active={painter}
        onActive={id => { setActive(id); setPicks(new Map()); setNote(null); }}
        onChange={next => { if (!canEdit) return; setNote(null); setPicks(new Map([...next].filter(([, r]) => r.managerId === painter))); }}
        footer={
          <div className="v2-card" style={{ padding: 12 }}>
            <div className="v2-small" style={{ marginBottom: 8 }}>{picks.size
              ? <>New for {mgrs.find(m => m.id === painter)?.full_name}: <b>{[...picks.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}</b></>
              : <span className="v2-mut">Open a map and tap routes that aren’t on the session yet (dashed numbers are already on it).</span>}</div>
            <Btn kind="g" disabled={!canEdit || busy || !picks.size || !painter} onClick={add} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Adding…' : `Add ${picks.size || ''} route${picks.size === 1 ? '' : 's'} to ${mgrs.find(m => m.id === painter)?.full_name || 'manager'}`}</Btn>
            <div className="v2-note">Mid-session, routes can only be added, not moved or removed.</div>
          </div>
        } />
    </div>
  );
};

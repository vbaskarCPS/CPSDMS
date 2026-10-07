// src/v2/features/rm/Floater.tsx — Route Manager › Floater view (Floater Route Manager permission).
//
// Every live session's route managers, by command center, with what they have today (routes,
// areas, workers, carts, steps, gross so far). Pick one or more at a center and open the floater
// map for them: the same map an office-set floater gets, covering all their teams and routes.
// One center at a time, because each center runs its own live session.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Map as MapIcon, RefreshCw, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { actAsLegacyFloater, floaterManagers, routeRuns, type FloaterManager } from '../../lib/floater';
import { hasLiveRouteManagerSeat } from '../../lib/legacy';
import { legacyManagerId } from '../../lib/startSession';
import { serviceLabel } from '../../lib/permissions';
import { Btn, ErrorBox, Loading } from '../../ui';

const RMLogbook = React.lazy(() => import('../../../pages/Management/RMLogbook'));
const money = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`;
const PICK_KEY = (uid: string) => `cpsdms-v2-floater-${uid}`;
const readPick = (uid: string): { cc: string; ids: string[] } | null => { try { return JSON.parse(localStorage.getItem(PICK_KEY(uid)) || 'null'); } catch { return null; } };
const writePick = (uid: string, v: { cc: string; ids: string[] }) => { try { localStorage.setItem(PICK_KEY(uid), JSON.stringify(v)); } catch { /* private mode */ } };

/** /app/rm/floater — choose the managers. */
export const FloaterPicker: React.FC = () => {
  const { profile, center } = useAuth();
  const nav = useNavigate();
  const list = useLoad(floaterManagers, []);
  const [cc, setCc] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  // my own map, when I'm a manager on a session today
  const ownCenter = profile?.rm_center_id || center?.id || null;
  const own = useLoad(async () => ownCenter && profile ? hasLiveRouteManagerSeat(ownCenter, legacyManagerId(profile.full_name)) : false, [ownCenter, profile?.full_name]);

  const byCenter = useMemo(() => {
    const m = new Map<string, FloaterManager[]>();
    for (const r of list.data || []) m.set(r.center_id, [...(m.get(r.center_id) || []), r]);
    return [...m.values()];
  }, [list.data]);

  // the last pick on this device, if those managers are still on today
  useEffect(() => {
    if (!profile || !list.data || cc) return;
    const last = readPick(profile.id);
    if (!last) return;
    const ids = last.ids.filter(id => list.data!.some(r => r.center_id === last.cc && r.manager_id === id));
    if (ids.length) { setCc(last.cc); setPicked(new Set(ids)); }
  }, [profile, list.data, cc]);

  const toggle = (r: FloaterManager) => {
    setNote(null);
    if (cc && cc !== r.center_id) {
      setNote(`Switched to ${r.center_name}: the floater view covers one command center at a time.`);
      setCc(r.center_id); setPicked(new Set([r.manager_id])); return;
    }
    const next = new Set(picked);
    if (next.has(r.manager_id)) next.delete(r.manager_id); else next.add(r.manager_id);
    setCc(next.size ? r.center_id : null); setPicked(next);
  };
  const pickAll = (rows: FloaterManager[]) => { setNote(null); setCc(rows[0].center_id); setPicked(new Set(rows.map(r => r.manager_id))); };
  const open = () => {
    if (!cc || !picked.size || !profile) return;
    writePick(profile.id, { cc, ids: [...picked] });
    nav(`/app/rm/floater/map?cc=${encodeURIComponent(cc)}&m=${[...picked].map(encodeURIComponent).join(',')}`);
  };
  const chosenCenter = byCenter.find(rows => rows[0].center_id === cc)?.[0];

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Floater view</span>
        <span className="v2-mut v2-small">Pick route managers to follow, then open their map.</span>
        <span className="v2-spacer" />
        <button className="v2-gbtn" onClick={list.reload} aria-label="Refresh" title="Refresh"><RefreshCw size={15} /></button>
        {own.data && <Btn kind="o" icon={MapIcon} onClick={() => nav('/app/rm?own=1')}>My own map</Btn>}
        <Btn icon={Users} disabled={!picked.size} onClick={open}>
          {picked.size ? `Open floater view · ${picked.size} manager${picked.size === 1 ? '' : 's'}${chosenCenter ? ` · ${chosenCenter.center_name}` : ''}` : 'Open floater view'}
        </Btn>
      </div>
      {note && <div className="v2-note" style={{ marginTop: 0 }}>{note}</div>}
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Loading /> : byCenter.length === 0 ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>No sessions are live right now, so there are no route managers out today.</div>
      ) : byCenter.map(rows => {
        const c = rows[0]; const here = cc === c.center_id;
        return (
          <section key={c.center_id} className="v2-card" style={{ padding: 0, marginBottom: 14, ...(here ? { borderColor: 'var(--blue)' } : {}) }}>
            <div className="v2-row" style={{ padding: '12px 14px 8px' }}>
              <b>{c.center_name}</b>
              <span className="v2-mut v2-small">{serviceLabel(c.season_type)} · {new Date(c.session_date + 'T12:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })} · {rows.length} manager{rows.length === 1 ? '' : 's'}</span>
              <span className="v2-spacer" />
              {rows.length > 1 && <Btn size="sm" kind="o" onClick={() => pickAll(rows)}>Pick all</Btn>}
            </div>
            <div className="v2-table-wrap">
              <table className="v2-table">
                <thead><tr><th style={{ width: 34 }} /><th>Manager</th><th>Routes today</th><th>Areas</th>
                  <th style={{ textAlign: 'right' }}>Workers</th><th style={{ textAlign: 'right' }}>Carts</th><th style={{ textAlign: 'right' }}>Steps</th><th style={{ textAlign: 'right' }}>Gross</th></tr></thead>
                <tbody>{rows.map(r => {
                  const on = here && picked.has(r.manager_id);
                  return (
                    <tr key={r.manager_id} className="click" onClick={() => toggle(r)} style={on ? { background: '#eff6ff' } : undefined}>
                      <td><input type="checkbox" checked={on} onChange={() => toggle(r)} onClick={e => e.stopPropagation()} aria-label={`Follow ${r.manager_name}`} /></td>
                      <td><b>{r.manager_name}</b>{r.phone && <div className="v2-small v2-mut">{r.phone}</div>}</td>
                      <td className="v2-small">{r.routes.length ? <><b>{r.routes.length}</b> · {routeRuns(r.routes)}</> : <span className="v2-mut">none yet</span>}</td>
                      <td className="v2-small">{r.areas.length ? r.areas.join(', ') : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{r.workers}</td><td style={{ textAlign: 'right' }}>{r.carts}</td>
                      <td style={{ textAlign: 'right' }}>{Math.round(r.steps * 10) / 10}</td><td style={{ textAlign: 'right' }}>{money(r.gross)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
        );
      })}
      <div className="v2-note">Steps and gross are what their workers have logged so far today. The floater map covers the managers you pick, at one command center at a time.</div>
    </div>
  );
};

/** /app/rm/floater/map?cc=…&m=… — the floater map for the chosen managers (full screen). */
export const FloaterMap: React.FC = () => {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const cc = params.get('cc') || '';
  const ids = (params.get('m') || '').split(',').map(s => s.trim()).filter(Boolean);
  const ready = useLoad(async () => {
    if (!cc || !ids.length || !profile) return { ok: false as const, why: 'Pick at least one manager first.' };
    const live = await floaterManagers();
    const here = live.filter(r => r.center_id === cc && ids.includes(r.manager_id));
    if (!here.length) return { ok: false as const, why: 'Those managers aren’t on a live session any more.' };
    await actAsLegacyFloater(cc, profile, here.map(r => r.manager_id));
    return { ok: true as const, names: here.map(r => r.manager_name), center: here[0].center_name };
  }, [cc, ids.join(','), profile?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (ready.loading) return <div className="v2"><Loading label="Opening the floater map…" /></div>;
  if (ready.error || !ready.data?.ok) return (
    <div className="v2"><div className="v2-main v2-narrow">
      <div className="v2-head"><Link to="/app/rm/floater" className="v2-link">‹ Floater view</Link></div>
      <ErrorBox error={ready.error} />{ready.data && !ready.data.ok && <div className="v2-card" style={{ padding: 24 }}>{ready.data.why}</div>}
    </div></div>);
  return (
    <>
      <Suspense fallback={<div className="v2"><Loading label="Opening the floater map…" /></div>}><RMLogbook key={`${cc}|${ids.join(',')}`} /></Suspense>
      <button type="button" className="v2-floater-back" onClick={() => nav('/app/rm/floater')}
        title={`Floating for ${ready.data.names.join(', ')} · ${ready.data.center}`}>
        <ArrowLeft size={14} /> {ready.data.names.length === 1 ? ready.data.names[0] : `${ready.data.names.length} managers`}
      </button>
    </>
  );
};

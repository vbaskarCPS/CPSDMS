// src/v2/features/workerbook/Crew.tsx — Workerbook › Crew list.
//
// Road-trip center: everyone working here right now (its own people plus anyone pulled in from
// their home cities), with hotel room numbers you can change any time. "Pull in workers" brings
// people over from other centers; "Send home" puts them back on their home city's WDR list.
// In-city center: who from here is away on a road trip, and "Send to a road trip".
import { Link } from 'react-router-dom';
import React, { useEffect, useMemo, useState } from 'react';
import { BedDouble, Check, Home, Search, Truck, UserPlus } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import { centerTypeLabel, crewList, crewMove, crewSearch, roadTripCenters, setRoom, type CrewRow } from '../../lib/crew';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

const name = (r: CrewRow) => `${r.first_name} ${r.last_name}`.trim();
const since = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '';
const statusTag = (s: string) => s === 'active' ? <Tag tone="g">Active</Tag> : <Tag tone="a">{s}</Tag>;
const matches = (r: CrewRow, q: string) => {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return r.cn.toLowerCase().startsWith(t) || name(r).toLowerCase().includes(t) || (r.room || '').toLowerCase() === t
    || (t.replace(/\D/g, '').length >= 4 && (r.cell_phone || '').replace(/\D/g, '').includes(t.replace(/\D/g, '')));
};

/** Room number, saved when you leave the box or press Enter. */
const RoomInput: React.FC<{ row: CrewRow; onSaved: () => void }> = ({ row, onSaved }) => {
  const [v, setV] = useState(row.room || '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => { setV(row.room || ''); }, [row.room]);
  const save = async () => {
    if ((v.trim() || '') === (row.room || '')) return;
    setState('saving');
    try { await setRoom(row.hire_id, v); setState('saved'); onSaved(); setTimeout(() => setState('idle'), 1500); }
    catch { setState('error'); }
  };
  return (
    <span className="v2-room">
      <input className="v2-input" value={v} placeholder="—" aria-label={`Room for ${name(row)}`} maxLength={12}
        style={state === 'error' ? { borderColor: 'var(--rose)' } : undefined}
        onChange={e => { setV(e.target.value); setState('idle'); }} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {state === 'saved' && <Check size={14} color="var(--green)" />}
    </span>
  );
};

export const Crew: React.FC = () => {
  const { center, can } = useAuth();
  const list = useLoad(() => center ? crewList(center.id) : Promise.resolve(null), [center?.id]);
  const [q, setQ] = useState('');
  const [moving, setMoving] = useState<'pull' | 'push' | null>(null);
  const [sendHome, setSendHome] = useState<CrewRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const data = list.data;
  const rt = data?.type === 'road_trip';
  const here = useMemo(() => (data?.here || []).filter(r => matches(r, q)), [data, q]);
  const away = useMemo(() => (data?.away || []).filter(r => matches(r, q)), [data, q]);

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (!can('workerbook')) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to the crew list.</div></div>;

  const bringHome = async (r: CrewRow) => {
    setBusy(true); setError(null);
    try { await crewMove([r.hire_id], null); setSendHome(null); list.reload(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="v2-main">
      <div className="v2-head">
        <Link to="/app/workerbook/days" className="v2-link">‹ Calendar</Link>
        <span className="v2-h1">Crew list</span>
        {data && <Tag tone={rt ? 'v' : 'b'}>{centerTypeLabel(data.type)}</Tag>}
        {data && <span className="v2-mut v2-small">{rt ? `${data.here.length} at ${center.display_name}` : `${data.away.length} away on road trips`}</span>}
        <span className="v2-spacer" />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
          <input className="v2-input" style={{ paddingLeft: 30, width: 240 }} placeholder="Name, CN #, room or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the crew" />
        </div>
        {data && (rt
          ? <Btn icon={UserPlus} onClick={() => setMoving('pull')}>Pull in workers</Btn>
          : <Btn icon={Truck} onClick={() => setMoving('push')}>Send to a road trip</Btn>)}
      </div>
      <ErrorBox error={list.error || error} />
      {list.loading && !data ? <Loading /> : !data ? null : rt ? (
        <>
          <div className="v2-note" style={{ marginBottom: 12 }}>
            Everyone working at {center.display_name} right now. Rooms can be changed any time. Sending someone home puts them on their home city’s WDR list.
          </div>
          {here.length === 0 ? (
            <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
              {q ? 'Nobody on the crew matches that.' : <>Nobody is on the crew yet.<div style={{ marginTop: 12 }}><Btn icon={UserPlus} onClick={() => setMoving('pull')}>Pull in workers</Btn></div></>}
            </div>
          ) : (
            <>
              <div className="v2-stack v2-only-narrow" style={{ gap: 10 }}>
                {here.map(r => (
                  <div key={r.hire_id} className="v2-card">
                    <div className="v2-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}><b>{name(r)}</b> <span className="v2-mut v2-small">{r.cn}</span>
                        <div className="v2-small v2-mut">{r.home_id === center.id ? 'Home crew' : `From ${r.home}${r.moved_at ? ` · since ${since(r.moved_at)}` : ''}`}</div></div>
                      {statusTag(r.status)}
                    </div>
                    <div className="v2-row" style={{ marginTop: 10, gap: 8 }}>
                      <BedDouble size={16} color="#6b7280" /><RoomInput row={r} onSaved={list.reload} />
                      <span className="v2-spacer" />
                      {r.cell_phone && <a className="v2-btn o sm" href={`tel:${r.cell_phone.replace(/[^\d+]/g, '')}`}>Call</a>}
                      {r.home_id !== center.id && <Btn size="sm" kind="o" icon={Home} onClick={() => setSendHome(r)}>Send home</Btn>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="v2-card v2-only-wide" style={{ padding: 0 }}>
                <div className="v2-table-wrap">
                  <table className="v2-table">
                    <thead><tr><th style={{ width: 110 }}>Room</th><th>CN #</th><th>Name</th><th>Home city</th><th>Cell</th><th>Status</th><th>Here since</th><th /></tr></thead>
                    <tbody>
                      {here.map(r => (
                        <tr key={r.hire_id}>
                          <td><RoomInput row={r} onSaved={list.reload} /></td>
                          <td><b>{r.cn}</b></td>
                          <td><b>{name(r)}</b></td>
                          <td>{r.home_id === center.id ? <span className="v2-mut">Home crew</span> : r.home}</td>
                          <td className="v2-small">{r.cell_phone || '—'}</td>
                          <td>{statusTag(r.status)}</td>
                          <td className="v2-small v2-mut">{r.home_id === center.id ? '—' : since(r.moved_at)}</td>
                          <td style={{ textAlign: 'right' }}>{r.home_id !== center.id && <Btn size="sm" kind="o" icon={Home} onClick={() => setSendHome(r)}>Send home</Btn>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="v2-note" style={{ marginBottom: 12 }}>
            {center.display_name} is an In City center. Its contractors are under Contractors; here you can see who’s away on a road trip, send people out, or bring them home.
          </div>
          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-card-h" style={{ padding: '12px 14px 0' }}>Away on road trips</div>
            {away.length === 0 ? <div className="v2-mut" style={{ padding: 14 }}>{q ? 'Nobody away matches that.' : `Nobody from ${center.display_name} is away.`}</div> : (
              <div className="v2-table-wrap">
                <table className="v2-table">
                  <thead><tr><th>CN #</th><th>Name</th><th>Working at</th><th>Room</th><th>Since</th><th /></tr></thead>
                  <tbody>{away.map(r => (
                    <tr key={r.hire_id}>
                      <td><b>{r.cn}</b></td><td><b>{name(r)}</b></td><td>{r.current}</td><td>{r.room || '—'}</td><td className="v2-small v2-mut">{since(r.moved_at)}</td>
                      <td style={{ textAlign: 'right' }}><Btn size="sm" kind="o" icon={Home} onClick={() => setSendHome(r)}>Bring home</Btn></td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {sendHome && (
        <Modal title={`${rt ? 'Send' : 'Bring'} ${name(sendHome)} home?`} onClose={() => setSendHome(null)}
          footer={<><Btn kind="o" onClick={() => setSendHome(null)}>Cancel</Btn><Btn kind="r" disabled={busy} onClick={() => bringHome(sendHome)}>{busy ? 'Moving…' : rt ? 'Send home' : 'Bring home'}</Btn></>}>
          <p style={{ marginTop: 0 }}>{sendHome.cn} goes back to <b>{sendHome.home}</b> and onto its <b>WDR</b> list (worked, didn’t rebook). {sendHome.home} can make them active again or mark them as quit.</p>
          {sendHome.room && <p className="v2-mut v2-small">Their room ({sendHome.room}) is cleared.</p>}
          <ErrorBox error={error} />
        </Modal>
      )}
      {moving && <MoveWorkers mode={moving} centerId={center.id} centerName={center.display_name} onClose={() => setMoving(null)} onMoved={() => { setMoving(null); list.reload(); }} />}
    </div>
  );
};

/** Pull workers in to this road-trip center, or push this center's workers out to one. */
const MoveWorkers: React.FC<{ mode: 'pull' | 'push'; centerId: string; centerName: string; onClose: () => void; onMoved: () => void }> =
  ({ mode, centerId, centerName, onClose, onMoved }) => {
    const [q, setQ] = useState('');
    const [debounced, setDebounced] = useState('');
    useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
    const results = useLoad(() => crewSearch(centerId, debounced, mode === 'pull' ? 'others' : 'home'), [centerId, debounced, mode]);
    const trips = useLoad(() => mode === 'push' ? roadTripCenters() : Promise.resolve([]), [mode]);
    const [picked, setPicked] = useState<Map<string, { row: CrewRow; room: string }>>(new Map());
    const [dest, setDest] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const toggle = (r: CrewRow) => setPicked(m => { const n = new Map(m); if (n.has(r.hire_id)) n.delete(r.hire_id); else n.set(r.hire_id, { row: r, room: '' }); return n; });
    const blocked = (r: CrewRow) => ['Q', 'F', 'WL'].includes(r.status);
    const target = mode === 'pull' ? centerId : dest;

    const go = async () => {
      setBusy(true); setError(null);
      try {
        for (const { row, room } of picked.values()) await crewMove([row.hire_id], target, room || null);
        onMoved();
      } catch (e) { setError(e); } finally { setBusy(false); }
    };
    const destName = mode === 'pull' ? centerName : (trips.data || []).find(t => t.id === dest)?.display_name;

    return (
      <Modal wide title={mode === 'pull' ? `Pull workers in to ${centerName}` : `Send ${centerName} workers to a road trip`} onClose={onClose}
        footer={<><span className="v2-small v2-mut" style={{ marginRight: 'auto' }}>{picked.size} selected</span>
          <Btn kind="o" onClick={onClose}>Cancel</Btn>
          <Btn icon={mode === 'pull' ? UserPlus : Truck} disabled={busy || picked.size === 0 || !target} onClick={go}>
            {busy ? 'Moving…' : mode === 'pull' ? `Pull in ${picked.size || ''}` : `Send ${picked.size || ''}${destName ? ` to ${destName}` : ''}`}</Btn></>}>
        {mode === 'push' && (
          <Field label="Road trip">
            <select className="v2-sel" value={dest} onChange={e => setDest(e.target.value)}>
              <option value="">Choose a road-trip center…</option>
              {(trips.data || []).map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
            </select>
          </Field>
        )}
        <div className="v2-grid2" style={{ alignItems: 'start' }}>
          <div>
            <input className="v2-input" autoFocus placeholder={mode === 'pull' ? 'Search any center: name, CN # or phone' : 'Search your contractors: name, CN # or phone'}
              value={q} onChange={e => setQ(e.target.value)} aria-label="Search workers" />
            <div className="v2-stack" style={{ gap: 6, marginTop: 10, maxHeight: 380, overflow: 'auto' }}>
              {debounced.trim().length < 2 ? <div className="v2-mut v2-small">Type at least 2 letters.</div>
                : results.loading && !results.data ? <Loading />
                : (results.data || []).length === 0 ? <div className="v2-mut v2-small">Nobody matches.</div>
                : (results.data || []).map(r => {
                  const on = picked.has(r.hire_id);
                  return (
                    <button key={r.hire_id} type="button" className={`v2-pick${on ? ' on' : ''}`} disabled={blocked(r)} onClick={() => toggle(r)}
                      title={blocked(r) ? `On the ${r.status} list at ${r.home}; change that first` : undefined}>
                      <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                      <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                        <b>{name(r)}</b> <span className="v2-mut">{r.cn}</span>
                        <span className="v2-small v2-mut" style={{ display: 'block' }}>
                          {r.current ? `At ${r.current} now (home ${r.home})` : `Home: ${r.home}`}{r.status !== 'active' ? ` · ${r.status}` : ''}
                        </span>
                      </span>
                      {statusTag(r.status)}
                    </button>
                  );
                })}
            </div>
          </div>
          <div>
            <div className="v2-card-h">Moving {picked.size ? `(${picked.size})` : ''}</div>
            {picked.size === 0 ? <div className="v2-mut v2-small">Pick people on the left.</div> : (
              <div className="v2-stack" style={{ gap: 6 }}>
                {[...picked.values()].map(({ row, room }) => (
                  <div key={row.hire_id} className="v2-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span style={{ flex: 1, minWidth: 0 }}><b>{name(row)}</b> <span className="v2-mut v2-small">{row.cn}</span></span>
                    <input className="v2-input" style={{ width: 90 }} placeholder="Room" value={room} aria-label={`Room for ${name(row)}`}
                      onChange={e => setPicked(m => new Map(m).set(row.hire_id, { row, room: e.target.value }))} />
                    <button type="button" className="v2-link" onClick={() => toggle(row)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="v2-note" style={{ marginTop: 12 }}>
              They become Active at {destName || 'the road trip'} and leave their current center’s lists. Room numbers are optional and can be added later.
            </div>
          </div>
        </div>
        <ErrorBox error={error} />
      </Modal>
    );
  };

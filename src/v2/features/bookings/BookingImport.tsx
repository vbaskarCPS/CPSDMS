// src/v2/features/bookings/BookingImport.tsx — The Benny's booking import: the old BC Master Bookings
// "Star Plan Bookings" tab dropped into Client lists becomes the Fall Rejuv booking list.
//
//   1. read  every row is a prepaid AFSL office flat on an SP Pro plan (Call 1st → field notes,
//            Notes → office notes, $ → the plan's price, the A–L marks → what spring did)
//   2. find  each address is looked up on the map (Mapbox) and placed on the digital maps:
//            on map / moved / waiting on map / no location; rows already loaded are skipped
//   3. load  the bookings are saved; each joins (or starts) its customer record
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, MapPin, Upload, X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  checkImport, cityForRoute, listLists, locateRows, parseBookingTab, repeats, saveImportRows, starPlanToBooking, STATE_HINT, STATE_LABEL,
  type CheckRow, type ImportRow, type MapState,
} from '../../lib/bookings';
import { Btn, ErrorBox, Loading, Tag } from '../../ui';

const STATES: MapState[] = ['on_map', 'moved', 'waiting', 'no_location'];
const TONE: Record<MapState, 'g' | 'b' | 'a' | 'r'> = { on_map: 'g', moved: 'b', waiting: 'a', no_location: 'r' };

export const BookingImport: React.FC<{ fileName: string; tab: string; rows: unknown[][]; onClose: () => void }> = ({ fileName, tab, rows, onClose }) => {
  const { center } = useAuth();
  const lists = useLoad(() => (center ? listLists(center.id) : Promise.resolve([])), [center?.id]);
  const mine = (lists.data || []).filter(l => l.mine);
  const [listId, setListId] = useState<string>('');
  const list = mine.find(l => l.id === listId) || mine.find(l => l.part === 'fall') || mine[0] || null;

  const parsed = useMemo(() => parseBookingTab(rows), [rows]);
  const dupes = useMemo(() => repeats(parsed), [parsed]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [found, setFound] = useState<{ rows: (ImportRow & { i: number })[]; check: Map<number, CheckRow> } | null>(null);
  const [done, setDone] = useState<{ added: number; already: number; new_clients: number; states: Record<string, number> } | null>(null);
  const [show, setShow] = useState<MapState | 'already' | null>(null);

  const run = async (fn: () => Promise<void>) => { setError(null); try { await fn(); } catch (e) { setError(e); } finally { setBusy(null); } };
  const find = () => list && run(async () => {
    setBusy('Finding the addresses on the map…');
    const pts = await locateRows(parsed, n => setBusy(`Finding the addresses on the map… ${n} of ${parsed.length}`));
    const built = parsed.map((b, i) => ({ ...starPlanToBooking(b, pts.get(i) || null, cityForRoute(b.sheet_route)), i }));
    setBusy('Placing them on the digital maps…');
    const check = await checkImport(list.id, built);
    setFound({ rows: built, check });
  });
  const load = () => list && found && run(async () => {
    const todo = found.rows.filter(r => !found.check.get(r.i)?.already);
    setBusy(`Loading ${todo.length} bookings…`);
    setDone(await saveImportRows(list.id, fileName, todo.map(({ i: _i, ...r }) => r), n => setBusy(`Loading bookings… ${n} of ${todo.length}`)));
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { already: 0, on_map: 0, moved: 0, waiting: 0, no_location: 0 };
    const seen = new Set<string>();
    for (const r of found?.rows || []) {
      if (seen.has(r.key)) continue; seen.add(r.key);
      const k = found!.check.get(r.i);
      if (!k) continue;
      if (k.already) c.already++; else c[k.map_state]++;
    }
    return c;
  }, [found]);
  const toLoad = counts.on_map + counts.moved + counts.waiting + counts.no_location;
  const shownRows = (found?.rows || []).filter(r => {
    const k = found!.check.get(r.i); if (!k || !show) return false;
    return show === 'already' ? k.already : !k.already && k.map_state === show;
  });

  if (!center) return <div className="v2-card v2-mut">Pick the center that works this list (BC Fall RJ) in the top bar first.</div>;
  if (lists.loading && !lists.data) return <Loading label="Finding the booking lists…" />;

  return (
    <div className="v2-card" style={{ display: 'grid', gap: 12 }}>
      <div className="v2-row" style={{ gap: 8 }}>
        <Upload size={18} /><b style={{ fontSize: 17 }}>Booking list import</b>
        <span className="v2-spacer" />
        <button type="button" className="v2-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="v2-note" style={{ margin: 0 }}>
        The Benny recognised <b>{tab}</b> from the old Master Bookings sheet ({fileName}). Every row loads as a <b>prepaid AFSL</b> booking on an <b>SP Pro</b> plan:
        Call 1st becomes the field notes the crew sees, Notes the office notes, and the A–L marks what was done in spring. Only this tab is read.
      </div>
      <ErrorBox error={error || lists.error} />
      {!mine.length ? (
        <div className="v2-err">{center.display_name} doesn’t work a booking list. Pick BC Fall RJ in the top bar.</div>
      ) : (
        <div className="v2-row" style={{ gap: 8 }}>
          <span className="v2-mut">Into</span>
          <select className="v2-input" style={{ width: 'auto' }} value={list?.id || ''} onChange={e => { setListId(e.target.value); setFound(null); setDone(null); }} disabled={!!busy || !!done}>
            {mine.map(l => <option key={l.id} value={l.id}>{l.name} {l.year} · {l.total} loaded</option>)}
          </select>
        </div>
      )}

      <div className="v2-mb-nums">
        <span><b>{parsed.length}</b> rows</span>
        <span><b>{new Set(parsed.map(p => p.key)).size}</b> bookings</span>
        <span><b>{parsed.filter(p => !p.sheet_route).length}</b> without a route</span>
        <span><b>{parsed.filter(p => !p.prepaid_marked).length}</b> PP not marked</span>
      </div>
      {dupes.length > 0 && (
        <details>
          <summary className="v2-small"><b>{dupes.length}</b> address{dupes.length === 1 ? '' : 'es'} repeat on more than one row; each loads once</summary>
          <ul className="v2-small" style={{ margin: '6px 0 0 18px' }}>
            {dupes.map(g => <li key={g[0].key}>{g[0].sheet_route} · {g[0].house_no} {g[0].street} — rows {g.map(x => x.row).join(', ')}</li>)}
          </ul>
        </details>
      )}

      {busy && <div className="v2-mut">{busy}</div>}

      {done ? (
        <div className="v2-card" style={{ background: 'var(--v2-green-bg, #f0fdf4)' }}>
          <div className="v2-row" style={{ gap: 8 }}><CheckCircle2 size={18} color="#16a34a" /><b>{done.added} bookings loaded into {list?.name}</b></div>
          <div className="v2-small" style={{ marginTop: 6 }}>
            {STATES.map(s => `${done.states[s] || 0} ${STATE_LABEL[s].toLowerCase()}`).join(' · ')}{done.already ? ` · ${done.already} were already loaded` : ''}{done.new_clients ? ` · ${done.new_clients} new customer records` : ''}
          </div>
          <div className="v2-row" style={{ gap: 8, marginTop: 10 }}>
            <Link className="v2-btn" to="/app/bookings/list">Open the bookings</Link>
            <Btn kind="o" onClick={onClose}>Done</Btn>
          </div>
        </div>
      ) : !found ? (
        <div className="v2-row" style={{ gap: 8 }}>
          <Btn icon={MapPin} onClick={find} disabled={!list || !!busy || !parsed.length}>Find the addresses</Btn>
          <span className="v2-mut v2-small">Nothing is saved until you load.</span>
        </div>
      ) : (
        <>
          <div className="v2-mb-states">
            {STATES.map(s => (
              <button key={s} type="button" className={`v2-card v2-mb-state${show === s ? ' on' : ''}`} onClick={() => setShow(show === s ? null : s)} title={STATE_HINT[s]}>
                <Tag tone={TONE[s]}>{STATE_LABEL[s]}</Tag><b>{counts[s]}</b>
              </button>
            ))}
            <button type="button" className={`v2-card v2-mb-state${show === 'already' ? ' on' : ''}`} onClick={() => setShow(show === 'already' ? null : 'already')}>
              <Tag>Already loaded</Tag><b>{counts.already}</b>
            </button>
          </div>
          {show && (
            <div className="v2-card" style={{ padding: 8, maxHeight: 320, overflow: 'auto' }}>
              {show !== 'already' && <div className="v2-note" style={{ margin: '0 0 6px' }}>{STATE_HINT[show]}</div>}
              {shownRows.length === 0 ? <div className="v2-mut v2-small">None.</div> : shownRows.map(r => {
                const k = found.check.get(r.i)!;
                return (
                  <div key={r.i} className="v2-mb-booking">
                    <div className="v2-row" style={{ gap: 6 }}><b>{r.house_no} {r.street}</b><span className="v2-mut v2-small">{r.city}</span><span className="v2-spacer" />
                      <span className="v2-small">{k.map_state === 'moved' ? `${k.moved_from} → ${k.route_code}` : (k.route_code || r.sheet_route || 'no route')}</span></div>
                    <div className="v2-mut v2-small">{[r.people[0] && `${r.people[0].first} ${r.people[0].last}`.trim(), k.area_name, `row ${r.source.row}`].filter(Boolean).join(' · ')}</div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="v2-row" style={{ gap: 8 }}>
            <Btn icon={Upload} onClick={load} disabled={!!busy || !toLoad}>{toLoad ? `Load ${toLoad} bookings into ${list?.name}` : 'Nothing new to load'}</Btn>
            <Btn kind="o" onClick={() => setFound(null)} disabled={!!busy}>Back</Btn>
          </div>
          <div className="v2-note" style={{ margin: 0 }}>
            Waiting bookings attach by themselves as their maps are approved. Bookings with no location can be fixed from the Bookings tab.
          </div>
        </>
      )}
    </div>
  );
};

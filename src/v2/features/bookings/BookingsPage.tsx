// src/v2/features/bookings/BookingsPage.tsx — Master Bookings › Bookings and › Plans.
//
//   Bookings  one season's booking list (Fall Rejuv 2026…): every booking with where it sits on the
//             digital maps (on map / moved / waiting / no location) and how it's going (open, tried,
//             done, cancelled). Add a booking, or open one to change it. "Waiting on a map" groups
//             the bookings whose maps aren't built yet, busiest first, so the builders know where to go.
//   Plans     every plan the region has sold (SP Pro, Grub Control…), across seasons, with its bookings.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, MapPin, Plus, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  attemptLine, bookingColor, cityForRoute, findPoint, getBooking, lastAttempt, listBookings, listLists, listPlans, PART_LABEL, PLAN_LABEL, placeAgain,
  saveBooking, servicesCode, servicesFromCode, STATE_HINT, STATE_LABEL, waiting,
  type Booking, type BookingList, type BookingPatch, type BookingStatus, type MapState, type PlanKind,
} from '../../lib/bookings';
import { Btn, ErrorBox, Field, Loading, Modal, Tag } from '../../ui';

// On map and Moved are one filter: either way the booking is on a built route (Moved just shows the route it moved to)
const STATES: MapState[] = ['on_map', 'waiting', 'no_location'];
const mapped = (s: MapState) => (s === 'moved' ? 'on_map' : s);
const STATE_TONE: Record<MapState, 'g' | 'b' | 'a' | 'r'> = { on_map: 'g', moved: 'b', waiting: 'a', no_location: 'r' };
type StatusPick = BookingStatus | 'tried';
const STATUS_LABEL: Record<StatusPick, string> = { open: 'Open', tried: 'Tried', done: 'Done', cancelled: 'Cancelled' };
const shortDay = (d: string | null | undefined) => {
  if (!d) return ''; const x = new Date(`${d.slice(0, 10)}T12:00:00`);
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
};
const nameOf = (b: Booking) => (b.people?.[0] ? `${b.people[0].first || ''} ${b.people[0].last || ''}`.trim() : '');
const addressOf = (b: Pick<Booking, 'house_no' | 'street_name' | 'unit'>) => `${b.house_no} ${b.street_name}${b.unit ? ` #${b.unit}` : ''}`;

/** The center's lists, and the one picked (the list this center works, the fall one first). */
function useLists(centerId: string | undefined) {
  const lists = useLoad(() => (centerId ? listLists(centerId) : Promise.resolve([] as BookingList[])), [centerId]);
  const [pick, setPick] = useState<string>('');
  const all = lists.data || [];
  const order = (l: BookingList) => (l.mine ? 0 : 1) * 10 + (l.part === 'fall' ? 0 : l.part === 'summer' ? 1 : 2);
  const sorted = [...all].sort((a, b) => b.year - a.year || order(a) - order(b));
  const list = all.find(l => l.id === pick) || sorted.find(l => l.total > 0) || sorted[0] || null;
  return { lists, sorted, list, setPick };
}

export const BookingsPage: React.FC = () => {
  const { center, can } = useAuth();
  const { lists, sorted, list, setPick } = useLists(center?.id);
  const [q, setQ] = useState(''); const [qq, setQq] = useState('');
  const [status, setStatus] = useState<StatusPick | null>(null);
  const [state, setState] = useState<MapState | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [soft, setSoft] = useState<string | null>(null);
  const alertSoft = (m: string) => { setSoft(m); setTimeout(() => setSoft(null), 5000); };
  useEffect(() => { const t = setTimeout(() => { setQq(q); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [status, state, list?.id]);
  const rows = useLoad(() => (list ? listBookings(list.id, { q: qq, status, state }, page, 100) : Promise.resolve({ total: 0, rows: [] as Booking[] })),
    [list?.id, qq, status, state, page]);
  const wait = useLoad(() => (list && list.waiting ? waiting(list.id) : Promise.resolve([])), [list?.id, list?.waiting]);
  const refresh = () => { rows.reload(); lists.reload(); wait.reload(); };

  if (!can('bookings')) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to Master Bookings.</div></div>;
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card v2-mut">Pick a center in the top bar to see its bookings.</div></div>;

  const again = () => list && (async () => {
    setBusy('Checking the maps again…'); setErr(null);
    try { const n = await placeAgain(list.id); setBusy(null); refresh(); alertSoft(n ? `${n} booking${n === 1 ? '' : 's'} moved onto built maps.` : 'No new maps for the waiting bookings yet.'); }
    catch (e) { setErr(e); setBusy(null); }
  })();

  return (
    <div className="v2-main">
      <div className="v2-head">
        <span className="v2-h1">Bookings</span>
        <span className="v2-spacer" />
        <Link className="v2-link" to="/app/bookings/plans">Plans ›</Link>
        <Link className="v2-link" to="/app/bookings/maps">Master maps ›</Link>
      </div>
      <ErrorBox error={lists.error || rows.error || err} />
      {lists.loading && !lists.data ? <Loading label="Finding the booking lists…" /> : !list ? (
        <div className="v2-card v2-mut">No booking lists for {center.display_name}’s region yet.</div>
      ) : (
        <>
          <div className="v2-row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <select className="v2-input" style={{ width: 'auto' }} value={list.id} onChange={e => setPick(e.target.value)} aria-label="Booking list">
              {sorted.map(l => <option key={l.id} value={l.id}>{l.name} {l.year}{l.total ? ` · ${l.total}` : ''}{l.mine ? '' : ' (another center)'}</option>)}
            </select>
            <span className="v2-mut v2-small">{PART_LABEL[list.part]} · {list.job_code ? `done as ${list.job_code}` : 'no default job code'}</span>
            <span className="v2-spacer" />
            {can('sa_territory') && <Link className="v2-btn o" to="/app/admin/territory/clients">Import a list</Link>}
            <Btn icon={Plus} onClick={() => setOpen('new')}>Add booking</Btn>
          </div>

          <div className="v2-mb-states">
            {(['open', 'tried', 'done', 'cancelled'] as StatusPick[]).map(s => (
              <button key={s} type="button" className={`v2-card v2-mb-state${status === s ? ' on' : ''}`} onClick={() => setStatus(status === s ? null : s)}>
                <i className="dot" style={{ background: bookingColor({ status: s === 'tried' ? 'open' : s, tried: s === 'tried' }) }} />
                <span>{STATUS_LABEL[s]}</span><b>{s === 'open' ? list.open - list.tried : s === 'tried' ? list.tried : list[s]}</b>
              </button>
            ))}
            <span className="v2-mb-sep" />
            {STATES.map(s => (
              <button key={s} type="button" className={`v2-card v2-mb-state${state === s ? ' on' : ''}`} onClick={() => setState(state === s ? null : s)} title={STATE_HINT[s]}>
                <Tag tone={STATE_TONE[s]}>{STATE_LABEL[s]}</Tag><b>{s === 'on_map' ? list.on_map + list.moved : list[s]}</b>
              </button>
            ))}
          </div>

          {list.waiting > 0 && (
            <details className="v2-card" style={{ margin: '10px 0' }}>
              <summary className="v2-row" style={{ gap: 8, cursor: 'pointer' }}>
                <MapPin size={15} color="#d97706" /><b>{list.waiting} bookings are waiting on a map</b>
                <span className="v2-mut v2-small">Build these maps first: they attach by themselves once approved</span>
              </summary>
              <div className="v2-row" style={{ gap: 8, margin: '10px 0' }}>
                <Btn size="sm" kind="o" icon={RefreshCw} onClick={again} disabled={!!busy}>{busy || 'Check the maps again'}</Btn>
                {soft && <span className="v2-small">{soft}</span>}
              </div>
              {wait.loading && !wait.data ? <Loading /> : (
                <div className="v2-mb-wait">
                  {(wait.data || []).map(g => (
                    <div key={g.prefix} className="v2-mb-waitrow">
                      <b>{g.prefix}</b><span className="v2-mut">{g.cities.join(', ') || cityForRoute(g.prefix)}</span><span className="v2-spacer" />
                      <span className="v2-small v2-mut">{g.routes.map(r => `${r.code}${r.n > 1 ? ` ×${r.n}` : ''}`).join(' · ')}</span>
                      <b className="n">{g.n}</b>
                    </div>
                  ))}
                </div>
              )}
            </details>
          )}

          <div className="v2-row" style={{ gap: 8, margin: '10px 0' }}>
            <div className="v2-search" style={{ flex: 1 }}><Search size={15} /><input className="v2-input" placeholder="Search address, name, route, phone, notes…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search bookings" /></div>
            <span className="v2-mut v2-small">{rows.data?.total ?? 0} shown</span>
          </div>

          <div className="v2-card" style={{ padding: 0 }}>
            <div className="v2-table-wrap">
              <table className="v2-table">
                <thead><tr><th>Address</th><th>Customer</th><th>Route</th><th>Map</th><th>Job</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody>
                  {rows.loading && !rows.data ? <tr><td colSpan={7}><Loading /></td></tr>
                    : (rows.data?.rows || []).length === 0 ? <tr><td colSpan={7} className="v2-mut">No bookings here{list.total ? ' with these filters' : ' yet'}.</td></tr>
                    : rows.data!.rows.map(b => {
                      const last = lastAttempt(b.attempts);
                      return (
                        <tr key={b.id} className="click" onClick={() => setOpen(b.id)}>
                          <td><b>{addressOf(b)}</b><div className="v2-mut v2-small">{b.city}</div></td>
                          <td>{nameOf(b) || <span className="v2-mut">—</span>}{b.plan && <div className="v2-small v2-mut">{PLAN_LABEL[b.plan.kind]}</div>}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{b.map_state === 'moved' ? <>{b.moved_from} → <b>{b.route_code}</b></> : <b>{b.route_code || b.sheet_route || '—'}</b>}<div className="v2-small v2-mut">{b.area_name}</div></td>
                          <td><Tag tone={STATE_TONE[mapped(b.map_state)]}>{STATE_LABEL[mapped(b.map_state)]}</Tag></td>
                          <td style={{ whiteSpace: 'nowrap' }}><b>{b.job_code || servicesCode(b.services)}</b>{b.prepaid && <div className="v2-small v2-mut">Prepaid</div>}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className="v2-row" style={{ gap: 6 }}><i className="dot" style={{ background: bookingColor(b) }} />{b.status === 'done' ? `Done ${shortDay(b.done_on)}` : b.status === 'cancelled' ? 'Cancelled' : last ? 'Tried' : 'Open'}</span>
                            {b.status === 'done' && b.done_by_name && <div className="v2-small v2-mut">{b.done_by_name}</div>}
                            {b.status !== 'done' && last && <div className="v2-small" style={{ color: '#c2410c' }}>{attemptLine(last)}</div>}
                          </td>
                          <td className="v2-small" style={{ maxWidth: 280 }}>{b.field_notes}{b.office_notes && <div className="v2-mut">Office: {b.office_notes}</div>}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          {(rows.data?.total || 0) > 100 && (
            <div className="v2-row" style={{ gap: 8, marginTop: 10, justifyContent: 'center' }}>
              <Btn size="sm" kind="o" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Btn>
              <span className="v2-small">{page * 100 + 1}–{Math.min((page + 1) * 100, rows.data!.total)} of {rows.data!.total}</span>
              <Btn size="sm" kind="o" disabled={(page + 1) * 100 >= rows.data!.total} onClick={() => setPage(p => p + 1)}>Next</Btn>
            </div>
          )}
        </>
      )}
      {open && list && <BookingModal id={open === 'new' ? null : open} list={list} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); refresh(); }} />}
    </div>
  );
};

// ───────────── one booking ─────────────
const SVC_KEYS: { k: keyof Booking['services']; c: string; label: string }[] = [
  { k: 'aeration', c: 'A', label: 'Aeration' }, { k: 'dethatch', c: 'D', label: 'Dethatch' }, { k: 'fertilizer', c: 'F', label: 'Fertilizer' },
  { k: 'seed', c: 'S', label: 'Seed' }, { k: 'lime', c: 'L', label: 'Lime' },
];

export const BookingModal: React.FC<{ id: string | null; list: Pick<BookingList, 'id' | 'name' | 'year' | 'job_code'>; onClose: () => void; onSaved: (b: Booking) => void; readOnly?: boolean }> =
  ({ id, list, onClose, onSaved, readOnly }) => {
    const got = useLoad(() => (id ? getBooking(id) : Promise.resolve(null)), [id]);
    const b = got.data;
    const [f, setF] = useState<BookingPatch & { first?: string; last?: string; phone?: string; email?: string }>({});
    useEffect(() => {
      if (id && !b) return;
      setF(b ? {
        house_no: b.house_no, street_name: b.street_name, unit: b.unit, city: b.city, route_code: b.route_code, job_code: b.job_code, services: b.services,
        prepaid: b.prepaid, field_notes: b.field_notes, office_notes: b.office_notes, status: b.status,
        first: b.people?.[0]?.first || '', last: b.people?.[0]?.last || '', phone: b.phones.join(', '), email: b.emails.join(', '),
      } : { job_code: list.job_code || 'AFSL', services: servicesFromCode(list.job_code || 'AFSL'), prepaid: true, status: 'open', province: 'BC' });
    }, [id, b, list.job_code]);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<unknown>(null);
    const set = (p: Partial<typeof f>) => setF(x => ({ ...x, ...p }));
    const addrChanged = !b || b.lat == null || f.house_no !== b.house_no || f.street_name !== b.street_name || (f.city || '') !== (b.city || '') || (f.unit || '') !== (b.unit || '');

    const save = async () => {
      setBusy(true); setErr(null);
      try {
        const p: BookingPatch = {
          house_no: (f.house_no || '').trim(), street_name: (f.street_name || '').trim(), unit: f.unit || null, city: f.city || null,
          job_code: (f.job_code || '').toUpperCase(), services: f.services || {}, prepaid: f.prepaid ?? true,
          field_notes: f.field_notes || null, office_notes: f.office_notes || null, status: f.status || 'open',
          people: (f.first || f.last) ? [{ first: (f.first || '').trim(), last: (f.last || '').trim() }] : [],
          phones: (f.phone || '').split(/[,;]/).map(x => x.trim()).filter(Boolean),
          emails: (f.email || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean),
        };
        if (!p.house_no || !p.street_name) throw new Error('A booking needs a house number and a street.');
        if (addrChanged) {
          const g = (await findPoint({ house_no: p.house_no, street: p.street_name, city: p.city || cityForRoute(f.route_code || b?.sheet_route || ''), route: f.route_code || b?.sheet_route || '' })).found;
          p.lat = g?.lat ?? null; p.lng = g?.lng ?? null;
        }
        if (f.route_code && (!b || f.route_code.toUpperCase() !== (b.route_code || '').toUpperCase())) p.route_code = f.route_code.toUpperCase();
        onSaved(await saveBooking(id, id ? null : list.id, p));
      } catch (e) { setErr(e); } finally { setBusy(false); }
    };
    const ro = !!readOnly;
    return (
      <Modal wide title={id ? (b ? addressOf(b) : 'Booking') : `New booking · ${list.name} ${list.year}`} onClose={onClose}
        footer={ro ? <Btn kind="o" onClick={onClose}>Close</Btn> : <><Btn kind="o" onClick={onClose} disabled={busy}>Cancel</Btn><Btn onClick={save} disabled={busy || (!!id && !b)} icon={Check}>{busy ? 'Saving…' : 'Save'}</Btn></>}>
        {id && got.loading && !b ? <Loading /> : (
          <div className="v2-mb-form">
            <ErrorBox error={err || got.error} />
            {b && (
              <div className="v2-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Tag tone={STATE_TONE[b.map_state]}>{STATE_LABEL[b.map_state]}</Tag>
                <span className="v2-small v2-mut">{b.map_state === 'moved' ? `The sheet said ${b.moved_from}; it sits on ${b.route_code} (${b.area_name}).` : STATE_HINT[b.map_state]}</span>
              </div>
            )}
            <div className="v2-grid2">
              <Field label="House #"><input className="v2-input" value={f.house_no || ''} onChange={e => set({ house_no: e.target.value })} disabled={ro} /></Field>
              <Field label="Street"><input className="v2-input" value={f.street_name || ''} onChange={e => set({ street_name: e.target.value })} disabled={ro} /></Field>
              <Field label="Unit"><input className="v2-input" value={f.unit || ''} onChange={e => set({ unit: e.target.value })} disabled={ro} /></Field>
              <Field label="City"><input className="v2-input" value={f.city || ''} onChange={e => set({ city: e.target.value })} disabled={ro} /></Field>
              <Field label="First name"><input className="v2-input" value={f.first || ''} onChange={e => set({ first: e.target.value })} disabled={ro} /></Field>
              <Field label="Last name"><input className="v2-input" value={f.last || ''} onChange={e => set({ last: e.target.value })} disabled={ro} /></Field>
              <Field label="Phone"><input className="v2-input" value={f.phone || ''} onChange={e => set({ phone: e.target.value })} disabled={ro} /></Field>
              <Field label="Email"><input className="v2-input" value={f.email || ''} onChange={e => set({ email: e.target.value })} disabled={ro} /></Field>
              <Field label="Route" hint="Leave it to the map; type a code only to put it on that route yourself.">
                <input className="v2-input" value={f.route_code || ''} onChange={e => set({ route_code: e.target.value.toUpperCase() })} disabled={ro} />
              </Field>
              <Field label="Job code" hint="What the crew is credited (AFSL is the $200 office flat).">
                <input className="v2-input" value={f.job_code || ''} onChange={e => set({ job_code: e.target.value.toUpperCase(), services: servicesFromCode(e.target.value) })} disabled={ro} />
              </Field>
            </div>
            <Field label="Services booked">
              <div className="v2-row" style={{ gap: 6 }}>
                {SVC_KEYS.map(s => (
                  <button key={s.k} type="button" className={`v2-chip${f.services?.[s.k] ? ' on' : ''}`} disabled={ro}
                    onClick={() => set({ services: { ...(f.services || {}), [s.k]: !f.services?.[s.k] } })} title={s.label}>{s.c} · {s.label}</button>
                ))}
                <label className="v2-row" style={{ gap: 6, marginLeft: 8 }}><input type="checkbox" checked={f.prepaid ?? true} onChange={e => set({ prepaid: e.target.checked })} disabled={ro} />Prepaid</label>
              </div>
            </Field>
            <div className="v2-grid2">
              <Field label="Field notes" hint="The crew sees these."><textarea className="v2-input" rows={3} value={f.field_notes || ''} onChange={e => set({ field_notes: e.target.value })} disabled={ro} /></Field>
              <Field label="Office notes" hint="Only the office sees these."><textarea className="v2-input" rows={3} value={f.office_notes || ''} onChange={e => set({ office_notes: e.target.value })} disabled={ro} /></Field>
            </div>
            <Field label="Status">
              <div className="v2-row" style={{ gap: 6 }}>
                {(['open', 'done', 'cancelled'] as BookingStatus[]).map(s => (
                  <button key={s} type="button" className={`v2-chip${f.status === s ? ' on' : ''}`} onClick={() => set({ status: s })} disabled={ro}>{STATUS_LABEL[s]}</button>
                ))}
              </div>
            </Field>
            {b && (
              <div className="v2-grid2">
                <div className="v2-card" style={{ padding: 10 }}>
                  <div className="v2-card-h">How it’s going</div>
                  {b.status === 'done' && <div className="v2-small"><b>Done {shortDay(b.done_on)}</b>{b.done_by_name ? ` by ${b.done_by_name}` : ''}{b.done_services ? ` · ${servicesCode(b.done_services)}` : ''}</div>}
                  {b.attempts.length === 0 ? <div className="v2-mut v2-small">No tries yet.</div>
                    : [...b.attempts].reverse().map((a, i) => <div key={i} className="v2-small" style={{ color: '#c2410c' }}>{attemptLine(a)}</div>)}
                  {(b.this_year || []).map((v, i) => <div key={`y${i}`} className="v2-small">{v.done ? '✓' : '–'} {v.label}{v.detail ? ` · ${v.detail}` : ''}</div>)}
                </div>
                <div className="v2-card" style={{ padding: 10 }}>
                  <div className="v2-card-h">Customer</div>
                  {b.plan && <div className="v2-small"><b>{PLAN_LABEL[b.plan.kind]}</b> {b.plan.year}{b.plan.price != null ? ` · $${Number(b.plan.price).toFixed(2)}` : ''}{b.plan.prepaid ? ' · prepaid' : ''}</div>}
                  {(b.history || []).length === 0 ? <div className="v2-mut v2-small">No past jobs on file.</div>
                    : [...(b.history || [])].sort((x, y) => String(y.year || '').localeCompare(String(x.year || ''))).slice(0, 6)
                      .map((h, i) => <div key={i} className="v2-small v2-mut">{[h.year, h.line, h.service, h.price && `$${String(h.price).replace(/[^0-9.]/g, '')}`, h.contractor].filter(Boolean).join(' · ')}</div>)}
                  <div className="v2-small v2-mut" style={{ marginTop: 6 }}>{[b.booked_by && `Booked by ${b.booked_by}`, b.booked_at, (b.source as { row?: number } | null)?.row ? `sheet row ${(b.source as { row?: number }).row}` : null].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    );
  };

// ───────────── plans ─────────────
export const PlansPage: React.FC = () => {
  const { center, can } = useAuth();
  const [kind, setKind] = useState<PlanKind | ''>('');
  const plans = useLoad(() => (center ? listPlans(center.id, kind || null) : Promise.resolve([])), [center?.id, kind]);
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (plans.data || []).filter(p => !t || `${p.client?.address || ''} ${p.client?.city || ''} ${p.client?.name || ''}`.toLowerCase().includes(t));
  }, [plans.data, q]);
  if (!can('bookings')) return <div className="v2-main v2-narrow"><div className="v2-err">You don’t have access to Master Bookings.</div></div>;
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card v2-mut">Pick a center in the top bar.</div></div>;
  const kinds = [...new Set((plans.data || []).map(p => p.kind))];
  return (
    <div className="v2-main">
      <div className="v2-head"><span className="v2-h1">Plans</span><span className="v2-spacer" /><Link className="v2-link" to="/app/bookings/list">Bookings ›</Link></div>
      <ErrorBox error={plans.error} />
      <div className="v2-row" style={{ gap: 8, marginBottom: 10 }}>
        <select className="v2-input" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value as PlanKind | '')} aria-label="Plan">
          <option value="">Every plan</option>
          {(Object.keys(PLAN_LABEL) as PlanKind[]).filter(k => !kind || k === kind || kinds.includes(k)).map(k => <option key={k} value={k}>{PLAN_LABEL[k]}</option>)}
        </select>
        <div className="v2-search" style={{ flex: 1 }}><Search size={15} /><input className="v2-input" placeholder="Search address or name…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search plans" /></div>
        <span className="v2-mut v2-small">{shown.length} plan{shown.length === 1 ? '' : 's'}</span>
      </div>
      <div className="v2-card" style={{ padding: 0 }}>
        <div className="v2-table-wrap">
          <table className="v2-table">
            <thead><tr><th>Customer</th><th>Plan</th><th>Price</th><th>Bookings</th></tr></thead>
            <tbody>
              {plans.loading && !plans.data ? <tr><td colSpan={4}><Loading /></td></tr>
                : shown.length === 0 ? <tr><td colSpan={4} className="v2-mut">No plans yet.</td></tr>
                : shown.map(p => (
                  <tr key={p.id}>
                    <td><b>{p.client?.address || '—'}</b><div className="v2-small v2-mut">{[p.client?.name, p.client?.city].filter(Boolean).join(' · ')}</div></td>
                    <td><b>{PLAN_LABEL[p.kind]}</b> {p.year}{p.prepaid && <div className="v2-small v2-mut">Prepaid</div>}</td>
                    <td>{p.price != null ? `$${Number(p.price).toFixed(2)}` : '—'}</td>
                    <td>
                      <div className="v2-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {p.bookings.length === 0 ? <span className="v2-mut v2-small">None yet</span> : p.bookings.map(x => (
                          <span key={x.id} className="v2-mb-chip" style={{ borderColor: bookingColor({ status: x.status, tried: x.tried > 0 }), color: '#111827' }}>
                            <i className="dot" style={{ background: bookingColor({ status: x.status, tried: x.tried > 0 }) }} />
                            {x.list} · {x.job_code} · {x.status === 'done' ? `done ${shortDay(x.done_on)}` : x.status === 'cancelled' ? 'cancelled' : x.tried ? `tried ${x.tried}×` : 'open'}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

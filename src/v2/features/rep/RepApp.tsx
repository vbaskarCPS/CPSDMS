// src/v2/features/rep/RepApp.tsx — the MainstreetAI rep app (/app/rep). A rep only ever lands here:
// their zones, each zone's map and walking list, a business card to log a visit, their follow-ups and
// their numbers. MainstreetAI only, no Property Stars. Managing reps is in the management portal.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ArrowLeft, BarChart3, Clock, ExternalLink, Globe, List, LogOut, Map as MapIcon, MapPin, Navigation, Phone } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  hereNow, isOpen, kindLabel, logVisit, OUTCOMES, outcomeOf, PIN, pinOf, repBusiness, repFollowups, repHome, repNumbers, repZone, visitProblem, walkOrder, whenLabel,
  type FollowUp, type Outcome, type PinState, type RepBusiness, type RepZoneView,
} from '../../lib/rep';
import { RM_STYLE, tidyRmBaseMap } from '../../../lib/rmMapStyle';
import { BLANK_STYLE, EMPTY, removeMap } from '../bookings/mbMap';
import { Btn, ErrorBox, Field, Loading } from '../../ui';
import './rep.css';

// ───────────── the gate and the frame ─────────────
export const RepApp: React.FC = () => {
  const { loading, session, profile, can } = useAuth();
  if (loading) return <div className="v2"><Loading /></div>;
  if (!session || !profile) return <Navigate to="/app/login?as=mainstreet" replace />;
  if (!can('mainstreet_rep')) return <Navigate to="/app" replace />;
  return (
    <Routes>
      <Route index element={<Frame><Home /></Frame>} />
      <Route path="zone/:zone/:campaign" element={<Frame full><ZoneScreen /></Frame>} />
      <Route path="followups" element={<Frame><Followups /></Frame>} />
      <Route path="numbers" element={<Frame><Numbers /></Frame>} />
      <Route path="*" element={<Navigate to="/app/rep" replace />} />
    </Routes>
  );
};

const Frame: React.FC<{ full?: boolean; children: React.ReactNode }> = ({ full, children }) => {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const due = useLoad(() => repFollowups().then(f => f.filter(x => x.when !== 'later').length).catch(() => 0), []);
  return (
    <div className="v2"><div className="v2-rep">
      <div className="v2-rep-top">
        <span className="brand">MainstreetAI</span>
        <span className="who">{profile?.full_name}</span>
        <button type="button" aria-label="Sign out" onClick={async () => { await signOut(); nav('/app/login?as=mainstreet', { replace: true }); }}><LogOut size={16} /></button>
      </div>
      <div className={`v2-rep-body${full ? ' full' : ''}`}>{children}</div>
      <nav className="v2-rep-nav">
        <NavLink to="/app/rep" end className={({ isActive }) => (isActive ? 'on' : '')}><MapIcon size={20} />My zones</NavLink>
        <NavLink to="/app/rep/followups" className={({ isActive }) => (isActive ? 'on' : '')}><Clock size={20} />Follow-ups{!!due.data && <span className="badge">{due.data}</span>}</NavLink>
        <NavLink to="/app/rep/numbers" className={({ isActive }) => (isActive ? 'on' : '')}><BarChart3 size={20} />My numbers</NavLink>
      </nav>
    </div></div>
  );
};

// ───────────── my zones ─────────────
const Home: React.FC = () => {
  const h = useLoad(() => repHome(), []);
  if (h.loading && !h.data) return <Loading label="Finding your zones…" />;
  return (
    <>
      <ErrorBox error={h.error} />
      {h.data && <h1>Hi {h.data.first_name}</h1>}
      {h.data && h.data.zones.length === 0 && (
        <div className="v2-rep-zone"><b>No zones yet.</b><div className="v2-mut v2-small">Your admin assigns your zones. They’ll show here.</div></div>)}
      {h.data?.zones.map(z => {
        const pct = z.total ? Math.round((100 * z.visited) / z.total) : 0;
        return (
          <Link key={`${z.zone_id}-${z.campaign_id}`} to={`/app/rep/zone/${z.zone_id}/${z.campaign_id}`} className="v2-rep-zone">
            <div className="row"><span className="name">{z.zone_name}</span><span style={{ marginLeft: 'auto' }} className="v2-rep-chip"><i style={{ background: z.color }} />{z.campaign_name}</span></div>
            <div className="v2-rep-bar"><b style={{ width: `${pct}%` }} /></div>
            <div className="v2-rep-nums">
              <span><b>{z.left}</b> to visit</span><span><b>{z.visited}</b> of {z.total} visited</span>
              {z.followups_due > 0 && <span style={{ color: '#b45309' }}><b style={{ color: '#b45309' }}>{z.followups_due}</b> follow-up{z.followups_due === 1 ? '' : 's'} due</span>}
              {(z.deals_pending > 0 || z.deals_approved > 0) && <span><b>{z.deals_approved}</b> deal{z.deals_approved === 1 ? '' : 's'}{z.deals_pending ? ` · ${z.deals_pending} waiting` : ''}</span>}
            </div>
          </Link>);
      })}
    </>
  );
};

// ───────────── a zone: map or list, and the business card ─────────────
type Show = 'open' | 'all';
const ZoneScreen: React.FC = () => {
  const { zone = '', campaign = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const [tick, setTick] = useState(0);
  const z = useLoad(() => repZone(zone, campaign), [zone, campaign, tick]);
  const view = (sp.get('view') === 'list' ? 'list' : 'map') as 'map' | 'list';
  const [show, setShow] = useState<Show>('open');
  const openId = sp.get('b');
  const setOpen = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('b', id); else n.delete('b'); setSp(n, { replace: !id }); };
  const setView = (v: 'map' | 'list') => { const n = new URLSearchParams(sp); n.set('view', v); setSp(n, { replace: true }); };
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const shown = useMemo(() => (z.data?.businesses || []).filter(b => show === 'all' || isOpen(b.state)), [z.data, show]);
  const left = (z.data?.businesses || []).filter(b => isOpen(b.state)).length;

  return (
    <>
      <div className="v2-rep-bar2">
        <Link to="/app/rep" aria-label="Back to my zones"><ArrowLeft size={20} /></Link>
        <div style={{ minWidth: 0 }}>
          <div className="t">{z.data?.zone.name || 'Zone'}</div>
          {z.data && <div className="v2-small v2-mut">{z.data.campaign.name} · {left} to visit</div>}
        </div>
        <span style={{ flex: 1 }} />
        <div className="v2-rep-seg">
          <button type="button" className={view === 'map' ? 'on' : ''} onClick={() => setView('map')} aria-label="Map"><MapIcon size={15} /></button>
          <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List"><List size={15} /></button>
        </div>
      </div>
      <div className="v2-rep-bar2" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <div className="v2-rep-seg">
          <button type="button" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>To visit</button>
          <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button>
        </div>
      </div>
      <ErrorBox error={z.error} />
      {z.loading && !z.data ? <Loading label="Loading the zone…" /> : z.data && (view === 'map'
        ? <ZoneMap data={z.data} items={shown} onPick={setOpen} />
        : <ZoneList items={shown} onPick={setOpen} />)}
      {openId && <BusinessSheet id={openId} campaign={campaign} onClose={() => setOpen(null)}
        onSaved={(msg) => { setTick(t => t + 1); setToast(msg); setOpen(null); }} />}
      {toast && <div className="v2-rep-toast" role="status">{toast}</div>}
    </>
  );
};

const STATE_COLOR: unknown[] = ['match', ['get', 'state'], ...Object.entries(PIN).flatMap(([k, v]) => [k, v.color]), '#ffffff'];

const ZoneMap: React.FC<{ data: RepZoneView; items: RepBusiness[]; onPick: (id: string) => void }> = ({ data, items, onPick }) => {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const pick = useRef(onPick); pick.current = onPick;

  useEffect(() => {
    if (!box.current || map.current) return;
    const token = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_MAPBOX_TOKEN || '';
    try {
      if (token) mapboxgl.accessToken = token;
      const m = new mapboxgl.Map({ container: box.current, style: token && token !== 'pk.test' ? RM_STYLE : BLANK_STYLE,
        center: data.zone.center, zoom: 14, attributionControl: false });
      m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      m.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showUserHeading: true }), 'top-right');
      m.on('load', () => {
        tidyRmBaseMap(m);
        m.addSource('rep-zone', { type: 'geojson', data: EMPTY });
        m.addSource('rep-pins', { type: 'geojson', data: EMPTY });
        m.addLayer({ id: 'rep-zone-fill', type: 'fill', source: 'rep-zone', paint: { 'fill-color': '#0f766e', 'fill-opacity': 0.06 } });
        m.addLayer({ id: 'rep-zone-line', type: 'line', source: 'rep-zone', paint: { 'line-color': '#0f766e', 'line-width': 3 } });
        m.addLayer({ id: 'rep-pins', type: 'circle', source: 'rep-pins', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 9], 'circle-color': STATE_COLOR as never,
          'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } });
        m.addLayer({ id: 'rep-names', type: 'symbol', source: 'rep-pins', minzoom: 16, layout: {
          'text-field': ['get', 'name'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
          paint: { 'text-color': '#111827', 'text-halo-color': '#fff', 'text-halo-width': 1.6 } });
        m.on('click', 'rep-pins', e => { const id = e.features?.[0]?.properties?.id; if (id) pick.current(String(id)); });
        m.on('mouseenter', 'rep-pins', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'rep-pins', () => { m.getCanvas().style.cursor = ''; });
        setReady(true);
      });
      m.on('error', e => { if (!m.loaded()) setFailed(String((e as { error?: Error }).error?.message || 'The map didn’t load')); });
      const ro = new ResizeObserver(() => m.resize()); ro.observe(box.current);
      map.current = m;
      return () => { ro.disconnect(); removeMap(m); map.current = null; };
    } catch (e) { setFailed(e instanceof Error ? e.message : 'The map didn’t load'); }
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // the zone outline once, fitted
  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    (m.getSource('rep-zone') as mapboxgl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: data.zone.polygon });
    const pts = (data.zone.polygon.type === 'Polygon' ? [data.zone.polygon.coordinates] : data.zone.polygon.coordinates).flat(2) as [number, number][];
    if (pts.length) {
      const b = pts.reduce((bb, p) => bb.extend(p), new mapboxgl.LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: 30, duration: 0 });
    }
  }, [ready, data.zone.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current; if (!ready || !m) return;
    (m.getSource('rep-pins') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: items.map(b => ({
      type: 'Feature', properties: { id: b.id, name: b.name, state: b.state }, geometry: { type: 'Point', coordinates: [b.lng, b.lat] } })) });
  }, [ready, items]);

  const counts = useMemo(() => { const c: Partial<Record<PinState, number>> = {}; for (const b of items) c[b.state] = (c[b.state] || 0) + 1; return c; }, [items]);
  return (
    <div className="v2-rep-map">
      <div ref={box} className="box" />
      {failed && <div className="v2-err" style={{ position: 'absolute', top: 8, left: 8, right: 8, zIndex: 3 }}>{failed}</div>}
      <div className="v2-rep-legend">
        {(Object.keys(PIN) as PinState[]).filter(k => counts[k]).map(k => <span key={k}><i className="v2-rep-dot" style={{ background: PIN[k].color }} />{PIN[k].label} {counts[k]}</span>)}
        {!items.length && <span>Nothing left to visit here.</span>}
      </div>
    </div>
  );
};

const ZoneList: React.FC<{ items: RepBusiness[]; onPick: (id: string) => void }> = ({ items, onPick }) => (
  <div className="v2-rep-list">
    {!items.length && <div className="v2-mut" style={{ padding: 16 }}>Nothing left to visit here. Switch to All to see everything.</div>}
    {walkOrder(items).map(g => (
      <div key={g.group}>
        <div className="v2-rep-group">{g.group} · {g.items.length}</div>
        {g.items.map(b => (
          <button key={b.id} type="button" className="v2-rep-item" onClick={() => onPick(b.id)}>
            <i className="v2-rep-dot" style={{ background: pinOf(b.state).color, width: 14, height: 14 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="n">{b.name}</div>
              <div className="a">{b.address || kindLabel(b.kind)}</div>
            </div>
            <div className="v2-small v2-mut" style={{ textAlign: 'right' }}>
              {b.state === 'follow_up' && b.follow_up_at ? whenLabel(b.follow_up_at) : b.state !== 'new' ? pinOf(b.state).label : ''}
            </div>
          </button>))}
      </div>))}
  </div>
);

const BusinessSheet: React.FC<{ id: string; campaign: string; onClose: () => void; onSaved: (msg: string) => void }> = ({ id, campaign, onClose, onSaved }) => {
  const b = useLoad(() => repBusiness(id, campaign), [id, campaign]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [cName, setCName] = useState(''); const [cPhone, setCPhone] = useState(''); const [cEmail, setCEmail] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = useCallback(async () => {
    if (!outcome) return;
    const input = { outcome, notes, contact_name: cName, contact_phone: cPhone, contact_email: cEmail,
      follow_up_at: when ? new Date(when).toISOString() : null };
    const problem = visitProblem(input);
    if (problem) { setError(new Error(problem)); return; }
    setBusy(true); setError(null);
    try {
      const here = await hereNow();
      const r = await logVisit(id, campaign, { ...input, lat: here?.lat, lng: here?.lng, accuracy: here?.accuracy });
      const o = outcomeOf(outcome)!;
      onSaved(outcome === 'closed' ? 'Deal saved: it’s with an admin to approve.'
        : r.far ? `${o.label} saved. ${here ? `You were ${r.distance_m} m away, so an admin will see it.` : 'Your location wasn’t available, so an admin will see it.'}`
        : `${o.label} saved.`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }, [outcome, notes, cName, cPhone, cEmail, when, id, campaign, onSaved]);

  const d = b.data;
  const dirs = d ? `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}` : '';
  return (
    <div className="v2-rep-sheet-bg" onClick={onClose}>
      <div className="v2-rep-sheet" role="dialog" aria-label={d?.name || 'Business'} onClick={e => e.stopPropagation()}>
        <ErrorBox error={b.error} />
        {!d ? <Loading /> : (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h2>{d.name}</h2>
                <div className="v2-small v2-mut">{kindLabel(d.kind)}{d.plaza ? ` · ${d.plaza}` : ''}</div>
                {d.address && <div className="v2-small">{d.address}</div>}
              </div>
              <button type="button" className="v2-x" aria-label="Close" onClick={onClose} style={{ border: 0, background: 'none', fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div className="v2-rep-acts">
              <a href={dirs} target="_blank" rel="noreferrer"><Navigation size={15} />Directions</a>
              {d.phone && <a href={`tel:${d.phone.replace(/[^0-9+]/g, '')}`}><Phone size={15} />{d.phone}</a>}
              {d.website && <a href={/^https?:/i.test(d.website) ? d.website : `https://${d.website}`} target="_blank" rel="noreferrer"><Globe size={15} />Website<ExternalLink size={12} /></a>}
            </div>

            <div style={{ fontWeight: 800, marginTop: 4 }}>What happened?</div>
            <div className="v2-rep-outs">
              {OUTCOMES.map(o => (
                <button key={o.key} type="button" className={`v2-rep-out${outcome === o.key ? ' on' : ''}`} onClick={() => { setOutcome(o.key); setError(null); }} aria-pressed={outcome === o.key}>
                  <b><i className="v2-rep-dot" style={{ background: o.color }} />{o.label}</b><span>{o.hint}</span>
                </button>))}
            </div>
            {outcome === 'follow_up' && (
              <>
                <Field label="Follow up on"><input className="v2-input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>
                <Field label="Who to ask for"><input className="v2-input" value={cName} onChange={e => setCName(e.target.value)} autoComplete="off" /></Field>
              </>)}
            {(outcome === 'follow_up' || outcome === 'interested' || outcome === 'closed') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {outcome !== 'follow_up' && <div style={{ gridColumn: '1 / -1' }}><Field label="Decision-maker"><input className="v2-input" value={cName} onChange={e => setCName(e.target.value)} autoComplete="off" /></Field></div>}
                <Field label="Phone"><input className="v2-input" type="tel" value={cPhone} onChange={e => setCPhone(e.target.value)} autoComplete="off" /></Field>
                <Field label="Email"><input className="v2-input" type="email" value={cEmail} onChange={e => setCEmail(e.target.value)} autoComplete="off" /></Field>
              </div>)}
            {outcome && (
              <Field label={outcome === 'cant_sell' ? 'Why can’t you sell here?' : 'Notes'}>
                <textarea className="v2-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </Field>)}
            <ErrorBox error={error} />
            {outcome && <Btn onClick={save} disabled={busy} style={{ width: '100%', justifyContent: 'center', background: '#0f766e', borderColor: '#0f766e' }}>
              {busy ? 'Saving…' : outcome === 'closed' ? 'Save deal for approval' : 'Save visit'}</Btn>}

            <div style={{ fontWeight: 800, margin: '16px 0 2px' }}>Your visits</div>
            {!d.visits.length && <div className="v2-small v2-mut">None yet.</div>}
            {d.visits.map(v => {
              const o = outcomeOf(v.outcome);
              return (
                <div key={v.id} className="v2-rep-visit">
                  <div className="h"><i className="v2-rep-dot" style={{ background: o?.color }} /><b>{o?.label}</b><span className="v2-mut v2-small">{whenLabel(v.at)}</span>
                    {v.far && <span className="v2-small" style={{ color: '#b45309', marginLeft: 'auto' }}><MapPin size={12} /> {v.distance_m != null ? `${v.distance_m} m away` : 'no location'}</span>}</div>
                  {v.deal && <div className="v2-small" style={{ color: v.deal === 'approved' ? '#15803d' : v.deal === 'rejected' ? '#7e22ce' : '#6b7280' }}>
                    Deal {v.deal === 'pending' ? 'waiting for approval' : v.deal === 'approved' ? 'approved' : 'not approved'}{v.deal_note ? `: ${v.deal_note}` : ''}</div>}
                  {v.follow_up_at && <div className="v2-small">Follow up {whenLabel(v.follow_up_at)}</div>}
                  {(v.contact_name || v.contact_phone || v.contact_email) && <div className="v2-small">{[v.contact_name, v.contact_phone, v.contact_email].filter(Boolean).join(' · ')}</div>}
                  {v.notes && <div className="v2-small v2-mut">{v.notes}</div>}
                  {v.resolution && <div className="v2-small v2-mut">{v.resolution === 'removed' ? 'An admin took it off the list.' : 'An admin put it back on your list.'}</div>}
                </div>);
            })}
          </>)}
      </div>
    </div>
  );
};

// ───────────── follow-ups ─────────────
const Followups: React.FC = () => {
  const f = useLoad(() => repFollowups(), []);
  const groups: { key: FollowUp['when']; label: string }[] = [{ key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Today' }, { key: 'later', label: 'Coming up' }];
  return (
    <>
      <h1>Follow-ups</h1>
      <ErrorBox error={f.error} />
      {f.loading && !f.data ? <Loading /> : !f.data?.length ? <div className="v2-rep-zone v2-mut">No follow-ups. When a business asks you to come back, log a Follow-up and it shows here.</div> : null}
      {groups.map(g => {
        const list = (f.data || []).filter(x => x.when === g.key);
        if (!list.length) return null;
        return (
          <div key={g.key}>
            <div className="v2-rep-group" style={g.key === 'overdue' ? { color: '#b91c1c' } : undefined}>{g.label} · {list.length}</div>
            {list.map(x => (
              <Link key={`${x.business_id}-${x.campaign_id}`} className="v2-rep-item" to={`/app/rep/zone/${x.zone_id}/${x.campaign_id}?view=list&b=${x.business_id}`}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="n">{x.name}</div>
                  <div className="a">{[x.contact_name && `Ask for ${x.contact_name}`, x.contact_phone, x.zone_name].filter(Boolean).join(' · ')}</div>
                  {x.notes && <div className="a">{x.notes}</div>}
                </div>
                <div className="v2-small" style={{ fontWeight: 700, textAlign: 'right' }}>{whenLabel(x.follow_up_at)}</div>
              </Link>))}
          </div>);
      })}
    </>
  );
};

// ───────────── my numbers ─────────────
const Numbers: React.FC = () => {
  const n = useLoad(() => repNumbers(), []);
  const max = Math.max(1, ...(n.data?.days || []).map(d => d.visits));
  return (
    <>
      <h1>My numbers</h1>
      <ErrorBox error={n.error} />
      {n.loading && !n.data ? <Loading /> : n.data && (
        <>
          <div className="v2-rep-stat">
            <div><b>{n.data.deals.approved}</b><span>Deals approved</span></div>
            <div><b>{n.data.deals.pending}</b><span>Waiting for approval</span></div>
            <div><b>{n.data.visits_total}</b><span>Visits logged</span></div>
          </div>
          <div className="v2-rep-zone">
            <b>Visits, last 14 days</b>
            <div className="v2-rep-days">
              {n.data.days.map(d => (
                <div key={d.day} title={`${d.day}: ${d.visits} visits, ${d.deals} deals`}>
                  <span>{d.visits || ''}</span><i style={{ height: `${(100 * d.visits) / max}%` }} /><span>{new Date(`${d.day}T12:00:00`).getDate()}</span>
                </div>))}
            </div>
          </div>
          <div className="v2-rep-zone">
            <b>Recent deals</b>
            {!n.data.recent_deals.length && <div className="v2-small v2-mut" style={{ marginTop: 6 }}>No deals yet.</div>}
            {n.data.recent_deals.map(d => (
              <div key={d.id} className="v2-rep-visit">
                <div className="h"><b style={{ flex: 1 }}>{d.business}</b>
                  <span className="v2-small" style={{ fontWeight: 700, color: d.status === 'approved' ? '#15803d' : d.status === 'rejected' ? '#7e22ce' : '#6b7280' }}>
                    {d.status === 'approved' ? 'Approved' : d.status === 'rejected' ? 'Not approved' : 'Waiting'}</span></div>
                <div className="v2-small v2-mut">{d.campaign} · {whenLabel(d.at)}{d.note ? ` · ${d.note}` : ''}</div>
              </div>))}
            {n.data.deals.rejected > 0 && <div className="v2-small v2-mut" style={{ marginTop: 6 }}>{n.data.deals.rejected} not approved in all.</div>}
          </div>
          <div className="v2-small v2-mut">Pay per deal shows here once it’s set for your campaign.</div>
        </>)}
    </>
  );
};

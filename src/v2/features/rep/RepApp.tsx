// src/v2/features/rep/RepApp.tsx — the MainstreetAI rep app (/app/rep). A rep only ever lands here:
// a map of all their zones (the home screen), the zone list, follow-ups, and "Me" (today, goals, the
// week's board, earnings, numbers). MainstreetAI only, no Property Stars. Managing reps is in the
// management portal.
import React, { useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bell, CalendarPlus, Clock, Flame, LayoutList, List, LogOut, Map as MapIcon, Trophy, User } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useLoad } from '../../lib/data';
import {
  hoursLabel, isOpen, kindLabel, money, pinOf, repBoard, repFollowups, repHome, repNumbers, repZone, walkOrder, whenLabel,
  type FollowUp, type RepBusiness,
} from '../../lib/rep';
import { followUpIcs, openAt } from '../../lib/repField';
import { drop } from '../../lib/repQueue';
import { ErrorBox, Loading } from '../../ui';
import { BusinessSheet } from './BusinessSheet';
import { HomeMap } from './HomeMap';
import { RepMapView } from './RepMapView';
import { download, RepProvider, useRep } from './repContext';
import './rep.css';

// ───────────── the gate and the frame ─────────────
export const RepApp: React.FC = () => {
  const { loading, session, profile, can } = useAuth();
  if (loading) return <div className="v2"><Loading /></div>;
  if (!session || !profile) return <Navigate to="/app/login?as=mainstreet" replace />;
  if (!can('mainstreet_rep')) return <Navigate to="/app" replace />;
  return (
    <RepProvider>
      <Routes>
        <Route index element={<Frame full><HomeMap /></Frame>} />
        <Route path="zones" element={<Frame><Zones /></Frame>} />
        <Route path="zone/:zone/:campaign" element={<Frame full><ZoneScreen /></Frame>} />
        <Route path="followups" element={<Frame><Followups /></Frame>} />
        <Route path="me" element={<Frame><Me /></Frame>} />
        <Route path="numbers" element={<Navigate to="/app/rep/me" replace />} />
        <Route path="*" element={<Navigate to="/app/rep" replace />} />
      </Routes>
    </RepProvider>
  );
};

const Frame: React.FC<{ full?: boolean; children: React.ReactNode }> = ({ full, children }) => {
  const { profile, signOut } = useAuth();
  const { queue } = useRep();
  const nav = useNavigate();
  const due = useLoad(() => repFollowups().then(f => f.filter(x => x.when !== 'later').length).catch(() => 0), []);
  const stuck = queue.filter(q => q.error).length;
  const tab = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');
  return (
    <div className="v2"><div className="v2-rep">
      <div className="v2-rep-top">
        <span className="brand">MainstreetAI</span>
        <span className="who">{profile?.full_name}</span>
        <button type="button" aria-label="Sign out" onClick={async () => { await signOut(); nav('/app/login?as=mainstreet', { replace: true }); }}><LogOut size={16} /></button>
      </div>
      <div className={`v2-rep-body${full ? ' full' : ''}`}>{children}</div>
      <nav className="v2-rep-nav">
        <NavLink to="/app/rep" end className={tab}><MapIcon size={20} />Map</NavLink>
        <NavLink to="/app/rep/zones" className={tab}><LayoutList size={20} />Zones</NavLink>
        <NavLink to="/app/rep/followups" className={tab}><Clock size={20} />Follow-ups{!!due.data && <span className="badge">{due.data}</span>}</NavLink>
        <NavLink to="/app/rep/me" className={tab}><User size={20} />Me{stuck > 0 && <span className="badge">{stuck}</span>}</NavLink>
      </nav>
    </div></div>
  );
};

// ───────────── my zones (the cards) ─────────────
const Zones: React.FC = () => {
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
              {!!z.leads && <span><b>{z.leads}</b> added by you</span>}
            </div>
          </Link>);
      })}
    </>
  );
};

// ───────────── one zone: map or list ─────────────
const ZoneScreen: React.FC = () => {
  const { zone = '', campaign = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const [tick, setTick] = useState(0);
  const z = useLoad(() => repZone(zone, campaign), [zone, campaign, tick]);
  const view = (sp.get('view') === 'list' ? 'list' : 'map') as 'map' | 'list';
  const [show, setShow] = useState<'open' | 'all'>('open');
  const openId = sp.get('b');
  const setOpen = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('b', id); else n.delete('b'); setSp(n, { replace: !id }); };
  const setView = (v: 'map' | 'list') => { const n = new URLSearchParams(sp); n.set('view', v); setSp(n, { replace: true }); };

  const shown = useMemo(() => (z.data?.businesses || []).filter(b => show === 'all' || isOpen(b.state)), [z.data, show]);
  const left = (z.data?.businesses || []).filter(b => isOpen(b.state)).length;
  const pins = useMemo(() => shown.map(b => ({ id: b.id, name: b.name, state: b.state, lat: b.lat, lng: b.lng, lead: b.lead, dim: openAt(b.hours) === false })), [shown]);
  const fb = z.data?.businesses.find(b => b.id === openId);

  return (
    <>
      <div className="v2-rep-bar2">
        <Link to="/app/rep/zones" aria-label="Back to my zones"><ArrowLeft size={20} /></Link>
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
        ? <RepMapView zones={[{ id: z.data.zone.id, name: '', color: z.data.campaign.color || '#0f766e', polygon: z.data.zone.polygon }]} pins={pins} onPick={setOpen} fitKey={z.data.zone.id} />
        : <ZoneList items={shown} onPick={setOpen} />)}
      {openId && <BusinessSheet key={openId} id={openId} campaign={campaign}
        fallback={fb ? { id: fb.id, name: fb.name, address: fb.address, kind: fb.kind, lat: fb.lat, lng: fb.lng, hours: fb.hours, lead: fb.lead } : null}
        onClose={() => setOpen(null)} onSaved={() => { setTick(t => t + 1); setOpen(null); }} />}
    </>
  );
};

const ZoneList: React.FC<{ items: RepBusiness[]; onPick: (id: string) => void }> = ({ items, onPick }) => (
  <div className="v2-rep-list">
    {!items.length && <div className="v2-mut" style={{ padding: 16 }}>Nothing left to visit here. Switch to All to see everything.</div>}
    {walkOrder(items).map(g => (
      <div key={g.group}>
        <div className="v2-rep-group">{g.group} · {g.items.length}</div>
        {g.items.map(b => {
          const shut = openAt(b.hours) === false;
          return (
            <button key={b.id} type="button" className="v2-rep-item" onClick={() => onPick(b.id)} style={shut ? { opacity: 0.6 } : undefined}>
              <i className="v2-rep-dot" style={{ background: pinOf(b.state).color, width: 14, height: 14 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="n">{b.name}</div>
                <div className="a">{b.address || kindLabel(b.kind)}{shut ? ' · closed now' : ''}</div>
              </div>
              <div className="v2-small v2-mut" style={{ textAlign: 'right' }}>
                {b.state === 'follow_up' && b.follow_up_at ? whenLabel(b.follow_up_at) : b.state !== 'new' ? pinOf(b.state).label : ''}
              </div>
            </button>);
        })}
      </div>))}
  </div>
);

// ───────────── follow-ups ─────────────
const Followups: React.FC = () => {
  const f = useLoad(() => repFollowups(), []);
  const [perm, setPerm] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const groups: { key: FollowUp['when']; label: string }[] = [{ key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Today' }, { key: 'later', label: 'Coming up' }];
  const ics = (x: FollowUp) => download(`follow-up-${x.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`,
    followUpIcs({ uid: `${x.business_id}-${x.follow_up_at}`, title: `Follow up: ${x.name}`, at: x.follow_up_at, where: x.address,
      notes: [x.contact_name && `Ask for ${x.contact_name}`, x.contact_phone, x.notes].filter(Boolean).join('\n') }));
  return (
    <>
      <h1>Follow-ups</h1>
      {perm === 'default' && (
        <button type="button" className="v2-rep-zone v2-rep-ask" onClick={async () => { try { setPerm(await Notification.requestPermission()); } catch { /* no */ } }}>
          <Bell size={18} /><div><b>Remind me on this phone</b><div className="v2-small v2-mut">A reminder 10 minutes before each follow-up, while MainstreetAI is open.</div></div>
        </button>)}
      <ErrorBox error={f.error} />
      {f.loading && !f.data ? <Loading /> : !f.data?.length ? <div className="v2-rep-zone v2-mut">No follow-ups. When a business asks you to come back, log a Follow-up and it shows here.</div> : null}
      {groups.map(g => {
        const list = (f.data || []).filter(x => x.when === g.key);
        if (!list.length) return null;
        return (
          <div key={g.key}>
            <div className="v2-rep-group" style={g.key === 'overdue' ? { color: '#b91c1c' } : undefined}>{g.label} · {list.length}</div>
            {list.map(x => (
              <div key={`${x.business_id}-${x.campaign_id}`} className="v2-rep-item">
                <Link to={`/app/rep?b=${x.business_id}|${x.campaign_id}`} style={{ flex: 1, minWidth: 0, color: 'inherit' }}>
                  <div className="n">{x.name}</div>
                  <div className="a">{[x.contact_name && `Ask for ${x.contact_name}`, x.contact_phone, x.zone_name].filter(Boolean).join(' · ')}</div>
                  {x.notes && <div className="a">{x.notes}</div>}
                </Link>
                <div style={{ textAlign: 'right' }}>
                  <div className="v2-small" style={{ fontWeight: 700 }}>{whenLabel(x.follow_up_at)}</div>
                  <button type="button" className="v2-rep-mini" onClick={() => ics(x)} aria-label={`Add ${x.name} to calendar`}><CalendarPlus size={13} />Calendar</button>
                </div>
              </div>))}
          </div>);
      })}
    </>
  );
};

// ───────────── me: today, goals, the board, earnings, numbers ─────────────
const Me: React.FC = () => {
  const { today, queue, flushNow } = useRep();
  const b = useLoad(() => repBoard(), []);
  const n = useLoad(() => repNumbers(), []);
  const max = Math.max(1, ...(n.data?.days || []).map(d => d.visits));
  const pct = (a: number, g: number) => `${Math.min(100, g ? Math.round((100 * a) / g) : 0)}%`;
  const stuck = queue.filter(q => q.error);
  const waiting = queue.filter(q => !q.error);
  return (
    <>
      <h1>Me</h1>
      {(stuck.length > 0 || waiting.length > 0) && (
        <div className="v2-rep-zone">
          <b>On your phone, not sent yet</b>
          {waiting.length > 0 && <div className="v2-small" style={{ margin: '6px 0' }}>{waiting.length} waiting for signal. <button type="button" className="v2-rep-mini" onClick={flushNow}>Try now</button></div>}
          {stuck.map(q => (
            <div key={q.id} className="v2-rep-visit">
              <div className="h"><b style={{ flex: 1 }}>{q.label}</b><button type="button" className="v2-rep-mini" onClick={() => drop(q.id)}>Discard</button></div>
              <div className="v2-small" style={{ color: '#b91c1c' }}>{q.error}</div>
            </div>))}
        </div>)}
      {today && (
        <div className="v2-rep-zone">
          <div className="row"><b>Today</b><span className="v2-small v2-mut" style={{ marginLeft: 'auto' }}>
            {today.started_at ? `${hoursLabel(today.minutes)} out${today.ended_at ? ' · done' : ''}` : 'Day not started'}</span></div>
          <div className="v2-rep-goal"><span>Visits <b>{today.visits}</b> / {today.goal_visits}</span><div className="v2-rep-bar"><b style={{ width: pct(today.visits, today.goal_visits) }} /></div></div>
          <div className="v2-rep-goal"><span>Deals <b>{today.deals}</b> / {today.goal_deals}</span><div className="v2-rep-bar"><b style={{ width: pct(today.deals, today.goal_deals), background: '#16a34a' }} /></div></div>
        </div>)}
      <ErrorBox error={b.error || n.error} />
      {b.data && (
        <>
          <div className="v2-rep-stat">
            <div><b><Flame size={18} style={{ verticalAlign: -2, color: '#ea580c' }} /> {b.data.streak}</b><span>Day streak (goal met)</span></div>
            <div><b>{money(b.data.earnings.week)}</b><span>Earned this week</span></div>
            <div><b>{money(b.data.earnings.total)}</b><span>Earned in all</span></div>
          </div>
          {b.data.earnings.unpriced > 0 && <div className="v2-small v2-mut" style={{ margin: '-4px 0 10px' }}>{b.data.earnings.unpriced} approved deal{b.data.earnings.unpriced === 1 ? '' : 's'} on a campaign with no pay set yet.</div>}
          <div className="v2-rep-zone">
            <div className="row"><Trophy size={16} /><b>This week</b><span className="v2-small v2-mut" style={{ marginLeft: 'auto' }}>from {new Date(`${b.data.week_of}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span></div>
            <table className="v2-rep-board">
              <thead><tr><th>#</th><th>Rep</th><th>Deals</th><th>Visits</th></tr></thead>
              <tbody>{b.data.board.map((r, i) => (
                <tr key={i} className={r.me ? 'me' : ''}><td>{i + 1}</td><td>{r.me ? 'You' : r.name}</td><td><b>{r.approved}</b>{r.pending ? <span className="v2-mut"> +{r.pending}</span> : ''}</td><td>{r.visits}</td></tr>))}</tbody>
            </table>
            <div className="v2-small v2-mut">Deals count once approved; +n are waiting.</div>
          </div>
        </>)}
      {n.loading && !n.data ? <Loading /> : n.data && (
        <>
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
          <div className="v2-small v2-mut">{n.data.visits_total} visits logged in all.</div>
        </>)}
    </>
  );
};

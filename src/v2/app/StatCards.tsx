// src/v2/app/StatCards.tsx — the home page's large stat cards: one per component the user
// may open, each with today's key numbers. A number links to the screen it comes from;
// "Open" shows that component's screens.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/data';
import { COLORS } from '../ui';
import { SERVICE_LINES } from '../lib/clientImport';
import { adminStats, clientStats, isoDay, liveStats, workerbookStats, type LiveStats } from '../lib/dashboard';
import type { Component } from './nav';

const n = (v: number) => v.toLocaleString('en-CA');
const $ = (v: number) => `$${Math.round(v).toLocaleString('en-CA')}`;
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Kpi { label: string; value: string; sub?: string; tone?: 'green' | 'amber' | 'rose' | 'blue'; to?: string }

const StatCard: React.FC<{
  comp: Component; caption?: React.ReactNode; kpis: Kpi[] | null; loading: boolean; error: unknown;
  foot?: React.ReactNode; empty?: React.ReactNode; onOpen: () => void;
}> = ({ comp, caption, kpis, loading, error, foot, empty, onOpen }) => {
  const nav = useNavigate();
  const c = COLORS[comp.color];
  const Icon = comp.icon;
  return (
    <section className="v2-card v2-stat" aria-label={comp.label}>
      <div className="v2-stat-h">
        <span className="ib" style={{ background: `${c}1a` }}><Icon size={22} color={c} /></span>
        <span style={{ minWidth: 0 }}>
          <b>{comp.label}</b>
          {caption && <span className="cap">{caption}</span>}
        </span>
        <button className="open" onClick={onOpen}>Open<ChevronRight size={15} /></button>
      </div>
      {error ? <div className="v2-stat-msg err">Couldn’t load these numbers: {errText(error)}</div>
        : loading && !kpis ? <div className="v2-kpis">{[0, 1, 2].map(i => <div key={i} className="v2-kpi-box skel"><span className="l">&nbsp;</span><span className="n">&nbsp;</span></div>)}</div>
        : !kpis ? <div className="v2-stat-msg">{empty}</div>
        : (
          <div className="v2-kpis">
            {kpis.map(k => {
              const body = <><span className="l">{k.label}</span><span className={`n${k.tone ? ` ${k.tone}` : ''}`}>{k.value}</span>{k.sub && <span className="s">{k.sub}</span>}</>;
              return k.to
                ? <button key={k.label} className="v2-kpi-box link" onClick={() => nav(k.to!)}>{body}</button>
                : <div key={k.label} className="v2-kpi-box">{body}</div>;
            })}
          </div>
        )}
      {foot && !error && <div className="v2-stat-f">{foot}</div>}
    </section>
  );
};

export const StatCards: React.FC<{ comps: Component[]; onOpen: (c: Component) => void }> = ({ comps, onOpen }) => {
  const { center, can } = useAuth();
  const cid = center?.id || '';
  const has = (k: string) => comps.find(c => c.key === k);
  const rm = has('rm'), wb = has('wb'), mb = has('mb'), cd = has('cd'), sa = has('sa');

  const live = useLoad<LiveStats | null>(() => (cid && (rm || mb) ? liveStats(cid) : Promise.resolve(null)), [cid, !!rm, !!mb]);
  const work = useLoad(() => (cid && wb ? workerbookStats(cid) : Promise.resolve(null)), [cid, !!wb]);
  const lines = SERVICE_LINES.map(l => l.key);
  const clients = useLoad(() => (cd ? clientStats(lines) : Promise.resolve(null)), [!!cd]);
  const saUsers = !!sa && can('sa_users'), saTerr = !!sa && can('sa_territory');
  const admin = useLoad(() => (sa ? adminStats({ users: saUsers, territory: saTerr }) : Promise.resolve(null)), [saUsers, saTerr]);

  const today = isoDay(new Date());
  const noCenter = <>Pick a command center at the top to see these numbers.</>;
  const L = live.data;

  return (
    <div className="v2-stats">
      {rm && (
        <StatCard comp={rm} onOpen={() => onOpen(rm)} loading={live.loading} error={live.error}
          caption={L ? `Live session · ${dayLabel(L.date)}` : 'Today'}
          empty={!cid ? noCenter : 'No session is open at this center today.'}
          kpis={L ? [
            { label: 'Workers on', value: n(L.workers), sub: `${n(L.carts)} cart${L.carts === 1 ? '' : 's'}`, to: '/app/rm' },
            { label: 'Steps', value: n(L.steps), to: '/app/rm' },
            { label: 'Gross', value: $(L.gross), tone: 'green', to: '/app/workerbook/payouts' },
            { label: 'Upsells', value: n(L.upsells), sub: L.upsellGross ? $(L.upsellGross) : undefined, to: '/app/workerbook/payouts' },
            { label: 'Open routes', value: n(L.openRoutes), sub: `of ${n(L.routes)}`, tone: L.openRoutes ? 'amber' : undefined, to: '/app/rm' },
          ] : null}
          foot={L ? `${n(L.managers)} route manager${L.managers === 1 ? '' : 's'} on the session` : undefined} />
      )}
      {wb && (() => {
        const w = work.data; const t = w?.today; const tm = w?.tomorrow;
        return (
          <StatCard comp={wb} onOpen={() => onOpen(wb)} loading={work.loading} error={work.error}
            caption={`Today · ${dayLabel(today)}`} empty={noCenter}
            kpis={w ? [
              { label: 'Booked today', value: n(t?.booked || 0), sub: t ? `${n(t.confirmed)} confirmed` : 'No day planned', to: `/app/workerbook/days/${today}` },
              { label: 'Showed', value: n(t?.showed || 0), tone: 'green', to: `/app/workerbook/days/${today}` },
              { label: 'No-shows', value: n(t?.noShow || 0), tone: t?.noShow ? 'rose' : undefined, to: `/app/workerbook/days/${today}` },
              { label: 'Tomorrow', value: n(tm?.booked || 0), sub: tm ? `${n(tm.confirmed)} confirmed${tm.firstDay ? ` · ${tm.firstDay} first-day` : ''}` : 'Nobody booked yet', tone: 'blue', to: tm ? `/app/workerbook/days/${tm.day}` : '/app/workerbook/days' },
              { label: 'Active contractors', value: n(w.active), sub: w.watch ? `${n(w.watch)} on NS / WL` : undefined, to: '/app/workerbook/contractors' },
            ] : null} />
        );
      })()}
      {mb && (
        <StatCard comp={mb} onOpen={() => onOpen(mb)} loading={live.loading} error={live.error}
          caption={L ? `Live session prebooks · ${dayLabel(L.date)}` : 'Prebooks'}
          empty={!cid ? noCenter : 'No session is open at this center today.'}
          kpis={L ? [
            { label: 'Prebooks', value: n(L.prebooks), to: '/app/rm' },
            { label: 'Routes with prebooks', value: n(L.prebookRoutes), sub: `of ${n(L.routes)}` },
            { label: 'Prebook value', value: $(L.prebookValue), tone: 'green' },
          ] : null}
          foot="The Master Bookings screens arrive in a later phase." />
      )}
      {cd && (() => {
        const c = clients.data;
        const top = c ? c.byLine.filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3) : [];
        return (
          <StatCard comp={cd} onOpen={() => onOpen(cd)} loading={clients.loading} error={clients.error} caption="Client records"
            kpis={c ? [
              { label: 'Properties', value: n(c.total), to: '/app/clients/list' },
              { label: 'Need a route', value: n(c.noRoute), tone: c.noRoute ? 'amber' : undefined, to: '/app/clients/list' },
              ...top.map(x => ({ label: `${SERVICE_LINES.find(l => l.key === x.key)?.label || x.key} clients`, value: n(x.n), to: '/app/clients/list' })),
            ] : null} />
        );
      })()}
      {sa && (() => {
        const a = admin.data;
        const k: Kpi[] = [];
        if (a?.users) k.push(
          { label: 'Active users', value: n(a.users.active), to: '/app/admin/users' },
          { label: 'Route managers', value: n(a.users.managers), to: '/app/admin/users' },
          { label: 'Command centers', value: n(a.users.centers), to: '/app/admin/centers' });
        if (a?.territory) k.push(
          { label: 'Approved routes', value: n(a.territory.routes), sub: `${n(a.territory.areas)} areas`, to: '/app/admin/territory' },
          { label: 'Areas without a center', value: n(a.territory.unassignedAreas), tone: a.territory.unassignedAreas ? 'amber' : undefined, to: '/app/admin/territory' },
          { label: 'Client lists loaded', value: n(a.territory.lists), to: '/app/admin/territory/clients' });
        return (
          <StatCard comp={sa} onOpen={() => onOpen(sa)} loading={admin.loading} error={admin.error} caption="Across the company"
            kpis={a && k.length ? k : null} empty="Reporting arrives in a later phase." />
        );
      })()}
    </div>
  );
};

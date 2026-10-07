// src/v2/features/workerbook/Payouts.tsx — the day's payouts. The screen itself is the old
// app's payout screen (same numbers, same saves), shown in the new app's colours.
import React, { Suspense, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import { legacyLiveSession, pointLegacyAt } from '../../lib/legacy';
import { ErrorBox, Loading } from '../../ui';
import type { SortOption } from '../../../types';
import '../../ui/legacy.css';

const PayoutToday = React.lazy(() => import('../../../pages/Management/PayoutToday'));
const PayoutContractor = React.lazy(() => import('../../../pages/Management/PayoutContractor'));

const SORTS: { key: SortOption; label: string }[] = [
  { key: 'standard', label: 'Standard (by RM)' },
  { key: 'alpha', label: 'Alphabetical' },
  { key: 'steps', label: 'Sort by Steps' },
  { key: 'upGross', label: 'Sort by Up Gross' },
  { key: 'upsell', label: 'Sort by Upsells' },
  { key: 'equiv', label: 'Sort by EQ' },
  { key: 'bonusEquiv', label: 'Bonus EQ' },
  { key: 'commission', label: 'Sort by Payout' },
];

const prettyDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** /app/workerbook/payouts — jumps to the live session's day. */
export const PayoutsLive: React.FC = () => {
  const { center } = useAuth();
  const live = useLoad(() => center ? legacyLiveSession(center.id) : Promise.resolve(null), [center?.id]);
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (live.loading) return <div className="v2-main"><Loading /></div>;
  if (live.error) return <div className="v2-main v2-narrow"><ErrorBox error={live.error} /></div>;
  if (live.data) return <Navigate to={`/app/workerbook/days/${live.data.date}/payouts`} replace />;
  return (
    <div className="v2-main v2-narrow">
      <div className="v2-head"><span className="v2-h1">Payouts</span></div>
      <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
        No session is live at {center.display_name}. Start one from <Link className="v2-link" to={`/app/workerbook/days/${todayISO()}`}>today’s day</Link>.
      </div>
    </div>
  );
};

/** /app/workerbook/days/:date/payouts */
export const Payouts: React.FC = () => {
  const { date = todayISO() } = useParams();
  const { center } = useAuth();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('standard');
  const live = useLoad(() => center ? legacyLiveSession(center.id) : Promise.resolve(null), [center?.id]);

  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  const session = live.data;
  return (
    <div className="v2-main">
      <div className="v2-head">
        <Link to={`/app/workerbook/days/${date}`} className="v2-link">‹ {prettyDate(date)}</Link>
        <span className="v2-h1">Payouts</span>
      </div>
      <ErrorBox error={live.error} />
      {live.loading ? <Loading /> : !session ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>No session is live at {center.display_name}, so there’s nothing to pay out yet.</div>
      ) : session.date !== date ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
          The live session is {prettyDate(session.date)}. <Link className="v2-link" to={`/app/workerbook/days/${session.date}/payouts`}>Open its payouts</Link>
        </div>
      ) : (
        <>
          <div className="v2-card v2-row" style={{ marginBottom: 14, padding: 10 }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
              <input className="v2-input" style={{ paddingLeft: 30 }} placeholder="Search workers…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search workers" />
            </div>
            <select className="v2-sel" style={{ width: 200 }} value={sort} onChange={e => setSort(e.target.value as SortOption)} aria-label="Sort">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="v2-legacy v2-legacy-panel">
            <Suspense fallback={<Loading />}>
              <PayoutToday consoleProfileId={1} date={session.date} sortOption={sort} searchTerm={search}
                managers={session.data.managers} workers={session.data.workers}
                workerHref={id => `/app/workerbook/days/${session.date}/payouts/${encodeURIComponent(id)}`} />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
};

/** /app/workerbook/days/:date/payouts/:contractorId — one worker's payout (the old app's screen). */
export const PayoutWorker: React.FC = () => {
  const { date = todayISO() } = useParams();
  const { center } = useAuth();
  const ready = useLoad(() => center ? pointLegacyAt(center.id).then(() => true) : Promise.resolve(false), [center?.id]);
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (ready.error) return <div className="v2-main v2-narrow"><ErrorBox error={ready.error} /></div>;
  if (!ready.data) return <div className="v2-main"><Loading /></div>;
  return (
    <div className="v2-legacy v2-legacy-full">
      <Suspense fallback={<Loading />}>
        <PayoutContractor doneHref={`/app/workerbook/days/${date}/payouts`} />
      </Suspense>
    </div>
  );
};

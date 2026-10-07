// src/v2/features/workerbook/Payouts.tsx — the live day's payouts (shown on the day page). The screen itself is the old
// app's payout screen (same numbers, same saves), shown in the new app's colours.
import React, { Suspense, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { todayISO, useLoad } from '../../lib/data';
import { legacyLiveSession, pointLegacyAt } from '../../lib/legacy';
import { ErrorBox, Loading } from '../../ui';
import { cartContext, cartStats, dayLines, saveDay, type PayoutCart } from '../../lib/payoutCarts';
import { cartSessionId, fromBonus, savedDayView } from '../../lib/savedPayouts';
import type { PayoutLine } from '../../lib/payslips';
import type { LogsheetSession, SeasonType, SortOption } from '../../../types';
import type { PayoutTodaySource } from '../../../pages/Management/PayoutToday';
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

/** Search and sort above the payout list. */
const PayoutBar: React.FC<{ search: string; setSearch: (v: string) => void; sort: SortOption; setSort: (v: SortOption) => void; children?: React.ReactNode }> =
  ({ search, setSearch, sort, setSort, children }) => (
    <div className="v2-card v2-row" style={{ marginBottom: 14, padding: 10 }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#6b7280' }} />
        <input className="v2-input" style={{ paddingLeft: 30 }} placeholder="Search workers…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search workers" />
      </div>
      <select className="v2-sel" style={{ width: 200 }} value={sort} onChange={e => setSort(e.target.value as SortOption)} aria-label="Sort">
        {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      {children}
    </div>
  );

const prettyDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** /app/workerbook/payouts — jumps to the live session's day. */
export const PayoutsLive: React.FC = () => {
  const { center } = useAuth();
  const live = useLoad(() => center ? legacyLiveSession(center.id) : Promise.resolve(null), [center?.id]);
  if (!center) return <div className="v2-main v2-narrow"><div className="v2-card">Pick a command center first.</div></div>;
  if (live.loading) return <div className="v2-main"><Loading /></div>;
  if (live.error) return <div className="v2-main v2-narrow"><ErrorBox error={live.error} /></div>;
  if (live.data) return <Navigate to={`/app/workerbook/days/${live.data.date}`} replace />;
  return (
    <div className="v2-main v2-narrow">
      <div className="v2-head"><span className="v2-h1">Payouts</span></div>
      <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
        No session is live at {center.display_name}. Start one from <Link className="v2-link" to={`/app/workerbook/days/${todayISO()}`}>today’s day</Link>.
      </div>
    </div>
  );
};

/** The live session's payouts (the old app's payout list). A live day shows this as its page. */
export const SessionPayouts: React.FC<{ centerId: string; centerName: string; date: string }> = ({ centerId, centerName, date }) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('standard');
  const live = useLoad(() => legacyLiveSession(centerId), [centerId]);
  const session = live.data;
  return (
    <>
      <ErrorBox error={live.error} />
      {live.loading && !session ? <Loading /> : !session ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>No session is live at {centerName}, so there’s nothing to pay out yet.</div>
      ) : session.date !== date ? (
        <div className="v2-card" style={{ textAlign: 'center', padding: 30 }}>
          The live session is {prettyDate(session.date)}. <Link className="v2-link" to={`/app/workerbook/days/${session.date}`}>Open that day</Link>
        </div>
      ) : (
        <>
          <PayoutBar search={search} setSearch={setSearch} sort={sort} setSort={setSort} />
          <div className="v2-legacy v2-legacy-panel">
            <Suspense fallback={<Loading />}>
              <PayoutToday consoleProfileId={1} date={session.date} sortOption={sort} searchTerm={search}
                managers={session.data.managers} workers={session.data.workers}
                workerHref={id => `/app/workerbook/days/${session.date}/payouts/${encodeURIComponent(id)}`} />
            </Suspense>
          </div>
        </>
      )}
    </>
  );
};

/**
 * A saved day's payouts (closed, or handed off to a newer day) on the live payout screen: the same
 * carts, numbers, Paid / Pending and bonuses. Adding or removing a bonus works the day's pay out
 * again and saves it (until a payslip is generated). A worker opens the payout editor at their cart.
 */
export const SavedDayPayouts: React.FC<{
  centerId: string; region: string; date: string; carts: PayoutCart[]; lines: PayoutLine[]; readOnly: boolean;
  onChanged: () => void; toolbar?: React.ReactNode;
}> = ({ centerId, region, date, carts, lines, readOnly, onChanged, toolbar }) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('standard');
  const ctx = useLoad(() => cartContext(centerId, region, date, carts), [centerId, region, date, carts]);
  const stats = useLoad(async () => ctx.data ? Promise.all(carts.map(c => cartStats(c, ctx.data!.service, ctx.data!.settings))) : null, [ctx.data, carts]);
  const changed = useRef(onChanged); changed.current = onChanged;
  const view = useMemo(() => stats.data ? savedDayView(date, carts, stats.data as Record<string, number>[], lines) : null, [date, carts, stats.data, lines]);
  const source = useMemo<PayoutTodaySource | null>(() => !view || !ctx.data ? null : {
    seasonType: ctx.data.service as SeasonType,
    load: async () => view.sessions,
    readOnly,
    update: async (sessionId: string, patch: Partial<LogsheetSession>) => {
      if (!patch.bonuses || !ctx.data) return;
      const next = carts.map((c, i) => cartSessionId(c, i) === sessionId ? { ...c, bonuses: patch.bonuses!.map(fromBonus) } : c);
      await saveDay(centerId, date, next, await dayLines(next, ctx.data));
      changed.current();
    },
  }, [view, ctx.data, readOnly, carts, centerId, date]);
  return (
    <>
      <ErrorBox error={ctx.error || stats.error} />
      <PayoutBar search={search} setSearch={setSearch} sort={sort} setSort={setSort}>{toolbar}</PayoutBar>
      {!view || !source ? <Loading /> : (
        <div className="v2-legacy v2-legacy-panel">
          <Suspense fallback={<Loading />}>
            <PayoutToday consoleProfileId={1} date={date} sortOption={sort} searchTerm={search} source={source}
              managers={view.managers} workers={view.workers}
              workerHref={id => `/app/workerbook/days/${date}?edit=${encodeURIComponent(id)}`} />
          </Suspense>
        </div>
      )}
      {view && !view.sessions.length && <div className="v2-card v2-mut" style={{ marginTop: 10 }}>No carts with anyone on them for this day.</div>}
    </>
  );
};

/** /app/workerbook/days/:date/payouts — the live day is the payouts page now. */
export const Payouts: React.FC = () => {
  const { date = todayISO() } = useParams();
  return <Navigate to={`/app/workerbook/days/${date}`} replace />;
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
        <PayoutContractor doneHref={`/app/workerbook/days/${date}`} />
      </Suspense>
    </div>
  );
};

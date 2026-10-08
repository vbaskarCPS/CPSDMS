// src/pages/Management/components/RMDesktopRoutes.tsx
//
// Desktop RM map: the left sidebar. It shows the combined route list, and a
// route's view in its place when one is opened (‹ goes back to the list).
// RMMapTab owns the data and every action; these only draw.
//
//   RouteList  the team first (each crew with its route chips; a click opens
//              their route), then the routes (open ones first, with Assign).
//   RoutePanel what a click on a route (list, map line, or a worker's
//              initials) opens: Logsheet first, then Stats / Prebooks / PCL,
//              with Assign and Navigate on top.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronDown, Users, Navigation2, Phone, FileText, Truck, Check, Minus, Plus,
  FlaskConical, Loader, ArrowUpDown,
} from 'lucide-react';
import type { MasterBooking } from '../../../types';
import type { CartCardData, WorkerCardData, RouteCardData } from './RMMapTab';
import type { PhoneCrew, PhoneRouteState, KnockSummary, CrewMoney, SortOption, ManagerTag } from '../mobile/RMPhoneLayout';
import { crewLabel, ManagerBadge } from '../mobile/RMPhoneLayout';
import { ActivityBadge, latestMs } from './rmMapShared';
import { money } from '../mobile/rmPhone';

const SORT_LABEL: Record<SortOption, string> = {
  recent: 'Most recent', alpha: 'A–Z', steps: 'Steps', equiv: 'EQ', upGross: 'Upsell $',
};

const Dot = () => <span className="text-gray-600">•</span>;

export function crewLastMs(crew: PhoneCrew, knock: Map<string, KnockSummary>): number | null {
  return crew.type === 'cart'
    ? latestMs(crew.cart.lastActiveTimestamp, knock.get(crew.cart.sessionId)?.last?.t)
    : latestMs(crew.card.lastActiveTimestamp);
}

const crewIds = (crew: PhoneCrew) => (crew.type === 'cart' ? crew.cart.members.map(m => m.contractorId) : [crew.card.worker.contractorId]);

// ---------------------------------------------------------------------------
// LIST (left sidebar)
// ---------------------------------------------------------------------------

export interface RouteListProps {
  isTeamSeason: boolean;
  routeCards: RouteCardData[];
  /** Crews in the chosen sort order. */
  crews: PhoneCrew[];
  crewForIds: (ids: string[]) => PhoneCrew | null;
  crewMoney: (crew: PhoneCrew) => CrewMoney;
  knock: Map<string, KnockSummary>;
  /** Floating for several managers: whose team each crew is (top right of the card). */
  managerTag?: (crew: PhoneCrew) => ManagerTag | null;
  activityNow: number;
  selected: PhoneRouteState | null;
  sortBy: SortOption;
  onSortBy: (s: SortOption) => void;
  onOpenRoute: (rc: RouteCardData) => void;
  onAssignRoute: (rc: RouteCardData) => void;
  onOpenCrew: (crewKey: string) => void;
  onCollapse: () => void;
}

export const RouteList: React.FC<RouteListProps> = p => {
  // Each crew's routes (chips on their one card, however many routes).
  const routesOf = useMemo(() => {
    const m = new Map<string, RouteCardData[]>();
    for (const c of p.crews) {
      const ids = crewIds(c);
      m.set(c.key, p.routeCards
        .filter(rc => rc.assignedWorkerIds.some(id => ids.includes(id)))
        .sort((x, y) => x.displayRouteCode.localeCompare(y.displayRouteCode, undefined, { numeric: true })));
    }
    return m;
  }, [p.crews, p.routeCards]);

  // Routes nobody is on yet — listed at the bottom with Assign.
  const open = useMemo(() => p.routeCards
    .filter(rc => !rc.isAssigned)
    .sort((x, y) => x.displayRouteCode.localeCompare(y.displayRouteCode, undefined, { numeric: true })), [p.routeCards]);

  const sel = p.selected;
  const selRouteCrewKey = useMemo(() => {
    if (!sel?.routeCode) return null;
    const rc = p.routeCards.find(r => r.baseRouteCode === sel.routeCode && (r.letter || undefined) === (sel.letter || undefined));
    return rc ? p.crewForIds(rc.assignedWorkerIds)?.key ?? null : null;
  }, [sel, p.routeCards, p.crewForIds]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-3 border-b border-gray-700 bg-gray-900/95">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">{p.isTeamSeason ? 'Carts' : 'Workers'}</span>
          <span className="text-[11px] text-gray-400">· {p.crews.length}{open.length > 0 && <span className="text-amber-400"> · {open.length} open route{open.length === 1 ? '' : 's'}</span>}</span>
          <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-300 bg-gray-800 rounded-full pl-2 pr-1 py-0.5 border border-gray-700">
            <ArrowUpDown size={11} />
            <select
              value={p.sortBy}
              onChange={e => p.onSortBy(e.target.value as SortOption)}
              className="bg-transparent text-[11px] text-gray-200 outline-none cursor-pointer"
              title="Sort the team"
            >
              {(Object.keys(SORT_LABEL) as SortOption[]).map(k => <option key={k} value={k} className="bg-gray-800">{SORT_LABEL[k]}</option>)}
            </select>
          </label>
          <button
            onClick={p.onCollapse}
            className="w-7 h-7 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"
            title="Hide the list"
          ><ChevronLeft size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
        {/* WORKERS / CARTS — one card each; a click opens their route */}
        {p.crews.length === 0 && <div className="text-xs text-gray-500 p-3">Nobody on your team yet today.</div>}
        {p.crews.map(c => {
          const m = p.crewMoney(c);
          const k = c.type === 'cart' ? p.knock.get(c.cart.sessionId) : undefined;
          const theirs = routesOf.get(c.key) || [];
          const tag = p.managerTag?.(c) || null;
          const on = !!sel && (sel.crewKey === c.key || selRouteCrewKey === c.key);
          return (
            <div
              key={c.key}
              onClick={() => p.onOpenCrew(c.key)}
              className={`rounded-lg p-2.5 cursor-pointer border transition-colors ${on ? 'bg-gray-700 border-blue-500 ring-1 ring-blue-500' : 'bg-gray-800 hover:bg-gray-700 border-gray-700'}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex flex-col gap-1 flex-shrink-0">
                  {theirs.length === 0 ? (
                    <div className="h-8 px-2 min-w-[48px] rounded-md flex items-center justify-center font-bold text-gray-400 text-[10px] bg-gray-700 leading-none">No route</div>
                  ) : theirs.map(rc => (
                    <div
                      key={`${rc.baseRouteCode}-${rc.letter || ''}`}
                      className={`${theirs.length > 1 ? 'h-6 text-[10px]' : 'h-8 text-[11px]'} px-2 min-w-[48px] rounded-md flex items-center justify-center font-bold text-white leading-none whitespace-nowrap`}
                      style={{ background: rc.routeColor }}
                    >{rc.displayRouteCode}</div>
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {c.type === 'cart' && c.cart.isRcCart && <Truck size={11} className="text-orange-400 flex-shrink-0" />}
                    <span className="text-white text-xs font-bold truncate">{crewLabel(c)}</span>
                    <ActivityBadge lastMs={crewLastMs(c, p.knock)} nowMs={p.activityNow} />
                    {tag && <span className="ml-auto"><ManagerBadge tag={tag} /></span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-gray-300 mt-0.5">
                    <span><b className="text-white">{m.steps}</b> steps</span><Dot />
                    <span className={m.pending > 0 ? 'text-amber-400' : ''}>{m.pending} pend</span><Dot />
                    <span>{money(m.gross, true)}<span className="text-yellow-400"> +{money(m.pendingGross, true).slice(1)}</span></span>
                    {k && (<><Dot /><span className="text-blue-300">{k.total ? `${Math.round(k.pct * 100)}% cov` : '— cov'}</span></>)}
                  </div>
                  {k && (
                    <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-gray-300 mt-0.5">
                      <span><b className="text-white">{k.knocks}</b> knocks</span><Dot />
                      <span className={k.no > 0 ? 'text-red-400' : ''}>{k.no} no</span><Dot />
                      <span className={k.goBack > 0 ? 'text-orange-300' : ''}>{k.goBack} GB</span><Dot />
                      <span className={k.invalid > 0 ? 'text-pink-300' : ''}>{k.invalid} inv</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* OPEN ROUTES — at the bottom, with Assign */}
        {open.length > 0 && (
          <div className="pt-3 pb-1 px-1 text-[10px] uppercase tracking-wide text-amber-400 font-bold">
            Open routes · {open.length}
          </div>
        )}
        {open.map(rc => {
          const on = !!sel && sel.routeCode === rc.baseRouteCode && (sel.letter || undefined) === (rc.letter || undefined);
          return (
            <div
              key={`${rc.baseRouteCode}-${rc.letter || 'whole'}`}
              onClick={() => p.onOpenRoute(rc)}
              className={`rounded-lg px-2.5 py-2 cursor-pointer border transition-colors ${on ? 'bg-gray-700 border-blue-500 ring-1 ring-blue-500' : 'bg-gray-800/70 hover:bg-gray-700 border-gray-700'}`}
            >
              <div className="flex items-center gap-2">
                <div
                  className="h-7 px-2 min-w-[44px] rounded-md flex items-center justify-center font-bold text-white text-[11px] flex-shrink-0 leading-none whitespace-nowrap"
                  style={{ background: rc.routeColor }}
                >{rc.displayRouteCode}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-amber-400 text-xs font-bold">⚠ Unassigned</div>
                  <div className="text-[10px] text-gray-400">{rc.prebookCount} jobs · {rc.prepayCount} prepaid · {rc.totalEQ.toFixed(1)} EQ</div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); p.onAssignRoute(rc); }}
                  className="flex-shrink-0 h-7 px-2.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold"
                >Assign</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ROUTE VIEW (in the sidebar, in place of the list)
// ---------------------------------------------------------------------------

type PanelTab = 'logsheet' | 'stats' | 'prebooks';

export interface RoutePanelProps {
  isSealing: boolean;
  activityNow: number;
  route: RouteCardData | null;
  crew: PhoneCrew | null;
  crewRoutes: Array<{ routeCode: string; letter?: string; display: string; color: string }>;
  onEnterRoute: (routeCode: string, letter?: string) => void;
  onClose: () => void;
  onAssign: () => void;
  onNavigate: () => void;
  crewMoney: (crew: PhoneCrew) => CrewMoney;
  knock: Map<string, KnockSummary>;
  /** CartMapPanel for map-logsheet carts — kept mounted (it draws the houses). */
  cartPanelNode: React.ReactNode | null;
  logsheet: (crew: PhoneCrew) => React.ReactNode;
  onViewLogsheet: (crew: PhoneCrew) => void;
  routeBookings: MasterBooking[];
  onShowBooking: (bookingId: string) => void;
  pclCount: number;
  onOpenPcl: () => void;
  bottleSavingId: string | null;
  onAdjustBottles: (cart: CartCardData, delta: number) => void;
  onToggleUpsells: (card: WorkerCardData) => void;
}

const StatBox: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="bg-gray-800 rounded-lg px-2.5 py-2 min-w-0">
    <div className="text-[9.5px] uppercase tracking-wide text-gray-500 font-bold truncate">{label}</div>
    <div className={`text-[15px] font-extrabold truncate ${tone || 'text-white'}`}>{value}</div>
  </div>
);

const TabBtn: React.FC<{ on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ on, onClick, disabled, children }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`flex-shrink-0 h-8 px-3.5 rounded-full text-xs font-bold flex items-center gap-1 transition-colors ${on ? 'bg-[#f3f4f6] text-[#111827]' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'} ${disabled ? 'opacity-35 cursor-default' : ''}`}
  >{children}</button>
);

export const RoutePanel: React.FC<RoutePanelProps> = p => {
  const { route, crew } = p;
  const [tab, setTab] = useState<PanelTab>(crew ? 'logsheet' : 'stats');
  const [switcher, setSwitcher] = useState(false);

  // A new route (or crew) opens on its logsheet — on Stats when nobody's on it.
  const key = `${route?.baseRouteCode || ''}|${route?.letter || ''}|${crew?.key || ''}`;
  useEffect(() => { setTab(crew ? 'logsheet' : 'stats'); setSwitcher(false); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const cm = crew ? p.crewMoney(crew) : null;
  const knock = crew?.type === 'cart' ? p.knock.get(crew.cart.sessionId) : undefined;
  const members = crew ? (crew.type === 'cart' ? crew.cart.members : [crew.card.worker]) : [];

  return (
    <div className="flex flex-col h-full">
      {/* HEADER: route + crew, Assign / Navigate / close */}
      <div className="flex-shrink-0 p-3 border-b border-gray-700 bg-gray-900/95 space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={p.onClose}
            className="w-8 h-8 -ml-1 rounded-md hover:bg-gray-800 text-gray-300 flex items-center justify-center flex-shrink-0"
            title="Back to all routes"
            aria-label="Back to all routes"
          ><ChevronLeft size={18} /></button>
          <div className="relative">
            <button
              onClick={() => p.crewRoutes.length > 1 && setSwitcher(v => !v)}
              className="flex items-center gap-1"
              title={p.crewRoutes.length > 1 ? "This crew's other routes" : undefined}
            >
              {route ? (
                <span className="h-8 px-2.5 rounded-md text-white text-[13px] font-extrabold flex items-center" style={{ background: route.routeColor }}>{route.displayRouteCode}</span>
              ) : (
                <span className="h-8 px-2.5 rounded-md bg-gray-700 text-gray-200 text-[12px] font-bold flex items-center">No route</span>
              )}
              {p.crewRoutes.length > 1 && <ChevronDown size={14} className="text-gray-400" />}
            </button>
            {switcher && (
              <div className="absolute left-0 top-10 z-20 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-1 space-y-0.5">
                {p.crewRoutes.map(r => {
                  const on = route && r.routeCode === route.baseRouteCode && (r.letter || '') === (route.letter || '');
                  return (
                    <button
                      key={r.display}
                      onClick={() => { setSwitcher(false); p.onEnterRoute(r.routeCode, r.letter); }}
                      className={`w-full h-9 rounded-md px-2 flex items-center gap-2 text-xs font-bold ${on ? 'bg-gray-700 text-white' : 'text-gray-200 hover:bg-gray-800'}`}
                    >
                      <span className="h-6 px-1.5 rounded text-white text-[11px] font-extrabold flex items-center" style={{ background: r.color }}>{r.display}</span>
                      {on && <Check size={14} className="ml-auto" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex-1" />
          {route && (
            <button
              onClick={p.onAssign}
              className={`h-8 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 border ${route.isAssigned ? 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-200' : 'bg-amber-600 hover:bg-amber-500 border-amber-400 text-white'}`}
            ><Users size={14} /> {route.isAssigned ? 'Reassign' : 'Assign'}</button>
          )}
          <button
            onClick={p.onNavigate}
            className="h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5"
          ><Navigation2 size={14} /> Navigate</button>
        </div>

        <div className="flex items-center gap-2 min-w-0">
          {crew ? (
            <>
              {crew.type === 'cart' && crew.cart.isRcCart && <Truck size={13} className="text-orange-400 flex-shrink-0" />}
              <span className="text-white font-bold text-sm truncate">{crewLabel(crew, true)}</span>
              <ActivityBadge lastMs={crewLastMs(crew, p.knock)} nowMs={p.activityNow} />
              <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                {members.filter(m => m.cellPhone).slice(0, 3).map(m => (
                  <a key={m.contractorId} href={`tel:${m.cellPhone}`} className="h-7 px-2 rounded-md bg-green-900/50 hover:bg-green-800 text-green-200 text-[11px] font-bold flex items-center gap-1" title={`Call ${m.firstName} · ${m.cellPhone}`}>
                    <Phone size={11} /> {m.firstName}
                  </a>
                ))}
              </div>
            </>
          ) : (
            <span className="text-amber-400 font-bold text-xs">⚠ Nobody on {route?.displayRouteCode || 'this route'} yet</span>
          )}
        </div>

        {cm && (
          <div className="flex items-center gap-3 text-[11px] text-gray-300">
            <span>Steps <b className="text-white">{cm.steps}</b><span className="text-yellow-400 font-bold">+{cm.pending}</span></span>
            <span>$ <b className="text-white">{money(cm.gross, true).slice(1)}</b><span className="text-yellow-400 font-bold">+{money(cm.pendingGross, true).slice(1)}</span></span>
            <span>EQ <b className="text-white">{cm.eq.toFixed(1)}</b></span>
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto">
          <TabBtn on={tab === 'logsheet'} onClick={() => setTab('logsheet')} disabled={!crew}>Logsheet</TabBtn>
          <TabBtn on={tab === 'stats'} onClick={() => setTab('stats')}>Stats</TabBtn>
          <TabBtn on={tab === 'prebooks'} onClick={() => setTab('prebooks')} disabled={!route}>
            Prebooks {p.routeBookings.length > 0 && <span className="opacity-70">{p.routeBookings.length}</span>}
          </TabBtn>
          <TabBtn on={false} onClick={p.onOpenPcl} disabled={!route}>PCL {p.pclCount > 0 && <span className="opacity-70">{p.pclCount}</span>}</TabBtn>
        </div>
      </div>

      {/* BODY */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {tab === 'logsheet' && crew && (
          <div className="p-3 space-y-3">{p.logsheet(crew)}</div>
        )}

        {/* STATS — the cart's map panel stays mounted (it draws the house tiles). */}
        <div className={tab === 'stats' ? 'p-3 space-y-3' : 'hidden'}>
          {crew && cm && (
            <div className="grid grid-cols-3 gap-1.5">
              <StatBox label="Steps" value={cm.steps} />
              <StatBox label="Pending" value={cm.pending} tone="text-yellow-400" />
              <StatBox label="EQ" value={cm.eq.toFixed(1)} />
              <StatBox label="Done $" value={money(cm.gross)} />
              <StatBox label="Pending $" value={money(cm.pendingGross)} tone="text-yellow-400" />
              <StatBox
                label="Upsells"
                value={crew.type === 'cart' ? `${crew.cart.stats.upsellCount} · ${money(crew.cart.stats.upsellGross)}` : `${crew.card.stats.upsellCount} · ${money(crew.card.stats.upsellGross)}`}
                tone="text-purple-300"
              />
            </div>
          )}
          {p.cartPanelNode ? (
            <div className="-mx-3 border-t border-gray-800">{p.cartPanelNode}</div>
          ) : knock && (
            <div className="text-[11px] text-gray-300 flex flex-wrap gap-x-2">
              <span>{knock.knocks} knocks</span><span className="text-red-400">{knock.no} no</span>
              <span className="text-orange-300">{knock.goBack} GB</span><span className="text-pink-300">{knock.invalid} inv</span>
              <span className="text-blue-300">{knock.total ? `${Math.round(knock.pct * 100)}% cov` : '— cov'}</span>
            </div>
          )}
          {route && (
            <div className="grid grid-cols-3 gap-1.5">
              <StatBox label="Jobs" value={route.prebookCount} />
              <StatBox label="Prepaid" value={route.prepayCount} />
              <StatBox label="Route EQ" value={route.totalEQ.toFixed(1)} />
            </div>
          )}
          {crew && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => p.onViewLogsheet(crew)} className="h-10 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-xs font-bold flex items-center justify-center gap-2">
                <FileText size={14} /> Open full logsheet
              </button>
              {crew.type === 'cart' && p.isSealing ? (
                <BottleCounter cart={crew.cart} saving={p.bottleSavingId === crew.cart.sessionId} onAdjust={d => p.onAdjustBottles(crew.cart, d)} />
              ) : crew.type === 'worker' ? (
                <button
                  onClick={() => p.onToggleUpsells(crew.card)}
                  className={`h-10 rounded-lg text-xs font-bold border ${crew.card.upsellsEnabled ? 'bg-green-900/40 border-green-700 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-300'}`}
                >{crew.card.upsellsEnabled ? 'Upsells ✓' : 'Upsells ✗'}</button>
              ) : <span />}
            </div>
          )}
        </div>

        {tab === 'prebooks' && (
          <div className="p-3 space-y-1.5">
            {p.routeBookings.length === 0 && <div className="text-xs text-gray-500 py-3">No pending prebooks on this route.</div>}
            {p.routeBookings.map(b => {
              const name = `${b['First Name'] || ''} ${b['Last Name'] || ''}`.trim() || '(no name)';
              const phone = String(b['Cell Phone'] || b['Home Phone'] || '').trim();
              return (
                <div key={b['Booking ID']} className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
                  <button onClick={() => p.onShowBooking(b['Booking ID'])} className="min-w-0 flex-1 text-left" title="Show on the map">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-white truncate">{name}</span>
                      {b.Prepaid === 'x' && <span className="text-[9px] font-bold bg-green-900/60 text-green-300 rounded px-1">PREPAID</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">{b['Full Address'] || ''}</div>
                  </button>
                  {b.Price && <span className="text-xs font-mono font-bold text-green-400 flex-shrink-0">{String(b.Price).startsWith('$') || /^[A-Za-z]+$/.test(String(b.Price)) ? b.Price : `$${b.Price}`}</span>}
                  {phone && (
                    <a href={`tel:${phone}`} className="w-8 h-8 rounded-full bg-green-800 text-green-100 flex items-center justify-center flex-shrink-0" title={phone}><Phone size={13} /></a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const BottleCounter: React.FC<{ cart: CartCardData; saving: boolean; onAdjust: (d: number) => void }> = ({ cart, saving, onAdjust }) => {
  const locked = cart.sessionStatus === 'PAID';
  return (
    <div className={`h-10 rounded-lg border flex items-center justify-between overflow-hidden ${locked ? 'bg-gray-800 border-gray-700 text-gray-500' : 'bg-slate-800 border-slate-600 text-slate-100'}`}>
      <button onClick={() => onAdjust(-1)} disabled={locked || saving || cart.crackfillerBottles === 0} className="w-10 h-full flex items-center justify-center disabled:opacity-30"><Minus size={14} /></button>
      <span className="flex items-center gap-1.5 text-xs font-bold">
        {saving ? <Loader size={13} className="animate-spin" /> : <FlaskConical size={13} />} {cart.crackfillerBottles}
      </span>
      <button onClick={() => onAdjust(1)} disabled={locked || saving} className="w-10 h-full flex items-center justify-center disabled:opacity-30"><Plus size={14} /></button>
    </div>
  );
};

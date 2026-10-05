// src/pages/Management/mobile/RMPhoneLayout.tsx
//
// The Route Manager map, phone layout. Same engine as the desktop tab — this
// component is only the screen: RMMapTab owns the map, the data and every
// action, and hands them over in `ctx`. Three states:
//
//   ① MAP      one-line team header · full map · team drawer · hamburger
//   ② ROUTE    ‹ route header with the cart's numbers, Assign + Navigate ·
//              map zoomed to the route (house tiles on map-logsheet carts) ·
//              drawer with the route's stats / logsheet / prebooks / PCL
//   ③ NAVIGATE turn-by-turn, driver's-eye (PhoneNavigation)
//
// Tapping a route on the map, or a cart in the drawer, goes ① → ②. ‹ goes
// back. Navigate goes to ③; End comes back to where you were.

import React, { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Menu, BarChart3, Layers, MapPin, Users, Shovel, CreditCard, Trophy, Lock, Unlock, Monitor,
  Navigation, Navigation2, ChevronLeft, ChevronDown, Phone, FileText, Truck, AlertTriangle, Loader,
  Compass, Clock, CheckCircle2, History, X, ArrowUpDown, Trash2, Mail, Check, Minus, Plus, FlaskConical,
} from 'lucide-react';
import type { MasterBooking } from '../../../types';
import type { MapPin as MapPinRecord } from '../../../lib/sessionService';
import type { FilterVisibility, GeocodeProgress } from '../RMLogbook';
import type { CartCardData, WorkerCardData, RouteCardData } from '../components/RMMapTab';
import { ActivityBadge, latestMs, computeRedFlags } from '../components/rmMapShared';
import PhoneDrawer, { DrawerSnap } from './PhoneDrawer';
import { PhoneSheet, Tile } from './PhoneSheet';
import PhoneNavigation, { PhoneNavDestination } from './PhoneNavigation';
import { money, safeAreaTop, installPixelRatioCap } from './rmPhone';

// ---------------------------------------------------------------------------
// Types shared with RMMapTab / RMLogbook
// ---------------------------------------------------------------------------

/** What RMLogbook hands the phone layout (the desktop header's contents). */
export interface RMPhoneShell {
  header: {
    isTeamSeason: boolean;
    done: number;             // completed jobs today (Production + Sale)
    pendingSales: number;     // parked sales
    prebooks: number;         // office prebooks still to do
    gross: number;            // completed $
    pendingGross: number;     // pending $
    pending: number;          // aeration: pending total
    upsellGross: number;      // aeration: upsell $
  };
  statsPanel: React.ReactNode;
  battleCards: React.ReactNode;
  onToggleFilter: (k: keyof FilterVisibility) => void;
  onToggleFollowMe: () => void;
  onTogglePinMode: () => void;
  isTeamLocked: boolean;
  lockLoading: boolean;
  onToggleLock: () => void;
  onOpenTransactions: () => void;
  isSealing: boolean;
  unassignedAsphaltCount: number;
  onOpenAsphalt: () => void;
  onOpenManageTeam: () => void;
  onDesktopView: () => void;
  userName: string;
  coveringNames: string[];
}

export type PhoneCrew =
  | { type: 'cart'; key: string; cart: CartCardData }
  | { type: 'worker'; key: string; card: WorkerCardData };

export interface PhoneRouteState { routeCode: string | null; letter?: string; crewKey?: string; }

export interface PhonePinCardData {
  kind: 'pending' | 'completed' | 'new_sale' | 'upsell';
  name: string; address: string; routeCode: string; routeColor: string;
  phone?: string; email?: string; price?: string; paymentMethod?: string;
  confirmed?: boolean; upsell?: { name: string; price: string } | null;
  lat: number; lng: number;
}

export interface KnockSummary {
  knocks: number; no: number; goBack: number; invalid: number; touched: number; total: number; pct: number;
  last: { lat: number; lng: number; address: string; t: number } | null;
}

export interface CrewMoney { steps: number; pending: number; gross: number; pendingGross: number; eq: number; }

export type SortOption = 'recent' | 'alpha' | 'steps' | 'equiv' | 'upGross';

export interface RMPhoneCtx {
  shell: RMPhoneShell;
  mapContainerRef: React.RefObject<HTMLDivElement>;
  map: mapboxgl.Map | null;
  mapLoaded: boolean;
  isTeamSeason: boolean;
  isSealing: boolean;
  routesLoading: boolean;
  noGeometry: boolean;
  compassNeedsPermission: boolean;
  onEnableCompass: () => void;
  activityNow: number;
  filterVisibility: FilterVisibility;
  geocodeProgress: GeocodeProgress;
  centerOnLocation: boolean;
  pinMode: boolean;

  // ① team
  sortBy: SortOption;
  onSortBy: (s: SortOption) => void;
  carts: CartCardData[];
  workers: WorkerCardData[];
  knock: Map<string, KnockSummary>;
  crewMoney: (crew: PhoneCrew) => CrewMoney;
  onEnterCrew: (key: string) => void;
  onRouteCrewLabel: string | null;
  onOnRouteTap: () => void;

  // ② route
  phoneRoute: PhoneRouteState | null;
  route: RouteCardData | null;
  crew: PhoneCrew | null;
  crewRoutes: Array<{ routeCode: string; letter?: string; display: string; color: string }>;
  onEnterRoute: (routeCode: string, letter?: string) => void;
  onExitRoute: () => void;
  onAssign: () => void;
  onNavigateCrew: () => void;
  canNavigateCrew: boolean;
  onNavigateRoute: () => void;
  onViewLogsheet: (crew: PhoneCrew) => void;
  cartPanelNode: React.ReactNode | null;
  cartDetails: (cart: CartCardData) => React.ReactNode;
  workerJobs: (card: WorkerCardData) => React.ReactNode;
  routeBookings: MasterBooking[];
  onShowBooking: (bookingId: string) => void;
  pclCount: number;
  onOpenPcl: () => void;
  bottleSavingId: string | null;
  onAdjustBottles: (cart: CartCardData, delta: number) => void;
  onToggleUpsells: (card: WorkerCardData) => void;

  // pins
  pin: PhonePinCardData | null;
  onClosePin: () => void;
  mapPin: MapPinRecord | null;
  onCloseMapPin: () => void;
  currentUserId: string;
  managerName: (id: string | null | undefined) => string;
  onNavigateToPoint: (dest: PhoneNavDestination) => void;
  onNavigateToMapPin: (pin: MapPinRecord) => void;
  onRemoveMapPin: (pin: MapPinRecord) => void;

  // ③ navigation
  nav: PhoneNavDestination | null;
  onNavEnd: () => void;
  onNavArrived: () => void;

  /** Drawer settled height, so the map keeps its centre above it. */
  onDrawerHeight: (h: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function crewLabel(crew: PhoneCrew, full = false): string {
  if (crew.type === 'cart') {
    const m = crew.cart.members;
    if (m.length > 1) return m.map(x => x.firstName).join(' & ');
    if (!m[0]) return crew.cart.teamId;
    return full ? `${m[0].firstName} ${m[0].lastName}` : `${m[0].firstName} ${(m[0].lastName || '').charAt(0)}.`.trim();
  }
  const w = crew.card.worker;
  return full ? `${w.firstName} ${w.lastName}` : `${w.firstName} ${(w.lastName || '').charAt(0)}.`.trim();
}

const HEADER_H = 48;
const PEEK_MAP = 96;
const PEEK_ROUTE = 108;

const SORT_LABEL: Record<SortOption, string> = {
  recent: 'Most recent', alpha: 'A–Z', steps: 'Steps', equiv: 'EQ', upGross: 'Upsell $',
};

type SheetKind = 'menu' | 'stats' | 'layers' | 'battle' | 'routes' | 'sort' | null;
type RouteTab = 'stats' | 'logsheet' | 'prebooks';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RMPhoneLayout: React.FC<{ ctx: RMPhoneCtx }> = ({ ctx }) => {
  const { shell } = ctx;
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [mapSnap, setMapSnap] = useState<DrawerSnap>('peek');
  const [routeSnap, setRouteSnap] = useState<DrawerSnap>('half');
  const [routeTab, setRouteTab] = useState<RouteTab>('stats');
  const [drawerH, setDrawerH] = useState(PEEK_MAP);

  // Notch height; measured once viewport-fit=cover is on (set just below).
  const [safeTop, setSafeTop] = useState(0);
  const inRoute = !!ctx.phoneRoute;
  const navigating = !!ctx.nav;

  // Full-bleed phone page: no page zoom, no pinch-zoom of the page, and the
  // Android GPU pixel-ratio cap the map logsheet uses. Restored on leave.
  useEffect(() => {
    document.documentElement.classList.add('map-fullbleed');
    const restoreRatio = installPixelRatioCap();
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const previous = meta?.getAttribute('content') || 'width=device-width, initial-scale=1.0';
    meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    const raf = requestAnimationFrame(() => setSafeTop(safeAreaTop()));
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove('map-fullbleed');
      restoreRatio();
      meta?.setAttribute('content', previous);
    };
  }, []);

  // New route → back to its Stats tab, drawer at half.
  const routeKey = ctx.phoneRoute ? `${ctx.phoneRoute.routeCode}|${ctx.phoneRoute.letter || ''}|${ctx.phoneRoute.crewKey || ''}` : '';
  useEffect(() => { if (routeKey) { setRouteTab('stats'); setRouteSnap('half'); } }, [routeKey]);

  // Leaving pin mode / route state closes stray sheets.
  useEffect(() => { setSheet(null); }, [inRoute]);

  const reportHeight = (h: number) => { setDrawerH(h); ctx.onDrawerHeight(h); };

  const liveCount = useMemo(() => {
    if (ctx.isTeamSeason) {
      return ctx.carts.filter(c => {
        const t = latestMs(c.lastActiveTimestamp, ctx.knock.get(c.sessionId)?.last?.t);
        return t != null && ctx.activityNow - t < 3 * 60000;
      }).length;
    }
    return ctx.workers.filter(w => {
      const t = latestMs(w.lastActiveTimestamp);
      return t != null && ctx.activityNow - t < 3 * 60000;
    }).length;
  }, [ctx.carts, ctx.workers, ctx.knock, ctx.activityNow, ctx.isTeamSeason]);

  const crews: PhoneCrew[] = useMemo(() => (
    ctx.isTeamSeason
      ? ctx.carts.map(c => ({ type: 'cart' as const, key: `cart:${c.sessionId}`, cart: c }))
      : ctx.workers.map(w => ({ type: 'worker' as const, key: `worker:${w.worker.contractorId}`, card: w }))
  ), [ctx.carts, ctx.workers, ctx.isTeamSeason]);

  const crewLastMs = (crew: PhoneCrew) => crew.type === 'cart'
    ? latestMs(crew.cart.lastActiveTimestamp, ctx.knock.get(crew.cart.sessionId)?.last?.t)
    : latestMs(crew.card.lastActiveTimestamp);

  // -------------------------------------------------------------------------
  // HEADERS
  // -------------------------------------------------------------------------

  const h = shell.header;
  const mapHeader = (
    <button
      onClick={() => setSheet('stats')}
      className="absolute inset-x-0 top-0 z-30 bg-gray-950/95 border-b border-gray-800 flex items-center px-2 text-left"
      style={{ height: HEADER_H + safeTop, paddingTop: safeTop }}
    >
      <div className="flex items-center min-w-0 flex-1 overflow-hidden whitespace-nowrap">
        <HeaderGroup label="Done"><b className="text-white">{h.done}</b></HeaderGroup>
        {h.isTeamSeason ? (
          <>
            <HeaderGroup label="Sales/PB">
              <b className="text-yellow-400">{h.pendingSales}</b>
              <span className="text-gray-500 mx-0.5">/</span>
              <b className="text-green-400">{h.prebooks}</b>
            </HeaderGroup>
            <HeaderGroup label="$" last>
              <b className="text-white">{money(h.gross, true)}</b>
              <span className="text-yellow-400 text-[12px] font-bold ml-1">+{money(h.pendingGross, true).slice(1)}</span>
            </HeaderGroup>
          </>
        ) : (
          <>
            <HeaderGroup label="Pend"><b className="text-yellow-400">{h.pending}</b></HeaderGroup>
            <HeaderGroup label="Up $" last><b className="text-purple-300">{money(h.upsellGross, true)}</b></HeaderGroup>
          </>
        )}
      </div>
      <ChevronDown size={16} className="text-gray-500 flex-shrink-0 ml-1" />
    </button>
  );

  const crew = ctx.crew;
  const cm = crew ? ctx.crewMoney(crew) : null;
  const route = ctx.route;
  const assigned = !!route?.isAssigned;
  const routeHeader = (
    <div
      className="absolute inset-x-0 top-0 z-30 bg-gray-950/95 border-b border-gray-800 flex items-center gap-1 px-1"
      style={{ height: HEADER_H + safeTop, paddingTop: safeTop }}
    >
      <button onClick={ctx.onExitRoute} className="w-10 h-10 flex items-center justify-center text-white flex-shrink-0" aria-label="Back to map">
        <ChevronLeft size={26} />
      </button>
      <button
        onClick={() => ctx.crewRoutes.length > 1 && setSheet('routes')}
        className="flex items-center gap-1 flex-shrink-0 min-w-0"
      >
        {route ? (
          <span className="h-7 px-2 rounded-md text-white text-[13px] font-extrabold flex items-center" style={{ background: route.routeColor }}>
            {route.displayRouteCode}
          </span>
        ) : (
          <span className="h-7 px-2 rounded-md bg-gray-700 text-gray-200 text-[12px] font-bold flex items-center">No route</span>
        )}
        {ctx.crewRoutes.length > 1 && <ChevronDown size={14} className="text-gray-400" />}
      </button>
      <div className="flex items-center min-w-0 flex-1 overflow-hidden whitespace-nowrap ml-1">
        {cm ? (
          <>
            <HeaderGroup label="St" compact>
              <b className="text-white">{cm.steps}</b><span className="text-yellow-400 text-[11px] font-bold">+{cm.pending}</span>
            </HeaderGroup>
            <HeaderGroup label="$" last compact>
              <b className="text-white">{money(cm.gross, true).slice(1)}</b><span className="text-yellow-400 text-[11px] font-bold">+{money(cm.pendingGross, true).slice(1)}</span>
            </HeaderGroup>
          </>
        ) : (
          <span className="text-amber-400 text-xs font-bold px-1">Unassigned</span>
        )}
      </div>
      {route && (
        <button
          onClick={ctx.onAssign}
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${assigned ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-amber-700 border-amber-400 text-white animate-pulse'}`}
          aria-label="Assign route"
        ><Users size={18} /></button>
      )}
      <button
        onClick={() => (crew && ctx.canNavigateCrew ? ctx.onNavigateCrew() : ctx.onNavigateRoute())}
        className="w-10 h-10 rounded-xl bg-blue-600 border border-blue-400 text-white flex items-center justify-center flex-shrink-0"
        aria-label="Navigate"
      ><Navigation2 size={18} /></button>
    </div>
  );

  // -------------------------------------------------------------------------
  // DRAWER ①: TEAM
  // -------------------------------------------------------------------------

  const teamHeader = (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
        <span className="text-white font-bold text-sm">Team</span>
        <span>· {crews.length} {ctx.isTeamSeason ? (crews.length === 1 ? 'cart' : 'carts') : (crews.length === 1 ? 'worker' : 'workers')}</span>
        {liveCount > 0 && <span className="text-green-400">· {liveCount} live</span>}
        <button onClick={() => setSheet('sort')} className="ml-auto flex items-center gap-1 text-gray-300 bg-gray-800 rounded-full px-2.5 py-1">
          <ArrowUpDown size={12} /> {SORT_LABEL[ctx.sortBy]}
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-3 px-3 touch-pan-x">
        {crews.length === 0 && <span className="text-xs text-gray-500">Nobody on your team yet today.</span>}
        {crews.map(c => (
          <button
            key={c.key}
            onClick={() => ctx.onEnterCrew(c.key)}
            className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-full pl-2.5 pr-3 py-1.5 text-xs font-bold text-white active:bg-gray-700"
          >
            {c.type === 'cart' && c.cart.isRcCart && <Truck size={11} className="text-orange-400" />}
            <span className="truncate max-w-[120px]">{crewLabel(c)}</span>
            <ActivityBadge lastMs={crewLastMs(c)} nowMs={ctx.activityNow} />
          </button>
        ))}
      </div>
    </div>
  );

  const teamBody = (
    <div className="px-2.5 pb-4 space-y-2">
      {crews.map(c => <CrewCard key={c.key} crew={c} ctx={ctx} lastMs={crewLastMs(c)} onTap={() => ctx.onEnterCrew(c.key)} />)}
    </div>
  );

  // -------------------------------------------------------------------------
  // DRAWER ②: ROUTE
  // -------------------------------------------------------------------------

  const routeDrawerHeader = (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {crew ? (
          <>
            {crew.type === 'cart' && crew.cart.isRcCart && <Truck size={14} className="text-orange-400 flex-shrink-0" />}
            <span className="text-white font-bold text-[15px] truncate">{crewLabel(crew, true)}</span>
            <ActivityBadge lastMs={crewLastMs(crew)} nowMs={ctx.activityNow} />
            {(() => {
              const fs = crew.type === 'cart' ? crew.cart.sharedFinancialStore : crew.card.financialStore;
              const { hasFlag, flags } = computeRedFlags(fs);
              return hasFlag ? <span title={flags.join(', ')} className="text-red-400"><AlertTriangle size={14} /></span> : null;
            })()}
            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
              {(crew.type === 'cart' ? crew.cart.members : [crew.card.worker]).filter(m => m.cellPhone).slice(0, 3).map(m => (
                <a key={m.contractorId} href={`tel:${m.cellPhone}`} className="w-8 h-8 rounded-full bg-green-800 text-green-100 flex items-center justify-center" title={`Call ${m.firstName}`}>
                  <Phone size={14} />
                </a>
              ))}
            </div>
          </>
        ) : (
          <span className="text-amber-400 font-bold text-sm">⚠ Nobody on {route?.displayRouteCode || 'this route'} yet</span>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar touch-pan-x">
        <TabPill on={routeTab === 'stats'} onClick={() => { setRouteTab('stats'); if (routeSnap === 'peek') setRouteSnap('half'); }}>Stats</TabPill>
        <TabPill on={routeTab === 'logsheet'} onClick={() => { setRouteTab('logsheet'); if (routeSnap === 'peek') setRouteSnap('half'); }} disabled={!crew}>Logsheet</TabPill>
        <TabPill on={routeTab === 'prebooks'} onClick={() => { setRouteTab('prebooks'); if (routeSnap === 'peek') setRouteSnap('half'); }} disabled={!route}>
          Prebooks {ctx.routeBookings.length > 0 && <span className="opacity-70">{ctx.routeBookings.length}</span>}
        </TabPill>
        <TabPill on={false} onClick={ctx.onOpenPcl} disabled={!route}>PCL {ctx.pclCount > 0 && <span className="opacity-70">{ctx.pclCount}</span>}</TabPill>
      </div>
    </div>
  );

  const routeSummary = route && (
    <div className="grid grid-cols-3 gap-1.5">
      <StatBox label="Jobs" value={route.prebookCount} />
      <StatBox label="Prepaid" value={route.prepayCount} />
      <StatBox label="Route EQ" value={route.totalEQ.toFixed(1)} />
    </div>
  );

  const crewStats = crew && cm && (
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
  );

  const knock = crew?.type === 'cart' ? ctx.knock.get(crew.cart.sessionId) : undefined;

  const routeBody = (
    <div className="px-3 pb-4">
      {/* STATS — CartMapPanel stays mounted (it draws the house tiles), just hidden on other tabs. */}
      <div className={routeTab === 'stats' ? 'space-y-3' : 'hidden'}>
        {crewStats}
        {ctx.cartPanelNode ? (
          <div className="-mx-3 border-t border-gray-800">{ctx.cartPanelNode}</div>
        ) : (
          <>
            {knock && (
              <div className="text-[11px] text-gray-300 flex flex-wrap gap-x-2">
                <span>{knock.knocks} knocks</span><span className="text-red-400">{knock.no} no</span>
                <span className="text-orange-300">{knock.goBack} GB</span><span className="text-pink-300">{knock.invalid} inv</span>
                <span className="text-blue-300">{knock.total ? `${Math.round(knock.pct * 100)}% cov` : '— cov'}</span>
              </div>
            )}
            {routeSummary}
          </>
        )}
        {ctx.cartPanelNode && routeSummary}
        {crew && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => ctx.onViewLogsheet(crew)} className="h-11 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm font-bold flex items-center justify-center gap-2 active:bg-gray-700">
              <FileText size={16} /> Open logsheet
            </button>
            {crew.type === 'cart' && ctx.isSealing ? (
              <BottleCounter cart={crew.cart} saving={ctx.bottleSavingId === crew.cart.sessionId} onAdjust={d => ctx.onAdjustBottles(crew.cart, d)} />
            ) : crew.type === 'worker' ? (
              <button
                onClick={() => ctx.onToggleUpsells(crew.card)}
                className={`h-11 rounded-xl text-sm font-bold border ${crew.card.upsellsEnabled ? 'bg-green-900/40 border-green-700 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-300'}`}
              >{crew.card.upsellsEnabled ? 'Upsells ✓' : 'Upsells ✗'}</button>
            ) : <span />}
          </div>
        )}
      </div>

      {routeTab === 'logsheet' && crew && (
        <div className="space-y-3">
          {crew.type === 'cart' ? ctx.cartDetails(crew.cart) : ctx.workerJobs(crew.card)}
        </div>
      )}

      {routeTab === 'prebooks' && (
        <div className="space-y-1.5">
          {ctx.routeBookings.length === 0 && <div className="text-xs text-gray-500 py-3">No pending prebooks on this route.</div>}
          {ctx.routeBookings.map(b => {
            const name = `${b['First Name'] || ''} ${b['Last Name'] || ''}`.trim() || '(no name)';
            const phone = String(b['Cell Phone'] || b['Home Phone'] || '').trim();
            return (
              <div key={b['Booking ID']} className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 flex items-center gap-2">
                <button onClick={() => ctx.onShowBooking(b['Booking ID'])} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-white truncate">{name}</span>
                    {b.Prepaid === 'x' && <span className="text-[9px] font-bold bg-green-900/60 text-green-300 rounded px-1">PREPAID</span>}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">{b['Full Address'] || ''}</div>
                </button>
                {b.Price && <span className="text-xs font-mono font-bold text-green-400 flex-shrink-0">{String(b.Price).startsWith('$') || /^[A-Za-z]+$/.test(String(b.Price)) ? b.Price : `$${b.Price}`}</span>}
                {phone && (
                  <a href={`tel:${phone}`} className="w-9 h-9 rounded-full bg-green-800 text-green-100 flex items-center justify-center flex-shrink-0"><Phone size={15} /></a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // -------------------------------------------------------------------------
  // FLOATING: pin card, hamburger, follow-me, on-route pill
  // -------------------------------------------------------------------------

  const pinCard = !navigating && (ctx.pin || ctx.mapPin) && (
    <div className="absolute inset-x-3 z-30" style={{ bottom: drawerH + 10 }}>
      {ctx.pin ? <BookingPinCard pin={ctx.pin} onClose={ctx.onClosePin} onNavigate={() => ctx.onNavigateToPoint({ lat: ctx.pin!.lat, lng: ctx.pin!.lng, label: ctx.pin!.name !== 'Unknown' ? ctx.pin!.name : ctx.pin!.address })} />
        : ctx.mapPin && (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-3">
            <div className="flex items-center gap-2">
              <MapPin size={18} className="text-purple-400 flex-shrink-0" />
              <div className="text-white font-bold text-[15px] truncate flex-1">{ctx.mapPin.label}</div>
              <button onClick={ctx.onCloseMapPin} className="w-8 h-8 -mr-1 flex items-center justify-center text-gray-400"><X size={18} /></button>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {ctx.mapPin.visibility === 'private' ? 'Only you can see this pin.'
                : ctx.mapPin.visibility === 'all' ? 'Visible to every manager.'
                : `Sent to ${ctx.managerName(ctx.mapPin.targetManagerId)}.`}
              {ctx.mapPin.createdBy !== ctx.currentUserId && ' Dropped by someone else.'}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              {ctx.mapPin.createdBy === ctx.currentUserId ? (
                <button onClick={() => ctx.onRemoveMapPin(ctx.mapPin!)} className="h-11 rounded-xl bg-red-900/40 border border-red-800 text-red-200 text-sm font-bold flex items-center justify-center gap-1.5"><Trash2 size={15} /> Remove</button>
              ) : <span />}
              <button onClick={() => ctx.onNavigateToMapPin(ctx.mapPin!)} className="h-11 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-1.5"><Navigation2 size={15} /> Navigate</button>
            </div>
          </div>
        )}
    </div>
  );

  const fabBottom = drawerH + 12;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none rm-phone">
      <style>{`
        .rm-phone .mapboxgl-ctrl-bottom-left, .rm-phone .mapboxgl-ctrl-bottom-right { display: none; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { scrollbar-width: none; }
      `}</style>

      {/* MAP — full screen under everything */}
      <div ref={ctx.mapContainerRef} className="absolute inset-0 bg-gray-900" />

      {navigating && ctx.map ? (
        <PhoneNavigation key={`${ctx.nav!.lat},${ctx.nav!.lng}`} map={ctx.map} destination={ctx.nav!} onArrived={ctx.onNavArrived} onCancel={ctx.onNavEnd} />
      ) : (
        <>
          {inRoute ? routeHeader : mapHeader}

          {/* status chips under the header */}
          <div className="absolute inset-x-0 z-20 flex flex-col items-center gap-1.5 pointer-events-none" style={{ top: HEADER_H + safeTop + 8 }}>
            {ctx.routesLoading && (
              <span className="bg-gray-900/90 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-2 shadow"><Loader size={12} className="animate-spin" /> Loading routes…</span>
            )}
            {ctx.noGeometry && (
              <span className="bg-amber-900/90 text-amber-100 text-xs px-3 py-1.5 rounded-full shadow">No approved route maps yet</span>
            )}
            {ctx.pinMode && (
              <span className="bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow">Tap the map to drop a pin</span>
            )}
            {ctx.compassNeedsPermission && (
              <button onClick={ctx.onEnableCompass} className="pointer-events-auto bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow flex items-center gap-1.5"><Compass size={13} /> Enable compass</button>
            )}
          </div>

          {/* follow me */}
          <button
            onClick={shell.onToggleFollowMe}
            className={`absolute left-3 z-20 w-11 h-11 rounded-full shadow-xl flex items-center justify-center ${ctx.centerOnLocation ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'bg-[#ffffff] text-[#1f2937]'}`}
            style={{ top: HEADER_H + safeTop + 10 }}
            aria-label={ctx.centerOnLocation ? 'Stop following me' : 'Follow me'}
          ><Navigation size={19} className={ctx.centerOnLocation ? 'fill-current' : ''} /></button>

          {/* on-route pill (① only) */}
          {!inRoute && mapSnap !== 'full' && ctx.onRouteCrewLabel && !ctx.pin && !ctx.mapPin && (
            <button
              onClick={ctx.onOnRouteTap}
              className="absolute left-1/2 -translate-x-1/2 z-20 bg-gray-900/95 border border-blue-500/60 rounded-full shadow-xl px-4 py-2 flex items-center gap-2 max-w-[70%]"
              style={{ bottom: fabBottom }}
            >
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
              <span className="text-[10px] text-blue-300 font-bold uppercase">On route</span>
              <span className="text-white text-sm font-bold truncate">{ctx.onRouteCrewLabel}</span>
            </button>
          )}

          {/* hamburger (① only) — becomes Cancel while dropping pins */}
          {ctx.pinMode && !ctx.pin && !ctx.mapPin && (
            <button
              onClick={shell.onTogglePinMode}
              className="absolute right-3 z-20 h-12 px-5 rounded-full bg-purple-600 text-white font-bold text-sm shadow-xl flex items-center gap-2"
              style={{ bottom: Math.min(fabBottom, 420) }}
            ><X size={16} /> Done</button>
          )}
          {!inRoute && !ctx.pinMode && !ctx.pin && !ctx.mapPin && mapSnap !== 'full' && (
            <button
              onClick={() => setSheet('menu')}
              className="absolute right-3 z-20 w-14 h-14 rounded-full bg-gray-900 border border-gray-700 text-white shadow-xl flex items-center justify-center"
              style={{ bottom: fabBottom }}
              aria-label="Menu"
            >
              <Menu size={24} />
              {shell.isSealing && shell.unassignedAsphaltCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-black text-[11px] font-extrabold flex items-center justify-center">{shell.unassignedAsphaltCount}</span>
              )}
            </button>
          )}

          {pinCard}

          {/* DRAWER */}
          {inRoute ? (
            <PhoneDrawer key="route" snap={routeSnap} onSnap={setRouteSnap} peek={PEEK_ROUTE} topGap={HEADER_H + safeTop + 6} header={routeDrawerHeader} onHeight={reportHeight}>
              {routeBody}
            </PhoneDrawer>
          ) : (
            <PhoneDrawer key="map" snap={mapSnap} onSnap={setMapSnap} peek={PEEK_MAP} topGap={HEADER_H + safeTop + 6} header={teamHeader} onHeight={reportHeight}>
              {teamBody}
            </PhoneDrawer>
          )}
        </>
      )}

      {/* SHEETS */}
      {sheet === 'menu' && (
        <PhoneSheet
          title={<span className="text-xs text-gray-400 font-normal">{shell.userName}{shell.coveringNames.length > 0 && <> · covering {shell.coveringNames.join(', ')}</>}</span>}
          onClose={() => setSheet(null)}
        >
          <div className="grid grid-cols-3 gap-2.5 pb-1">
            <Tile icon={BarChart3} label="Stats" iconClass="text-green-300" onClick={() => setSheet('stats')} />
            <Tile icon={Layers} label="Layers" iconClass="text-sky-300" onClick={() => setSheet('layers')} />
            <Tile icon={MapPin} label="Drop Pin" iconClass="text-purple-300" active={ctx.pinMode} onClick={() => { setSheet(null); shell.onTogglePinMode(); }} />
            <Tile icon={Users} label="Manage Team" iconClass="text-blue-300" onClick={() => { setSheet(null); shell.onOpenManageTeam(); }} />
            <Tile icon={Shovel} label="Asphalt" iconClass="text-amber-300" disabled={!shell.isSealing}
              onClick={() => { setSheet(null); shell.onOpenAsphalt(); }}
              badge={shell.isSealing && shell.unassignedAsphaltCount > 0 ? String(shell.unassignedAsphaltCount) : null} badgeClass="bg-amber-500 text-black" />
            <Tile icon={CreditCard} label="Card Txns" iconClass="text-emerald-300" onClick={() => { setSheet(null); shell.onOpenTransactions(); }} />
            <Tile icon={Trophy} label="Team Battle" iconClass="text-yellow-300" onClick={() => setSheet('battle')} />
            <Tile icon={shell.isTeamLocked ? Lock : Unlock} label={shell.lockLoading ? '…' : shell.isTeamLocked ? 'Team Locked' : 'Team Lock'}
              iconClass={shell.isTeamLocked ? 'text-red-400' : 'text-gray-300'} active={shell.isTeamLocked} onClick={shell.onToggleLock} disabled={shell.lockLoading} />
            <Tile icon={Monitor} label="Desktop view" iconClass="text-gray-300" onClick={() => { setSheet(null); shell.onDesktopView(); }} />
          </div>
        </PhoneSheet>
      )}

      {sheet === 'stats' && (
        <PhoneSheet title="Today's team stats" onClose={() => setSheet(null)}>
          <div className="pb-2">{shell.statsPanel}</div>
        </PhoneSheet>
      )}

      {sheet === 'layers' && (
        <PhoneSheet title="Map layers" onClose={() => setSheet(null)}>
          <div className="space-y-2 pb-2">
            <LayerRow icon={Clock} label="Pending prebooks" on={ctx.filterVisibility.pendingBookings} progress={ctx.geocodeProgress.pendingBookings} onToggle={() => shell.onToggleFilter('pendingBookings')} />
            <LayerRow icon={CheckCircle2} label="Sales & completed" on={ctx.filterVisibility.pendingSalesAndCompleted} progress={ctx.geocodeProgress.pendingSalesAndCompleted} onToggle={() => shell.onToggleFilter('pendingSalesAndCompleted')} />
            <LayerRow icon={History} label="Previously done" on={ctx.filterVisibility.historical} progress={ctx.geocodeProgress.historical} onToggle={() => shell.onToggleFilter('historical')} />
            <LayerRow icon={Users} label="Callbook clients (PCL)" on={ctx.filterVisibility.pcl} progress={ctx.geocodeProgress.pcl} onToggle={() => shell.onToggleFilter('pcl')} />
          </div>
        </PhoneSheet>
      )}

      {sheet === 'battle' && (
        <PhoneSheet title="Team battle" onClose={() => setSheet(null)}>
          <div className="pb-3 flex">{shell.battleCards}</div>
          <div className="text-[10px] text-gray-500 pb-2">Steps · pending prebooks + pending sales · gross + pending $. Tap a team for its carts.</div>
        </PhoneSheet>
      )}

      {sheet === 'sort' && (
        <PhoneSheet title="Sort team by" onClose={() => setSheet(null)}>
          <div className="space-y-1.5 pb-2">
            {(Object.keys(SORT_LABEL) as SortOption[]).map(k => (
              <button key={k} onClick={() => { ctx.onSortBy(k); setSheet(null); }}
                className={`w-full h-12 rounded-xl px-4 flex items-center justify-between text-sm font-bold ${ctx.sortBy === k ? 'bg-blue-600/30 text-white ring-1 ring-blue-500' : 'bg-gray-800 text-gray-200'}`}>
                {SORT_LABEL[k]} {ctx.sortBy === k && <Check size={16} />}
              </button>
            ))}
          </div>
        </PhoneSheet>
      )}

      {sheet === 'routes' && (
        <PhoneSheet title={crew ? `${crewLabel(crew)}'s routes` : 'Routes'} onClose={() => setSheet(null)}>
          <div className="space-y-1.5 pb-2">
            {ctx.crewRoutes.map(r => {
              const on = route && r.routeCode === route.baseRouteCode && (r.letter || '') === (route.letter || '');
              return (
                <button key={r.display} onClick={() => { setSheet(null); ctx.onEnterRoute(r.routeCode, r.letter); }}
                  className={`w-full h-12 rounded-xl px-3 flex items-center gap-3 text-sm font-bold ${on ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-200'}`}>
                  <span className="h-7 px-2 rounded-md text-white text-xs font-extrabold flex items-center" style={{ background: r.color }}>{r.display}</span>
                  {on && <Check size={16} className="ml-auto" />}
                </button>
              );
            })}
          </div>
        </PhoneSheet>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const HeaderGroup: React.FC<{ label: string; last?: boolean; compact?: boolean; children: React.ReactNode }> = ({ label, last, compact, children }) => (
  <div className={`flex items-baseline gap-1 ${compact ? 'px-1.5' : 'px-2'} ${last ? '' : 'border-r border-gray-800'}`}>
    <span className="text-[9.5px] uppercase tracking-wide text-gray-500 font-bold">{label}</span>
    <span className={`${compact ? 'text-[14px]' : 'text-[15px]'} font-extrabold`}>{children}</span>
  </div>
);

const TabPill: React.FC<{ on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({ on, onClick, disabled, children }) => (
  <button
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
    className={`flex-shrink-0 h-8 px-3.5 rounded-full text-xs font-bold flex items-center gap-1 ${on ? 'bg-[#f3f4f6] text-[#111827]' : 'bg-gray-800 text-gray-300'} ${disabled ? 'opacity-35' : ''}`}
  >{children}</button>
);

const StatBox: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="bg-gray-800 rounded-xl px-2.5 py-2 min-w-0">
    <div className="text-[9.5px] uppercase tracking-wide text-gray-500 font-bold truncate">{label}</div>
    <div className={`text-[15px] font-extrabold truncate ${tone || 'text-white'}`}>{value}</div>
  </div>
);

const LayerRow: React.FC<{ icon: LucideIcon; label: string; on: boolean; progress: { current: number; total: number; done: boolean }; onToggle: () => void }> = ({ icon: Icon, label, on, progress, onToggle }) => {
  const loading = !progress.done;
  return (
    <button
      onClick={loading ? undefined : onToggle}
      className={`w-full h-14 rounded-xl px-4 flex items-center gap-3 ${on && !loading ? 'bg-blue-600/25 ring-1 ring-blue-500' : 'bg-gray-800'} ${loading ? 'opacity-60' : ''}`}
    >
      <Icon size={18} className={on ? 'text-blue-300' : 'text-gray-400'} />
      <span className="text-sm font-bold text-white flex-1 text-left">{label}</span>
      {loading ? (
        <span className="text-[11px] text-amber-300 font-bold flex items-center gap-1">
          <Loader size={12} className="animate-spin" />{progress.total > 0 ? `${progress.current}/${progress.total}` : 'waiting'}
        </span>
      ) : (
        <span className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-blue-500' : 'bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </span>
      )}
    </button>
  );
};

const BottleCounter: React.FC<{ cart: CartCardData; saving: boolean; onAdjust: (d: number) => void }> = ({ cart, saving, onAdjust }) => {
  const locked = cart.sessionStatus === 'PAID';
  return (
    <div className={`h-11 rounded-xl border flex items-center justify-between overflow-hidden ${locked ? 'bg-gray-800 border-gray-700 text-gray-500' : 'bg-slate-800 border-slate-600 text-slate-100'}`}>
      <button onClick={() => onAdjust(-1)} disabled={locked || saving || cart.crackfillerBottles === 0} className="w-11 h-full flex items-center justify-center disabled:opacity-30"><Minus size={16} /></button>
      <span className="flex items-center gap-1.5 text-sm font-bold">
        {saving ? <Loader size={14} className="animate-spin" /> : <FlaskConical size={14} />} {cart.crackfillerBottles}
      </span>
      <button onClick={() => onAdjust(1)} disabled={locked || saving} className="w-11 h-full flex items-center justify-center disabled:opacity-30"><Plus size={16} /></button>
    </div>
  );
};

const CrewCard: React.FC<{ crew: PhoneCrew; ctx: RMPhoneCtx; lastMs: number | null; onTap: () => void }> = ({ crew, ctx, lastMs, onTap }) => {
  const fs = crew.type === 'cart' ? crew.cart.sharedFinancialStore : crew.card.financialStore;
  const { hasFlag, flags } = computeRedFlags(fs);
  const st = crew.type === 'cart' ? crew.cart.stats : crew.card.stats;
  const k = crew.type === 'cart' ? ctx.knock.get(crew.cart.sessionId) : undefined;
  const routes = crew.type === 'cart' ? crew.cart.assignedRoutes : crew.card.assignedRoutes;
  return (
    <button onClick={onTap} className="w-full text-left bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 active:bg-gray-700">
      <div className="flex items-center gap-1.5 min-w-0">
        {crew.type === 'cart' && crew.cart.isRcCart && <Truck size={13} className="text-orange-400 flex-shrink-0" />}
        <span className="text-white font-bold text-sm truncate">{crewLabel(crew, true)}</span>
        <ActivityBadge lastMs={lastMs} nowMs={ctx.activityNow} />
        {hasFlag && <span title={flags.join(', ')} className="text-red-400"><AlertTriangle size={13} /></span>}
        {routes.length > 0 && <span className="ml-auto text-[10px] text-gray-400 font-mono truncate max-w-[40%]">{routes.join(' ')}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 mt-1 text-[11px] text-gray-300">
        <span><b className="text-white">{st.steps}</b> steps</span><Dot />
        <span className={st.pending > 0 ? 'text-amber-400' : ''}>{st.pending} pend</span><Dot />
        <span>{st.eq.toFixed(1)} EQ</span><Dot />
        <span>{st.upsellCount} up · ${st.upsellGross.toFixed(0)}</span>
        {crew.type === 'cart' && crew.cart.stats.pendingSaleCount > 0 && (<><Dot /><span className="text-amber-400">{crew.cart.stats.pendingSaleCount} sale</span></>)}
      </div>
      {k && (
        <div className="flex flex-wrap items-center gap-x-1.5 mt-0.5 text-[11px] text-gray-300">
          <span>{k.knocks} knocks</span><Dot />
          <span className={k.no > 0 ? 'text-red-400' : ''}>{k.no} no</span><Dot />
          <span className={k.goBack > 0 ? 'text-orange-300' : ''}>{k.goBack} GB</span><Dot />
          <span className={k.invalid > 0 ? 'text-pink-300' : ''}>{k.invalid} inv</span><Dot />
          <span className="text-blue-300">{k.total ? `${Math.round(k.pct * 100)}% cov` : '— cov'}</span>
        </div>
      )}
    </button>
  );
};

const Dot = () => <span className="text-gray-600">•</span>;

const BookingPinCard: React.FC<{ pin: PhonePinCardData; onClose: () => void; onNavigate: () => void }> = ({ pin, onClose, onNavigate }) => {
  const status = pin.kind === 'pending' ? { label: 'Pending prebook', cls: 'text-gray-300' }
    : pin.kind === 'completed' ? { label: 'Done', cls: 'text-green-400' }
    : pin.kind === 'new_sale' ? { label: 'New sale', cls: 'text-yellow-400' }
    : { label: 'Upsell', cls: 'text-blue-300' };
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-white font-bold text-[15px] truncate">{pin.name}</div>
          <div className="text-[12px] text-gray-400 truncate">{pin.address}</div>
        </div>
        <button onClick={onClose} className="w-8 h-8 -mr-1 -mt-1 flex items-center justify-center text-gray-400"><X size={18} /></button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {pin.routeCode && <span className="text-[11px] font-bold rounded px-1.5 py-0.5" style={{ background: `${pin.routeColor}33`, color: pin.routeColor, border: `1px solid ${pin.routeColor}88` }}>{pin.routeCode}</span>}
        <span className={`text-[11px] font-bold ${status.cls}`}>{status.label}</span>
        {pin.confirmed && <span className="text-[11px] font-bold text-green-400 flex items-center gap-0.5"><Check size={12} /> Confirmed</span>}
        {pin.price && <span className="text-[11px] font-bold rounded px-1.5 py-0.5 bg-green-900/40 text-green-300 border border-green-800">{pin.price}</span>}
        {pin.paymentMethod && <span className="text-[11px] text-gray-400">{pin.paymentMethod}</span>}
      </div>
      {pin.upsell && (
        <div className="mt-1.5 text-[11px] text-blue-300">⬆ Upsell {pin.upsell.price} {pin.upsell.name && <span className="text-gray-400">· {pin.upsell.name}</span>}</div>
      )}
      {pin.email && <div className="mt-1.5 text-[11px] text-gray-400 flex items-center gap-1 truncate"><Mail size={11} /> {pin.email}</div>}
      <div className={`grid ${pin.phone ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mt-2.5`}>
        {pin.phone && (
          <a href={`tel:${pin.phone}`} className="h-11 rounded-xl bg-green-800 text-white text-sm font-bold flex items-center justify-center gap-1.5"><Phone size={15} /> Call</a>
        )}
        <button onClick={onNavigate} className="h-11 rounded-xl bg-blue-600 text-white text-sm font-bold flex items-center justify-center gap-1.5"><Navigation2 size={15} /> Navigate</button>
      </div>
    </div>
  );
};

export default RMPhoneLayout;

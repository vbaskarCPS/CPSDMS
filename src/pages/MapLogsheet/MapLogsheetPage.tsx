// src/pages/MapLogsheet/MapLogsheetPage.tsx
//
// Map-based logsheet for contractor H01 (SalesRabbit-style). One screen:
//   - slim stats strip on top,
//   - the house map filling the rest,
//   - a bottom sheet for the tapped house (No / Not Home / Go Back / Sale),
//   - a slide-up drawer with the same job cards the Logsheet tab shows.
//
// Backend interaction is IDENTICAL to Dashboard/NewJob: sessions, pending
// sales, transactions and stats all go through sessionService. This page
// only adds house lists and dispositions (mapLogsheetService).
//
// Gate: H01 + team season + digital mapping. Anything else → /logsheet.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader, X, CheckCircle2, AlertCircle, Shovel, Droplets, Leaf,
  Menu, ChevronUp, Route, Truck, ArrowRight,
} from 'lucide-react';
import PhoneNavigation from '../Management/mobile/PhoneNavigation';
import { primeSpeech } from '../Management/mobile/rmPhone';
import type { MapPin as DriverStop } from '../../lib/sessionService';
import { format } from 'date-fns';
import { getStorageItem, removeStorageItem } from '../../lib/localStorage';
import { sessionService } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import { commandCenterService, seasonHasTeams } from '../../lib/commandCenterService';
import { subscribeAsContractor } from '../../lib/realtimeService';
import { supabase } from '../../lib/supabase';
import { getWorkerPCL, PCLClientGroup } from '../../lib/pclCacheService';
import { Worker, SessionStats, MasterBooking, SeasonType, PendingSale, CommandCenter, SessionTransaction, HistoricalProperty } from '../../types';
import LogsheetJobCard from '../Logsheet/components/LogsheetJobCard';
import AddContractModal from '../../components/AddContractModal';
import QuickPendingModal from '../../components/QuickPendingModal';
import MapLogsheetView from './MapLogsheetView';
import HouseSheet, { AddHouseSheet } from './HouseSheet';
import PclOutreachSheet, { pclOutreachClients, phoneKey } from './PclOutreachSheet';
import GallerySheet from './GallerySheet';
import MenuGrid from './MenuGrid';
import ContactsSheet, { ContactPerson } from './ContactsSheet';
import MapStatsTabs, { StatsTab } from './MapStatsTabs';
import {
  CartScope, computeCounts, computeKnockEvents, computePace, computeAvgCharge, computeGoBackQueue, computeCoverage,
} from '../../lib/mapLogsheetStats';
import { getPclTextedSet } from '../../lib/pclOutreachService';
import {
  MAP_LOGSHEET_PATH, isMapWorker,
  SavedRouteMap, RouteHouse, HouseDisposition, HouseDispositionStatus, HouseView, StreetSegmentPick,
  fetchRouteMaps, ensureRouteHouses, fetchDispositions, fetchDisposition, setDisposition, clearDisposition, addManualHouse, loadSegmentHouses,
  fetchHistoricalForRoutes, indexHistorical, historicalSummary,
  indexPendingSales, indexBookings, indexPcl, buildHouseViews, routeHouseId,
  subscribeToPendingSales, subscribeToDispositions,
  houseNumberLabel,
} from '../../lib/mapLogsheetService';

// --- ASPHALT MERGE HELPERS ---
// Copied from Dashboard.tsx (which doesn't export them). Same debt note applies:
// these belong in src/lib/pendingSaleDisplay.ts once the deliveries settle.
const convertPendingSaleToBookingShape = (ps: PendingSale): MasterBooking => {
  const fullAddress = `${ps.houseNumber || ''} ${ps.streetName || ''}`.trim();
  return {
    'Booking ID': ps.id,
    'First Name': '',
    'Last Name': '',
    'Full Address': fullAddress,
    'House Number': ps.houseNumber,
    'Street Name': ps.streetName,
    'Route Number': ps.routeCode,
    'Price': ps.price || '',
    'Log Sheet Notes': ps.notes,
    'FO/BO/FP': ps.propertyType as any,
    Status: 'pending',
    services: ps.services,
    isPendingSale: true,
    pendingSaleId: ps.id,
    asphaltAmount: ps.asphaltAmount,
    upsoldAsphaltAmount: ps.upsoldAsphaltAmount,
    saleType: ps.saleType,
    sharedJobKey: ps.sharedJobKey,
    assignedRcSessionId: ps.assignedRcSessionId,
  } as MasterBooking;
};

const mergePendingSalesForDisplay = (pendingSales: PendingSale[]): MasterBooking[] => {
  const allIds = new Set(pendingSales.map(ps => ps.id));
  const asphaltChildByParentId = new Map<string, PendingSale>();
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt' && ps.parentId) asphaltChildByParentId.set(ps.parentId, ps);
  }
  const result: MasterBooking[] = [];
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt') {
      if (ps.parentId && allIds.has(ps.parentId)) continue;
      result.push(convertPendingSaleToBookingShape(ps));
    } else {
      const booking = convertPendingSaleToBookingShape(ps);
      const child = asphaltChildByParentId.get(ps.id);
      if (child) {
        (booking as any).asphaltAmount = child.asphaltAmount;
        (booking as any).upsoldAsphaltAmount = child.upsoldAsphaltAmount;
        (booking as any).sharedJobKey = child.sharedJobKey;
        (booking as any).assignedRcSessionId = child.assignedRcSessionId;
      }
      result.push(booking);
    }
  }
  return result;
};

const fetchPendingSalesWithAssignments = async (sessionId: string): Promise<PendingSale[]> => {
  const [own, assigned] = await Promise.all([
    sessionService.getPendingSalesForSession(sessionId),
    sessionService.getAsphaltAssignmentsForSession(sessionId),
  ]);
  const ownIds = new Set(own.map(ps => ps.id));
  const incoming = assigned.filter(ps => !ownIds.has(ps.id));
  return [...incoming, ...own];
};

const SeasonPill: React.FC<{ seasonType: SeasonType }> = ({ seasonType }) => {
  if (seasonType === 'lawn_rejuv') return <span className="text-[9px] bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded border border-green-700 flex items-center gap-1"><Leaf size={9} /> REJUV</span>;
  if (seasonType === 'sealing') return <span className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-600 flex items-center gap-1"><Shovel size={9} /> SEALING</span>;
  if (seasonType === 'cleaning') return <span className="text-[9px] bg-cyan-900/30 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-700 flex items-center gap-1"><Droplets size={9} /> CLEANING</span>;
  return null;
};

const MapLogsheetPage: React.FC = () => {
  const navigate = useNavigate();

  // --- identity / session ---
  const [worker, setWorker] = useState<Worker | null>(null);
  const [cc, setCc] = useState<CommandCenter | null>(null);
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats>(sessionService.getEmptyStats());
  // Today's completed transactions (with timestamps) — for the Pace tab.
  const [transactions, setTransactions] = useState<SessionTransaction[]>([]);
  const [upsellsEnabled, setUpsellsEnabled] = useState(true);

  // --- logsheet data (same sources as Dashboard) ---
  const [jobs, setJobs] = useState<MasterBooking[]>([]);
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([]);
  const [routeCodes, setRouteCodes] = useState<string[]>([]);

  // --- map data ---
  const [routeMaps, setRouteMaps] = useState<SavedRouteMap[]>([]);
  const [houses, setHouses] = useState<RouteHouse[]>([]);
  const [dispositions, setDispositions] = useState<Map<string, HouseDisposition>>(new Map());
  // Teams: who's on this worker's cart today (contractor ids + the cart's
  // shared logsheet session) and everyone's display name, from the daily
  // session. Today's counts and Pace only count this cart's knocks, and the
  // house sheet says who marked a house.
  const [cart, setCart] = useState<CartScope>({ workerIds: new Set(), sessionIds: new Set() });
  const [workerNames, setWorkerNames] = useState<Map<string, string>>(new Map());
  const [pclByRoute, setPclByRoute] = useState<Map<string, PCLClientGroup[]>>(new Map());
  // Load Historical rows (previously serviced houses) for these routes — purple.
  const [historicalRows, setHistoricalRows] = useState<HistoricalProperty[]>([]);
  // The daily session's date ("YYYY-MM-DD"). Today's counts and Pace are scoped
  // to it; Coverage deliberately isn't (it belongs to the route, not the day).
  const [sessionDate, setSessionDate] = useState<string | null>(null);

  // --- ui ---
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsTab, setStatsTab] = useState<StatsTab>('today');
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; nonce: number } | null>(null);

  // --- WORKER DRIVER STOPS ---
  // Pickups / drop-offs the RM queued for this worker (map_pins, visibility
  // 'worker'), in order. Navigate drives to the first; Continue at a stop
  // deletes it and moves on to the next.
  const [driverStops, setDriverStops] = useState<DriverStop[]>([]);
  const [driverNav, setDriverNav] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
  const continuedIdsRef = useRef<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const [jobsFilter, setJobsFilter] = useState<'pending' | 'completed'>('pending');
  const [showContract, setShowContract] = useState(false);
  const [showPclOutreach, setShowPclOutreach] = useState(false);
  // Pitch gallery (photos of each prep step, in sales order) — full-screen.
  const [showGallery, setShowGallery] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [partners, setPartners] = useState<ContactPerson[]>([]);
  const [pclTexted, setPclTexted] = useState<Set<string>>(new Set());
  const [quickPending, setQuickPending] = useState<null | { prefill?: { routeCode: string; houseNumber: string; streetName: string; firstName?: string } }>(null);
  const [placing, setPlacing] = useState(false);
  // "Load houses on a street": pick mode, then the tapped street awaiting Load.
  const [pickingStreet, setPickingStreet] = useState(false);
  const [streetPick, setStreetPick] = useState<StreetSegmentPick | null>(null);
  const [placeAt, setPlaceAt] = useState<null | { lng: number; lat: number; routeCode: string; streets: string[] }>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const housesLoadedForRef = useRef<string>('');

  // Lock browser page-zoom at 100% while the map is open. A two-finger pinch
  // that lands on the header or the sheet zooms the whole page instead of the
  // map, and the phone then keeps that zoom for the site. Setting the viewport
  // meta this way snaps it back and stops it recurring; restored on leave so
  // the rest of the app keeps normal zoom behaviour.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const previous = meta.getAttribute('content') || 'width=device-width, initial-scale=1.0';
    meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    return () => { meta.setAttribute('content', previous); };
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const loadDriverStops = useCallback(async () => {
    if (!worker?.contractorId) return;
    const stops = await sessionService.getWorkerDriverStops(worker.contractorId);
    // A stop just continued past may still be on its way out of the database.
    setDriverStops(stops.filter(s => !continuedIdsRef.current.has(s.id)));
  }, [worker?.contractorId]);

  useEffect(() => {
    if (!worker?.contractorId) return;
    loadDriverStops();
    const id = setInterval(loadDriverStops, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') loadDriverStops(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [worker?.contractorId, loadDriverStops]);

  // Every stop done (or the RM cleared them) → out of navigation.
  useEffect(() => { if (driverNav && driverStops.length === 0) setDriverNav(false); }, [driverNav, driverStops.length]);

  // While a worker driver is navigating, share their position with the RM map
  // every 8 seconds (instead of the usual every 2 minutes), with heading and
  // the stop they're heading to. Cleared the moment navigation ends.
  const navShareRef = useRef<{ label: string; left: number }>({ label: '', left: 0 });
  navShareRef.current = { label: driverStops[0]?.label || '', left: driverStops.length };
  useEffect(() => {
    if (!driverNav || !worker?.contractorId || !('geolocation' in navigator)) return;
    if (trainingService.isTrainingMode()) return;
    const workerId = worker.contractorId;
    const ccId = cc?.id || commandCenterService.getCurrentCommandCenterId();
    if (!ccId) return;
    let last: { lat: number; lng: number; heading: number | null } | null = null;
    let prev: { lat: number; lng: number } | null = null;
    let sentAny = false;
    const send = async () => {
      if (!last) return;
      try {
        await supabase.from('worker_locations').upsert({
          worker_id: workerId, command_center_id: ccId,
          lat: last.lat, lng: last.lng, heading: last.heading,
          updated_at: new Date().toISOString(), nav_active_at: new Date().toISOString(),
          nav_label: navShareRef.current.label || null, nav_stops_left: navShareRef.current.left,
        }, { onConflict: 'worker_id' });
      } catch { /* next tick */ }
    };
    const watchId = navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lng, heading, speed } = pos.coords;
      let h: number | null = heading != null && !isNaN(heading) && (speed ?? 0) > 1 ? heading : last?.heading ?? null;
      if (h == null && prev) {
        const dy = lat - prev.lat, dx = (lng - prev.lng) * Math.cos(lat * Math.PI / 180);
        if (Math.hypot(dx, dy) * 111320 > 8) h = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      }
      if (!prev || Math.hypot(lat - prev.lat, lng - prev.lng) * 111320 > 8) prev = { lat, lng };
      last = { lat, lng, heading: h };
      if (!sentAny) { sentAny = true; send(); }
    }, () => { /* keep trying */ }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    const id = window.setInterval(send, 8000);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(id);
      // Off the road: tell the RM map straight away.
      supabase.from('worker_locations')
        .update({ nav_active_at: null, nav_label: null, nav_stops_left: null })
        .eq('worker_id', workerId)
        .then(() => {}, () => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverNav, worker?.contractorId]);

  const startDriverNav = () => {
    if (!driverStops.length) return;
    primeSpeech();   // voice prompts need unlocking inside the tap (iOS)
    setShowMenu(false); setShowStats(false); setSelectedId(null);
    setDriverNav(true);
  };

  const continueToNextStop = async () => {
    const current = driverStops[0];
    if (!current || continuing) return;
    setContinuing(true);
    continuedIdsRef.current.add(current.id);
    const rest = driverStops.slice(1);
    setDriverStops(rest);
    try {
      await sessionService.deleteMapPin(current.id);
    } catch {
      showToast('Could not clear that stop — it may come back');
    } finally {
      setContinuing(false);
    }
    if (rest.length === 0) showToast('All stops done ✓');
  };

  const forceLogout = useCallback(() => {
    removeStorageItem('current_user');
    navigate('/');
  }, [navigate]);

  // ---------------------------------------------------------------------
  // SESSION DATA (re-run on realtime ticks)
  // ---------------------------------------------------------------------
  const loadSessionData = useCallback(async (w: Worker, sid: string, season: SeasonType) => {
    const [assignments, sales, daily] = await Promise.all([
      sessionService.getWorkerAssignments(w.contractorId),
      seasonHasTeams(season) ? fetchPendingSalesWithAssignments(sid).catch(() => [] as PendingSale[]) : Promise.resolve([] as PendingSale[]),
      sessionService.getDailySession(),
    ]);
    setJobs(assignments);
    setPendingSales(sales);
    setSessionDate(daily?.date || null);
    const myRoutes = daily
      ? daily.routes.filter(r => r.assignedWorkerIds && r.assignedWorkerIds.includes(w.contractorId)).map(r => r.routeCode)
      : [];
    myRoutes.sort();
    setRouteCodes(prev => (prev.join(',') === myRoutes.join(',') ? prev : myRoutes));
    // Cart + names (teams). A solo worker's "cart" is just themselves.
    const myCart = daily?.teamCarts?.find(c => c.workerIds?.includes(w.contractorId));
    const cartWorkerIds = new Set<string>(myCart?.workerIds?.length ? myCart.workerIds : [w.contractorId]);
    cartWorkerIds.add(w.contractorId);
    const cartSessionIds = new Set<string>([sid]);
    if (myCart?.logsheetSessionId) cartSessionIds.add(myCart.logsheetSessionId);
    setCart({ workerIds: cartWorkerIds, sessionIds: cartSessionIds });
    // Cart partners (everyone on my cart but me) for the Contacts list.
    setPartners((daily?.workers || [])
      .filter(dw => cartWorkerIds.has(dw.contractorId) && dw.contractorId !== w.contractorId)
      .map(dw => ({ id: dw.contractorId, name: `${dw.firstName || ''} ${dw.lastName || ''}`.trim() || dw.contractorId, phone: String(dw.cellPhone ?? '').trim() || null })));
    const names = new Map<string, string>();
    for (const dw of daily?.workers || []) {
      const nm = `${dw.firstName || ''} ${dw.lastName ? dw.lastName[0] + '.' : ''}`.trim();
      if (dw.contractorId && nm) names.set(dw.contractorId, nm);
    }
    setWorkerNames(names);
    try {
      const live = await sessionService.getActiveLogsheetSession(w.contractorId);
      if (live) { setStats(live.stats); setTransactions(live.financialStore || []); }
    } catch { /* stats are cosmetic here */ }
  }, []);

  // ---------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setFatal(null);

      // Training / RM-view never use this page.
      if (trainingService.isTrainingMode() || getStorageItem<boolean>('rm_view_mode', false)) {
        navigate('/logsheet');
        return;
      }

      const storedWorker = getStorageItem<Worker | null>('current_user', null);
      if (!storedWorker) { navigate('/'); return; }
      const currentCc = commandCenterService.getCurrentCommandCenter();
      if (!(await isMapWorker(storedWorker, currentCc?.id ?? null))) { navigate('/logsheet'); return; }
      setWorker(storedWorker);
      setCc(currentCc);

      try {
        if (await sessionService.isWorkerLockedOut(storedWorker.contractorId)) { forceLogout(); return; }

        const season = await sessionService.getSessionSeasonType();
        if (cancelled) return;
        setSeasonType(season);
        if (!seasonHasTeams(season)) { navigate('/logsheet'); return; }

        // Digital mapping: CC flag OR the worker's manager carries a mapping config.
        let mapped = currentCc?.digitalMappingEnabled || false;
        if (!mapped && storedWorker.assignedManagerId) {
          const mgr = await sessionService.getManagerById(storedWorker.assignedManagerId);
          if (mgr?.digitalMapping) mapped = true;
        }
        if (!mapped) { navigate('/logsheet'); return; }

        const session = await sessionService.startLogsheetSession(storedWorker.contractorId);
        if (cancelled) return;
        setSessionId(session.id);
        setStats(session.stats);

        await loadSessionData(storedWorker, session.id, season);
        setUpsellsEnabled(await sessionService.getWorkerUpsellsEnabled(storedWorker.contractorId));
      } catch (err) {
        console.error('[MapLogsheet] init failed', err);
        if (!cancelled) setFatal(err instanceof Error ? err.message : 'Failed to load your session.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [navigate, forceLogout, loadSessionData, refreshKey]);

  // ---------------------------------------------------------------------
  // HOUSES + PCL + DISPOSITIONS — whenever the route set changes
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!worker || !cc || routeCodes.length === 0) return;
    const key = routeCodes.join(',');
    if (housesLoadedForRef.current === key) return;
    housesLoadedForRef.current = key;

    let cancelled = false;
    (async () => {
      try {
        setLoadingMsg('Loading your routes…');
        const [maps, dispos, pcl, hist] = await Promise.all([
          fetchRouteMaps(routeCodes),
          fetchDispositions(routeCodes),
          getWorkerPCL(routeCodes, cc.id).catch(err => { console.warn('[MapLogsheet] PCL load failed', err); return new Map<string, PCLClientGroup[]>(); }),
          fetchHistoricalForRoutes(cc.id, routeCodes).catch(err => { console.warn('[MapLogsheet] historical load failed', err); return [] as HistoricalProperty[]; }),
        ]);
        if (cancelled) return;
        setRouteMaps(maps);
        setDispositions(dispos);
        setPclByRoute(pcl);
        setHistoricalRows(hist);

        if (maps.length === 0) {
          setLoadingMsg(null);
          showToast('No approved map for your routes yet');
          setHouses([]);
          return;
        }

        // Build/fetch each route's houses in turn so progress reads sensibly.
        const all: RouteHouse[] = [];
        for (const rm of maps) {
          const hs = await ensureRouteHouses(rm, msg => { if (!cancelled) setLoadingMsg(msg); });
          if (cancelled) return;
          all.push(...hs);
          setHouses([...all]);
        }
        setLoadingMsg(null);
        if (all.length === 0) showToast('No houses found for your routes');
      } catch (err) {
        console.error('[MapLogsheet] house load failed', err);
        if (!cancelled) { setLoadingMsg(null); showToast('Could not load houses'); }
      }
    })();
    return () => { cancelled = true; };
  }, [routeCodes, worker, cc]);

  // ---------------------------------------------------------------------
  // REALTIME
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!worker || !sessionId) return;
    const refresh = () => { loadSessionData(worker, sessionId, seasonType).catch(err => console.warn('[MapLogsheet] refresh failed', err)); };
    const unsubA = subscribeAsContractor(refresh);
    const unsubB = cc ? subscribeToPendingSales(cc.id, refresh) : () => {};
    return () => { unsubA(); unsubB(); };
  }, [worker, sessionId, seasonType, cc, loadSessionData]);

  useEffect(() => {
    if (!routeCodes.length) return;
    const unsub = subscribeToDispositions(routeCodes, () => {
      fetchDispositions(routeCodes).then(setDispositions).catch(() => {});
    });
    return () => unsub();
  }, [routeCodes]);

  // Lockout listener (same as Dashboard)
  useEffect(() => {
    if (!worker) return;
    const channel = supabase
      .channel(`lockout-ml-${worker.contractorId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'logsheet_sessions', filter: `worker_id=eq.${worker.contractorId}` },
        (payload) => { if (payload.new && (payload.new as any).status === 'PAID') forceLogout(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [worker, forceLogout]);

  // ---------------------------------------------------------------------
  // DERIVED
  // ---------------------------------------------------------------------
  const houseViews: HouseView[] = useMemo(() => {
    const ps = indexPendingSales(pendingSales, houses);
    const { pending, completed } = indexBookings(jobs, houses);
    const pcl = indexPcl(pclByRoute, houses);
    const hist = indexHistorical(historicalRows, houses);
    return buildHouseViews(houses, dispositions, ps, pending, completed, pcl, hist);
  }, [houses, dispositions, pendingSales, jobs, pclByRoute, historicalRows]);

  // PCL Outreach: who's textable on these routes, and how many are still to do.
  // Anyone in the historicals (same house, or same phone number) is left out.
  const historicalPhones = useMemo(() => {
    const set = new Set<string>();
    for (const r of historicalRows) { const k = phoneKey(r.phone); if (k.length === 10) set.add(k); }
    return set;
  }, [historicalRows]);
  const pclClients = useMemo(() => pclOutreachClients(houseViews, historicalPhones), [houseViews, historicalPhones]);
  const pclToText = useMemo(() => pclClients.filter(c => !pclTexted.has(c.key)).length, [pclClients, pclTexted]);
  useEffect(() => {
    if (!worker) return;
    let cancelled = false;
    getPclTextedSet().then(s => { if (!cancelled) setPclTexted(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [worker]);

  const selectedView = useMemo(
    () => (selectedId ? houseViews.find(v => routeHouseId(v.house.routeCode, v.house.houseKey) === selectedId) || null : null),
    [selectedId, houseViews],
  );

  // Today / Pace / Coverage — shared maths (lib/mapLogsheetStats), also used
  // by the manager's cart panel so both screens show the same numbers.
  const counts = useMemo(() => computeCounts(dispositions, houseViews, sessionDate, cart), [dispositions, houseViews, sessionDate, cart]);
  const knockEvents = useMemo(
    () => computeKnockEvents(dispositions, pendingSales, transactions, houses, sessionDate, cart),
    [dispositions, pendingSales, transactions, houses, sessionDate, cart],
  );
  const pace = useMemo(() => computePace(knockEvents), [knockEvents]);
  const avgCharge = useMemo(() => computeAvgCharge(transactions, sessionDate), [transactions, sessionDate]);
  const goBackQueue = useMemo(() => computeGoBackQueue(houseViews, sessionDate), [houseViews, sessionDate]);
  const coverage = useMemo(() => computeCoverage(houseViews), [houseViews]);

  const drawerJobs = useMemo(() => {
    if (jobsFilter === 'pending') {
      const officePending = jobs.filter(b => !b.Completed && (!b.Status || b.Status === 'pending'));
      return [...mergePendingSalesForDisplay(pendingSales), ...officePending];
    }
    return jobs.filter(b => b.Completed === 'x' || b.Status === 'completed');
  }, [jobs, pendingSales, jobsFilter]);

  // ---------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------
  const handleSelectHouse = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) { setPlacing(false); setPlaceAt(null); setShowJobs(false); setShowMenu(false); setShowStats(false); }
  }, []);

  const handleDispose = async (status: HouseDispositionStatus, note: string, firstName: string, auto = false) => {
    if (!selectedView || !worker) return;
    setSaving(true);
    try {
      if (auto) {
        // The 5-second auto Not Home must never overwrite a partner: check
        // the database first, and if anyone has marked this house meanwhile,
        // keep theirs (with its note) and just show it.
        const existing = await fetchDisposition(selectedView.house.routeCode, selectedView.house.houseKey);
        if (existing) {
          setDispositions(prev => { const m = new Map(prev); m.set(routeHouseId(existing.routeCode, existing.houseKey), existing); return m; });
          return;
        }
      }
      const d = await setDisposition({
        routeCode: selectedView.house.routeCode,
        houseKey: selectedView.house.houseKey,
        status, note, firstName,
        commandCenterId: cc?.id ?? null,
        workerId: worker.contractorId,
        sessionId,
      });
      setDispositions(prev => { const m = new Map(prev); m.set(routeHouseId(d.routeCode, d.houseKey), d); return m; });
    } catch (err) {
      console.error('[MapLogsheet] disposition failed', err);
      showToast('Could not save — try again');
    } finally {
      setSaving(false);
    }
  };

  const handleClearDisposition = async () => {
    if (!selectedView) return;
    setSaving(true);
    try {
      await clearDisposition(selectedView.house.routeCode, selectedView.house.houseKey);
      setDispositions(prev => { const m = new Map(prev); m.delete(routeHouseId(selectedView.house.routeCode, selectedView.house.houseKey)); return m; });
    } catch (err) {
      console.error('[MapLogsheet] clear failed', err);
      showToast('Could not clear — try again');
    } finally {
      setSaving(false);
    }
  };

  const handleSale = () => {
    if (!selectedView) return;
    const h = selectedView.house;
    setQuickPending({
      prefill: {
        routeCode: h.routeCode,
        houseNumber: houseNumberLabel(h),   // "12-4241" for a condo unit
        streetName: h.streetName,
        firstName: selectedView.disposition?.firstName
          || (selectedView.isHistorical ? historicalSummary(selectedView.historical).name.split(/\s+/)[0] : '')
          || undefined,
      },
    });
  };

  const handleOpenPending = () => {
    const ps = selectedView?.pendingSale;
    if (!ps) return;
    navigate(`/logsheet/new?pendingSaleId=${encodeURIComponent(ps.id)}&returnTo=${encodeURIComponent(MAP_LOGSHEET_PATH)}`);
  };

  const handleOpenBooking = () => {
    const b = selectedView?.officeBooking;
    if (!b) return;
    navigate(`/job-detail/${encodeURIComponent(b['Booking ID'])}?returnTo=${encodeURIComponent(MAP_LOGSHEET_PATH)}`);
  };

  const handleJobCardClick = (job: MasterBooking) => {
    if ((job as any).isPendingSale && (job as any).pendingSaleId) {
      navigate(`/logsheet/new?pendingSaleId=${encodeURIComponent((job as any).pendingSaleId)}&returnTo=${encodeURIComponent(MAP_LOGSHEET_PATH)}`);
    } else {
      navigate(`/job-detail/${encodeURIComponent(job['Booking ID'])}?returnTo=${encodeURIComponent(MAP_LOGSHEET_PATH)}`);
    }
  };

  const handlePendingSaved = async () => {
    if (!worker || !sessionId) return;
    try { await loadSessionData(worker, sessionId, seasonType); } catch { /* realtime will catch up */ }
  };

  // "Add missing house": pick the nearest route + its streets for the tap point.
  const handlePlaceHouse = (lng: number, lat: number) => {
    let bestRoute: SavedRouteMap | null = null;
    let bestD = Infinity;
    const streetD = new Map<string, number>();
    const kx = Math.cos(lat * Math.PI / 180) * 111320;
    for (const rm of routeMaps) {
      for (const seg of rm.segments || []) {
        for (const c of seg.coordinates || []) {
          const d = Math.hypot((c[0] - lng) * kx, (c[1] - lat) * 111320);
          if (d < bestD) { bestD = d; bestRoute = rm; }
          if (seg.name) {
            const cur = streetD.get(seg.name);
            if (cur == null || d < cur) streetD.set(seg.name, d);
          }
        }
      }
    }
    if (!bestRoute) { showToast('No route near that spot'); setPlacing(false); return; }
    const streets = [...streetD.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
    setPlacing(false);
    setSelectedId(null);
    setPlaceAt({ lng, lat, routeCode: bestRoute.route_code, streets });
  };

  // "Load houses on a street": the tapped road (or nothing) comes back from the map.
  const handlePickStreet = (pick: StreetSegmentPick | null) => {
    if (!pick) { showToast('Tap directly on a road'); return; }
    setPickingStreet(false);
    setSelectedId(null);
    setStreetPick(pick);
  };

  // Houses go on the route the worker is on: the only assigned route, else
  // the one whose streets are nearest the tapped road.
  const handleLoadStreet = async () => {
    if (!streetPick) return;
    let rc = routeCodes.length === 1 ? routeCodes[0] : '';
    if (!rc) {
      const p0 = streetPick.lines.find(l => l.length)?.[0];
      let bestD = Infinity;
      if (p0) {
        const kx = Math.cos(p0[1] * Math.PI / 180) * 111320;
        for (const rm of routeMaps) {
          for (const seg of rm.segments || []) {
            for (const c of seg.coordinates || []) {
              const d = Math.hypot((c[0] - p0[0]) * kx, (c[1] - p0[1]) * 111320);
              if (d < bestD) { bestD = d; rc = rm.route_code; }
            }
          }
        }
      }
    }
    if (!rc) { showToast('No route to attach these houses to'); setStreetPick(null); return; }
    const pick = streetPick;
    setStreetPick(null);
    setSaving(true);
    try {
      const { houses: updated, added } = await loadSegmentHouses(rc, pick, houses, setLoadingMsg);
      setHouses(prev => [...prev.filter(h => h.routeCode !== rc), ...updated]);
      showToast(added > 0 ? `Added ${added} house${added === 1 ? '' : 's'} on ${pick.name}` : `No new houses found on ${pick.name}`);
    } catch (err) {
      console.error('[MapLogsheet] load street failed', err);
      showToast('Could not load that street — try again');
    } finally {
      setLoadingMsg(null);
      setSaving(false);
    }
  };

  const handleAddHouse = async (civicNo: number, suffix: string, street: string) => {
    if (!placeAt) return;
    setSaving(true);
    try {
      const updated = await addManualHouse(placeAt.routeCode, civicNo, suffix, street, placeAt.lat, placeAt.lng);
      setHouses(prev => [...prev.filter(h => h.routeCode !== placeAt.routeCode), ...updated]);
      setPlaceAt(null);
      showToast('House added');
    } catch (err) {
      console.error('[MapLogsheet] add house failed', err);
      showToast('Could not add house');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => { removeStorageItem('current_user'); navigate('/'); };

  // ---------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-black text-gray-300 p-6 text-center gap-4">
        <AlertCircle size={32} className="text-red-400" />
        <p className="text-sm">{fatal}</p>
        <div className="flex gap-2">
          <button onClick={() => setRefreshKey(k => k + 1)} className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm">Try again</button>
          <button onClick={() => navigate('/logsheet')} className="px-4 py-2 bg-cps-blue rounded-lg text-sm text-white">Use regular logsheet</button>
        </div>
      </div>
    );
  }

  const anySheetOpen = !!selectedView || !!placeAt || !!streetPick || showJobs || showStats || showMenu || showPclOutreach;

  return (
    // Fixed to the viewport edges: the most reliable "fill the phone screen"
    // on mobile browsers, whose 100vh wanders as the address bar shows/hides.
    <div className="fixed inset-0 bg-black flex flex-col overflow-hidden">
      {/* ── HEADER BAR (tap for expanded stats) ── */}
      <button
        type="button"
        onClick={() => { setShowStats(s => !s); setShowMenu(false); setSelectedId(null); }}
        className="shrink-0 w-full bg-black/95 border-b border-gray-800 px-3 py-2 flex items-center justify-between gap-3 text-left active:bg-gray-900"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-white font-bold text-base whitespace-nowrap">{format(new Date(), 'EEE, MMM d')}</span>
          <SeasonPill seasonType={seasonType} />
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex flex-col items-center leading-none">
            <span className="text-[9px] uppercase font-bold text-gray-500">Done</span>
            <span className="text-lg font-bold" style={{ color: '#4ade80' }}>{counts.completed}</span>
          </div>
          <div className="flex flex-col items-center leading-none">
            <span className="text-[9px] uppercase font-bold text-gray-500">Equiv</span>
            <span className="text-lg font-bold text-white">{stats.totalEQ.toFixed(1)}</span>
          </div>
          <ChevronUp size={16} className={`text-gray-500 transition-transform ${showStats ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* ── MAP ── */}
      <div className="flex-1 relative min-h-0">
        {worker && (
          <MapLogsheetView
            worker={worker}
            routeMaps={routeMaps}
            houses={houseViews}
            selectedId={selectedId}
            loadingMessage={loadingMsg}
            placingHouse={placing}
            pickingStreet={pickingStreet}
            flyTo={flyTo}
            onSelectHouse={handleSelectHouse}
            onPlaceHouse={handlePlaceHouse}
            onPickStreet={handlePickStreet}
            driverStops={driverStops}
            onMapReady={setMapInstance}
            navigating={driverNav}
          />
        )}

        {/* WORKER DRIVER: turn-by-turn through the queued stops. */}
        {driverNav && mapInstance && driverStops[0] && (
          <PhoneNavigation
            key={driverStops[0].id}
            map={mapInstance}
            destination={{ lat: driverStops[0].lat, lng: driverStops[0].lng, label: driverStops[0].label }}
            stayOnArrival
            onArrived={() => {}}
            onCancel={() => setDriverNav(false)}
            renderExtra={arrived => (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wide font-bold text-teal-300">Stop 1 of {driverStops.length}</div>
                  <div className="text-white font-bold text-sm truncate">{driverStops[0].label}</div>
                  {driverStops[1] && <div className="text-[11px] text-gray-400 truncate">Next: {driverStops[1].label}</div>}
                </div>
                <button
                  onClick={continueToNextStop}
                  disabled={continuing}
                  className={`flex-shrink-0 rounded-full font-extrabold flex items-center gap-2 transition-all disabled:opacity-50 ${
                    arrived ? 'h-14 px-6 text-base bg-green-500 text-black ring-4 ring-green-300/40 animate-pulse' : 'h-11 px-4 text-sm bg-gray-700 text-white'
                  }`}
                >
                  {continuing ? <Loader size={16} className="animate-spin" /> : null}
                  {driverStops.length > 1 ? 'Continue' : 'Finish'} <ArrowRight size={18} />
                </button>
              </div>
            )}
          />
        )}

        {/* Navigate button — only when the RM has queued stops for this worker. */}
        {!driverNav && driverStops.length > 0 && !anySheetOpen && !placing && !pickingStreet && (
          <button
            onClick={startDriverNav}
            className="absolute left-4 bottom-5 z-20 h-14 pl-4 pr-5 rounded-full shadow-xl bg-teal-600 active:bg-teal-500 text-white font-bold text-sm flex items-center gap-2 border border-teal-400"
          >
            <Truck size={20} />
            Navigate · {driverStops.length} stop{driverStops.length === 1 ? '' : 's'}
          </button>
        )}

        {/* Hamburger (bottom-right) — hidden while any sheet is open */}
        {!anySheetOpen && !placing && !pickingStreet && !driverNav && (
          <button
            onClick={() => setShowMenu(true)}
            className="absolute right-4 bottom-5 z-20 w-14 h-14 rounded-full shadow-xl bg-gray-900 text-white border border-gray-700 flex items-center justify-center active:bg-gray-800"
            aria-label="Menu"
          >
            <Menu size={24} />
            {counts.pending > 0 && (
              <span className="absolute -top-1 -right-1 bg-yellow-500 text-black rounded-full px-1.5 text-[10px] font-bold">{counts.pending}</span>
            )}
          </button>
        )}
        {placing && (
          <button
            onClick={() => setPlacing(false)}
            className="absolute right-4 bottom-5 z-20 px-4 h-12 rounded-full shadow-xl bg-yellow-500 text-black font-bold text-sm flex items-center gap-2"
          >
            <X size={16} /> Cancel
          </button>
        )}
        {pickingStreet && (
          <button
            onClick={() => setPickingStreet(false)}
            className="absolute right-4 bottom-5 z-20 px-4 h-12 rounded-full shadow-xl bg-yellow-500 text-black font-bold text-sm flex items-center gap-2"
          >
            <X size={16} /> Cancel
          </button>
        )}

        {/* Load-street confirm strip */}
        {streetPick && (
          <div className="absolute inset-x-3 bottom-5 z-30 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-3 flex items-center gap-3">
            <Route size={20} className="text-yellow-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold text-sm truncate">{streetPick.name}</div>
              <div className="text-[11px] text-gray-400">Load every house on the visible stretch?</div>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => setStreetPick(null)}
              className="px-3 h-10 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-bold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleLoadStreet}
              className="px-4 h-10 rounded-lg bg-yellow-500 text-black text-xs font-bold disabled:opacity-50"
            >
              Load
            </button>
          </div>
        )}

        {/* Menu: 3 x 3 grid of tiles */}
        {showMenu && (
          <MenuGrid
            workerName={worker?.firstName}
            contractorId={worker?.contractorId}
            routeCodes={routeCodes}
            pendingCount={counts.pending}
            pclToText={pclToText}
            canAddSale={!!sessionId && routeCodes.length > 0}
            upsellsEnabled={upsellsEnabled}
            hasPcl={pclClients.length > 0}
            onClose={() => setShowMenu(false)}
            onLogsheet={() => { setShowMenu(false); setShowJobs(true); }}
            onAddSale={() => { setShowMenu(false); setQuickPending({}); }}
            onContract={() => { setShowMenu(false); setShowContract(true); }}
            onStats={() => { setShowMenu(false); setShowStats(true); }}
            onGallery={() => { setShowMenu(false); setShowGallery(true); setSelectedId(null); }}
            onAddHouse={() => { setShowMenu(false); setPlacing(true); setSelectedId(null); }}
            onLoadStreet={() => { setShowMenu(false); setPickingStreet(true); setSelectedId(null); }}
            onPcl={() => { setShowMenu(false); setShowPclOutreach(true); }}
            onContacts={() => { setShowMenu(false); setShowContacts(true); }}
            onAccount={() => { setShowMenu(false); navigate('/worker/account'); }}
            onLogout={handleLogout}
          />
        )}

        {/* Contacts: route managers + today's cart partners */}
        {showContacts && <ContactsSheet partners={partners} workerId={worker?.contractorId} assignedManagerId={worker?.assignedManagerId} onClose={() => setShowContacts(false)} />}

        {/* Stats sheet */}
        {showStats && (
          <div className="absolute inset-0 z-30" onClick={() => setShowStats(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="absolute inset-x-0 top-0 bg-gray-900 border-b border-gray-700 rounded-b-2xl shadow-2xl p-3 space-y-3 max-h-[85%] overflow-y-auto custom-scrollbar"
              onClick={e => e.stopPropagation()}
            >
              <MapStatsTabs
                tab={statsTab}
                onTab={setStatsTab}
                counts={counts}
                avgCharge={avgCharge}
                pace={pace}
                goBackQueue={goBackQueue}
                coverage={coverage}
                equiv={stats.totalEQ}
                footer={<>
                  <span>Up gross ${stats.upsellGross.toFixed(0)}</span>
                  <span>Upsells {stats.upsellCount}</span>
                  <span>Steps {stats.stepCount}</span>
                </>}
                showRouteCodes={routeCodes.length > 1}
                onGoBackHouse={v => { setShowStats(false); setFlyTo({ lng: v.house.lng, lat: v.house.lat, zoom: 18, nonce: Date.now() }); setSelectedId(routeHouseId(v.house.routeCode, v.house.houseKey)); }}
                onStreet={st => { setShowStats(false); setFlyTo({ lng: st.lng, lat: st.lat, zoom: 17, nonce: Date.now() }); }}
                headerRight={<button onClick={() => setShowStats(false)} className="p-1 text-gray-400"><X size={20} /></button>}
              />
            </div>
          </div>
        )}

        {/* House sheet */}
        {selectedView && (
          <HouseSheet
            view={selectedView}
            saving={saving}
            onDispose={handleDispose}
            markedBy={(() => {
              const wid = selectedView.disposition?.workerId;
              if (!wid) return null;
              if (worker && wid === worker.contractorId) return 'you';
              return workerNames.get(wid) || wid;
            })()}
            onClearDisposition={handleClearDisposition}
            onSale={handleSale}
            onOpenPending={handleOpenPending}
            onOpenBooking={handleOpenBooking}
            onClose={() => setSelectedId(null)}
          />
        )}

        {/* Add-house sheet */}
        {placeAt && (
          <AddHouseSheet
            routeCode={placeAt.routeCode}
            streetOptions={placeAt.streets}
            lng={placeAt.lng}
            lat={placeAt.lat}
            saving={saving}
            onSave={handleAddHouse}
            onCancel={() => setPlaceAt(null)}
          />
        )}

        {/* PCL Outreach sheet */}
        {showPclOutreach && worker && (
          <PclOutreachSheet
            worker={worker}
            commandCenterId={cc?.id ?? null}
            clients={pclClients}
            texted={pclTexted}
            onTexted={key => setPclTexted(prev => new Set([...prev, key]))}
            onClose={() => setShowPclOutreach(false)}
          />
        )}

        {/* Jobs drawer */}
        {showJobs && (
          <div className="absolute inset-x-0 bottom-0 z-30 bg-gray-950 border-t border-gray-700 rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
              <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                <button onClick={() => setJobsFilter('pending')} className={`px-3 py-1.5 rounded-md text-xs font-bold ${jobsFilter === 'pending' ? 'bg-cps-blue text-white' : 'text-gray-400'}`}>Pending</button>
                <button onClick={() => setJobsFilter('completed')} className={`px-3 py-1.5 rounded-md text-xs font-bold ${jobsFilter === 'completed' ? 'bg-green-700 text-white' : 'text-gray-400'}`}>Completed</button>
              </div>
              <button onClick={() => setShowJobs(false)} className="p-1.5 text-gray-400"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 pt-0 space-y-2 custom-scrollbar">
              {drawerJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <CheckCircle2 size={36} className="mb-2 opacity-20" />
                  <p className="text-sm">{jobsFilter === 'pending' ? 'All caught up!' : 'Nothing completed yet.'}</p>
                </div>
              ) : (
                drawerJobs.map(job => (
                  <LogsheetJobCard key={job['Booking ID']} job={job} onClick={() => handleJobCardClick(job)} />
                ))
              )}
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-gray-900/95 text-white px-3 py-1.5 rounded-full text-xs shadow-lg border border-gray-700">
            {toast}
          </div>
        )}
      </div>

      {/* ── GALLERY (full screen) ── */}
      {showGallery && worker && (
        <GallerySheet contractorId={worker.contractorId} onClose={() => setShowGallery(false)} />
      )}

      {/* ── MODALS ── */}
      {showContract && (
        <AddContractModal onClose={() => { setShowContract(false); handlePendingSaved(); }} />
      )}

      {quickPending && worker && sessionId && (
        <QuickPendingModal
          worker={worker}
          sessionId={sessionId}
          seasonType={seasonType}
          assignedRoutes={routeCodes}
          prefill={quickPending.prefill}
          returnTo={MAP_LOGSHEET_PATH}
          onClose={() => setQuickPending(null)}
          onSaved={() => { handlePendingSaved(); setSelectedId(null); }}
        />
      )}
    </div>
  );
};

export default MapLogsheetPage;
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
  LogOut, Loader, Plus, FileText, ListChecks, Home, X, CheckCircle2, AlertCircle, Shovel, Droplets, Leaf,
  Menu, BarChart3, ChevronUp, Clock, MapPinned, RotateCcw,
} from 'lucide-react';
import { format } from 'date-fns';
import { getStorageItem, removeStorageItem } from '../../lib/localStorage';
import { sessionService } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import { commandCenterService, seasonHasTeams } from '../../lib/commandCenterService';
import { subscribeAsContractor } from '../../lib/realtimeService';
import { supabase } from '../../lib/supabase';
import { getWorkerPCL, PCLClientGroup } from '../../lib/pclCacheService';
import { Worker, SessionStats, MasterBooking, SeasonType, PendingSale, CommandCenter, SessionTransaction } from '../../types';
import LogsheetJobCard from '../Logsheet/components/LogsheetJobCard';
import AddContractModal from '../../components/AddContractModal';
import QuickPendingModal from '../../components/QuickPendingModal';
import MapLogsheetView from './MapLogsheetView';
import HouseSheet, { AddHouseSheet } from './HouseSheet';
import {
  MAP_LOGSHEET_PATH, isH01,
  SavedRouteMap, RouteHouse, HouseDisposition, HouseDispositionStatus, HouseView,
  fetchRouteMaps, ensureRouteHouses, fetchDispositions, setDisposition, clearDisposition, addManualHouse,
  indexPendingSales, indexBookings, indexPcl, buildHouseViews, routeHouseId, houseKeyFromFullAddress, houseKeyFromAddress,
  subscribeToPendingSales, subscribeToDispositions, HOUSE_COLORS,
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

const isToday = (iso: string) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
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
  const [pclByRoute, setPclByRoute] = useState<Map<string, PCLClientGroup[]>>(new Map());

  // --- ui ---
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsTab, setStatsTab] = useState<'today' | 'pace' | 'coverage'>('today');
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number; zoom?: number; nonce: number } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [jobsFilter, setJobsFilter] = useState<'pending' | 'completed'>('pending');
  const [showContract, setShowContract] = useState(false);
  const [quickPending, setQuickPending] = useState<null | { prefill?: { routeCode: string; houseNumber: string; streetName: string } }>(null);
  const [placing, setPlacing] = useState(false);
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
    const myRoutes = daily
      ? daily.routes.filter(r => r.assignedWorkerIds && r.assignedWorkerIds.includes(w.contractorId)).map(r => r.routeCode)
      : [];
    myRoutes.sort();
    setRouteCodes(prev => (prev.join(',') === myRoutes.join(',') ? prev : myRoutes));
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
      if (!isH01(storedWorker)) { navigate('/logsheet'); return; }
      setWorker(storedWorker);

      const currentCc = commandCenterService.getCurrentCommandCenter();
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
        const [maps, dispos, pcl] = await Promise.all([
          fetchRouteMaps(routeCodes),
          fetchDispositions(routeCodes),
          getWorkerPCL(routeCodes, cc.id).catch(err => { console.warn('[MapLogsheet] PCL load failed', err); return new Map<string, PCLClientGroup[]>(); }),
        ]);
        if (cancelled) return;
        setRouteMaps(maps);
        setDispositions(dispos);
        setPclByRoute(pcl);

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
    const ps = indexPendingSales(pendingSales);
    const { pending, completed } = indexBookings(jobs);
    const pcl = indexPcl(pclByRoute);
    return buildHouseViews(houses, dispositions, ps, pending, completed, pcl);
  }, [houses, dispositions, pendingSales, jobs, pclByRoute]);

  const selectedView = useMemo(
    () => (selectedId ? houseViews.find(v => routeHouseId(v.house.routeCode, v.house.houseKey) === selectedId) || null : null),
    [selectedId, houseViews],
  );

  const counts = useMemo(() => {
    let no = 0, notHome = 0, goBack = 0;
    dispositions.forEach(d => {
      if (!isToday(d.updatedAt)) return;
      if (d.status === 'no') no++;
      else if (d.status === 'not_home') notHome++;
      else goBack++;
    });
    const pending = houseViews.filter(v => v.state === 'pending').length;
    const completed = houseViews.filter(v => v.state === 'completed').length;
    // Knocks    = No + Not Home + Go Back + Pending + Done
    // Answered  = Knocks − Not Home          (a door that opened; Go Back counts)
    // Answer %  = Answered ÷ Knocks
    // Closing % = (Pending + Done) ÷ Answered
    const knocks = no + notHome + goBack + pending + completed;
    const answered = knocks - notHome;
    const sales = pending + completed;
    const answerRate = knocks > 0 ? answered / knocks : 0;
    const closingRate = answered > 0 ? sales / answered : 0;
    return { no, notHome, goBack, pending, completed, knocks, answered, sales, answerRate, closingRate };
  }, [dispositions, houseViews]);

  // ---------------------------------------------------------------------
  // PACE & TIME (today) — one event per knocked house, timed by its latest state
  // ---------------------------------------------------------------------
  const knockEvents = useMemo(() => {
    type Ev = { t: number; kind: 'no' | 'not_home' | 'go_back' | 'pending' | 'sale'; id: string };
    const byHouse = new Map<string, Ev>();
    // Dispositions marked today
    dispositions.forEach(d => {
      if (!isToday(d.updatedAt)) return;
      byHouse.set(routeHouseId(d.routeCode, d.houseKey), { t: new Date(d.updatedAt).getTime(), kind: d.status, id: routeHouseId(d.routeCode, d.houseKey) });
    });
    // Pending sales parked today (override a disposition at the same house)
    for (const ps of pendingSales) {
      if (ps.saleType === 'asphalt' && ps.parentId) continue;
      if (!ps.createdAt || !isToday(ps.createdAt)) continue;
      const key = houseKeyFromAddress(ps.houseNumber, ps.streetName);
      if (!key) continue;
      const id = routeHouseId(ps.routeCode || '', key);
      byHouse.set(id, { t: new Date(ps.createdAt).getTime(), kind: 'pending', id });
    }
    // Completed transactions today (override everything)
    for (const tx of transactions) {
      if (!tx.timestamp || !isToday(tx.timestamp)) continue;
      const key = houseKeyFromFullAddress(tx.address);
      if (!key) continue;
      const id = routeHouseId(tx.routeCode || '', key);
      byHouse.set(id, { t: new Date(tx.timestamp).getTime(), kind: 'sale', id });
    }
    return [...byHouse.values()].sort((a, b) => a.t - b.t);
  }, [dispositions, pendingSales, transactions]);

  const pace = useMemo(() => {
    const n = knockEvents.length;
    if (n === 0) return null;
    const first = knockEvents[0].t;
    const last = knockEvents[n - 1].t;
    const spanHrs = Math.max((last - first) / 3600000, 1 / 60); // never divide by zero
    const doorsPerHour = n / spanHrs;
    let longestGapMs = 0, gapAt = first;
    for (let i = 1; i < n; i++) {
      const g = knockEvents[i].t - knockEvents[i - 1].t;
      if (g > longestGapMs) { longestGapMs = g; gapAt = knockEvents[i - 1].t; }
    }
    const saleTimes = knockEvents.filter(e => e.kind === 'sale' || e.kind === 'pending').map(e => e.t);
    const minsToFirstSale = saleTimes.length ? (saleTimes[0] - first) / 60000 : null;
    let avgMinsBetweenSales: number | null = null;
    if (saleTimes.length >= 2) avgMinsBetweenSales = (saleTimes[saleTimes.length - 1] - saleTimes[0]) / 60000 / (saleTimes.length - 1);
    // Knocks by hour, from the first knock's hour to the current hour
    const startHour = new Date(first).getHours();
    const endHour = Math.max(new Date().getHours(), new Date(last).getHours());
    const hours: Array<{ hour: number; knocks: number; sales: number }> = [];
    for (let h = startHour; h <= endHour; h++) hours.push({ hour: h, knocks: 0, sales: 0 });
    for (const e of knockEvents) {
      const h = new Date(e.t).getHours() - startHour;
      if (h >= 0 && h < hours.length) { hours[h].knocks++; if (e.kind === 'sale' || e.kind === 'pending') hours[h].sales++; }
    }
    return { n, first, last, spanHrs, doorsPerHour, longestGapMs, gapAt, minsToFirstSale, avgMinsBetweenSales, hours };
  }, [knockEvents]);

  // Average charge (today): total price of completed sales ÷ number of them.
  // Upgrades/add-ons are excluded so the figure reads as "what a door is worth".
  const avgCharge = useMemo(() => {
    const sales = transactions.filter(tx => tx.timestamp && isToday(tx.timestamp) && (tx.type === 'Sale' || tx.type === 'Production'));
    const total = sales.reduce((sum, tx) => sum + (Number(tx.price) || 0), 0);
    return { count: sales.length, total, avg: sales.length ? total / sales.length : 0 };
  }, [transactions]);

  const goBackQueue = useMemo(() => {
    return houseViews
      .filter(v => v.state === 'go_back' && v.disposition && isToday(v.disposition.updatedAt))
      .sort((a, b) => new Date(a.disposition!.updatedAt).getTime() - new Date(b.disposition!.updatedAt).getTime());
  }, [houseViews]);

  // ---------------------------------------------------------------------
  // COVERAGE (today) — knocked = has a knock event today
  // ---------------------------------------------------------------------
  const coverage = useMemo(() => {
    const knockedIds = new Set(knockEvents.map(e => e.id));
    const total = houseViews.length;
    const knocked = houseViews.filter(v => knockedIds.has(routeHouseId(v.house.routeCode, v.house.houseKey))).length;
    // Per street, per side (odd/even), sorted by number: an untouched house
    // with a knocked house before AND after it on the same side is "skipped".
    type Street = { key: string; name: string; routeCode: string; total: number; knocked: number; sales: number; skipped: number; lng: number; lat: number };
    const streets = new Map<string, Street>();
    const groups = new Map<string, HouseView[]>();
    for (const v of houseViews) {
      const k = `${v.house.routeCode}|${v.house.streetNorm}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(v);
    }
    let skippedTotal = 0;
    groups.forEach((list, k) => {
      const first = list[0];
      const st: Street = { key: k, name: first.house.streetName, routeCode: first.house.routeCode, total: list.length, knocked: 0, sales: 0, skipped: 0, lng: 0, lat: 0 };
      let sLng = 0, sLat = 0;
      for (const v of list) {
        sLng += v.house.lng; sLat += v.house.lat;
        if (knockedIds.has(routeHouseId(v.house.routeCode, v.house.houseKey))) st.knocked++;
        if (v.state === 'pending' || v.state === 'completed') st.sales++;
      }
      st.lng = sLng / list.length; st.lat = sLat / list.length;
      for (const parity of [0, 1]) {
        const side = list.filter(v => v.house.civicNo % 2 === parity).sort((a, b) => a.house.civicNo - b.house.civicNo);
        const flags = side.map(v => knockedIds.has(routeHouseId(v.house.routeCode, v.house.houseKey)));
        let seenKnocked = false;
        let pendingGap = 0;
        for (const f of flags) {
          if (f) { if (seenKnocked) st.skipped += pendingGap; seenKnocked = true; pendingGap = 0; }
          else if (seenKnocked) pendingGap++;
        }
      }
      skippedTotal += st.skipped;
      streets.set(k, st);
    });
    const streetList = [...streets.values()].sort((a, b) => (b.total - b.knocked) - (a.total - a.knocked) || a.name.localeCompare(b.name));
    return { total, knocked, untouched: total - knocked, skipped: skippedTotal, pctKnocked: total > 0 ? knocked / total : 0, streets: streetList };
  }, [houseViews, knockEvents]);

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

  const handleDispose = async (status: HouseDispositionStatus, note: string) => {
    if (!selectedView || !worker) return;
    setSaving(true);
    try {
      const d = await setDisposition({
        routeCode: selectedView.house.routeCode,
        houseKey: selectedView.house.houseKey,
        status, note,
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
        houseNumber: `${h.civicNo}${(h.civicSuffix || '').toUpperCase()}`,
        streetName: h.streetName,
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

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const anySheetOpen = !!selectedView || !!placeAt || showJobs || showStats || showMenu;

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
            flyTo={flyTo}
            onSelectHouse={handleSelectHouse}
            onPlaceHouse={handlePlaceHouse}
          />
        )}

        {/* Hamburger (bottom-right) — hidden while any sheet is open */}
        {!anySheetOpen && !placing && (
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

        {/* Menu sheet */}
        {showMenu && (
          <div className="absolute inset-0 z-30" onClick={() => setShowMenu(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="absolute inset-x-0 bottom-0 bg-gray-900 border-t border-gray-700 rounded-t-2xl shadow-2xl p-3 pb-5 space-y-2"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs text-gray-400">
                  {worker?.firstName} <span className="font-mono bg-gray-800 border border-gray-700 px-1 rounded">#{worker?.contractorId}</span>
                  {routeCodes.length > 0 && <span className="ml-2 font-mono text-gray-500">{routeCodes.join(' ')}</span>}
                </span>
                <button onClick={() => setShowMenu(false)} className="p-1 text-gray-400"><X size={20} /></button>
              </div>
              <button
                onClick={() => { setShowMenu(false); setPlacing(true); setSelectedId(null); }}
                className="w-full py-3.5 rounded-xl bg-gray-800 text-white font-bold text-sm flex items-center gap-3 px-4 active:bg-gray-700"
              >
                <Home size={18} className="text-yellow-400" /> Add missing house
              </button>
              {sessionId && routeCodes.length > 0 && (
                <button
                  onClick={() => { setShowMenu(false); setQuickPending({}); }}
                  className="w-full py-3.5 rounded-xl bg-cps-blue text-white font-bold text-sm flex items-center gap-3 px-4 active:bg-blue-600"
                >
                  <Plus size={18} /> Add sale (not on the map)
                </button>
              )}
              <button
                onClick={() => { setShowMenu(false); setShowJobs(true); }}
                className="w-full py-3.5 rounded-xl bg-gray-800 text-white font-bold text-sm flex items-center gap-3 px-4 active:bg-gray-700"
              >
                <ListChecks size={18} className="text-blue-300" /> Jobs
                {counts.pending > 0 && <span className="ml-auto bg-yellow-500 text-black rounded-full px-2 text-[11px]">{counts.pending} pending</span>}
              </button>
              {upsellsEnabled && (
                <button
                  onClick={() => { setShowMenu(false); setShowContract(true); }}
                  className="w-full py-3.5 rounded-xl bg-purple-700 text-white font-bold text-sm flex items-center gap-3 px-4 active:bg-purple-600"
                >
                  <FileText size={18} /> Contract / upsell
                </button>
              )}
              <button
                onClick={() => { setShowMenu(false); setShowStats(true); }}
                className="w-full py-3.5 rounded-xl bg-gray-800 text-white font-bold text-sm flex items-center gap-3 px-4 active:bg-gray-700"
              >
                <BarChart3 size={18} className="text-green-300" /> Today's stats
              </button>
              <button
                onClick={handleLogout}
                className="w-full py-3.5 rounded-xl bg-gray-800 text-red-400 font-bold text-sm flex items-center gap-3 px-4 border border-gray-700 active:bg-gray-700"
              >
                <LogOut size={18} /> Log out
              </button>
            </div>
          </div>
        )}

        {/* Stats sheet */}
        {showStats && (
          <div className="absolute inset-0 z-30" onClick={() => setShowStats(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="absolute inset-x-0 top-0 bg-gray-900 border-b border-gray-700 rounded-b-2xl shadow-2xl p-3 space-y-3 max-h-[85%] overflow-y-auto custom-scrollbar"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
                  {([['today', 'Today'], ['pace', 'Pace'], ['coverage', 'Coverage']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setStatsTab(k)} className={`px-3 py-1.5 rounded-md text-xs font-bold ${statsTab === k ? 'bg-cps-blue text-white' : 'text-gray-400'}`}>{label}</button>
                  ))}
                </div>
                <button onClick={() => setShowStats(false)} className="p-1 text-gray-400"><X size={20} /></button>
              </div>

              {statsTab === 'today' && (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Knocks', value: counts.knocks, color: '#e5e7eb' },
                      { label: 'No', value: counts.no, color: HOUSE_COLORS.no },
                      { label: 'Not home', value: counts.notHome, color: '#c4c8d0' },
                      { label: 'Go back', value: counts.goBack, color: HOUSE_COLORS.go_back },
                      { label: 'Pending', value: counts.pending, color: '#facc15' },
                      { label: 'Done', value: counts.completed, color: '#4ade80' },
                      { label: 'Answered', value: counts.answered, color: '#93c5fd' },
                      { label: 'Equiv', value: stats.totalEQ.toFixed(1), color: '#ffffff' },
                    ].map(t => (
                      <div key={t.label} className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">{t.label}</span>
                        <span className="text-lg font-bold" style={{ color: t.color }}>{t.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-800 rounded-lg py-2 px-2">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Answer rate</div>
                      <div className="text-2xl font-bold text-blue-300">{pct(counts.answerRate)}</div>
                      <div className="text-[10px] text-gray-500">{counts.answered} ÷ {counts.knocks} knocks</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2 px-2">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Closing rate</div>
                      <div className="text-2xl font-bold text-green-300">{pct(counts.closingRate)}</div>
                      <div className="text-[10px] text-gray-500">{counts.sales} ÷ {counts.answered} answered</div>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2 px-2">
                      <div className="text-[9px] uppercase font-bold text-gray-500">Avg charge</div>
                      <div className="text-2xl font-bold text-yellow-300">{avgCharge.count ? `$${Math.round(avgCharge.avg)}` : '—'}</div>
                      <div className="text-[10px] text-gray-500">${Math.round(avgCharge.total)} ÷ {avgCharge.count} done</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 flex flex-wrap gap-x-3">
                    <span>Up gross ${stats.upsellGross.toFixed(0)}</span>
                    <span>Upsells {stats.upsellCount}</span>
                    <span>Steps {stats.stepCount}</span>
                  </div>
                </>
              )}

              {statsTab === 'pace' && (
                !pace ? (
                  <div className="text-sm text-gray-500 py-6 text-center">No knocks yet today.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">Doors / hr</span>
                        <span className="text-2xl font-bold text-white">{pace.doorsPerHour.toFixed(1)}</span>
                        <span className="text-[10px] text-gray-500">{pace.n} ÷ {pace.spanHrs.toFixed(1)} h</span>
                      </div>
                      <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">First knock</span>
                        <span className="text-lg font-bold text-white">{format(pace.first, 'h:mm a')}</span>
                      </div>
                      <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">Last knock</span>
                        <span className="text-lg font-bold text-white">{format(pace.last, 'h:mm a')}</span>
                      </div>
                      <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">Longest gap</span>
                        <span className="text-lg font-bold text-orange-300">{Math.round(pace.longestGapMs / 60000)} min</span>
                        <span className="text-[10px] text-gray-500">after {format(pace.gapAt, 'h:mm a')}</span>
                      </div>
                      <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">To 1st sale</span>
                        <span className="text-lg font-bold text-green-300">{pace.minsToFirstSale == null ? '—' : `${Math.round(pace.minsToFirstSale)} min`}</span>
                      </div>
                      <div className="bg-gray-800 rounded-lg py-2 px-2 flex flex-col items-center">
                        <span className="text-[9px] uppercase font-bold text-gray-500">Between sales</span>
                        <span className="text-lg font-bold text-green-300">{pace.avgMinsBetweenSales == null ? '—' : `${Math.round(pace.avgMinsBetweenSales)} min`}</span>
                      </div>
                    </div>

                    {/* Knocks by hour */}
                    <div className="bg-gray-800 rounded-lg p-3">
                      <div className="text-[9px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-1"><Clock size={10} /> Knocks by hour <span className="text-green-400 normal-case font-normal">· green = sales</span></div>
                      {(() => {
                        const max = Math.max(1, ...pace.hours.map(h => h.knocks));
                        return (
                          <div className="flex items-end gap-1 h-20">
                            {pace.hours.map(h => (
                              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full">
                                <span className="text-[9px] text-gray-400 mb-0.5">{h.knocks || ''}</span>
                                <div className="w-full rounded-t bg-gray-600 relative" style={{ height: `${(h.knocks / max) * 100}%`, minHeight: h.knocks ? 3 : 0 }}>
                                  {h.sales > 0 && <div className="absolute bottom-0 left-0 right-0 bg-green-500 rounded-t" style={{ height: `${(h.sales / Math.max(h.knocks, 1)) * 100}%` }} />}
                                </div>
                                <span className="text-[9px] text-gray-500 mt-1">{format(new Date().setHours(h.hour, 0, 0, 0), 'ha').toLowerCase()}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Go back queue */}
                    <div className="bg-gray-800 rounded-lg p-3">
                      <div className="text-[9px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-1"><RotateCcw size={10} /> Go back queue ({goBackQueue.length})</div>
                      {goBackQueue.length === 0 ? (
                        <div className="text-xs text-gray-500">Nothing to go back to.</div>
                      ) : (
                        <div className="space-y-1">
                          {goBackQueue.map(v => (
                            <button
                              key={routeHouseId(v.house.routeCode, v.house.houseKey)}
                              onClick={() => { setShowStats(false); setFlyTo({ lng: v.house.lng, lat: v.house.lat, zoom: 18, nonce: Date.now() }); setSelectedId(routeHouseId(v.house.routeCode, v.house.houseKey)); }}
                              className="w-full text-left flex items-center gap-2 py-1.5 border-b border-gray-700/60 last:border-0"
                            >
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: HOUSE_COLORS.go_back }} />
                              <span className="text-sm text-white font-bold shrink-0">{v.house.civicNo}{(v.house.civicSuffix || '').toUpperCase()} {v.house.streetName}</span>
                              <span className="text-xs text-gray-400 truncate">{v.disposition?.note || ''}</span>
                              <span className="ml-auto text-[10px] text-gray-500 shrink-0">{format(new Date(v.disposition!.updatedAt), 'h:mm a')}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )
              )}

              {statsTab === 'coverage' && (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
                      <span className="text-[9px] uppercase font-bold text-gray-500">Knocked</span>
                      <span className="text-2xl font-bold text-white">{pct(coverage.pctKnocked)}</span>
                      <span className="text-[10px] text-gray-500">{coverage.knocked} of {coverage.total}</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
                      <span className="text-[9px] uppercase font-bold text-gray-500">Untouched</span>
                      <span className="text-2xl font-bold text-gray-300">{coverage.untouched}</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
                      <span className="text-[9px] uppercase font-bold text-gray-500">Skipped</span>
                      <span className="text-2xl font-bold text-orange-300">{coverage.skipped}</span>
                      <span className="text-[10px] text-gray-500">between knocks</span>
                    </div>
                    <div className="bg-gray-800 rounded-lg py-2 flex flex-col items-center">
                      <span className="text-[9px] uppercase font-bold text-gray-500">Streets</span>
                      <span className="text-2xl font-bold text-white">{coverage.streets.length}</span>
                    </div>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3">
                    <div className="text-[9px] uppercase font-bold text-gray-500 mb-2 flex items-center gap-1"><MapPinned size={10} /> By street <span className="normal-case font-normal">· most left to do first · tap to go there</span></div>
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[9px] uppercase font-bold text-gray-500 pb-1 border-b border-gray-700">
                      <span>Street</span><span>Knocked</span><span>Sales</span><span>Skip</span>
                    </div>
                    {coverage.streets.map(st => (
                      <button
                        key={st.key}
                        onClick={() => { setShowStats(false); setFlyTo({ lng: st.lng, lat: st.lat, zoom: 17, nonce: Date.now() }); }}
                        className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center text-left py-1.5 border-b border-gray-700/60 last:border-0"
                      >
                        <span className="text-sm text-white truncate">{st.name} <span className="text-[10px] text-gray-500 font-mono">{routeCodes.length > 1 ? st.routeCode : ''}</span></span>
                        <span className={`text-sm font-mono ${st.knocked === st.total ? 'text-green-300' : 'text-gray-200'}`}>{st.knocked}/{st.total}</span>
                        <span className="text-sm font-mono text-green-300">{st.sales || ''}</span>
                        <span className="text-sm font-mono text-orange-300">{st.skipped || ''}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* House sheet */}
        {selectedView && (
          <HouseSheet
            view={selectedView}
            saving={saving}
            onDispose={handleDispose}
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
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
} from 'lucide-react';
import { format } from 'date-fns';
import { getStorageItem, removeStorageItem } from '../../lib/localStorage';
import { sessionService } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import { commandCenterService, seasonHasTeams } from '../../lib/commandCenterService';
import { subscribeAsContractor } from '../../lib/realtimeService';
import { supabase } from '../../lib/supabase';
import { getWorkerPCL, PCLClientGroup } from '../../lib/pclCacheService';
import { Worker, SessionStats, MasterBooking, SeasonType, PendingSale, CommandCenter } from '../../types';
import LogsheetJobCard from '../Logsheet/components/LogsheetJobCard';
import AddContractModal from '../../components/AddContractModal';
import QuickPendingModal from '../../components/QuickPendingModal';
import MapLogsheetView from './MapLogsheetView';
import HouseSheet, { AddHouseSheet } from './HouseSheet';
import {
  MAP_LOGSHEET_PATH, isH01,
  SavedRouteMap, RouteHouse, HouseDisposition, HouseDispositionStatus, HouseView,
  fetchRouteMaps, ensureRouteHouses, fetchDispositions, setDisposition, clearDisposition, addManualHouse,
  indexPendingSales, indexBookings, indexPcl, buildHouseViews, routeHouseId,
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
      if (live) setStats(live.stats);
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
    return { no, notHome, goBack, pending, completed, knocks: no + notHome + goBack + pending + completed };
  }, [dispositions, houseViews]);

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
    if (id) { setPlacing(false); setPlaceAt(null); setShowJobs(false); }
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

  const Stat: React.FC<{ label: string; value: string | number; color: string }> = ({ label, value, color }) => (
    <div className="flex flex-col items-center justify-center min-w-0 px-1">
      <span className="text-[8px] uppercase font-bold text-gray-500 leading-none">{label}</span>
      <span className="text-sm font-bold leading-tight" style={{ color }}>{value}</span>
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden bg-black flex flex-col">
      {/* ── TOP STRIP ── */}
      <div className="shrink-0 bg-black/95 border-b border-gray-800 px-2 pt-2 pb-1.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2 text-white">
            <span className="font-bold text-sm">{format(new Date(), 'EEE, MMM d')}</span>
            <SeasonPill seasonType={seasonType} />
            <span className="text-[10px] text-gray-400 truncate">
              {worker?.firstName} <span className="font-mono bg-gray-800 border border-gray-700 px-1 rounded">#{worker?.contractorId}</span>
              {routeCodes.length > 0 && <span className="ml-1 font-mono text-gray-500">{routeCodes.join(' ')}</span>}
            </span>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {upsellsEnabled && (
              <button onClick={() => setShowContract(true)} className="p-2 bg-purple-600 text-white rounded-lg" title="Contract / upsell"><FileText size={16} /></button>
            )}
            <button onClick={handleLogout} className="p-2 bg-gray-800 text-red-400 rounded-lg border border-gray-700"><LogOut size={16} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 bg-gray-900 rounded-lg border border-gray-800 py-1">
          <Stat label="Knocks" value={counts.knocks} color="#e5e7eb" />
          <Stat label="No" value={counts.no} color={HOUSE_COLORS.no} />
          <Stat label="N/H" value={counts.notHome} color="#c4c8d0" />
          <Stat label="Go bk" value={counts.goBack} color={HOUSE_COLORS.go_back} />
          <Stat label="Pend" value={counts.pending} color="#facc15" />
          <Stat label="Done" value={counts.completed} color="#4ade80" />
          <Stat label="EQ" value={stats.totalEQ.toFixed(1)} color="#ffffff" />
        </div>
      </div>

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
            onSelectHouse={handleSelectHouse}
            onPlaceHouse={handlePlaceHouse}
          />
        )}

        {/* Floating action buttons (right edge, above the sheet zone) */}
        {!selectedView && !placeAt && !showJobs && (
          <div className="absolute right-3 bottom-4 z-20 flex flex-col gap-2 items-end">
            <button
              onClick={() => { setPlacing(p => !p); setSelectedId(null); }}
              className={`px-3 py-2 rounded-full shadow-lg text-xs font-bold flex items-center gap-1.5 ${placing ? 'bg-yellow-500 text-black' : 'bg-white text-gray-800 border border-gray-300'}`}
            >
              <Home size={14} /> {placing ? 'Cancel' : 'Add house'}
            </button>
            {sessionId && routeCodes.length > 0 && (
              <button
                onClick={() => setQuickPending({})}
                className="px-3 py-2 rounded-full shadow-lg text-xs font-bold flex items-center gap-1.5 bg-cps-blue text-white"
                title="Walk-up sale (not on the map)"
              >
                <Plus size={14} /> Sale
              </button>
            )}
            <button
              onClick={() => setShowJobs(true)}
              className="px-3 py-2 rounded-full shadow-lg text-xs font-bold flex items-center gap-1.5 bg-gray-900 text-white border border-gray-700"
            >
              <ListChecks size={14} /> Jobs
              {(counts.pending > 0) && <span className="ml-0.5 bg-yellow-500 text-black rounded-full px-1.5 text-[10px]">{counts.pending}</span>}
            </button>
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
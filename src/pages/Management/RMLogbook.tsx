// src/pages/Management/RMLogbook.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map as MapIcon, Loader, BookOpen, Activity, DollarSign, Clock, Lock, Unlock, Leaf, CreditCard, Shovel, Bookmark } from 'lucide-react';
// NEW: Shovel icon for Sealing badge (already imported). Bookmark icon for the
// new pending-sales count split in the 7-column header grid (team seasons only).
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession, SeasonType, PendingSale, SEASON_CONFIGS } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { commandCenterService, seasonHasTeams } from '../../lib/commandCenterService';
import { subscribeAsRouteManager } from '../../lib/realtimeService';

import RMTeamTab from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';
import RMMapTab from './components/RMMapTab';
import BamboraTransactionsModal from '../../components/BamboraTransactionsModal';

export interface TabStats {
  totalSteps: number;
  totalPending: number;
  totalEQ: number;
  workerCount: number;
  totalGross: number;
  avgEQ: number;
  totalUpsellCount: number;
  
  // Badge counters
  unassignedRoutes: number;
  unassignedBookings: number;

  // --- TEAM-SEASON-ONLY STATS (zero in Aeration, populated only when isTeamSeason) ---
  // teamTotalGross: sum of session.stats.prodGross across all the manager's cart sessions.
  //                 The new white centerpiece in the 7-col grid.
  // teamTotalPendingDollars: dollar total of pending office bookings + pending sales.
  //                          Yellow row underneath the centerpiece.
  // teamPendingSalesCount: number of pending sales across the manager's carts.
  //                        Yellow half of the green+yellow Pending count split.
  // teamPendingOfficeCount: number of pending office bookings under the manager.
  //                         Green half of the split.
  // teamCartAvgGross: teamTotalGross / sessionCount (cart count). The new bottom row in the Avg EQ cell.
  teamTotalGross: number;
  teamTotalPendingDollars: number;
  teamPendingSalesCount: number;
  teamPendingOfficeCount: number;
  teamCartAvgGross: number;
}

// --- HELPER: Parse a Price string into a dollar value ---
// Office bookings + pending sales both store price as a string field that can be:
//   - numeric: "150", "75.50"
//   - letter code: "SP", "RJ" (→ $52.50 in Aeration), "FSL" (→ $157.50 in Rejuv)
//   - blank/empty: returns 0
// Unknown letter codes return 0 — no error, just skip them.
// Used by the new Pending $ centerpiece calc. Module-scope helper so it doesn't
// recreate on every render.
function getPendingDollarValue(priceStr: string | undefined | null, seasonType: SeasonType): number {
  if (!priceStr) return 0;
  const trimmed = priceStr.trim();
  if (!trimmed) return 0;

  // Letter-only code (e.g. "SP", "RJ", "FSL"): resolve via season's office flats map
  if (/^[A-Za-z]+$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    const flat = SEASON_CONFIGS[seasonType].officeFlats.find(f => f.code === upper);
    return flat ? flat.value : 0;
  }

  // Numeric (or numeric with a $ prefix): strip non-numeric and parse
  const numeric = trimmed.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(numeric);
  return isNaN(parsed) ? 0 : parsed;
}

const RMLogbook: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'routes' | 'maps'>('team');
  
  // Lock State
  const [isTeamLocked, setIsTeamLocked] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);
  
  // Digital Mapping State
  const [digitalMappingEnabled, setDigitalMappingEnabled] = useState(false);

  // Bambora Transactions Modal State
  const [showTransactionsModal, setShowTransactionsModal] = useState(false);
  
  // Initialize Stats
  const [stats, setStats] = useState<TabStats>({
    totalSteps: 0,
    totalPending: 0,
    totalEQ: 0,
    workerCount: 0,
    totalGross: 0,
    avgEQ: 0,
    totalUpsellCount: 0,
    unassignedRoutes: 0,
    unassignedBookings: 0,
    // Team-season-only — stay at 0 in Aeration
    teamTotalGross: 0,
    teamTotalPendingDollars: 0,
    teamPendingSalesCount: 0,
    teamPendingOfficeCount: 0,
    teamCartAvgGross: 0,
  });

  // Data State
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailySessionData | null>(null);
  const [allSessions, setAllSessions] = useState<LogsheetSession[]>([]);
  
  // Season Type
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  // CHANGED: was a single isLawnRejuv flag. Now two flags side-by-side so the
  // header badge can render either a Rejuv pill (Leaf + green) or a Sealing pill
  // (Shovel + slate-gray). Aeration shows no badge, same as before.
  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isSealing = seasonType === 'sealing';
  // NEW: team-season flag — drives the conditional render between the existing
  // 6-col stats grid (Aeration) and the new 7-col grid (Rejuv + Sealing).
  const isTeamSeason = seasonHasTeams(seasonType);

  // NEW: Pending sales fetched separately because they aren't part of the
  // existing `allSessions` payload. Refreshed alongside the daily session.
  // Aeration stays at [] — never fetched.
  const [pendingSalesByManager, setPendingSalesByManager] = useState<PendingSale[]>([]);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Shared Data Fetcher ---
  // CHANGED: Now also fetches pending sales for the manager's carts when the
  // active session is a team season. Aeration skips the pending sales fetch.
  const refreshData = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(async () => {
        try {
          console.log('🔄 RM Logbook: Refreshing Data...');
          const [session, sessions] = await Promise.all([
            sessionService.getDailySession(),
            sessionService.getLogsheetSessions()
          ]);
          setDailyData(session);
          setAllSessions(sessions);
          
          // Update season type from session
          if (session?.seasonType) {
            setSeasonType(session.seasonType);
          }

          // Fetch pending sales for this manager's carts — team seasons only
          const sessionSeasonType = session?.seasonType || 'aeration';
          const userId = currentUser?.userId;
          if (seasonHasTeams(sessionSeasonType) && userId) {
            try {
              const pendingSales = await sessionService.getPendingSalesForManager(userId);
              setPendingSalesByManager(pendingSales);
            } catch (err) {
              console.warn('Failed to fetch pending sales for manager:', err);
              setPendingSalesByManager([]);
            }
          } else {
            setPendingSalesByManager([]);
          }
        } catch (err) {
          console.error('Failed to refresh RM Logbook data', err);
        }
    }, 500);
  };

  // --- Check Team Lock Status ---
  const checkLockStatus = async (userId: string) => {
    try {
      const locked = await sessionService.getTeamLockStatus(userId);
      setIsTeamLocked(locked);
    } catch (err) {
      console.error('Failed to check lock status:', err);
    }
  };

  // --- Toggle Lock ---
  const handleToggleLock = async () => {
    if (!currentUser || lockLoading) return;
    
    setLockLoading(true);
    try {
      if (isTeamLocked) {
        await sessionService.unlockTeamSessions(currentUser.userId);
        setIsTeamLocked(false);
      } else {
        await sessionService.lockTeamSessions(currentUser.userId);
        setIsTeamLocked(true);
      }
    } catch (err) {
      console.error('Failed to toggle lock:', err);
    } finally {
      setLockLoading(false);
    }
  };

  // --- Initial Load ---
  useEffect(() => {
    const init = async () => {
      const user = getStorageItem<ManagementUser | null>('current_user', null);
      if (!user || user.role !== 'RouteManager') {
        navigate('/');
        return;
      }
      setCurrentUser(user);
      
      // Check if digital mapping is enabled for this CC
      const hasMapping = commandCenterService.currentHasDigitalMapping();
      setDigitalMappingEnabled(hasMapping);
      
      // DEFAULT to Map tab when digital mapping is enabled
      if (hasMapping) {
        setActiveTab('maps');
      }

      await refreshData();
      await checkLockStatus(user.userId);
      setLoading(false);
    };
    init();

    return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [navigate]);

  // --- Compute my team's worker IDs for filtering ---
  const myTeamIds = useMemo(() => {
    if (!dailyData || !currentUser) return [];
    return dailyData.workers
      .filter(w => w.assignedManagerId === currentUser.userId)
      .map(w => w.contractorId);
  }, [dailyData, currentUser]);

  // --- Realtime Subscription (Optimized) ---
  useEffect(() => {
    if (!dailyData?.date || !currentUser) return;

    console.log('📡 Connecting to Realtime Updates (Filtered)...');

    const unsubscribe = subscribeAsRouteManager(refreshData);

    // Fallback polling
    const intervalId = setInterval(refreshData, 30000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, [dailyData?.date, currentUser?.userId, myTeamIds]);


  // --- CENTRALIZED STAT CALCULATION ---
  // CHANGED: Team-season-only stats (teamTotalGross, teamTotalPendingDollars,
  // teamPendingSalesCount, teamPendingOfficeCount, teamCartAvgGross) calculated
  // alongside the existing stats. Gated behind isTeamSeason — Aeration skips
  // the entire team-season block and the new fields stay at 0.
  useEffect(() => {
    if (!dailyData || !allSessions || !currentUser) return;

    const myTeam = dailyData.workers.filter(w => w.assignedManagerId === currentUser.userId);
    const myTeamIdsSet = new Set(myTeam.map(w => w.contractorId));

    const mySessions = allSessions.filter(s => {
      if (myTeamIdsSet.has(s.workerId)) return true;
      if (s.teamWorkerIds && s.teamWorkerIds.length > 0) {
        return s.teamWorkerIds.some(wid => myTeamIdsSet.has(wid));
      }
      return false;
    });

    const myRoutes = dailyData.routes.filter(r => r.managerId === currentUser.userId);
    const myRouteCodes = new Set(myRoutes.map(r => r.routeCode));

    const workerCount = myTeam.length;

    const countedSessionIds = new Set<string>();
    let totalSteps = 0;
    let totalTeamEQ = 0;
    let totalUpsellCount = 0;
    let totalUpsellGross = 0;

    // NEW: team-season aggregations — captured in the same session loop to
    // avoid iterating allSessions twice. Stay at 0 in Aeration.
    let teamTotalGross = 0;

    mySessions.forEach(s => {
      if (!countedSessionIds.has(s.id)) {
        countedSessionIds.add(s.id);
        totalSteps += s.stats?.stepCount || 0;
        totalTeamEQ += s.stats?.totalEQ || 0;
        totalUpsellCount += s.stats?.upsellCount || 0;
        totalUpsellGross += s.stats?.upsellGross || 0;
        // Sum prodGross for the new Total Gross centerpiece — tax-inclusive,
        // matches what payout pages show. Only used when isTeamSeason.
        teamTotalGross += s.stats?.prodGross || 0;
      }
    });

    const assignedPendingCount = dailyData.pendingBookings.filter(b => 
        b['Contractor Number'] && myTeamIdsSet.has(b['Contractor Number'])
    ).length;
    
    const unassignedBookingsCount = dailyData.pendingBookings.filter(b => 
        b['Route Number'] && myRouteCodes.has(b['Route Number']) && !b['Contractor Number']
    ).length;

    const totalPending = assignedPendingCount + unassignedBookingsCount;

    const sessionCount = countedSessionIds.size;
    const avgEQ = sessionCount > 0 ? (totalTeamEQ / sessionCount) : 0;

    const unassignedRoutesCount = myRoutes.filter(r => !r.assignedWorkerIds || r.assignedWorkerIds.length === 0).length;

    // --- TEAM-SEASON-ONLY STAT CALCULATIONS ---
    // Run only in Rejuv + Sealing. Aeration falls through with all team fields = 0.
    let teamTotalPendingDollars = 0;
    let teamPendingSalesCount = 0;
    let teamPendingOfficeCount = 0;
    let teamCartAvgGross = 0;

    if (isTeamSeason) {
      // Office pending dollars: every pending booking under this manager's
      // workers OR on this manager's routes (assigned + unassigned, same as
      // the totalPending count above).
      const myPendingOfficeBookings = dailyData.pendingBookings.filter(b => {
        const isAssignedToMyWorker = b['Contractor Number'] && myTeamIdsSet.has(b['Contractor Number']);
        const isOnMyRoute = b['Route Number'] && myRouteCodes.has(b['Route Number']) && !b['Contractor Number'];
        return isAssignedToMyWorker || isOnMyRoute;
      });
      teamPendingOfficeCount = myPendingOfficeBookings.length;

      const officePendingDollars = myPendingOfficeBookings.reduce(
        (sum, b) => sum + getPendingDollarValue(b.Price, seasonType),
        0
      );

      // Pending sales dollars: every pending sale in this manager's carts.
      // pendingSalesByManager was fetched in refreshData (gated behind isTeamSeason).
      teamPendingSalesCount = pendingSalesByManager.length;
      const pendingSalesDollars = pendingSalesByManager.reduce(
        (sum, ps) => sum + getPendingDollarValue(ps.price, seasonType),
        0
      );

      teamTotalPendingDollars = officePendingDollars + pendingSalesDollars;

      // Cart Avg = total gross / cart count. Same denominator as Avg EQ uses
      // (sessionCount = unique session ids = unique carts in team seasons).
      teamCartAvgGross = sessionCount > 0 ? (teamTotalGross / sessionCount) : 0;
    }

    setStats({
        workerCount,
        totalSteps,
        totalPending,
        avgEQ,
        totalUpsellCount,
        totalGross: totalUpsellGross,  // existing field, name is legacy (used for Up $)
        totalEQ: totalTeamEQ,
        unassignedRoutes: unassignedRoutesCount,
        unassignedBookings: unassignedBookingsCount,
        // Team-season fields
        teamTotalGross,
        teamTotalPendingDollars,
        teamPendingSalesCount,
        teamPendingOfficeCount,
        teamCartAvgGross,
    });

  }, [dailyData, allSessions, currentUser, isTeamSeason, pendingSalesByManager, seasonType]);if (loading || !currentUser || !dailyData)
  return (
    <div className="flex h-screen items-center justify-center bg-gray-900">
      <Loader className="animate-spin text-cps-blue" />
    </div>
  );

return (
  <div className="min-h-screen bg-gray-900 text-white flex flex-col">
    {/* HEADER - Compact Single Row */}
    <div className="bg-gray-800 border-b border-gray-700 shadow-md sticky top-0 z-10">
      
      {/* Single Row Header: Logo/Name | Lock | Tabs */}
      <div className="flex items-center justify-between gap-2 p-2 px-3">
        {/* Left: Logo + Name + Season Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="text-cps-blue flex-shrink-0" size={18} />
          <span className="text-sm font-bold text-white truncate">
            {currentUser.name}
          </span>
          {/* CHANGED: was a 1-way pill (Rejuv only with Leaf + green). Now
              2-way: Rejuv keeps Leaf + green + "Rejuv", Sealing gets Shovel +
              slate-gray + "Sealing". Aeration still shows no pill. */}
          {isLawnRejuv && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-700/50">
              <Leaf size={10} />
              Rejuv
            </span>
          )}
          {isSealing && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600">
              <Shovel size={10} />
              Sealing
            </span>
          )}
        </div>

        {/* Right: Transactions Button + Lock Button + Tabs */}
        <div className="flex items-center gap-2">
          {/* Bambora Transactions Button */}
          <button
            onClick={() => setShowTransactionsModal(true)}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all"
            title="View Today's Card Transactions"
          >
            <CreditCard size={16} />
          </button>

          {/* Lock Toggle Button */}
          <button
            onClick={handleToggleLock}
            disabled={lockLoading}
            className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all ${
              lockLoading 
                ? 'bg-gray-700 cursor-wait' 
                : isTeamLocked 
                  ? 'bg-red-600 hover:bg-red-500 text-white' 
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
            title={isTeamLocked ? 'Team Locked - Click to Unlock' : 'Team Unlocked - Click to Lock'}
          >
            {lockLoading ? (
              <Loader size={16} className="animate-spin" />
            ) : isTeamLocked ? (
              <Lock size={16} />
            ) : (
              <Unlock size={16} />
            )}
          </button>

          {/* Tab Buttons */}
          <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-700/50">
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'team'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Users size={14} />
              Team
            </button>
            
            <button
              onClick={() => setActiveTab('routes')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'routes'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <MapIcon size={14} /> Routes
              {stats.unassignedRoutes > 0 && (
                <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] bg-red-500 text-white rounded-full font-bold">
                  {stats.unassignedRoutes}
                </span>
              )}
            </button>

            {/* Maps Tab — only when digital mapping is enabled */}
            {digitalMappingEnabled && (
              <button
                onClick={() => setActiveTab('maps')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === 'maps'
                    ? 'bg-gray-700 text-white shadow-sm'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <MapIcon size={14} /> Map
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          STATS GRID — Branched by season:
            Aeration: existing 6-column grid (verbatim, untouched)
            Team seasons: new 7-column grid with 2× centerpiece
          ============================================================ */}

      {/* ────── AERATION: EXISTING 6-COLUMN GRID (verbatim, do not modify) ────── */}
      {!isTeamSeason && (
        <div className="grid grid-cols-6 gap-px bg-gray-700 border-t border-gray-700">
            
            {/* 1. Workers */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Workers</span>
                <div className="flex items-center gap-1 text-blue-300 font-bold text-base">
                    <Users size={12} className="opacity-70" /> {stats.workerCount}
                </div>
            </div>

            {/* 2. Steps */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Steps</span>
                <div className="flex items-center gap-1 text-white font-bold text-base">
                    <Activity size={12} className="opacity-70 text-green-400" /> {stats.totalSteps}
                </div>
            </div>

            {/* 3. Pending */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Pending</span>
                <div className="flex items-center gap-1 text-yellow-400 font-bold text-base">
                    <Clock size={12} className="opacity-70" /> {stats.totalPending}
                </div>
            </div>

            {/* 4. Avg EQ */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Avg EQ</span>
                <div className={`font-bold text-base ${
                    stats.avgEQ >= 3 ? 'text-green-400' : stats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                    {stats.avgEQ.toFixed(2)}
                </div>
            </div>

             {/* 5. Upsells */}
             <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Upsells</span>
                <div className="text-purple-300 font-bold text-base">
                    {stats.totalUpsellCount}
                </div>
            </div>

             {/* 6. Up $ */}
             <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Up $</span>
                <div className="flex items-center gap-0.5 text-purple-400 font-bold text-base">
                    <DollarSign size={12} className="opacity-70" /> 
                    {stats.totalGross.toFixed(0)}
                </div>
            </div>

        </div>
      )}

      {/* ────── TEAM SEASONS: NEW 7-COLUMN GRID ──────
          Desktop layout (sm and up): 7 columns with the centerpiece at 2× width.
            [Workers] [Steps] [Pending split] [TOTAL GROSS + PENDING $ (2x wide)] [Avg EQ + Cart Avg] [Upsells] [Up $]
          Mobile layout (< sm): centerpiece stacks full-width on top, other 6 stats
            in a 3-col grid below (top: Workers/Steps/Pending, bottom: AvgEQ/Upsells/Up$). */}
      {isTeamSeason && (
        <div className="border-t border-gray-700">
          {/* Mobile: centerpiece on its own full-width row */}
          <div className="sm:hidden bg-gray-800 p-3 flex flex-col items-center justify-center border-b border-gray-700">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-1">Total Gross</span>
            <div className="flex items-center gap-1 text-white font-bold text-2xl">
              <DollarSign size={18} className="opacity-70" />
              {stats.teamTotalGross.toFixed(0)}
            </div>
            <div className="flex items-center gap-1 text-yellow-400 font-medium text-xs mt-1">
              <span className="text-gray-500 text-[9px] uppercase tracking-wider">Pending $:</span>
              <DollarSign size={10} className="opacity-70" />
              <span>{stats.teamTotalPendingDollars.toFixed(0)}</span>
            </div>
          </div>

          {/* Mobile: 3-col grid for the other 6 stats */}
          <div className="grid grid-cols-3 gap-px bg-gray-700 sm:hidden">
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Workers</span>
              <div className="flex items-center gap-1 text-blue-300 font-bold text-base">
                <Users size={12} className="opacity-70" /> {stats.workerCount}
              </div>
            </div>
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Steps</span>
              <div className="flex items-center gap-1 text-white font-bold text-base">
                <Activity size={12} className="opacity-70 text-green-400" /> {stats.totalSteps}
              </div>
            </div>
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Pending</span>
              {/* Green office count + yellow pending sales count (count split) */}
              <div className="flex items-center gap-1 font-bold text-base">
                <Clock size={12} className="text-yellow-400 opacity-70" />
                <span className="text-green-400">{stats.teamPendingOfficeCount}</span>
                {stats.teamPendingSalesCount > 0 && (
                  <>
                    <span className="text-gray-500 text-xs">+</span>
                    <span className="text-yellow-400 flex items-center gap-0.5">
                      <Bookmark size={10} />
                      {stats.teamPendingSalesCount}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Avg EQ</span>
              <div className={`font-bold text-base ${
                stats.avgEQ >= 3 ? 'text-green-400' : stats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {stats.avgEQ.toFixed(2)}
              </div>
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold mt-0.5">Cart Avg</span>
              <div className="flex items-center gap-0.5 text-gray-300 text-xs font-medium">
                <DollarSign size={9} className="opacity-70" />
                {stats.teamCartAvgGross.toFixed(0)}
              </div>
            </div>
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Upsells</span>
              <div className="text-purple-300 font-bold text-base">
                {stats.totalUpsellCount}
              </div>
            </div>
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Up $</span>
              <div className="flex items-center gap-0.5 text-purple-400 font-bold text-base">
                <DollarSign size={12} className="opacity-70" />
                {stats.totalGross.toFixed(0)}
              </div>
            </div>
          </div>

          {/* Desktop: single row, 7 columns (centerpiece spans 2) */}
          <div className="hidden sm:grid grid-cols-7 gap-px bg-gray-700">
            {/* 1. Workers */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Workers</span>
              <div className="flex items-center gap-1 text-blue-300 font-bold text-base">
                <Users size={12} className="opacity-70" /> {stats.workerCount}
              </div>
            </div>

            {/* 2. Steps */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Steps</span>
              <div className="flex items-center gap-1 text-white font-bold text-base">
                <Activity size={12} className="opacity-70 text-green-400" /> {stats.totalSteps}
              </div>
            </div>

            {/* 3. Pending — green office count + yellow pending sales count split */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Pending</span>
              <div className="flex items-center gap-1 font-bold text-base">
                <Clock size={12} className="text-yellow-400 opacity-70" />
                <span className="text-green-400">{stats.teamPendingOfficeCount}</span>
                {stats.teamPendingSalesCount > 0 && (
                  <>
                    <span className="text-gray-500 text-xs">+</span>
                    <span className="text-yellow-400 flex items-center gap-0.5">
                      <Bookmark size={10} />
                      {stats.teamPendingSalesCount}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* 4. CENTERPIECE — Total Gross (white, large) + Pending $ (yellow, smaller).
                Spans 2 columns to dominate the visual hierarchy. */}
            <div className="col-span-2 bg-gray-800 p-2 flex flex-col items-center justify-center">
              <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold">Total Gross</span>
              <div className="flex items-center gap-1 text-white font-bold text-2xl leading-tight">
                <DollarSign size={18} className="opacity-70" />
                {stats.teamTotalGross.toFixed(0)}
              </div>
              <div className="flex items-center gap-1 text-yellow-400 font-medium text-xs mt-0.5">
                <span className="text-gray-500 text-[9px] uppercase tracking-wider">Pending $:</span>
                <DollarSign size={10} className="opacity-70" />
                <span>{stats.teamTotalPendingDollars.toFixed(0)}</span>
              </div>
            </div>

            {/* 5. Avg EQ (top) + Cart Avg (bottom) — two-row stat cell */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Avg EQ</span>
              <div className={`font-bold text-base ${
                stats.avgEQ >= 3 ? 'text-green-400' : stats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {stats.avgEQ.toFixed(2)}
              </div>
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold mt-1">Cart Avg</span>
              <div className="flex items-center gap-0.5 text-gray-300 text-xs font-medium">
                <DollarSign size={9} className="opacity-70" />
                {stats.teamCartAvgGross.toFixed(0)}
              </div>
            </div>

            {/* 6. Upsells */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Upsells</span>
              <div className="text-purple-300 font-bold text-base">
                {stats.totalUpsellCount}
              </div>
            </div>

            {/* 7. Up $ */}
            <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
              <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Up $</span>
              <div className="flex items-center gap-0.5 text-purple-400 font-bold text-base">
                <DollarSign size={12} className="opacity-70" />
                {stats.totalGross.toFixed(0)}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>

    {/* CONTENT */}
    <div className={`flex-1 overflow-hidden ${activeTab !== 'maps' ? 'p-4' : ''} relative`}>
      {activeTab !== 'maps' ? (
        <div className="h-full overflow-y-auto custom-scrollbar">
          {activeTab === 'team' && (
            <RMTeamTab
              managerId={currentUser.userId}
              workers={dailyData.workers}
              allSessions={allSessions}
              allManagers={dailyData.managers}
              seasonType={seasonType}
              currentUser={currentUser}
            />
          )}
          {activeTab === 'routes' && (
            <RMRoutesTab
              managerId={currentUser.userId}
              routes={dailyData.routes}
              bookings={dailyData.pendingBookings}
              workers={dailyData.workers}
              managers={dailyData.managers}
              seasonType={seasonType}
              teamCarts={dailyData.teamCarts}
              allSessions={allSessions}
              onRefresh={() => { refreshData(); }} 
            />
          )}
        </div>
      ) : (
        <RMMapTab
          managerId={currentUser.userId}
          routes={dailyData.routes}
          bookings={dailyData.pendingBookings}
          allSessions={allSessions}
          workers={dailyData.workers}
          currentUser={currentUser}
          onRefresh={refreshData}
        />
      )}
    </div>

    {/* Bambora Transactions Modal */}
    {showTransactionsModal && (
      <BamboraTransactionsModal
        sessionDate={dailyData.date}
        onClose={() => setShowTransactionsModal(false)}
      />
    )}
  </div>
);
};

export default RMLogbook;
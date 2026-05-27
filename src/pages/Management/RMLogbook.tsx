// src/pages/Management/RMLogbook.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map as MapIcon, Loader, BookOpen, Activity, DollarSign, Clock, Lock, Unlock, Leaf, CreditCard, Shovel, Bookmark } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession, SeasonType, PendingSale, SEASON_CONFIGS } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { commandCenterService, seasonHasTeams } from '../../lib/commandCenterService';
import { subscribeAsRouteManager } from '../../lib/realtimeService';

import RMTeamTab from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';
import RMMapTab from './components/RMMapTab';
import BamboraTransactionsModal from '../../components/BamboraTransactionsModal';
import RMAsphaltModal from '../../components/RMAsphaltModal';

export interface TabStats {
  totalSteps: number;
  totalPending: number;
  totalEQ: number;
  workerCount: number;
  totalGross: number;
  avgEQ: number;
  totalUpsellCount: number;

  unassignedRoutes: number;
  unassignedBookings: number;

  teamTotalGross: number;
  teamTotalPendingDollars: number;
  teamPendingSalesCount: number;
  teamPendingOfficeCount: number;
  teamCartAvgGross: number;
}

function getPendingDollarValue(priceStr: string | undefined | null, seasonType: SeasonType): number {
  if (!priceStr) return 0;
  const trimmed = priceStr.trim();
  if (!trimmed) return 0;

  if (/^[A-Za-z]+$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    const flat = SEASON_CONFIGS[seasonType].officeFlats.find(f => f.code === upper);
    return flat ? flat.value : 0;
  }

  const numeric = trimmed.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(numeric);
  return isNaN(parsed) ? 0 : parsed;
}

const RMLogbook: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'routes' | 'maps'>('team');

  const [isTeamLocked, setIsTeamLocked] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);

  const [digitalMappingEnabled, setDigitalMappingEnabled] = useState(false);

  const [showTransactionsModal, setShowTransactionsModal] = useState(false);

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
    teamTotalGross: 0,
    teamTotalPendingDollars: 0,
    teamPendingSalesCount: 0,
    teamPendingOfficeCount: 0,
    teamCartAvgGross: 0,
  });

  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailySessionData | null>(null);
  const [allSessions, setAllSessions] = useState<LogsheetSession[]>([]);

  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isSealing = seasonType === 'sealing';
  const isTeamSeason = seasonHasTeams(seasonType);

  const [pendingSalesByManager, setPendingSalesByManager] = useState<PendingSale[]>([]);

  const [showAsphaltModal, setShowAsphaltModal] = useState(false);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const refreshData = async (overrideUser?: ManagementUser) => {
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

          if (session?.seasonType) {
            setSeasonType(session.seasonType);
          }

          const sessionSeasonType = session?.seasonType || 'aeration';
          const userId = overrideUser?.userId || currentUser?.userId;
          if (seasonHasTeams(sessionSeasonType) && session && userId) {
            try {
              const myWorkerIds = new Set(
                session.workers
                  .filter(w => w.assignedManagerId === userId)
                  .map(w => w.contractorId)
              );
              const mySessions = sessions.filter(s => {
                const ids = s.teamWorkerIds || [s.workerId];
                return ids.some(id => myWorkerIds.has(id));
              });
              const pendingSalesArrays = await Promise.all(
                mySessions.map(s => sessionService.getPendingSalesForSession(s.id))
              );
              const allPendingSales = pendingSalesArrays.flat();
              setPendingSalesByManager(allPendingSales);
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

  const checkLockStatus = async (userId: string) => {
    try {
      const locked = await sessionService.getTeamLockStatus(userId);
      setIsTeamLocked(locked);
    } catch (err) {
      console.error('Failed to check lock status:', err);
    }
  };

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

  useEffect(() => {
    const init = async () => {
      const user = getStorageItem<ManagementUser | null>('current_user', null);
      if (!user || user.role !== 'RouteManager') {
        navigate('/');
        return;
      }
      setCurrentUser(user);

      const hasMapping = commandCenterService.currentHasDigitalMapping();
      setDigitalMappingEnabled(hasMapping);

      if (hasMapping) {
        setActiveTab('maps');
      }

      await refreshData(user);
      await checkLockStatus(user.userId);
      setLoading(false);
    };
    init();

    return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [navigate]);

  // Defensive: if mapping is on and the active tab is anything other than 'maps',
  // force it back to 'maps'. Belt-and-braces in case state gets out of sync.
  useEffect(() => {
    if (digitalMappingEnabled && activeTab !== 'maps') {
      setActiveTab('maps');
    }
  }, [digitalMappingEnabled, activeTab]);

  const myTeamIds = useMemo(() => {
    if (!dailyData || !currentUser) return [];
    return dailyData.workers
      .filter(w => w.assignedManagerId === currentUser.userId)
      .map(w => w.contractorId);
  }, [dailyData, currentUser]);

  const unassignedAsphaltCount = useMemo(() => {
    if (!isSealing) return 0;
    return pendingSalesByManager.filter(
      ps => ps.saleType === 'asphalt' && !ps.assignedRcSessionId
    ).length;
  }, [pendingSalesByManager, isSealing]);

  useEffect(() => {
    if (!dailyData?.date || !currentUser) return;

    console.log('📡 Connecting to Realtime Updates (Filtered)...');

    const unsubscribe = subscribeAsRouteManager(refreshData);

    const intervalId = setInterval(refreshData, 30000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, [dailyData?.date, currentUser?.userId, myTeamIds]);


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
    let teamTotalGross = 0;

    mySessions.forEach(s => {
      if (!countedSessionIds.has(s.id)) {
        countedSessionIds.add(s.id);
        totalSteps += s.stats?.stepCount || 0;
        totalTeamEQ += s.stats?.totalEQ || 0;
        totalUpsellCount += s.stats?.upsellCount || 0;
        totalUpsellGross += s.stats?.upsellGross || 0;
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

    let teamTotalPendingDollars = 0;
    let teamPendingSalesCount = 0;
    let teamPendingOfficeCount = 0;
    let teamCartAvgGross = 0;

    if (isTeamSeason) {
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

      teamPendingSalesCount = pendingSalesByManager.length;
      const pendingSalesDollars = pendingSalesByManager.reduce(
        (sum, ps) => sum + getPendingDollarValue(ps.price, seasonType),
        0
      );

      teamTotalPendingDollars = officePendingDollars + pendingSalesDollars;

      teamCartAvgGross = sessionCount > 0 ? (teamTotalGross / sessionCount) : 0;
    }

    setStats({
        workerCount,
        totalSteps,
        totalPending,
        avgEQ,
        totalUpsellCount,
        totalGross: totalUpsellGross,
        totalEQ: totalTeamEQ,
        unassignedRoutes: unassignedRoutesCount,
        unassignedBookings: unassignedBookingsCount,
        teamTotalGross,
        teamTotalPendingDollars,
        teamPendingSalesCount,
        teamPendingOfficeCount,
        teamCartAvgGross,
    });

  }, [dailyData, allSessions, currentUser, isTeamSeason, pendingSalesByManager, seasonType]);

  if (loading || !currentUser || !dailyData)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="bg-gray-800 border-b border-gray-700 shadow-md sticky top-0 z-10">

        <div className="flex items-center justify-between gap-2 p-2 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="text-cps-blue flex-shrink-0" size={18} />
            <span className="text-sm font-bold text-white truncate">
              {currentUser.name}
            </span>
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTransactionsModal(true)}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-all"
              title="View Today's Card Transactions"
            >
              <CreditCard size={16} />
            </button>

            {isSealing && (
              <button
                onClick={() => setShowAsphaltModal(true)}
                className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 text-amber-300 hover:text-amber-200 transition-all"
                title={
                  unassignedAsphaltCount > 0
                    ? `${unassignedAsphaltCount} asphalt ${unassignedAsphaltCount === 1 ? 'row' : 'rows'} awaiting RC assignment`
                    : 'Asphalt queue (none waiting)'
                }
              >
                <Shovel size={16} />
                {unassignedAsphaltCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] bg-amber-600 text-white rounded-full font-bold border border-gray-800">
                    {unassignedAsphaltCount}
                  </span>
                )}
              </button>
            )}

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

            <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-700/50">
              {/* Team tab — hidden when digital mapping is on. Manage Team modal in the map
                  replaces the per-worker management actions; the team list itself is in the
                  map sidebar. */}
              {!digitalMappingEnabled && (
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
              )}

              {/* Routes tab — hidden when digital mapping is on. The map's Routes sidebar mode
                  plus the route prebookings popup cover everything Routes tab used to do. */}
              {!digitalMappingEnabled && (
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
              )}

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

        {/* AERATION: existing 6-column grid (untouched) */}
        {!isTeamSeason && (
          <div className="grid grid-cols-6 gap-px bg-gray-700 border-t border-gray-700">

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
                  <div className="flex items-center gap-1 text-yellow-400 font-bold text-base">
                      <Clock size={12} className="opacity-70" /> {stats.totalPending}
                  </div>
              </div>

              <div className="bg-gray-800 p-1.5 flex flex-col items-center justify-center">
                  <span className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Avg EQ</span>
                  <div className={`font-bold text-base ${
                      stats.avgEQ >= 3 ? 'text-green-400' : stats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                      {stats.avgEQ.toFixed(2)}
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
        )}

        {/* TEAM SEASONS: 8-column grid (6 small cells of 1-width each + centerpiece spanning 2)
            Mobile: centerpiece stacks on top in its own row, other 6 stats in 3-col grid below */}
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

            {/* Desktop: 8 columns total. 6 small cells (1 width each) + centerpiece (2 widths). */}
            <div className="hidden sm:grid grid-cols-8 gap-px bg-gray-700">
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
          </div>
        )}

      </div>

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
            allManagers={dailyData.managers}
            seasonType={seasonType}
            teamCarts={dailyData.teamCarts}
            pendingSalesByManager={pendingSalesByManager}
            onRefresh={refreshData}
          />
        )}
      </div>

      {showTransactionsModal && (
        <BamboraTransactionsModal
          sessionDate={dailyData.date}
          onClose={() => setShowTransactionsModal(false)}
        />
      )}

      {showAsphaltModal && (
        <RMAsphaltModal
          managerId={currentUser.userId}
          managerName={currentUser.name}
          onClose={() => setShowAsphaltModal(false)}
          onAssignmentChange={() => refreshData()}
        />
      )}
    </div>
  );
};

export default RMLogbook;
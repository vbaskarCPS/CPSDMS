// src/pages/Management/RMLogbook.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map as MapIcon, Loader, BookOpen, Activity, DollarSign, Clock, Lock, Unlock, Leaf } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession, SeasonType } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { commandCenterService } from '../../lib/commandCenterService';
import { subscribeAsRouteManager } from '../../lib/realtimeService';

import RMTeamTab from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';
import RMMapTab from './components/RMMapTab';

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
  });

  // Data State
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailySessionData | null>(null);
  const [allSessions, setAllSessions] = useState<LogsheetSession[]>([]);
  
  // Season Type
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  const isLawnRejuv = seasonType === 'lawn_rejuv';

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Shared Data Fetcher ---
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

    mySessions.forEach(s => {
      if (!countedSessionIds.has(s.id)) {
        countedSessionIds.add(s.id);
        totalSteps += s.stats?.stepCount || 0;
        totalTeamEQ += s.stats?.totalEQ || 0;
        totalUpsellCount += s.stats?.upsellCount || 0;
        totalUpsellGross += s.stats?.upsellGross || 0;
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
    });

  }, [dailyData, allSessions, currentUser]);


  if (loading || !currentUser || !dailyData)
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
            {/* Season Badge */}
            {isLawnRejuv && (
              <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-700/50">
                <Leaf size={10} />
                Rejuv
              </span>
            )}
          </div>

          {/* Right: Lock Button + Tabs */}
          <div className="flex items-center gap-2">
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

        {/* Stats Grid Row */}
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
    </div>
  );
};

export default RMLogbook;
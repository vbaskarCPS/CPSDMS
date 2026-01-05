// src/pages/Management/RMLogbook.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map, Loader, Calendar, BookOpen, Activity, DollarSign, Clock } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { subscribeAsRouteManager } from '../../lib/realtimeService';

import RMTeamTab from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';

export interface TabStats {
  totalSteps: number;
  totalPending: number;
  totalEQ: number;
  workerCount: number;
  totalGross: number; // This will represent Up $ (Upsell Gross) per your request
  avgEQ: number;
  totalUpsellCount: number;
  
  // Badge counters
  unassignedRoutes: number;
  unassignedBookings: number;
}

const RMLogbook: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'routes'>('team');
  
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
    unassignedBookings: 0
  });

  // Data State
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailySessionData | null>(null);
  const [allSessions, setAllSessions] = useState<LogsheetSession[]>([]);

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
        } catch (err) {
          console.error('Failed to refresh RM Logbook data', err);
        }
    }, 500);
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

      await refreshData();
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

    // Subscribe with filtering for this manager's team
    const unsubscribe = subscribeAsRouteManager(
      currentUser.userId,
      myTeamIds,
      refreshData
    );

    // Fallback polling - reduced from 10s to 30s since realtime is better now
    const intervalId = setInterval(refreshData, 30000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, [dailyData?.date, currentUser?.userId, myTeamIds]);


  // --- CENTRALIZED STAT CALCULATION ---
  useEffect(() => {
    if (!dailyData || !allSessions || !currentUser) return;

    // 1. Identify "My Team"
    const myTeam = dailyData.workers.filter(w => w.assignedManagerId === currentUser.userId);
    const myTeamIdsSet = new Set(myTeam.map(w => w.contractorId));

    // 2. Identify "My Team's Sessions" (for Steps, EQ, Upsells)
    const mySessions = allSessions.filter(s => myTeamIdsSet.has(s.workerId));

    // 3. Identify "My Routes" (for Unassigned badges)
    const myRoutes = dailyData.routes.filter(r => r.managerId === currentUser.userId);
    const myRouteCodes = new Set(myRoutes.map(r => r.routeCode));

    // --- CALCULATIONS ---

    // A. Worker Count
    const workerCount = myTeam.length;

    // B. Steps (Sum from sessions)
    const totalSteps = mySessions.reduce((sum, s) => sum + (s.stats?.stepCount || 0), 0);

    // C. Pending (Sum of incomplete bookings assigned to my team)
    // We assume dailyData.pendingBookings contains all incomplete jobs for the day
    const assignedPendingCount = dailyData.pendingBookings.filter(b => 
        b['Contractor Number'] && myTeamIdsSet.has(b['Contractor Number'])
    ).length;
    
    // We also include unassigned bookings in the pending count if that is the desired behavior for "Pending"
    // However, usually "Pending" for a manager means "Total work left to do".
    // Let's count Unassigned Bookings relevant to this manager's routes separately.
    const unassignedBookingsCount = dailyData.pendingBookings.filter(b => 
        b['Route Number'] && myRouteCodes.has(b['Route Number']) && !b['Contractor Number']
    ).length;

    const totalPending = assignedPendingCount + unassignedBookingsCount;

    // D. Avg EQ
    // Formula: (Total EQ of all workers) / (Number of workers)
    const totalTeamEQ = mySessions.reduce((sum, s) => sum + (s.stats?.totalEQ || 0), 0);
    const avgEQ = workerCount > 0 ? (totalTeamEQ / workerCount) : 0;

    // E. Upsell Count
    const totalUpsellCount = mySessions.reduce((sum, s) => sum + (s.stats?.upsellCount || 0), 0);

    // F. Up $ (Upsell Gross)
    const totalUpsellGross = mySessions.reduce((sum, s) => sum + (s.stats?.upsellGross || 0), 0);

    // G. Unassigned Routes (Badge)
    const unassignedRoutesCount = myRoutes.filter(r => !r.assignedWorkerId).length;

    setStats({
        workerCount,
        totalSteps,
        totalPending,
        avgEQ,
        totalUpsellCount,
        totalGross: totalUpsellGross, // Mapping "Up $" to this field
        totalEQ: totalTeamEQ,
        unassignedRoutes: unassignedRoutesCount,
        unassignedBookings: unassignedBookingsCount
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
      {/* HEADER & DASHBOARD */}
      <div className="bg-gray-800 border-b border-gray-700 shadow-md sticky top-0 z-10">
        
        {/* Top Row: Title, Date, Tabs */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 p-4 pb-2">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <BookOpen className="text-cps-blue" size={20} /> 
              RM Logbook
            </h1>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
              {currentUser.name}
            </p>
          </div>

          <div className="flex items-center gap-2 bg-gray-900 px-3 py-1 rounded-full border border-gray-700">
            <Calendar size={14} className="text-gray-400" />
            <span className="font-mono font-bold text-sm text-gray-200">
              {dailyData.date}
            </span>
          </div>

          <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-700/50">
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'team'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Users size={14} /> Team
            </button>
            <button
              onClick={() => setActiveTab('routes')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === 'routes'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Map size={14} /> Routes{' '}
              {(stats.unassignedRoutes > 0 || stats.unassignedBookings > 0) && (
                <span className="flex items-center justify-center w-4 h-4 text-[9px] bg-red-500 text-white rounded-full animate-pulse">
                  !
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bottom Row: 6-Metric Stats Grid */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-gray-700 border-t border-gray-700">
            
            {/* 1. Workers */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Workers</span>
                <div className="flex items-center gap-1 text-blue-300 font-bold text-lg">
                    <Users size={14} className="opacity-70" /> {stats.workerCount}
                </div>
            </div>

            {/* 2. Steps */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Steps</span>
                <div className="flex items-center gap-1 text-white font-bold text-lg">
                    <Activity size={14} className="opacity-70 text-green-400" /> {stats.totalSteps}
                </div>
            </div>

            {/* 3. Pending (Assigned + Unassigned) */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Pending</span>
                <div className="flex items-center gap-1 text-yellow-400 font-bold text-lg">
                    <Clock size={14} className="opacity-70" /> 
                    {stats.totalPending}
                </div>
            </div>

            {/* 4. Avg EQ (2 Decimals) */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Avg EQ</span>
                <div className={`font-bold text-lg ${
                    stats.avgEQ >= 3 ? 'text-green-400' : stats.avgEQ >= 2 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                    {stats.avgEQ.toFixed(2)}
                </div>
            </div>

             {/* 5. Upsells Count */}
             <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Upsells</span>
                <div className="text-purple-300 font-bold text-lg">
                    {stats.totalUpsellCount}
                </div>
            </div>

             {/* 6. Up $ (Upsell Revenue) */}
             <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Up $</span>
                <div className="flex items-center gap-1 text-purple-400 font-bold text-lg">
                    <DollarSign size={14} className="opacity-70" /> 
                    {stats.totalGross.toFixed(2)}
                </div>
            </div>

        </div>
      </div>

      {/* CONTENT */}
      <div className="flex-1 overflow-hidden p-4 relative">
        <div className="h-full overflow-y-auto custom-scrollbar">
          {activeTab === 'team' && (
            <RMTeamTab
              managerId={currentUser.userId}
              workers={dailyData.workers}
              allSessions={allSessions}
              allManagers={dailyData.managers}
            />
          )}
          {activeTab === 'routes' && (
            <RMRoutesTab
              managerId={currentUser.userId}
              routes={dailyData.routes}
              bookings={dailyData.pendingBookings}
              workers={dailyData.workers}
              onRefresh={() => {
                  refreshData();
              }} 
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RMLogbook;
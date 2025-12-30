import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map, Loader, Calendar, BookOpen, Activity, DollarSign, Clock } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { supabase } from '../../lib/supabase';

import RMTeamTab, { ExtendedTabStats } from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';

// We now use the extended interface from RMTeamTab to support all metrics
export type { ExtendedTabStats } from './components/RMTeamTab';

const RMLogbook: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'routes'>('team');
  
  // Initialize with zeroes
  const [stats, setStats] = useState<ExtendedTabStats>({
    totalSteps: 0,
    totalPending: 0,
    totalEQ: 0,
    workerCount: 0,
    totalGross: 0,
    avgEQ: 0,
    totalUpsellCount: 0,
    pendingPrebooks: 0,
    completedPrebooks: 0,
    unassignedRoutes: 0,
    unassignedBookings: 0
  });

  // Data State
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailySessionData | null>(null);
  const [allSessions, setAllSessions] = useState<LogsheetSession[]>([]);

  // Debounce Ref to prevent spamming refreshes
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

  // --- Realtime Listeners ---
  useEffect(() => {
    if (!dailyData?.date) return;

    console.log('📡 Connecting to Realtime Updates...');

    const channel = supabase
      .channel('rm-dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'logsheet_sessions' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => refreshData())
      .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
              console.log('✅ Realtime Connected!');
          }
      });

    const intervalId = setInterval(() => {
        refreshData();
    }, 60000); 

    return () => {
      supabase.removeChannel(channel);
      clearInterval(intervalId);
    };
  }, [dailyData?.date]);


  // --- PRIMARY STATS CALCULATION ---
  // We perform this here to ensure the header always reflects the strictly filtered
  // "My Team" data, regardless of which tab is open or what the child component thinks.
  useEffect(() => {
    if (!dailyData || !allSessions || !currentUser) return;
    
    // 1. FILTER WORKERS: Strictly only those assigned to this Route Manager
    const myWorkers = dailyData.workers.filter((w: any) => 
        (w.managerId === currentUser.userId) || (w.manager_id === currentUser.userId)
    );
    const myWorkerIds = myWorkers.map(w => w.userId);

    // 2. FILTER SESSIONS: Only sessions belonging to MY workers
    const mySessions = allSessions.filter(s => myWorkerIds.includes(s.user_id));

    // 3. FILTER BOOKINGS: Only unassigned bookings for this Route Manager
    // (Checks both camelCase and snake_case properties to be safe)
    const myPendingBookings = (dailyData.pendingBookings || []).filter((b: any) => 
        (b.managerId === currentUser.userId) || (b.manager_id === currentUser.userId)
    );

    let totalSteps = 0;
    let totalPending = 0; 
    let totalCompleted = 0;
    let totalGross = 0;
    let totalUpsellCount = 0;
    
    let sumOfIndividualEQs = 0;
    let workersWithActivity = 0;

    mySessions.forEach((session: any) => {
        const steps = Number(session.steps) || 0;
        const pending = Number(session.pending_count || session.pending || 0);
        const completed = Number(session.completed_count || session.completed || 0);
        const gross = Number(session.total_revenue || session.gross || 0);
        const upsells = Number(session.upsell_count || session.upsells || 0);

        totalSteps += steps;
        totalPending += pending;
        totalCompleted += completed;
        totalGross += gross;
        totalUpsellCount += upsells;

        // Calculate Individual EQ for aggregation
        // We only average EQ for workers who have actually started (steps > 0)
        if (steps > 0) {
            const results = pending + completed;
            const workerEq = results / steps;
            sumOfIndividualEQs += workerEq;
            workersWithActivity++;
        }
    });

    // Calculate Average EQ
    // If 1 worker active with 2.0 EQ, sum=2.0, count=1 -> Avg=2.00
    const countForAvg = workersWithActivity > 0 ? workersWithActivity : 0;
    const avgEQ = countForAvg > 0 ? sumOfIndividualEQs / countForAvg : 0.00;

    // Derived unassigned count (filtered)
    const currentUnassignedCount = myPendingBookings.length;

    setStats(prev => ({
        ...prev,
        workerCount: myWorkers.length,
        totalSteps,
        pendingPrebooks: totalPending,
        completedPrebooks: totalCompleted,
        totalGross,
        totalUpsellCount,
        avgEQ,
        unassignedBookings: currentUnassignedCount
    }));

  }, [dailyData, allSessions, currentUser]); // Runs whenever data or user changes


  if (loading || !currentUser || !dailyData)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );

  // --- PREPARE PROPS FOR CHILDREN ---
  
  // 1. Filter Workers
  const myWorkers = dailyData.workers.filter((w: any) => 
      (w.managerId === currentUser.userId) || (w.manager_id === currentUser.userId)
  );

  // 2. Filter Bookings (for Routes Tab)
  const myPendingBookings = (dailyData.pendingBookings || []).filter((b: any) => 
      (b.managerId === currentUser.userId) || (b.manager_id === currentUser.userId)
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
              {(stats.unassignedRoutes || 0) + (stats.unassignedBookings || 0) > 0 && (
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

            {/* 3. Pending (Prebooks + Unassigned) */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Pending</span>
                <div className="flex items-center gap-1 text-yellow-400 font-bold text-lg">
                    <Clock size={14} className="opacity-70" /> 
                    {stats.pendingPrebooks + stats.unassignedBookings}
                </div>
            </div>

            {/* 4. Avg EQ (2 Decimals) */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Avg EQ</span>
                <div className={`font-bold text-lg ${
                    (stats.avgEQ || 0) >= 3 ? 'text-green-400' : (stats.avgEQ || 0) >= 2 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                    {(stats.avgEQ || 0).toFixed(2)}
                </div>
            </div>

             {/* 5. Upsells Count */}
             <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Upsells</span>
                <div className="text-purple-300 font-bold text-lg">
                    {stats.totalUpsellCount}
                </div>
            </div>

             {/* 6. Up $ (Revenue) */}
             <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Up $</span>
                <div className="flex items-center gap-1 text-purple-400 font-bold text-lg">
                    <DollarSign size={14} className="opacity-70" /> 
                    {stats.totalGross?.toFixed(2)}
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
              workers={myWorkers} 
              allSessions={allSessions} // Child filters this itself, but we could pass filtered if needed
              allManagers={dailyData.managers}
              // We disconnect the child's ability to overwrite key metrics to ensure 
              // the parent's filtered logic remains the source of truth for the header.
              // We only accept specific updates if necessary, or empty function to block it.
              onStatsUpdate={() => {}} 
            />
          )}
          {activeTab === 'routes' && (
            <RMRoutesTab
              managerId={currentUser.userId}
              routes={dailyData.routes}
              bookings={myPendingBookings}
              workers={myWorkers} 
              // Allow routes to update unassigned counts since that logic lives there
              onStatsUpdate={(s) => setStats((prev) => ({ 
                  ...prev, 
                  unassignedRoutes: s.unassignedRoutes, 
                  unassignedBookings: s.unassignedBookings 
              }))}
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
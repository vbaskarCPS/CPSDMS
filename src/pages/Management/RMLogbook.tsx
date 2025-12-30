import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map, Loader, Calendar, BookOpen, Activity, DollarSign, CheckCircle, Clock } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { supabase } from '../../lib/supabase';

import RMTeamTab, { ExtendedTabStats } from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';

// We now use the extended interface from RMTeamTab to support all 8 metrics
export type { ExtendedTabStats } from './components/RMTeamTab';

const RMLogbook: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'routes'>('team');
  
  // Initialize with zeroes for all 8 stats
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
    // Route stats (handled separately by RMRoutesTab usually, but kept here for safety)
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
    // Clear any pending refresh to "debounce" multiple rapid events
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Wait 500ms before actually fetching. 
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

    // Cleanup timeout on unmount
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => refreshData()) // Listen for User/Worker changes
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
              {(stats.unassignedRoutes || 0) + (stats.unassignedBookings || 0) > 0 && (
                <span className="flex items-center justify-center w-4 h-4 text-[9px] bg-red-500 text-white rounded-full animate-pulse">
                  !
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Bottom Row: 8-Metric Stats Grid */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-px bg-gray-700 border-t border-gray-700">
            
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

            {/* 3. Pending Prebooks */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Pending</span>
                <div className="flex items-center gap-1 text-yellow-400 font-bold text-lg">
                    <Clock size={14} className="opacity-70" /> {stats.pendingPrebooks}
                </div>
            </div>

            {/* 4. Completed Prebooks */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Done</span>
                <div className="flex items-center gap-1 text-emerald-400 font-bold text-lg">
                    <CheckCircle size={14} className="opacity-70" /> {stats.completedPrebooks}
                </div>
            </div>

            {/* 5. Total Gross */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Gross</span>
                <div className="text-white font-bold text-lg">
                    ${stats.totalGross?.toFixed(0)}
                </div>
            </div>

            {/* 6. Avg EQ */}
            <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Avg EQ</span>
                <div className={`font-bold text-lg ${
                    (stats.avgEQ || 0) >= 3 ? 'text-green-400' : (stats.avgEQ || 0) >= 2 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                    {(stats.avgEQ || 0).toFixed(1)}
                </div>
            </div>

             {/* 7. Upsells Count */}
             <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Upsells</span>
                <div className="text-purple-300 font-bold text-lg">
                    {stats.totalUpsellCount}
                </div>
            </div>

             {/* 8. Upsell Value (Estimated) */}
             <div className="bg-gray-800 p-2 flex flex-col items-center justify-center group hover:bg-gray-750 transition-colors">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold mb-0.5">Up $</span>
                <div className="flex items-center gap-1 text-purple-400 font-bold text-lg">
                    <DollarSign size={14} className="opacity-70" /> 
                    {/* Assuming upsellGross is passed up in totalGross, we might need to separate it if you want specific upsell $ here. 
                        Currently using a placeholder logic or if you have upsellGross in stats, use it. 
                        Based on RMTeamTab update, we didn't explicitly add totalUpsellGross to the interface yet, 
                        but we can calculate or just show count for now. 
                        Let's use totalUpsellCount for now or 0 if undefined.
                    */}
                    {/* FIX: If you want Upsell $, ensure RMTeamTab passes 'totalUpsellGross' */}
                    {/* For now, leaving as placeholder or deriving from logic if available */}
                    -
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
              // Cast to any because we extended the type in the child component but TS might complain about the mismatch until reload
              onStatsUpdate={(s: any) => setStats((prev) => ({ ...prev, ...s }))}
            />
          )}
          {activeTab === 'routes' && (
            <RMRoutesTab
              managerId={currentUser.userId}
              routes={dailyData.routes}
              bookings={dailyData.pendingBookings}
              workers={dailyData.workers}
              // Only update specific route stats to avoid overwriting team stats
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
// src/pages/Management/RMLogbook.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map, Loader, Calendar, BookOpen } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';
import { supabase } from '../../lib/supabase';

import RMTeamTab from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';

export interface TabStats {
  totalPending?: number;
  totalSteps?: number;
  totalEQ?: number;
  unassignedRoutes?: number;
  unassignedBookings?: number;
}

const RMLogbook: React.FC = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<ManagementUser | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'routes'>('team');
  const [stats, setStats] = useState<TabStats>({});

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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'logsheet_sessions' },
        (payload) => {
          console.log('🔔 Realtime: Logsheet update', payload.eventType);
          refreshData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          console.log('🔔 Realtime: Booking update', payload.eventType);
          refreshData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'routes' },
        (payload) => {
          console.log('🔔 Realtime: Route update', payload.eventType);
          refreshData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        (payload) => {
          console.log('🔔 Realtime: Transaction update', payload.eventType);
          refreshData();
        }
      )
      // Listen for changes to the workers table to reflect transfers/removals immediately
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workers' },
        (payload) => {
          console.log('🔔 Realtime: Worker update', payload.eventType);
          refreshData();
        }
      )
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

  // --- Management Actions ---

  const handleTransferContractor = async (contractorId: string, newManagerId: string) => {
    try {
      // Assuming your table is named 'workers' and has an 'assignedManagerId' column
      const { error } = await supabase
        .from('workers')
        .update({ assignedManagerId: newManagerId })
        .eq('contractorId', contractorId);

      if (error) throw error;
      console.log(`✅ Transferred ${contractorId} to ${newManagerId}`);
      await refreshData(); // Force refresh to update UI immediately
    } catch (err) {
      console.error('Failed to transfer contractor:', err);
      alert('Failed to transfer contractor. Please try again.');
    }
  };

  const handleRemoveContractor = async (contractorId: string) => {
    try {
      // Removing usually means setting assignedManagerId to null (unassigning)
      const { error } = await supabase
        .from('workers')
        .update({ assignedManagerId: null })
        .eq('contractorId', contractorId);

      if (error) throw error;
      console.log(`✅ Removed ${contractorId} from team`);
      await refreshData(); // Force refresh
    } catch (err) {
      console.error('Failed to remove contractor:', err);
      alert('Failed to remove contractor. Please try again.');
    }
  };


  if (loading || !currentUser || !dailyData)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 p-4 shadow-md sticky top-0 z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BookOpen className="text-cps-blue" /> RM Logbook
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Manager: {currentUser.name}
            </p>
          </div>

          <div className="flex items-center gap-2 bg-gray-900 p-1.5 rounded-lg border border-gray-700">
            <Calendar size={16} className="text-gray-400" />
            <span className="font-mono font-bold text-sm text-gray-200">
              {dailyData.date}
            </span>
          </div>

          <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg border border-gray-700/50">
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'team'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Users size={16} /> Team
            </button>
            <button
              onClick={() => setActiveTab('routes')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'routes'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Map size={16} /> Routes{' '}
              {(stats.unassignedRoutes || 0) + (stats.unassignedBookings || 0) > 0 && (
                <span className="text-xs bg-red-900/50 text-red-300 px-1.5 rounded-full border border-red-900">
                  !
                </span>
              )}
            </button>
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
              // NEW: Pass the list of managers for the transfer dropdown
              allManagers={dailyData.managers}
              // NEW: Pass the action handlers
              onTransferContractor={handleTransferContractor}
              onRemoveContractor={handleRemoveContractor}
              onStatsUpdate={(s) => setStats((prev) => ({ ...prev, ...s }))}
            />
          )}
          {activeTab === 'routes' && (
            <RMRoutesTab
              managerId={currentUser.userId}
              routes={dailyData.routes}
              bookings={dailyData.pendingBookings}
              workers={dailyData.workers}
              onStatsUpdate={(s) => setStats((prev) => ({ ...prev, ...s }))}
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
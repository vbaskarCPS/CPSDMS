// src/pages/Management/RMLogbook.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Map, FileText, Loader, Calendar, BookOpen } from 'lucide-react';
import { getStorageItem } from '../../lib/localStorage';
import { ManagementUser, DailySessionData, LogsheetSession } from '../../types';
import { sessionService } from '../../lib/sessionService';

import RMTeamTab from './components/RMTeamTab';
import RMRoutesTab from './components/RMRoutesTab';
import RMBookingsTab from './components/RMBookingsTab';

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
  const [activeTab, setActiveTab] = useState<'team' | 'routes' | 'bookings'>(
    'team'
  );
  const [stats, setStats] = useState<TabStats>({});

  // Data State
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<DailySessionData | null>(null);
  const [allSessions, setAllSessions] = useState<LogsheetSession[]>([]);

  useEffect(() => {
    const init = async () => {
      const user = getStorageItem<ManagementUser | null>('current_user', null);
      if (!user || user.role !== 'RouteManager') {
        navigate('/');
        return;
      }
      setCurrentUser(user);

      try {
        // 1. Fetch Static Data (Routes, Workers, Bookings)
        const session = await sessionService.getDailySession();
        setDailyData(session);

        // 2. Fetch Dynamic Data (Live Stats from Workers)
        const sessions = await sessionService.getLogsheetSessions();
        setAllSessions(sessions);
      } catch (err) {
        console.error('Failed to load RM Logbook', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [navigate]);

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
              <span className="text-xs bg-gray-800 px-1.5 rounded-full text-gray-300">
                {stats.unassignedRoutes !== undefined &&
                stats.unassignedRoutes > 0
                  ? stats.unassignedRoutes
                  : ''}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('bookings')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'bookings'
                  ? 'bg-gray-700 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <FileText size={16} /> Bookings{' '}
              <span className="text-xs bg-gray-800 px-1.5 rounded-full text-gray-300">
                {stats.unassignedBookings !== undefined &&
                stats.unassignedBookings > 0
                  ? stats.unassignedBookings
                  : ''}
              </span>
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
              onStatsUpdate={(s) => setStats((prev) => ({ ...prev, ...s }))}
            />
          )}
          {activeTab === 'routes' && (
            <RMRoutesTab
              managerId={currentUser.userId}
              routes={dailyData.routes}
              bookings={dailyData.pendingBookings}
              workers={dailyData.workers} // Pass workers for assignment dropdown
              onStatsUpdate={(s) => setStats((prev) => ({ ...prev, ...s }))}
            />
          )}
          {activeTab === 'bookings' && (
            <RMBookingsTab
              managerId={currentUser.userId}
              bookings={dailyData.pendingBookings}
              routes={dailyData.routes}
              workers={dailyData.workers}
              onStatsUpdate={(s) => setStats((prev) => ({ ...prev, ...s }))}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default RMLogbook;

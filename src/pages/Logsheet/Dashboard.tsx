// src/pages/Logsheet/Dashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Trophy,
  TrendingUp,
  DollarSign,
  LogOut,
  Loader,
  Plus,
  Calendar,
  CheckCircle2,
  Clock,
  Briefcase,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { getStorageItem, removeStorageItem } from '../../lib/localStorage';
import { sessionService } from '../../lib/sessionService';
import { supabase } from '../../lib/supabase';
import { Worker, SessionStats, MasterBooking } from '../../types';
import LogsheetJobCard from './components/LogsheetJobCard';
import AddContractModal from '../../components/AddContractModal';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<
    'pending' | 'not_done' | 'completed'
  >('pending');
  const [showContractModal, setShowContractModal] = useState(false);

  // Data State
  const [stats, setStats] = useState<SessionStats>(
    sessionService.getEmptyStats()
  );
  const [jobs, setJobs] = useState<MasterBooking[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const storedWorker = getStorageItem<Worker | null>('current_user', null);
      if (!storedWorker) {
        navigate('/');
        return;
      }
      setWorker(storedWorker);

      try {
        // 1. Ensure Session Exists
        const session = await sessionService.startLogsheetSession(
          storedWorker.contractorId
        );
        setStats(session.stats);

        // 2. Fetch Assignments (Merges Pending & Completed)
        const assignments = await sessionService.getWorkerAssignments(
          storedWorker.contractorId
        );
        setJobs(assignments);
      } catch (err) {
        console.error('Dashboard Load Error', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    // --- REALTIME SUBSCRIPTION ---
    // Listen for changes to bookings (assignments) so the dashboard updates live
    const channel = supabase
      .channel('public:bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        () => {
          setRefreshKey((prev) => prev + 1); // Trigger re-fetch
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [navigate, refreshKey]);

  const handleLogout = () => {
    removeStorageItem('current_user');
    navigate('/');
  };

  const filteredJobs = useMemo(() => {
    if (viewFilter === 'pending') {
      return jobs.filter(
        (b) =>
          b.Status !== 'completed' &&
          b.Status !== 'cancelled' &&
          b.Status !== 'next_time'
      );
    } else if (viewFilter === 'not_done') {
      return jobs.filter(
        (b) => b.Status === 'cancelled' || b.Status === 'next_time'
      );
    } else {
      return jobs.filter((b) => b.Status === 'completed');
    }
  }, [jobs, viewFilter]);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );

  return (
    <div className="min-h-screen bg-black pb-20 flex flex-col">
      <div className="sticky top-0 z-30 bg-black/90 backdrop-blur-md border-b border-gray-800 p-4 pb-2">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-lg">
              <Calendar size={18} className="text-cps-blue" />
              {format(new Date(), 'EEE, MMM d')}
            </div>
            <div className="flex items-center gap-2 text-gray-400 text-xs mt-1">
              <span>
                {worker?.firstName} {worker?.lastName}
              </span>
              <span className="bg-gray-800 px-1.5 rounded border border-gray-700">
                #{worker?.contractorId}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/logsheet/new')}
              className="p-2 bg-cps-blue text-white rounded-lg shadow-lg hover:bg-blue-600 transition-colors"
            >
              <Plus size={20} />
            </button>
            <button
              onClick={() => setShowContractModal(true)}
              className="p-2 bg-purple-600 text-white rounded-lg shadow-lg hover:bg-purple-500 transition-colors"
            >
              <FileText size={20} />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 bg-gray-800 text-red-400 rounded-lg border border-gray-700"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5 mb-4">
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Clock size={10} />
              <span className="text-[9px] uppercase font-bold">Pend</span>
            </div>
            <p className="text-lg font-bold text-yellow-400">
              {jobs.filter((b) => b.Status !== 'completed').length}
            </p>
          </div>
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Trophy size={10} />
              <span className="text-[9px] uppercase font-bold">Steps</span>
            </div>
            <p className="text-lg font-bold text-blue-400">{stats.stepCount}</p>
          </div>
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Briefcase size={10} />
              <span className="text-[9px] uppercase font-bold">EQ</span>
            </div>
            <p className="text-lg font-bold text-white">
              {stats.totalEQ.toFixed(1)}
            </p>
          </div>
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <TrendingUp size={10} />
              <span className="text-[9px] uppercase font-bold">Upsell</span>
            </div>
            <p className="text-lg font-bold text-green-400">
              {stats.upsellCount}
            </p>
          </div>
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <DollarSign size={10} />
              <span className="text-[9px] uppercase font-bold">Gross</span>
            </div>
            <p className="text-lg font-bold text-green-400">
              ${stats.upsellGross.toFixed(0)}
            </p>
          </div>
        </div>

        <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 mb-2">
          <button
            onClick={() => setViewFilter('pending')}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-colors ${
              viewFilter === 'pending'
                ? 'bg-cps-blue text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setViewFilter('not_done')}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-colors ${
              viewFilter === 'not_done'
                ? 'bg-red-900/50 text-red-200'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Not Done
          </button>
          <button
            onClick={() => setViewFilter('completed')}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-colors ${
              viewFilter === 'completed'
                ? 'bg-green-700 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Completed
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500">
            <CheckCircle2 size={48} className="mb-4 opacity-20" />
            <p>
              {viewFilter === 'pending' ? 'All caught up!' : 'No jobs found.'}
            </p>
          </div>
        ) : (
          filteredJobs.map((job) => (
            <LogsheetJobCard
              key={job['Booking ID']}
              job={job}
              onClick={() =>
                navigate(`/job-detail/${encodeURIComponent(job['Booking ID'])}`)
              }
            />
          ))
        )}
      </div>

      {showContractModal && (
        <AddContractModal
          onClose={() => {
            setShowContractModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;

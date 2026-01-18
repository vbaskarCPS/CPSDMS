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
  Phone,
  Check,
  GraduationCap,
  Truck,
  X,
  Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { getStorageItem, removeStorageItem } from '../../lib/localStorage';
import { sessionService } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import { subscribeAsContractor } from '../../lib/realtimeService';
import { supabase } from '../../lib/supabase';
import { Worker, SessionStats, MasterBooking, ManagementUser, SeasonType } from '../../types';
import LogsheetJobCard from './components/LogsheetJobCard';
import AddContractModal from '../../components/AddContractModal';

// Simple Toast Component
const Toast: React.FC<{ message: string; show: boolean }> = ({ message, show }) => {
  if (!show) return null;
  
  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
      <div className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
        <Check size={16} />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
};

// Training Mode Banner Component
const TrainingBanner: React.FC = () => (
  <div className="bg-gradient-to-r from-yellow-600 to-orange-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm font-bold">
    <GraduationCap size={18} />
    <span>TRAINING MODE</span>
    <span className="text-yellow-200 font-normal">— Practice with mock data. No real records affected.</span>
  </div>
);

// Team Members Modal
const TeamMembersModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  teammates: Worker[];
  currentWorkerId: string;
  onCopyPhone: (phone: string) => void;
}> = ({ isOpen, onClose, teammates, currentWorkerId, onCopyPhone }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-sm border border-gray-700 shadow-xl">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Truck size={20} className="text-green-400" />
            <h3 className="text-lg font-bold text-white">Your Team</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {teammates.map((teammate) => (
            <div
              key={teammate.contractorId}
              className={`p-3 rounded-lg border ${
                teammate.contractorId === currentWorkerId
                  ? 'bg-green-900/20 border-green-600'
                  : 'bg-gray-900/50 border-gray-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">
                      {teammate.firstName} {teammate.lastName}
                    </span>
                    {teammate.contractorId === currentWorkerId && (
                      <span className="text-[9px] bg-green-600 text-white px-1.5 py-0.5 rounded">YOU</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 font-mono">#{teammate.contractorId}</span>
                </div>
                {teammate.cellPhone && (
                  <button
                    onClick={() => onCopyPhone(teammate.cellPhone!)}
                    className="flex items-center gap-1.5 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors border border-gray-600"
                  >
                    <Phone size={12} className="text-cps-blue" />
                    <span className="text-xs text-gray-300">{teammate.cellPhone}</span>
                    <Copy size={10} className="text-gray-500" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [worker, setWorker] = useState<Worker | null>(null);
  const [manager, setManager] = useState<ManagementUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<'pending' | 'not_done' | 'completed'>('pending');
  const [showContractModal, setShowContractModal] = useState(false);
  const [hasAssignedRoutes, setHasAssignedRoutes] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Copied!');
  
  // Training mode state
  const [isTrainingMode, setIsTrainingMode] = useState(false);
  
  // Season type state
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');
  
  // Team state
  const [teammates, setTeammates] = useState<Worker[]>([]);
  const [showTeamModal, setShowTeamModal] = useState(false);
  
  // Upsells enabled state
  const [upsellsEnabled, setUpsellsEnabled] = useState(true);

  // Data State
  const [stats, setStats] = useState<SessionStats>(sessionService.getEmptyStats());
  const [jobs, setJobs] = useState<MasterBooking[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Check if this is a team season with teammates
  const hasTeammates = seasonType === 'lawn_rejuv' && teammates.length > 1;

  // Copy phone to clipboard
  const handleCopyPhone = async (phone: string) => {
    try {
      const digitsOnly = phone.replace(/\D/g, '');
      await navigator.clipboard.writeText(digitsOnly);
      setToastMessage('Copied!');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Force logout helper
  const forceLogout = () => {
    console.log('🔒 Session locked - forcing logout');
    removeStorageItem('current_user');
    if (isTrainingMode) {
      trainingService.disableTrainingMode();
    }
    navigate('/');
  };

  // Initial load and data fetching
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      
      // Check if we're in training mode
      const trainingMode = trainingService.isTrainingMode();
      setIsTrainingMode(trainingMode);
      
      const storedWorker = getStorageItem<Worker | null>('current_user', null);
      if (!storedWorker) {
        navigate('/');
        return;
      }
      setWorker(storedWorker);

      try {
        if (trainingMode) {
          // --- TRAINING MODE: Use trainingService ---
          const session = await trainingService.startLogsheetSession(storedWorker.contractorId);
          setStats(session.stats);

          const assignments = await trainingService.getWorkerAssignments(storedWorker.contractorId);
          setJobs(assignments);

          const dailySession = await trainingService.getDailySession();
          if (dailySession) {
            const myRoutes = dailySession.routes.filter(
              (r: any) => r.assignedWorkerIds && r.assignedWorkerIds.includes(storedWorker.contractorId)
            );
            setHasAssignedRoutes(myRoutes.length > 0);
          }

          // Get training manager
          const managerData = trainingService.getManagerById(storedWorker.assignedManagerId || '');
          setManager(managerData);

          setUpsellsEnabled(true); // Always enabled in training
          setSeasonType('aeration'); // Training is always aeration
        } else {
          // --- PRODUCTION MODE: Use sessionService ---
          const isLockedOut = await sessionService.isWorkerLockedOut(storedWorker.contractorId);
          if (isLockedOut) {
            forceLogout();
            return;
          }

          // Get season type
          const currentSeasonType = await sessionService.getSessionSeasonType();
          setSeasonType(currentSeasonType);

          const session = await sessionService.startLogsheetSession(storedWorker.contractorId);
          setStats(session.stats);

          const assignments = await sessionService.getWorkerAssignments(storedWorker.contractorId);
          setJobs(assignments);

          const dailySession = await sessionService.getDailySession();
          if (dailySession) {
            const myRoutes = dailySession.routes.filter(
              r => r.assignedWorkerIds && r.assignedWorkerIds.includes(storedWorker.contractorId)
            );
            setHasAssignedRoutes(myRoutes.length > 0);

            // Get teammates for lawn_rejuv season
            if (currentSeasonType === 'lawn_rejuv' && dailySession.teamCarts) {
              const myCart = dailySession.teamCarts.find(cart => 
                cart.workerIds.includes(storedWorker.contractorId)
              );
              if (myCart && myCart.workers) {
                setTeammates(myCart.workers);
              }
            }
          }

          if (storedWorker.assignedManagerId) {
            const managerData = await sessionService.getManagerById(storedWorker.assignedManagerId);
            setManager(managerData);
          }

          const upsellStatus = await sessionService.getWorkerUpsellsEnabled(storedWorker.contractorId);
          setUpsellsEnabled(upsellStatus);
        }
      } catch (err) {
        console.error('Dashboard Load Error', err);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [navigate, refreshKey]);

  // --- FORCE LOGOUT LISTENER: Subscribe to session status changes (production only) ---
  useEffect(() => {
    if (!worker || isTrainingMode) return;

    const channel = supabase
      .channel(`lockout-${worker.contractorId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'logsheet_sessions',
          filter: `worker_id=eq.${worker.contractorId}`
        },
        (payload) => {
          console.log('📡 Session status change detected:', payload);
          if (payload.new && payload.new.status === 'PAID') {
            forceLogout();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [worker?.contractorId, navigate, isTrainingMode]);

  // Realtime subscription (production only)
  useEffect(() => {
    if (!worker || isTrainingMode) return;

    const unsubscribe = subscribeAsContractor(() => setRefreshKey((prev) => prev + 1));

    return () => unsubscribe();
  }, [worker?.contractorId, isTrainingMode]);

  const handleLogout = () => {
    removeStorageItem('current_user');
    if (isTrainingMode) {
      trainingService.disableTrainingMode();
    }
    navigate('/');
  };

  const handleTabSwitch = (tab: 'pending' | 'not_done' | 'completed') => {
    setViewFilter(tab);
    setRefreshKey((prev) => prev + 1);
  };

  const filteredJobs = useMemo(() => {
    if (viewFilter === 'pending') {
      return jobs.filter((b) => !b.Completed && (!b.Status || b.Status === 'pending'));
    } else if (viewFilter === 'not_done') {
      return jobs.filter((b) => b.Status === 'cancelled' || b.Status === 'next_time');
    } else {
      return jobs.filter((b) => b.Completed === 'x' || b.Status === 'completed');
    }
  }, [jobs, viewFilter]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black pb-20 flex flex-col">
      {/* Training Mode Banner */}
      {isTrainingMode && <TrainingBanner />}

      {/* Toast Notification */}
      <Toast message={toastMessage} show={showToast} />

      <div className="sticky top-0 z-30 bg-black/90 backdrop-blur-md border-b border-gray-800 p-4 pb-2">
        <div className="flex justify-between items-start mb-2">
          <div>
            <div className="flex items-center gap-2 text-white font-bold text-lg">
              <Calendar size={18} className="text-cps-blue" />
              {format(new Date(), 'EEE, MMM d')}
              {seasonType === 'lawn_rejuv' && (
                <span className="text-[9px] bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded border border-green-700">
                  LAWN REJUV
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-400 text-xs mt-1">
              <span>{worker?.firstName} {worker?.lastName}</span>
              <span className={`px-1.5 rounded border ${isTrainingMode ? 'bg-yellow-900/30 border-yellow-700 text-yellow-400' : 'bg-gray-800 border-gray-700'}`}>
                #{worker?.contractorId}
              </span>
              {/* Team Indicator */}
              {hasTeammates && (
                <button
                  onClick={() => setShowTeamModal(true)}
                  className="flex items-center gap-1 px-1.5 py-0.5 bg-green-900/30 border border-green-700 rounded text-green-400 hover:bg-green-900/50 transition-colors"
                >
                  <Truck size={12} />
                  <span className="text-[10px] font-bold">{teammates.length}</span>
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {hasAssignedRoutes && (
              <button
                onClick={() => navigate('/logsheet/new')}
                className="p-2 bg-cps-blue text-white rounded-lg shadow-lg hover:bg-blue-600 transition-colors"
              >
                <Plus size={20} />
              </button>
            )}
            {upsellsEnabled && (
              <button
                onClick={() => setShowContractModal(true)}
                className="p-2 bg-purple-600 text-white rounded-lg shadow-lg hover:bg-purple-500 transition-colors"
              >
                <FileText size={20} />
              </button>
            )}
            <button
              onClick={handleLogout}
              className="p-2 bg-gray-800 text-red-400 rounded-lg border border-gray-700"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {/* Manager Info Row */}
        {manager && (
          <div className="flex items-center gap-2 text-xs text-gray-300 mb-3 bg-gray-900/50 rounded-lg px-3 py-2 border border-gray-800">
            <span className="text-gray-500">Manager:</span>
            <span className="font-medium text-white">{manager.name}</span>
            {manager.phone && (
              <button
                onClick={() => handleCopyPhone(manager.phone!)}
                className="flex items-center gap-1.5 ml-2 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded-md transition-colors border border-gray-700"
              >
                <Phone size={12} className="text-cps-blue" />
                <span className="text-cps-blue font-mono">{manager.phone}</span>
              </button>
            )}
          </div>
        )}

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
            <p className="text-lg font-bold text-white">{stats.totalEQ.toFixed(1)}</p>
          </div>
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <TrendingUp size={10} />
              <span className="text-[9px] uppercase font-bold">Upsell</span>
            </div>
            <p className="text-lg font-bold text-green-400">{stats.upsellCount}</p>
          </div>
          <div className="bg-gray-900 p-1.5 rounded-lg border border-gray-800 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <DollarSign size={10} />
              <span className="text-[9px] uppercase font-bold">Up Gross</span>
            </div>
            <p className="text-lg font-bold text-green-400">${stats.upsellGross.toFixed(0)}</p>
          </div>
        </div>

        <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700 mb-2">
          <button
            onClick={() => handleTabSwitch('pending')}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-colors ${
              viewFilter === 'pending'
                ? 'bg-cps-blue text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => handleTabSwitch('not_done')}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-colors ${
              viewFilter === 'not_done'
                ? 'bg-red-900/50 text-red-200'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Not Done
          </button>
          <button
            onClick={() => handleTabSwitch('completed')}
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
            <p>{viewFilter === 'pending' ? 'All caught up!' : 'No jobs found.'}</p>
          </div>
        ) : (
          filteredJobs.map((job) => (
            <LogsheetJobCard
              key={job['Booking ID']}
              job={job}
              onClick={() => navigate(`/job-detail/${encodeURIComponent(job['Booking ID'])}`)}
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
          seasonType={seasonType}
        />
      )}

      {/* Team Members Modal */}
      <TeamMembersModal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        teammates={teammates}
        currentWorkerId={worker?.contractorId || ''}
        onCopyPhone={handleCopyPhone}
      />

      {/* Toast Animation Styles */}
      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translate(-50%, -10px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
};

export default Dashboard;
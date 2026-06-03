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
  Eye,
  ArrowLeft,
  Map as MapIcon,
  BookOpen,
  Shovel,
} from 'lucide-react';
import { format } from 'date-fns';
import { getStorageItem, removeStorageItem, setStorageItem } from '../../lib/localStorage';
import { sessionService } from '../../lib/sessionService';
import { trainingService } from '../../lib/trainingService';
import { commandCenterService, seasonHasTeams } from '../../lib/commandCenterService';
import { subscribeAsContractor } from '../../lib/realtimeService';
import { supabase } from '../../lib/supabase';
import { Worker, SessionStats, MasterBooking, ManagementUser, SeasonType, PendingSale } from '../../types';
import LogsheetJobCard from './components/LogsheetJobCard';
import AddContractModal from '../../components/AddContractModal';
import QuickPendingModal from '../../components/QuickPendingModal';
import WorkerMapTab from './components/WorkerMapTab';
import WorkerPCLTab from './components/WorkerPCLTab';

// --- ASPHALT MERGE HELPER ---
//
// Mirrors RMTeamTab's mergePendingSalesForDisplay. Collapses driveway parents
// with linked asphalt children into single MasterBookings with the 5 contract
// fields stamped on the parent. Standalone asphalt children (Path 3 deferred,
// orphans, or assigned-incoming) pass through with saleType='asphalt' so the
// LogsheetJobCard renders them as amber asphalt cards.
//
// NOTE on duplication: this same logic lives in RMTeamTab.tsx. Extracting both
// helpers (this + convertPendingSaleToBooking) to src/lib/pendingSaleDisplay.ts
// is the right move once these deliveries settle — accumulated debt is
// tracked in the parked-items list.
const convertPendingSaleToBookingShape = (ps: PendingSale): MasterBooking => {
  const fullAddress = `${ps.houseNumber || ''} ${ps.streetName || ''}`.trim();
  return {
    'Booking ID': ps.id,
    'First Name': '',
    'Last Name': '',
    'Full Address': fullAddress,
    'House Number': ps.houseNumber,
    'Street Name': ps.streetName,
    'Route Number': ps.routeCode,
    'Price': ps.price || '',
    'Log Sheet Notes': ps.notes,
    'FO/BO/FP': ps.propertyType as any,
    Status: 'pending',
    services: ps.services,
    isPendingSale: true,
    pendingSaleId: ps.id,
    // 5-field LogsheetJobCard contract — propagate the row's own values; the
    // merger below stamps a child's fields onto a parent when one is paired.
    asphaltAmount: ps.asphaltAmount,
    upsoldAsphaltAmount: ps.upsoldAsphaltAmount,
    saleType: ps.saleType,
    sharedJobKey: ps.sharedJobKey,
    assignedRcSessionId: ps.assignedRcSessionId,
  } as MasterBooking;
};

const mergePendingSalesForDisplay = (pendingSales: PendingSale[]): MasterBooking[] => {
  const allIds = new Set(pendingSales.map(ps => ps.id));

  // Index asphalt children by parentId for quick stamp lookup.
  const asphaltChildByParentId = new Map<string, PendingSale>();
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt' && ps.parentId) {
      asphaltChildByParentId.set(ps.parentId, ps);
    }
  }

  const result: MasterBooking[] = [];
  for (const ps of pendingSales) {
    if (ps.saleType === 'asphalt') {
      // Child whose parent IS in this list → skip; merges into the parent below.
      if (ps.parentId && allIds.has(ps.parentId)) continue;
      // Standalone asphalt (Path 3 deferred, incoming-assigned, or orphan) →
      // render as own amber card via LogsheetJobCard's saleType branch.
      result.push(convertPendingSaleToBookingShape(ps));
    } else {
      const booking = convertPendingSaleToBookingShape(ps);
      const child = asphaltChildByParentId.get(ps.id);
      if (child) {
        // Stamp child's asphalt fields onto the parent. saleType stays
        // undefined on the parent — LogsheetJobCard's "merged" visual state
        // triggers when asphaltAmount > 0 AND saleType !== 'asphalt'.
        (booking as any).asphaltAmount = child.asphaltAmount;
        (booking as any).upsoldAsphaltAmount = child.upsoldAsphaltAmount;
        (booking as any).sharedJobKey = child.sharedJobKey;
        (booking as any).assignedRcSessionId = child.assignedRcSessionId;
      }
      result.push(booking);
    }
  }
  return result;
};

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

// RM View Mode Banner Component
interface RMViewBannerProps {
  workerName: string;
  cartNames: string | null;
  onReturn: () => void;
}

const RMViewBanner: React.FC<RMViewBannerProps> = ({ workerName, cartNames, onReturn }) => (
  <div
    className="bg-gradient-to-r from-cyan-600 to-blue-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm font-bold cursor-pointer hover:from-cyan-500 hover:to-blue-500 transition-all"
    onClick={onReturn}
  >
    <Eye size={18} />
    <span>VIEWING AS {cartNames ? `CART: ${cartNames}` : workerName.toUpperCase()}</span>
    <span className="text-cyan-200 font-normal flex items-center gap-1">
      — <ArrowLeft size={14} /> Click to return to Route Manager view
    </span>
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

  // RM View Mode state
  const [isRMViewMode, setIsRMViewMode] = useState(false);
  const [rmOriginalUser, setRmOriginalUser] = useState<ManagementUser | null>(null);
  const [rmViewCartNames, setRmViewCartNames] = useState<string | null>(null);

  // Season type state
  const [seasonType, setSeasonType] = useState<SeasonType>('aeration');

  // Team state
  const [teammates, setTeammates] = useState<Worker[]>([]);
  const [showTeamModal, setShowTeamModal] = useState(false);

  // Upsells enabled state
  const [upsellsEnabled, setUpsellsEnabled] = useState(true);

  // Digital mapping / view state
  const [hasDigitalMapping, setHasDigitalMapping] = useState(false);
  const [activeView, setActiveView] = useState<'logsheet' | 'pcl' | 'map'>('logsheet');

  // Worker's assigned route codes (used by PCL tab AND by QuickPendingModal)
  const [assignedRouteCodes, setAssignedRouteCodes] = useState<string[]>([]);

  // --- PENDING SALES STATE (team seasons only) ---
  // activeSessionId: the worker's current cart/session id (sess_xxx).
  //   Needed for both the QuickPendingModal (to scope new pending sales) and
  //   for fetching the existing list to display alongside office bookings.
  // showQuickPendingModal: controls the new modal that replaces the blue +
  //   button's NewJob handoff in team seasons.
  // pendingSales: live list of parked pending sales for this cart.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showQuickPendingModal, setShowQuickPendingModal] = useState(false);
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([]);

  // Data State
  const [stats, setStats] = useState<SessionStats>(sessionService.getEmptyStats());
  const [jobs, setJobs] = useState<MasterBooking[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Show the digital tabs (PCL + Route Map) only for aeration, non-training,
  // non-RM-view sessions with digital mapping enabled for this command center.
  const showMapTab = hasDigitalMapping && !isTrainingMode && !isRMViewMode;

  // Check if this is a team season with teammates.
  // seasonHasTeams() handles lawn_rejuv + sealing today (and future cleaning when added).
  const hasTeammates = seasonHasTeams(seasonType) && teammates.length > 1;

  // Team season flag — drives the blue + button behaviour and pending-sales display.
  // Production mode only; training is always Aeration so pending sales code paths skip naturally.
  const isTeamSeason = seasonHasTeams(seasonType) && !isTrainingMode;

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
    if (isRMViewMode) {
      removeStorageItem('rm_original_user');
      removeStorageItem('rm_view_mode');
      removeStorageItem('rm_view_cart_names');
    }
    navigate('/');
  };

  // Return to RM view handler
  const handleReturnToRM = () => {
    if (rmOriginalUser) {
      setStorageItem('current_user', rmOriginalUser);
      removeStorageItem('rm_original_user');
      removeStorageItem('rm_view_mode');
      removeStorageItem('rm_view_cart_names');
      navigate('/rm-logbook');
    }
  };

  // Initial load and data fetching
  useEffect(() => {
    const init = async () => {
      setLoading(true);

      // Check training mode
      const trainingMode = trainingService.isTrainingMode();
      setIsTrainingMode(trainingMode);

      // Check RM view mode
      const rmViewMode = getStorageItem<boolean>('rm_view_mode', false);
      const originalUser = getStorageItem<ManagementUser | null>('rm_original_user', null);
      const cartNames = getStorageItem<string | null>('rm_view_cart_names', null);
      setIsRMViewMode(rmViewMode);
      setRmOriginalUser(originalUser);
      setRmViewCartNames(cartNames);

      // Check digital mapping enabled for this command center
      const cc = commandCenterService.getCurrentCommandCenter();
      setHasDigitalMapping(cc?.digitalMappingEnabled || false);

      const storedWorker = getStorageItem<Worker | null>('current_user', null);
      if (!storedWorker) {
        navigate('/');
        return;
      }
      setWorker(storedWorker);

      try {
        if (trainingMode) {
          // --- TRAINING MODE ---
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
            setAssignedRouteCodes(myRoutes.map((r: any) => r.routeCode));
          }

          const managerData = trainingService.getManagerById(storedWorker.assignedManagerId || '');
          setManager(managerData);
          setUpsellsEnabled(true);
          setSeasonType('aeration');
          // Training is always Aeration — pending sales never apply here
          setActiveSessionId(null);
          setPendingSales([]);
        } else {
          // --- PRODUCTION MODE ---
          if (!rmViewMode) {
            const isLockedOut = await sessionService.isWorkerLockedOut(storedWorker.contractorId);
            if (isLockedOut) {
              forceLogout();
              return;
            }
          }

          const currentSeasonType = await sessionService.getSessionSeasonType();
          setSeasonType(currentSeasonType);

          const session = await sessionService.startLogsheetSession(storedWorker.contractorId);
          setStats(session.stats);
          // Stash the session id for QuickPendingModal + pending sales fetch
          setActiveSessionId(session.id);

          const assignments = await sessionService.getWorkerAssignments(storedWorker.contractorId);
          setJobs(assignments);

          // --- PENDING SALES FETCH (team seasons only) ---
          // seasonHasTeams() is true for Rejuv + Sealing. Aeration skips this entirely.
          // The returned list is fed through mergePendingSalesForDisplay in
          // filteredJobs below to collapse parent+asphalt-child pairs into single
          // display cards (LogsheetJobCard renders the three asphalt visual states).
          if (seasonHasTeams(currentSeasonType) && session.id) {
            try {
              const sales = await sessionService.getPendingSalesForSession(session.id);
              setPendingSales(sales);
            } catch (err) {
              console.warn('[Dashboard] Failed to load pending sales:', err);
              setPendingSales([]);
            }
          } else {
            setPendingSales([]);
          }

          const dailySession = await sessionService.getDailySession();
          if (dailySession) {
            const myRoutes = dailySession.routes.filter(
              r => r.assignedWorkerIds && r.assignedWorkerIds.includes(storedWorker.contractorId)
            );
            setHasAssignedRoutes(myRoutes.length > 0);
            setAssignedRouteCodes(myRoutes.map(r => r.routeCode));

            // Load teammates for ANY team-based season (lawn_rejuv + sealing today).
            // TODO: When Central Cleaning ships, seasonHasTeams() will return true for it automatically.
            if (seasonHasTeams(currentSeasonType) && dailySession.teamCarts) {
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

  // Lockout listener (production only, not RM view)
  useEffect(() => {
    if (!worker || isTrainingMode || isRMViewMode) return;

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
  }, [worker?.contractorId, navigate, isTrainingMode, isRMViewMode]);

  // Realtime subscription (production only)
  useEffect(() => {
    if (!worker || isTrainingMode) return;
    const unsubscribe = subscribeAsContractor(() => setRefreshKey((prev) => prev + 1));
    return () => unsubscribe();
  }, [worker?.contractorId, isTrainingMode]);

  const handleLogout = () => {
    removeStorageItem('current_user');
    if (isTrainingMode) trainingService.disableTrainingMode();
    if (isRMViewMode) {
      removeStorageItem('rm_original_user');
      removeStorageItem('rm_view_mode');
      removeStorageItem('rm_view_cart_names');
    }
    navigate('/');
  };

  const handleTabSwitch = (tab: 'pending' | 'not_done' | 'completed') => {
    setViewFilter(tab);
    setRefreshKey((prev) => prev + 1);
  };

  // --- BLUE + BUTTON HANDLER ---
  // Team seasons (Rejuv + Sealing): open QuickPendingModal instead of jumping
  // straight to NewJob. Aeration: unchanged — straight to NewJob as before.
  const handleAddClick = () => {
    if (isTeamSeason && activeSessionId) {
      setShowQuickPendingModal(true);
    } else {
      navigate('/logsheet/new');
    }
  };

  // --- JOB CARD CLICK HANDLER ---
  // Pending sales route to NewJob with the id so it prefills. NewJob's 8-case
  // resolver handles all asphalt sub-states (merged parent, standalone, deferred
  // pickup, assigned-incoming). Office bookings and completed transactions keep
  // the existing JobDetail route.
  const handleJobCardClick = (job: MasterBooking) => {
    if ((job as any).isPendingSale && (job as any).pendingSaleId) {
      navigate(`/logsheet/new?pendingSaleId=${encodeURIComponent((job as any).pendingSaleId)}`);
    } else {
      navigate(`/job-detail/${encodeURIComponent(job['Booking ID'])}`);
    }
  };

  // --- REFRESH PENDING SALES AFTER MODAL ACTIONS ---
  // Called by QuickPendingModal after a successful Save Pending so the new row
  // shows up immediately without waiting for a realtime tick.
  const handlePendingSalesRefresh = async () => {
    if (!activeSessionId || !isTeamSeason) return;
    try {
      const sales = await sessionService.getPendingSalesForSession(activeSessionId);
      setPendingSales(sales);
    } catch (err) {
      console.warn('[Dashboard] Failed to refresh pending sales:', err);
    }
  };

  // --- FILTERED JOBS ---
  // Pending tab merges pending sales (with asphalt parent+child collapse) into
  // office bookings. The merger collapses driveway+asphalt pairs into single
  // cards with the 5 asphalt fields stamped; standalone asphalt rows (Path 3
  // deferred, orphan, or incoming-assigned) pass through as their own cards.
  // LogsheetJobCard's three visual states render the distinction.
  //
  // Pending sales never appear on Not Done (no cancelled/next_time concept for
  // them — deletion-only per design decision E) or Completed (completion
  // converts them to real transactions and deletes the pending row).
  const filteredJobs = useMemo(() => {
    if (viewFilter === 'pending') {
      const officePending = jobs.filter(
        (b) => !b.Completed && (!b.Status || b.Status === 'pending')
      );
      const mergedPendingBookings = mergePendingSalesForDisplay(pendingSales);
      // Pending sales first so the worker sees their own parked work before
      // scrolling through office prebooks. Adjust ordering if desired.
      return [...mergedPendingBookings, ...officePending];
    } else if (viewFilter === 'not_done') {
      return jobs.filter((b) => b.Status === 'cancelled' || b.Status === 'next_time');
    } else {
      return jobs.filter((b) => b.Completed === 'x' || b.Status === 'completed');
    }
  }, [jobs, viewFilter, pendingSales]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <Loader className="animate-spin text-cps-blue" />
      </div>
    );
  }

  return (
    <div className={`bg-black flex flex-col ${activeView === 'map' ? 'h-screen overflow-hidden' : 'min-h-screen pb-20'}`}>
      {/* RM View Mode Banner */}
      {isRMViewMode && worker && (
        <RMViewBanner
          workerName={`${worker.firstName} ${worker.lastName}`}
          cartNames={rmViewCartNames}
          onReturn={handleReturnToRM}
        />
      )}

      {/* Training Mode Banner */}
      {isTrainingMode && !isRMViewMode && <TrainingBanner />}

      {/* Toast Notification */}
      <Toast message={toastMessage} show={showToast} />

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-30 bg-black/90 backdrop-blur-md border-b border-gray-800 p-4 pb-2">

        {/* TOP-LEVEL TAB SWITCHER — Logsheet | PCL | Route Map
            Only visible when digital mapping is enabled, aeration season,
            not training, not RM view */}
        {showMapTab && (
          <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-800 mb-3">
            <button
              onClick={() => setActiveView('logsheet')}
              className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                activeView === 'logsheet'
                  ? 'bg-cps-blue text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <FileText size={13} />
              Logsheet
            </button>
            <button
              onClick={() => setActiveView('pcl')}
              className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                activeView === 'pcl'
                  ? 'bg-amber-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <BookOpen size={13} />
              PCL
            </button>
            <button
              onClick={() => setActiveView('map')}
              className={`flex-1 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                activeView === 'map'
                  ? 'bg-green-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <MapIcon size={13} />
              Route Map
            </button>
          </div>
        )}

        {/* LOGSHEET-SPECIFIC HEADER CONTENT */}
        {activeView === 'logsheet' && (
          <>
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="flex items-center gap-2 text-white font-bold text-lg">
                  <Calendar size={18} className="text-cps-blue" />
                  {format(new Date(), 'EEE, MMM d')}
                  {/* Season badge — 3-way branch: lawn_rejuv | sealing | (none for aeration) */}
                  {/* TODO: Add a 'cleaning' branch here once Central Cleaning ships. */}
                  {seasonType === 'lawn_rejuv' && (
                    <span className="text-[9px] bg-green-900/50 text-green-300 px-1.5 py-0.5 rounded border border-green-700">
                      LAWN REJUV
                    </span>
                  )}
                  {seasonType === 'sealing' && (
                    <span className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-600 flex items-center gap-1">
                      <Shovel size={9}/> SEALING
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-gray-400 text-xs mt-1">
                  <span>{worker?.firstName} {worker?.lastName}</span>
                  <span className={`px-1.5 rounded border ${isTrainingMode ? 'bg-yellow-900/30 border-yellow-700 text-yellow-400' : isRMViewMode ? 'bg-cyan-900/30 border-cyan-700 text-cyan-400' : 'bg-gray-800 border-gray-700'}`}>
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
                {/* Back to Training Lesson button */}
                {isTrainingMode && !isRMViewMode && (
                  <button
                    onClick={() => {
                      const returnPath = sessionStorage.getItem('training_return_path');
                      trainingService.disableTrainingMode();
                      sessionStorage.removeItem('training_return_path');
                      removeStorageItem('current_user');
                      navigate(returnPath || '/training');
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/50 text-amber-400 text-xs font-semibold rounded-lg transition-colors"
                  >
                    <GraduationCap size={16} />
                    <span className="hidden sm:inline">Back to Lesson</span>
                  </button>
                )}
                {/* BLUE + BUTTON — branches by season:
                    Team seasons (Rejuv + Sealing): opens QuickPendingModal so the
                    worker can park a half-collected sale or proceed to complete.
                    Aeration: navigates straight to NewJob as before. */}
                {hasAssignedRoutes && (
                  <button
                    onClick={handleAddClick}
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

            {/* Stats Grid */}
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

            {/* Filter Tabs */}
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
          </>
        )}

        {/* PCL VIEW — minimal header strip */}
        {activeView === 'pcl' && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {worker?.firstName} {worker?.lastName} ·{' '}
              <span className="text-gray-600">#{worker?.contractorId}</span>
            </span>
            <button
              onClick={handleLogout}
              className="p-2 bg-gray-800 text-red-400 rounded-lg border border-gray-700"
            >
              <LogOut size={18} />
            </button>
          </div>
        )}

        {/* MAP VIEW — minimal header strip showing who's viewing */}
        {activeView === 'map' && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              {worker?.firstName} {worker?.lastName} · <span className="text-gray-600">#{worker?.contractorId}</span>
            </span>
            <button
              onClick={handleLogout}
              className="p-2 bg-gray-800 text-red-400 rounded-lg border border-gray-700"
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>

      {/* ── LOGSHEET CONTENT ── */}
      {activeView === 'logsheet' && (
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
                onClick={() => handleJobCardClick(job)}
              />
            ))
          )}
        </div>
      )}

      {/* ── PCL CONTENT ── */}
      {activeView === 'pcl' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <WorkerPCLTab routeCodes={assignedRouteCodes} seasonType={seasonType} />
        </div>
      )}

      {/* ── MAP CONTENT ── */}
      {activeView === 'map' && worker && (
        <div className="flex-1 relative">
          <WorkerMapTab worker={worker} />
        </div>
      )}

      {/* ── MODALS (always rendered regardless of active view) ── */}
      {showContractModal && (
        <AddContractModal
          onClose={() => {
            setShowContractModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* QUICK PENDING MODAL (team seasons only) — replaces the blue + button's
          direct navigation to NewJob. Opened by handleAddClick when isTeamSeason
          is true and the worker has an active session id. */}
      {showQuickPendingModal && worker && activeSessionId && (
        <QuickPendingModal
          worker={worker}
          sessionId={activeSessionId}
          seasonType={seasonType}
          assignedRoutes={assignedRouteCodes}
          onClose={() => setShowQuickPendingModal(false)}
          onSaved={handlePendingSalesRefresh}
        />
      )}

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
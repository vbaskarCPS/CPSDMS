// src/pages/Management/components/RMRoutesTab.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Map as MapIcon, 
  AlertCircle, X, Check, ChevronDown, ChevronUp, 
  MapPin, Phone, User, Users, Shuffle, Truck, Leaf, FileText,
  Shovel, // NEW: Sealing season banner icon
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { 
  getPrepaidWeight, 
  getSeasonConfig,
  seasonHasTeams, // NEW: drives isTeamSeason — true for Rejuv AND Sealing
  EQ_DIVISOR 
} from '../../../lib/commandCenterService';
import { RouteData, MasterBooking, Worker, ManagementUser, SeasonType, TeamCart, LogsheetSession } from '../../../types';
import PendingJobModal from '../../../components/PendingJobModal';

interface RMRoutesTabProps {
  managerId: string;
  routes: RouteData[];
  bookings: MasterBooking[];
  workers: Worker[];
  managers: ManagementUser[];
  seasonType?: SeasonType;
  teamCarts?: TeamCart[];
  allSessions?: LogsheetSession[]; // source of truth for cart membership
  onRefresh: () => void;
}

interface WorkerBreakdown {
  workerId: string;
  workerName: string;
  initials: string;
  bookingCount: number;
}

interface RouteDisplay {
  routeCode: string;
  totalBookings: number;
  prepaidCount: number;
  totalEQ: number;
  assignedWorkerIds: string[];
  items: MasterBooking[];
  workerBreakdown: WorkerBreakdown[];
  unassignedCount: number;
}

const RMRoutesTab: React.FC<RMRoutesTabProps> = ({
  managerId,
  routes,
  bookings,
  workers,
  managers,
  seasonType = 'aeration',
  teamCarts = [],
  allSessions = [],
  onRefresh,
}) => {
  // CHANGED: was a single `isLawnRejuv` flag driving all cart-vs-individual
  // branching. Now we have two flags:
  //   - isTeamSeason: true for Rejuv AND Sealing — drives cart-based assignment,
  //                   cart-aware sorting, cart-bubble rendering, modal branching.
  //   - isLawnRejuv:  true ONLY for Rejuv — used solely for showing the A/D/F/S/L
  //                   service badges on job rows. Sealing has no services so this
  //                   correctly stays Rejuv-only.
  const isLawnRejuv = seasonType === 'lawn_rejuv';
  const isTeamSeason = seasonHasTeams(seasonType);
  
  // State
  const [displayRoutes, setDisplayRoutes] = useState<RouteDisplay[]>([]);
  const [contractors, setContractors] = useState<Worker[]>([]);
  const [sortBy, setSortBy] = useState<'alpha' | 'prebooks' | 'eq'>('alpha');
  
  // Selection State
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  
  // Modal State
  const [assignModalData, setAssignModalData] = useState<{
    type: 'ROUTE' | 'JOB';
    targetId: string;
    currentWorkerId: string | null;
    routeCode?: string;
    title: string;
  } | null>(null);

  const [transferModalData, setTransferModalData] = useState<{
    type: 'ROUTE' | 'JOB';
    targetId: string;
    routeCode: string;
    title: string;
  } | null>(null);

  // Pending Job Modal State
  const [pendingJob, setPendingJob] = useState<MasterBooking | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter managers (exclude current manager)
  const availableManagers = useMemo(() => {
    return managers.filter(m => m.userId !== managerId && m.role === 'RouteManager');
  }, [managers, managerId]);

  // Build cart lookup for contractors
  const cartByWorkerId = useMemo(() => {
    const map = new Map<string, TeamCart>();
    teamCarts.forEach(cart => {
      cart.workerIds.forEach(wid => {
        map.set(wid, cart);
      });
    });
    return map;
  }, [teamCarts]);

  // --- EQ CALCULATION HELPER ---
  const calculateBookingEQ = (booking: MasterBooking): number => {
    const priceStr = String(booking.Price || '');
    const config = getSeasonConfig(seasonType);
    
    for (const flat of config.officeFlats) {
      if (priceStr.startsWith(flat.code)) {
        return flat.value / EQ_DIVISOR;
      }
    }
    
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
    if (price === 0) return 0;
    
    const isPrepaid = booking.Prepaid === 'x';
    const weight = isPrepaid ? getPrepaidWeight(seasonType) : 1.0;
    
    const taxDivisor = 1.05;
    const eq = (price * weight) / taxDivisor / EQ_DIVISOR;
    
    return eq;
  };

  // --- 1. DATA PROCESSING ---
  useEffect(() => {
    const myTeam = workers.filter((w) => w.assignedManagerId === managerId);
    setContractors(myTeam);

    const myRoutes = routes.filter((r) => r.managerId === managerId);
    const myRouteCodes = new Set(myRoutes.map(r => r.routeCode));

    const groupedBookings: Record<string, MasterBooking[]> = {};
    
    myRoutes.forEach(r => {
      groupedBookings[r.routeCode] = [];
    });

    bookings.forEach(b => {
      const rCode = b['Route Number'];
      if (rCode && myRouteCodes.has(rCode)) {
        groupedBookings[rCode].push(b);
      }
    });

    const enrichedRoutes = myRoutes.map((r) => {
      const routeBookings = groupedBookings[r.routeCode] || [];

      const totalEQ = routeBookings.reduce((sum, b) => {
        return sum + calculateBookingEQ(b);
      }, 0);

      const workerCounts: Record<string, { count: number; worker: Worker | null }> = {};
      let unassignedCount = 0;

      routeBookings.forEach(b => {
        const contractorId = b['Contractor Number'];
        if (contractorId) {
          if (!workerCounts[contractorId]) {
            const worker = myTeam.find(w => w.contractorId === contractorId) || null;
            workerCounts[contractorId] = { count: 0, worker };
          }
          workerCounts[contractorId].count++;
        } else {
          unassignedCount++;
        }
      });

      const workerBreakdown: WorkerBreakdown[] = Object.entries(workerCounts)
        .filter(([_, data]) => data.worker !== null)
        .map(([workerId, data]) => ({
          workerId,
          workerName: `${data.worker!.firstName} ${data.worker!.lastName}`,
          initials: `${data.worker!.firstName[0]}${data.worker!.lastName[0]}`,
          bookingCount: data.count
        }))
        .sort((a, b) => b.bookingCount - a.bookingCount);

      return {
        routeCode: r.routeCode,
        totalBookings: routeBookings.length,
        prepaidCount: routeBookings.filter((b) => b.Prepaid === 'x').length,
        totalEQ: totalEQ,
        assignedWorkerIds: r.assignedWorkerIds || [],
        items: routeBookings,
        workerBreakdown,
        unassignedCount
      };
    });

    setDisplayRoutes(enrichedRoutes);

  }, [managerId, routes, bookings, workers, seasonType]);

  // --- 2. SORTING ---
  
  const sortedRoutes = useMemo(() => {
    const routeList = [...displayRoutes];
    
    const unassigned = routeList.filter(r => r.assignedWorkerIds.length === 0);
    const assigned = routeList.filter(r => r.assignedWorkerIds.length > 0);
    
    const sortFn = (a: RouteDisplay, b: RouteDisplay) => {
      if (sortBy === 'alpha') {
        return a.routeCode.localeCompare(b.routeCode);
      } else if (sortBy === 'prebooks') {
        return b.totalBookings - a.totalBookings;
      } else {
        return b.totalEQ - a.totalEQ;
      }
    };
    
    unassigned.sort(sortFn);
    assigned.sort(sortFn);
    
    return [...unassigned, ...assigned];
  }, [displayRoutes, sortBy]);

  // --- 3. CALCULATE ASSIGNMENTS & SORTING ---
  
  const workerRouteMap = useMemo(() => {
    const map = new Map<string, string[]>();
    routes.forEach(r => {
      (r.assignedWorkerIds || []).forEach(workerId => {
        const existing = map.get(workerId) || [];
        if (!existing.includes(r.routeCode)) {
          existing.push(r.routeCode);
        }
        map.set(workerId, existing);
      });
    });
    return map;
  }, [routes]);

  const sortedContractors = useMemo(() => {
    const sorted = [...contractors];
    
    // CHANGED: was `if (isLawnRejuv)`. Now isTeamSeason — Sealing teams also sort by cart.
    if (isTeamSeason) {
      return sorted.sort((a, b) => {
        const aTeam = a.teamId || a.contractorId;
        const bTeam = b.teamId || b.contractorId;
        
        if (aTeam !== bTeam) {
          return aTeam.localeCompare(bTeam);
        }
        return a.firstName.localeCompare(b.firstName);
      });
    }
    
    return sorted.sort((a, b) => {
      const aRoutes = workerRouteMap.get(a.contractorId);
      const bRoutes = workerRouteMap.get(b.contractorId);
      
      const aHasRoute = aRoutes && aRoutes.length > 0;
      const bHasRoute = bRoutes && bRoutes.length > 0;

      if (aHasRoute !== bHasRoute) {
        return aHasRoute ? 1 : -1;
      }

      return a.firstName.localeCompare(b.firstName);
    });
  }, [contractors, workerRouteMap, isTeamSeason]);

  // Build contractorsByCart from allSessions instead of worker.teamId.
  // After a reassignment, logsheet_sessions reflects the new cart membership
  // immediately. worker.teamId (metadata) never changes mid-session.
  // CHANGED: was gated `if (!isLawnRejuv) return null` — now Sealing also gets
  // the cart-based contractor map.
  const contractorsByCart = useMemo(() => {
    if (!isTeamSeason) return null;
    
    const myTeamIds = new Set(contractors.map(w => w.contractorId));
    const workerMap = new Map(contractors.map(w => [w.contractorId, w]));
    const cartMap = new Map<string, Worker[]>();

    allSessions.forEach(session => {
      const sessionWorkerIds = (session.teamWorkerIds || [session.workerId])
        .filter(id => myTeamIds.has(id));
      if (sessionWorkerIds.length === 0) return;

      const sessionWorkers = sessionWorkerIds
        .map(id => workerMap.get(id))
        .filter(Boolean) as Worker[];
      if (sessionWorkers.length === 0) return;

      // Key by session's primary workerId — stable, unique per cart
      cartMap.set(session.workerId, sessionWorkers);
    });

    return cartMap;
  }, [contractors, allSessions, isTeamSeason]);

  // --- 4. ACTIONS ---

  const handleCopy = (text: string, uniqueId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(uniqueId);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const toggleRouteExpand = (routeCode: string) => {
    const next = new Set(expandedRoutes);
    if (next.has(routeCode)) next.delete(routeCode);
    else next.add(routeCode);
    setExpandedRoutes(next);
  };

  // Handle job row click (open PendingJobModal for non-completed jobs)
  const handleJobClick = (job: MasterBooking) => {
    const isCompleted = job.Status === 'completed' || job.Completed === 'x';
    
    if (!isCompleted) {
      setPendingJob(job);
    }
  };

  const handlePendingModalClose = () => {
    setPendingJob(null);
  };

  const handlePendingModalUpdate = () => {
    setPendingJob(null);
    onRefresh();
  };

  const handleAssignConfirm = async (workerId: string | null) => {
    if (!assignModalData) return;

    if (assignModalData.type === 'ROUTE') {
      const routeCode = assignModalData.targetId;
      
      if (workerId === null) {
        // Unassign route
        await sessionService.assignRouteToWorkers(routeCode, []);
        
        // CHANGED: was `if (isLawnRejuv)`. Now isTeamSeason — Sealing also
        // clears session-based booking assignments on route unassign.
        if (isTeamSeason) {
          const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
          const pendingItems = routeItems.filter(b => b.Status !== 'completed');
          await Promise.all(pendingItems.map(job => 
            sessionService.assignBookingToSession(job['Booking ID'], null)
          ));
        }
      } else if (isTeamSeason) {
        // CHANGED: was `else if (isLawnRejuv)`. Now Sealing also takes this
        // session-based cart-aware assignment path.
        const worker = contractors.find(w => w.contractorId === workerId);
        const teamId = worker?.teamId || workerId;
        const cart = teamCarts.find(c => c.teamId === teamId);
        
        // Get the session for this cart
        const session = await sessionService.getWorkerLogsheetSession(workerId);
        const sessionId = session?.id;
        
        if (cart && cart.workerIds.length > 1) {
          // Assign all cart members to the route
          await sessionService.assignRouteToWorkers(routeCode, cart.workerIds);
          
          // Assign all pending bookings to the SESSION (not contractor)
          if (sessionId) {
            const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
            const pendingItems = routeItems.filter(b => b.Status !== 'completed');
            const bookingIds = pendingItems.map(job => job['Booking ID']);
            
            if (bookingIds.length > 0) {
              await sessionService.assignBookingsToSession(bookingIds, sessionId);
            }
          }
        } else {
          // Solo worker - still use session-based assignment
          await sessionService.assignRouteToWorkers(routeCode, [workerId]);
          
          if (sessionId) {
            const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
            const pendingItems = routeItems.filter(b => b.Status !== 'completed');
            const bookingIds = pendingItems.map(job => job['Booking ID']);
            
            if (bookingIds.length > 0) {
              await sessionService.assignBookingsToSession(bookingIds, sessionId);
            }
          }
        }
      } else {
        // AERATION: Single worker assignment to contractor_id
        await sessionService.assignRouteToWorkers(routeCode, [workerId]);

        const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
        const pendingItems = routeItems.filter(b => b.Status !== 'completed');
        
        await Promise.all(pendingItems.map(job => 
          sessionService.assignBookingToWorker(job['Booking ID'], workerId)
        ));
      }
    } else {
      // Single job assignment
      // CHANGED: was `if (isLawnRejuv && workerId)`. Now isTeamSeason.
      if (isTeamSeason && workerId) {
        // Team season: assign to session
        const session = await sessionService.getWorkerLogsheetSession(workerId);
        if (session?.id) {
          await sessionService.assignBookingToSession(assignModalData.targetId, session.id);
        }
      } else {
        // Aeration: assign to contractor
        await sessionService.assignBookingToWorker(assignModalData.targetId, workerId);
      }
    }

    setAssignModalData(null);
    onRefresh(); 
  };

  const handleTransferConfirm = async (newManagerId: string) => {
    if (!transferModalData) return;

    if (transferModalData.type === 'ROUTE') {
      await sessionService.transferRouteToManager(transferModalData.routeCode, newManagerId);
    } else {
      await sessionService.transferBookingToManager(
        transferModalData.targetId,
        transferModalData.routeCode,
        newManagerId
      );
    }

    setTransferModalData(null);
    onRefresh();
  };

  const openTransferModal = () => {
    if (!assignModalData) return;
    
    setTransferModalData({
      type: assignModalData.type,
      targetId: assignModalData.targetId,
      routeCode: assignModalData.type === 'ROUTE' 
        ? assignModalData.targetId 
        : (assignModalData.routeCode || ''),
      title: assignModalData.type === 'ROUTE' 
        ? `Transfer Route ${assignModalData.targetId}`
        : 'Transfer Job to Manager'
    });
    
    setAssignModalData(null);
  };

  const getWorkerInfo = (id: string | null) => {
    if (!id) return null;
    return contractors.find((x) => x.contractorId === id);
  };

  // --- 5. RENDER HELPER: Worker Bubbles ---
  const renderWorkerBubbles = (route: RouteDisplay) => {
    const hasAssignments = route.assignedWorkerIds.length > 0;
    const hasUnassigned = route.unassignedCount > 0;
    
    if (!hasAssignments) {
      return (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setAssignModalData({
              type: 'ROUTE',
              targetId: route.routeCode,
              currentWorkerId: null,
              routeCode: route.routeCode,
              title: `Assign Route ${route.routeCode}`
            });
          }}
          className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm border shadow-lg transition-transform active:scale-95 bg-gray-700 text-gray-500 border-gray-600 hover:border-red-500 hover:text-red-400"
        >
          {/* CHANGED: was isLawnRejuv — now isTeamSeason so Sealing also shows
              the Truck (cart-mode) icon for unassigned team-season routes. */}
          {isTeamSeason ? <Truck size={18} /> : <Users size={18} />}
        </button>
      );
    }

    // CHANGED: was `!isLawnRejuv` — single-worker avatar bypass now applies to
    // Aeration ONLY. Sealing and Rejuv both fall through to the cart-aware branch.
    if (route.assignedWorkerIds.length === 1 && !hasUnassigned && !isTeamSeason) {
      const worker = getWorkerInfo(route.assignedWorkerIds[0]);
      
      return (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setAssignModalData({
              type: 'ROUTE',
              targetId: route.routeCode,
              currentWorkerId: route.assignedWorkerIds[0],
              routeCode: route.routeCode,
              title: `Assign Route ${route.routeCode}`
            });
          }}
          className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm border shadow-lg transition-transform active:scale-95 bg-cps-blue text-white border-blue-500"
        >
          {worker && (
            <span>{worker.firstName[0]}{worker.lastName[0]}</span>
          )}
        </button>
      );
    }

    // CHANGED: was `isLawnRejuv` — Sealing also takes this team-aware branch.
    if (isTeamSeason && route.assignedWorkerIds.length >= 1) {
      const firstWorker = getWorkerInfo(route.assignedWorkerIds[0]);
      const cart = firstWorker ? cartByWorkerId.get(firstWorker.contractorId) : null;
      const isFullCart = cart && cart.workerIds.every(wid => route.assignedWorkerIds.includes(wid));
      
      if (isFullCart && cart.workerIds.length > 1) {
        // Multi-worker team cart bubble.
        // CHANGED: cart-button color now season-aware — green for Rejuv, slate for Sealing.
        const cartButtonClass = seasonType === 'sealing'
          ? 'bg-slate-600 text-slate-100 border-slate-500'
          : 'bg-green-600 text-white border-green-500';
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAssignModalData({
                type: 'ROUTE',
                targetId: route.routeCode,
                currentWorkerId: route.assignedWorkerIds[0],
                routeCode: route.routeCode,
                title: `Assign Route ${route.routeCode}`
              });
            }}
            className={`h-10 w-10 rounded-lg flex flex-col items-center justify-center font-bold text-sm border shadow-lg transition-transform active:scale-95 ${cartButtonClass}`}
          >
            <Truck size={14} />
            <span className="text-[9px]">{cart.workerIds.length}</span>
          </button>
        );
      } else if (route.assignedWorkerIds.length === 1) {
        return (
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setAssignModalData({
                type: 'ROUTE',
                targetId: route.routeCode,
                currentWorkerId: route.assignedWorkerIds[0],
                routeCode: route.routeCode,
                title: `Assign Route ${route.routeCode}`
              });
            }}
            className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm border shadow-lg transition-transform active:scale-95 bg-cps-blue text-white border-blue-500"
          >
            {firstWorker && (
              <span>{firstWorker.firstName[0]}{firstWorker.lastName[0]}</span>
            )}
          </button>
        );
      }
    }

    const bubblesToShow: { type: 'worker' | 'unassigned' | 'overflow'; workerId?: string; count?: number }[] = [];
    
    route.assignedWorkerIds.slice(0, 4).forEach(workerId => {
      bubblesToShow.push({ type: 'worker', workerId });
    });

    if (hasUnassigned && bubblesToShow.length < 4) {
      bubblesToShow.push({ type: 'unassigned', count: route.unassignedCount });
    }

    const totalItems = route.assignedWorkerIds.length + (hasUnassigned ? 1 : 0);
    const overflow = totalItems - bubblesToShow.length;
    
    if (overflow > 0) {
      bubblesToShow.pop();
      bubblesToShow.push({ type: 'overflow', count: overflow + 1 });
    }

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setAssignModalData({
            type: 'ROUTE',
            targetId: route.routeCode,
            currentWorkerId: route.assignedWorkerIds[0] || null,
            routeCode: route.routeCode,
            title: `Assign Route ${route.routeCode}`
          });
        }}
        className="flex items-center -space-x-2 hover:opacity-80 transition-opacity"
      >
        {bubblesToShow.map((bubble, idx) => {
          if (bubble.type === 'worker' && bubble.workerId) {
            const worker = getWorkerInfo(bubble.workerId);
            const breakdown = route.workerBreakdown.find(wb => wb.workerId === bubble.workerId);
            // CHANGED: was `isLawnRejuv && worker?.teamId` — now isTeamSeason so
            // Sealing also colors team members differently. Color picks slate
            // for Sealing, green for Rejuv.
            const isTeamMember = isTeamSeason && worker?.teamId;
            const teamMemberClass = seasonType === 'sealing'
              ? 'bg-slate-600 text-slate-100'
              : 'bg-green-600 text-white';
            
            return (
              <div
                key={bubble.workerId}
                className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-gray-800 shadow-md ${
                  isTeamMember ? teamMemberClass : 'bg-cps-blue text-white'
                }`}
                style={{ zIndex: bubblesToShow.length - idx }}
                title={worker ? `${worker.firstName} ${worker.lastName}${breakdown ? ` (${breakdown.bookingCount} jobs)` : ''}` : ''}
              >
                {worker ? `${worker.firstName[0]}${worker.lastName[0]}` : '??'}
              </div>
            );
          }
          
          if (bubble.type === 'unassigned') {
            return (
              <div
                key="unassigned"
                className="h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-gray-800 bg-red-900/50 text-red-400 shadow-md"
                style={{ zIndex: bubblesToShow.length - idx }}
                title={`${bubble.count} unassigned jobs`}
              >
                {bubble.count}
              </div>
            );
          }
          
          if (bubble.type === 'overflow') {
            return (
              <div
                key="overflow"
                className="h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-gray-800 bg-gray-600 text-gray-300 shadow-md"
                style={{ zIndex: bubblesToShow.length - idx }}
                title={`+${bubble.count} more`}
              >
                +{bubble.count}
              </div>
            );
          }
          
          return null;
        })}
      </button>
    );
  };

  // --- 6. RENDER HELPER: Route Status Text ---
  const renderRouteStatus = (route: RouteDisplay) => {
    const hasAssignments = route.assignedWorkerIds.length > 0;
    
    if (!hasAssignments) {
      return <span className="text-red-400 italic">Unassigned Route</span>;
    }
    
    // CHANGED: was `if (isLawnRejuv)`. Now isTeamSeason — Sealing also gets the
    // cart label. Text color season-aware (slate vs green).
    if (isTeamSeason) {
      const firstWorker = getWorkerInfo(route.assignedWorkerIds[0]);
      const cart = firstWorker ? cartByWorkerId.get(firstWorker.contractorId) : null;
      const isFullCart = cart && cart.workerIds.every(wid => route.assignedWorkerIds.includes(wid));
      
      if (isFullCart && cart.workerIds.length > 1) {
        const cartLabelClass = seasonType === 'sealing' ? 'text-slate-300' : 'text-green-300';
        return (
          <span className={`${cartLabelClass} flex items-center gap-1`}>
            <Truck size={12} />
            Cart {cart.teamId} ({cart.workerIds.length} workers)
          </span>
        );
      }
    }
    
    if (route.assignedWorkerIds.length === 1) {
      const worker = getWorkerInfo(route.assignedWorkerIds[0]);
      if (worker) {
        return <span className="text-blue-300">{worker.firstName} {worker.lastName}</span>;
      }
    }
    
    const workerCount = route.assignedWorkerIds.length;
    const unassignedText = route.unassignedCount > 0 ? ` · ${route.unassignedCount} unassigned` : '';
    return (
      <span className="text-amber-400">
        {workerCount} worker{workerCount !== 1 ? 's' : ''}{unassignedText}
      </span>
    );
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-4">
      {/* Sort Dropdown */}
      {displayRoutes.length > 0 && (
        <div className="flex justify-between items-center mb-4">
          {/* CHANGED: was {isLawnRejuv && (...Leaf + green + "Lawn Rejuv Mode")}.
              Now shows for any team season, season-aware: Rejuv keeps Leaf+green,
              Sealing gets Shovel+slate with "Sealing Mode" label. */}
          {isTeamSeason && (
            <div className={`flex items-center gap-1 text-xs ${
              seasonType === 'sealing' ? 'text-slate-300' : 'text-green-400'
            }`}>
              {seasonType === 'sealing' ? <Shovel size={12} /> : <Leaf size={12} />}
              <span>
                {seasonType === 'sealing'
                  ? 'Sealing Mode - Assign by Cart'
                  : 'Lawn Rejuv Mode - Assign by Cart'}
              </span>
            </div>
          )}
          {/* CHANGED: !isLawnRejuv → !isTeamSeason so Sealing also keeps the
              banner on left and dropdown on right (instead of dropdown floating). */}
          <div className={`flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-sm ${!isTeamSeason ? 'ml-auto' : ''}`}>
            <span className="text-xs text-gray-400 font-medium">Sort by:</span>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cps-blue cursor-pointer"
            >
              <option value="alpha">Alphabetically</option>
              <option value="prebooks">Most Bookings</option>
              <option value="eq">Highest Lined Up (EQ)</option>
            </select>
          </div>
        </div>
      )}

      {displayRoutes.length === 0 && (
          <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg border border-gray-700/50">
            No routes assigned to you.
          </div>
      )}

      {sortedRoutes.map((route) => {
        const isExpanded = expandedRoutes.has(route.routeCode);
        const hasAnyAssignment = route.assignedWorkerIds.length > 0;

        return (
          <div
            key={route.routeCode}
            className={`rounded-lg border transition-all overflow-hidden ${
              hasAnyAssignment
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-800 border-red-900/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
            }`}
          >
            {/* --- HEADER --- */}
            <div className="p-3 flex items-center justify-between gap-3 bg-gray-800 relative">
              <div className="flex items-center gap-3">
                {renderWorkerBubbles(route)}
                 
                <div>
                  <h3 className="font-bold text-xl text-white font-mono leading-none">{route.routeCode}</h3>
                  <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                    {renderRouteStatus(route)}
                  </div>
                </div>
              </div>

              <div 
                onClick={() => toggleRouteExpand(route.routeCode)}
                className="flex items-center gap-4 cursor-pointer hover:bg-white/5 rounded px-2 py-1 transition-colors"
              >
                  <div className="text-right">
                      <div className="text-lg font-bold text-gray-200 font-mono">{route.totalEQ.toFixed(2)} EQ</div>
                      <div className="text-[10px] text-gray-500 uppercase font-bold flex gap-2 justify-end">
                          <span>{route.totalBookings} Jobs</span>
                          {route.prepaidCount > 0 && <span className="text-green-500">{route.prepaidCount} PP</span>}
                      </div>
                  </div>
                  {isExpanded ? <ChevronUp className="text-gray-400"/> : <ChevronDown className="text-gray-400"/>}
              </div>
            </div>

            {/* --- EXPANDED CONTENT (JOBS) --- */}
            {isExpanded && (
                <div className="border-t border-gray-700 bg-gray-900/30 p-2 space-y-2 animate-slide-down">
                    {route.items.map(job => {
                        const jobWorker = getWorkerInfo(job['Contractor Number'] || null);
                        const isJobCompleted = job.Status === 'completed' || job.Completed === 'x';
                        const isNextTime = job.Status === 'next_time';
                        const isCancelled = job.Status === 'cancelled';
                        const notes = job['Log Sheet Notes'] || '';
                        const services = job.services;
                        
                        // Determine status badge
                        let statusBadge = null;
                        if (isNextTime) {
                          statusBadge = <span className="text-[9px] bg-orange-900/30 text-orange-400 px-1 py-0.5 rounded border border-orange-800 font-bold">NEXT TIME</span>;
                        } else if (isCancelled) {
                          statusBadge = <span className="text-[9px] bg-red-900/30 text-red-400 px-1 py-0.5 rounded border border-red-800 font-bold">CANCELLED</span>;
                        }
                        
                                return (
                            <div 
                                key={job['Booking ID']} 
                                onClick={() => handleJobClick(job)}
                                className={`p-2 rounded border flex flex-col gap-2 transition-colors ${
                                    isJobCompleted 
                                    ? 'bg-green-900/10 border-green-900/30 opacity-75' 
                                    : isCancelled
                                    ? 'bg-red-900/10 border-red-900/30 cursor-pointer hover:border-red-700'
                                    : isNextTime
                                    ? 'bg-orange-900/10 border-orange-900/30 cursor-pointer hover:border-orange-700'
                                    : 'bg-gray-800 border-gray-700 cursor-pointer hover:border-cps-blue'
                                }`}
                            >
                                <div className="flex justify-between items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-gray-200 text-sm truncate flex items-center gap-2">
                                            <span className={isCancelled ? 'line-through text-gray-500' : ''}>
                                              {job['First Name']} {job['Last Name']}
                                            </span>
                                            
                                            {statusBadge}
                                            
                                            {/* Service badges stay gated on isLawnRejuv ONLY. Sealing has
                                                no services (no A/D/F/S/L) so this correctly skips. */}
                                            {isLawnRejuv && services && (
                                              <div className="flex gap-0.5">
                                                {services.aeration && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-900/50 text-blue-300 font-bold">A</span>}
                                                {services.dethatch && <span className="text-[8px] px-1 py-0.5 rounded bg-orange-900/50 text-orange-300 font-bold">D</span>}
                                                {services.fertilizer && <span className="text-[8px] px-1 py-0.5 rounded bg-green-900/50 text-green-300 font-bold">F</span>}
                                                {services.seed && <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-900/50 text-yellow-300 font-bold">S</span>}
                                                {services.lime && <span className="text-[8px] px-1 py-0.5 rounded bg-purple-900/50 text-purple-300 font-bold">L</span>}
                                              </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 text-xs text-gray-500 truncate">
                                            <MapPin size={10} /> {job['Full Address']}
                                        </div>
                                        {job['Home Phone'] && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleCopy(job['Home Phone']!, `ph-${job['Booking ID']}`);
                                              }}
                                              className="text-blue-400 text-xs flex items-center gap-1 hover:underline mt-1 w-fit"
                                            >
                                              <Phone size={10} /> {job['Home Phone']}
                                              {copiedId === `ph-${job['Booking ID']}` && <Check size={10} className="text-green-400" />}
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex flex-col items-end gap-2">
                                        <div className="flex items-center gap-2">
                                            {job.Prepaid === 'x' && <span className="text-[9px] bg-green-900/30 text-green-400 px-1 py-0.5 rounded border border-green-800 font-bold">PP</span>}
                                            <span className={`font-mono text-sm font-bold ${isCancelled ? 'text-gray-500 line-through' : 'text-gray-300'}`}>{job.Price}</span>
                                        </div>

                                        {!isJobCompleted ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setAssignModalData({
                                                        type: 'JOB',
                                                        targetId: job['Booking ID'],
                                                        currentWorkerId: job['Contractor Number'] || null,
                                                        routeCode: route.routeCode,
                                                        title: 'Assign Single Job'
                                                    });
                                                }}
                                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${
                                                    jobWorker
                                                    ? 'bg-gray-700 border-green-900/50 text-green-400'
                                                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-white'
                                                }`}
                                            >
                                                <User size={10} />
                                                <span className="truncate max-w-[60px]">
                                                    {jobWorker ? jobWorker.firstName : 'Assign'}
                                                </span>
                                            </button>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[10px] text-green-500 font-bold bg-green-900/20 px-1.5 py-0.5 rounded border border-green-900/30">
                                                <Check size={10}/> Done
                                            </span>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Inline Notes (always visible in expanded view) */}
                                {notes && (
                                    <div className="flex items-center gap-1.5 bg-gray-900/50 border border-gray-700/50 rounded px-2 py-1.5 text-[10px] text-gray-400 font-mono italic">
                                        <FileText size={10} className="flex-shrink-0 text-gray-600" />
                                        <span className="truncate">{notes}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {route.items.length === 0 && (
                        <div className="text-center text-xs text-gray-500 py-2 italic">No jobs loaded in this route.</div>
                    )}
                </div>
            )}
          </div>
        );
      })}

      {/* --- PENDING JOB MODAL --- */}
      {pendingJob && (
        <PendingJobModal
          job={pendingJob}
          onClose={handlePendingModalClose}
          onUpdate={handlePendingModalUpdate}
          seasonType={seasonType}
        />
      )}

      {/* --- UNIVERSAL ASSIGNMENT MODAL --- */}
      {assignModalData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-gray-900 rounded-lg w-full max-w-md border border-gray-700 shadow-2xl p-4">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                 <MapIcon size={18} className="text-cps-blue" /> 
                 {assignModalData.title}
                 {/* CHANGED: "Cart Mode" pill was gated on isLawnRejuv with green styling.
                     Now gates on isTeamSeason; color flips slate (Sealing) ↔ green (Rejuv). */}
                 {isTeamSeason && (
                   <span className={`text-[10px] px-1.5 py-0.5 rounded border ml-2 ${
                     seasonType === 'sealing'
                       ? 'bg-slate-800 text-slate-300 border-slate-600'
                       : 'bg-green-900/30 text-green-400 border-green-700/50'
                   }`}>
                     Cart Mode
                   </span>
                 )}
              </h3>
              <button onClick={() => setAssignModalData(null)}>
                <X className="text-gray-400 hover:text-white" size={20} />
              </button>
            </div>
            
            <div className="space-y-1 max-h-80 overflow-y-auto custom-scrollbar pr-1">
              <button
                onClick={() => handleAssignConfirm(null)}
                className="w-full text-left px-3 py-3 text-red-400 hover:bg-red-900/10 rounded flex items-center gap-2 mb-2 text-sm border border-transparent hover:border-red-900/30 transition-all"
              >
                <AlertCircle size={16} /> Unassign {assignModalData.type === 'ROUTE' ? 'Route' : 'Job'}
              </button>

              {/* CHANGED: was `isLawnRejuv && contractorsByCart`. Now `isTeamSeason &&
                  contractorsByCart` so Sealing also iterates by cart. Inside the
                  cart iteration, cart icon bg and worker name color flip slate↔green. */}
              {isTeamSeason && contractorsByCart ? (
                Array.from(contractorsByCart.entries()).map(([cartId, cartWorkers]) => {
                  const isSoloCart = cartWorkers.length === 1;
                  const primaryWorker = cartWorkers[0];
                  const isSelected = cartWorkers.some(w => w.contractorId === assignModalData.currentWorkerId);
                  const assignedRoutes = workerRouteMap.get(primaryWorker.contractorId);
                  const hasRoute = assignedRoutes && assignedRoutes.length > 0;
                  
                  // Season-aware styling for the multi-worker cart row.
                  const cartIconClass = seasonType === 'sealing'
                    ? (isSelected ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-300 border border-slate-600')
                    : (isSelected ? 'bg-green-600 text-white' : 'bg-green-900/30 text-green-400 border border-green-700/50');
                  const cartNameClass = seasonType === 'sealing' ? 'text-slate-200' : 'text-green-300';
                  const selectedRowClass = seasonType === 'sealing'
                    ? 'bg-slate-800/50 border border-slate-600 text-white'
                    : 'bg-green-900/20 border border-green-700/50 text-white';
                  
                  return (
                    <button
                      key={cartId}
                      onClick={() => handleAssignConfirm(primaryWorker.contractorId)}
                      className={`w-full text-left px-3 py-3 rounded text-sm flex items-center justify-between gap-3 transition-colors ${
                        isSelected 
                          ? selectedRowClass 
                          : 'text-gray-300 hover:bg-gray-800 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                          isSoloCart 
                            ? isSelected ? 'bg-cps-blue text-white' : 'bg-gray-700 text-gray-300'
                            : cartIconClass
                        }`}>
                          {isSoloCart ? (
                            <span>{primaryWorker.firstName[0]}{primaryWorker.lastName[0]}</span>
                          ) : (
                            <div className="flex flex-col items-center">
                              <Truck size={14} />
                              <span className="text-[9px]">{cartWorkers.length}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col">
                          {isSoloCart ? (
                            <>
                              <span className="font-medium">{primaryWorker.firstName} {primaryWorker.lastName}</span>
                              <span className="text-[10px] text-gray-500">#{primaryWorker.contractorId}</span>
                            </>
                          ) : (
                            <>
                              <span className={`font-medium ${cartNameClass}`}>
                                {cartWorkers.map(w => w.firstName).join(' & ')}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {cartWorkers.map(w => `${w.firstName} ${w.lastName[0]}.`).join(', ')}
                              </span>
                            </>
                          )}
                          {hasRoute && (
                            <span className="text-[10px] text-gray-500">
                              Routes: {assignedRoutes.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {hasRoute && (
                        <span className="text-[9px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded border border-gray-600 font-mono">
                          {assignedRoutes[0]}
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                // Aeration: Individual workers
                sortedContractors.map((w) => {
                  const isSelected = w.contractorId === assignModalData.currentWorkerId;
                  const assignedRoutes = workerRouteMap.get(w.contractorId);
                  const hasRoute = assignedRoutes && assignedRoutes.length > 0;

                  return (
                    <button
                      key={w.contractorId}
                      onClick={() => handleAssignConfirm(w.contractorId)}
                      className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center justify-between gap-3 transition-colors ${
                          isSelected 
                          ? 'bg-cps-blue/20 border border-cps-blue/50 text-white' 
                          : 'text-gray-300 hover:bg-gray-800 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                              isSelected ? 'bg-cps-blue' : 'bg-gray-700'
                          }`}>
                            {w.firstName[0]}
                          </div>
                          <div className="flex flex-col">
                              <span>{w.firstName} {w.lastName}</span>
                              {hasRoute && (
                                  <span className="text-[10px] text-gray-500">
                                      Assignments: {assignedRoutes.join(', ')}
                                  </span>
                              )}
                          </div>
                      </div>
                      
                      {hasRoute && (
                          <span className="text-[9px] bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded border border-gray-600 font-mono">
                              {assignedRoutes[0]}
                          </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Transfer to Manager Button */}
            {!assignModalData.currentWorkerId && availableManagers.length > 0 && (
              <>
                <div className="border-t border-gray-700 my-3"></div>
                <button
                  onClick={openTransferModal}
                  className="w-full px-3 py-3 text-blue-400 hover:bg-blue-900/10 rounded flex items-center gap-2 text-sm border border-transparent hover:border-blue-900/30 transition-all"
                >
                  <Shuffle size={16} /> Transfer to Manager
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* --- TRANSFER TO MANAGER MODAL --- */}
      {transferModalData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-gray-900 rounded-lg w-full max-w-sm border border-gray-700 shadow-2xl p-4">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                 <Shuffle size={18} className="text-blue-400" /> 
                 {transferModalData.title}
              </h3>
              <button onClick={() => setTransferModalData(null)}>
                <X className="text-gray-400 hover:text-white" size={20} />
              </button>
            </div>
            
            <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar pr-1">
              {availableManagers.map((manager) => {
                return (
                  <button
                    key={manager.userId}
                    onClick={() => handleTransferConfirm(manager.userId)}
                    className="w-full text-left px-3 py-3 rounded text-sm flex items-center gap-3 transition-colors text-gray-300 hover:bg-gray-800 border border-transparent hover:border-blue-900/30"
                  >
                    <div className="w-8 h-8 rounded-full bg-blue-900/30 border border-blue-700 flex items-center justify-center text-blue-300 font-bold text-xs">
                      {manager.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium">{manager.name}</span>
                      <span className="text-[10px] text-gray-500">Route Manager</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RMRoutesTab;
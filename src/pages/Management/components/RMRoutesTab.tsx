// src/pages/Management/components/RMRoutesTab.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Map as MapIcon, 
  AlertCircle, X, Check, ChevronDown, ChevronUp, 
  MapPin, Phone, User, Users, Shuffle, Truck, Leaf
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { RouteData, MasterBooking, Worker, ManagementUser, SeasonType, TeamCart } from '../../../types';

interface RMRoutesTabProps {
  managerId: string;
  routes: RouteData[];
  bookings: MasterBooking[];
  workers: Worker[];
  managers: ManagementUser[];
  seasonType?: SeasonType;
  teamCarts?: TeamCart[];
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
  onRefresh,
}) => {
  const isLawnRejuv = seasonType === 'lawn_rejuv';
  
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

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter managers (exclude current manager)
  const availableManagers = useMemo(() => {
    return managers.filter(m => m.userId !== managerId && m.role === 'RouteManager');
  }, [managers, managerId]);

  // --- 1. DATA PROCESSING ---
  useEffect(() => {
    const myTeam = workers.filter((w) => w.assignedManagerId === managerId);
    setContractors(myTeam);

    // Filter Routes for this Manager
    const myRoutes = routes.filter((r) => r.managerId === managerId);
    const myRouteCodes = new Set(myRoutes.map(r => r.routeCode));

    // Group Bookings by Route
    const groupedBookings: Record<string, MasterBooking[]> = {};
    
    // Initialize groups for valid routes
    myRoutes.forEach(r => {
      groupedBookings[r.routeCode] = [];
    });

    bookings.forEach(b => {
      const rCode = b['Route Number'];
      if (rCode && myRouteCodes.has(rCode)) {
        groupedBookings[rCode].push(b);
      }
    });

    // Build Display Objects
    const enrichedRoutes = myRoutes.map((r) => {
      const routeBookings = groupedBookings[r.routeCode] || [];

      // Calculate EQ using sessionService formula
      const totalEQ = routeBookings.reduce((sum, b) => {
        const priceStr = String(b.Price);
        
        // Handle Office Flats based on season
        if (isLawnRejuv) {
          // FSL = $157.50 EQ value (divided by 25 = 6.3)
          if (priceStr === 'FSL') {
            return sum + 6.3;
          }
        } else {
          // Aeration: RJ and SP = 2.00 EQ each
          if (priceStr === 'RJ' || priceStr === 'SP') {
            return sum + 2.00;
          }
        }
        
        // Regular calculation for dollar amounts
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
        const weight = b.Prepaid === 'x' ? (isLawnRejuv ? 0.7 : 0.5) : 1.0;
        const eq = (price * weight) / 1.05 / 25;
        return sum + eq;
      }, 0);

      // Calculate worker breakdown from bookings
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
        .sort((a, b) => b.bookingCount - a.bookingCount); // Sort by most bookings first

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

  }, [managerId, routes, bookings, workers, isLawnRejuv]);

  // --- 2. SORTING ---
  
  const sortedRoutes = useMemo(() => {
    const routeList = [...displayRoutes];
    
    // Unassigned routes always come first (no workers assigned at route level)
    const unassigned = routeList.filter(r => r.assignedWorkerIds.length === 0);
    const assigned = routeList.filter(r => r.assignedWorkerIds.length > 0);
    
    // Sort each group based on selected criteria
    const sortFn = (a: RouteDisplay, b: RouteDisplay) => {
      if (sortBy === 'alpha') {
        return a.routeCode.localeCompare(b.routeCode);
      } else if (sortBy === 'prebooks') {
        return b.totalBookings - a.totalBookings;
      } else { // sortBy === 'eq'
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

  // For Lawn Rejuv: sort by cart, then by name within cart
  const sortedContractors = useMemo(() => {
    const sorted = [...contractors];
    
    if (isLawnRejuv) {
      // Sort by teamId (cart), then by name
      return sorted.sort((a, b) => {
        const aTeam = a.teamId || a.contractorId;
        const bTeam = b.teamId || b.contractorId;
        
        if (aTeam !== bTeam) {
          return aTeam.localeCompare(bTeam);
        }
        return a.firstName.localeCompare(b.firstName);
      });
    }
    
    // Aeration: sort by assignment status, then name
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
  }, [contractors, workerRouteMap, isLawnRejuv]);

  // Group contractors by cart for Lawn Rejuv modal display
  const contractorsByCart = useMemo(() => {
    if (!isLawnRejuv) return null;
    
    const cartMap = new Map<string, Worker[]>();
    
    contractors.forEach(worker => {
      const teamId = worker.teamId || worker.contractorId;
      if (!cartMap.has(teamId)) {
        cartMap.set(teamId, []);
      }
      cartMap.get(teamId)!.push(worker);
    });
    
    return cartMap;
  }, [contractors, isLawnRejuv]);

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

  // For Lawn Rejuv: assign entire cart (all workers in team)
  const handleAssignConfirm = async (workerId: string | null) => {
    if (!assignModalData) return;

    if (assignModalData.type === 'ROUTE') {
      const routeCode = assignModalData.targetId;
      
      if (isLawnRejuv && workerId) {
        // Find the worker's cart and assign all team members
        const worker = contractors.find(w => w.contractorId === workerId);
        const teamId = worker?.teamId || workerId;
        const cart = teamCarts.find(c => c.teamId === teamId);
        
        if (cart && cart.workerIds.length > 1) {
          // Assign all cart members to the route
          await sessionService.assignRouteToWorker(routeCode, workerId);
          
          // Also assign all pending bookings to the first worker (cart lead)
          const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
          const pendingItems = routeItems.filter(b => b.Status !== 'completed');
          
          await Promise.all(pendingItems.map(job => 
            sessionService.assignBookingToWorker(job['Booking ID'], workerId)
          ));
        } else {
          // Solo worker - normal assignment
          await sessionService.assignRouteToWorker(routeCode, workerId);
          
          const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
          const pendingItems = routeItems.filter(b => b.Status !== 'completed');
          
          await Promise.all(pendingItems.map(job => 
            sessionService.assignBookingToWorker(job['Booking ID'], workerId)
          ));
        }
      } else {
        // Aeration or unassign
        await sessionService.assignRouteToWorker(routeCode, workerId);

        const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
        const pendingItems = routeItems.filter(b => b.Status !== 'completed');
        
        await Promise.all(pendingItems.map(job => 
          sessionService.assignBookingToWorker(job['Booking ID'], workerId)
        ));
      }
    } else {
      await sessionService.assignBookingToWorker(assignModalData.targetId, workerId);
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
    
    // Case 1: No assignments at all - show single unassigned icon
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
          {isLawnRejuv ? <Truck size={18} /> : <Users size={18} />}
        </button>
      );
    }

    // Case 2: Single worker assigned (no split)
    if (route.assignedWorkerIds.length === 1 && !hasUnassigned) {
      const worker = getWorkerInfo(route.assignedWorkerIds[0]);
      const isTeamMember = isLawnRejuv && worker?.teamId;
      
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
          className={`h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm border shadow-lg transition-transform active:scale-95 ${
            isTeamMember 
              ? 'bg-green-600 text-white border-green-500'
              : 'bg-cps-blue text-white border-blue-500'
          }`}
        >
          {worker && (
            <span>{worker.firstName[0]}{worker.lastName[0]}</span>
          )}
        </button>
      );
    }

    // Case 3: Multiple workers or split route - show overlapping bubbles
    const bubblesToShow: { type: 'worker' | 'unassigned' | 'overflow'; workerId?: string; count?: number }[] = [];
    
    // Add worker bubbles based on assignedWorkerIds
    route.assignedWorkerIds.slice(0, 4).forEach(workerId => {
      bubblesToShow.push({ type: 'worker', workerId });
    });

    // Add unassigned bubble if needed (within 4 limit)
    if (hasUnassigned && bubblesToShow.length < 4) {
      bubblesToShow.push({ type: 'unassigned', count: route.unassignedCount });
    }

    // Calculate overflow
    const totalItems = route.assignedWorkerIds.length + (hasUnassigned ? 1 : 0);
    const overflow = totalItems - bubblesToShow.length;
    
    if (overflow > 0) {
      // Replace last bubble with overflow indicator
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
            const isTeamMember = isLawnRejuv && worker?.teamId;
            
            return (
              <div
                key={bubble.workerId}
                className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-gray-800 shadow-md ${
                  isTeamMember ? 'bg-green-600 text-white' : 'bg-cps-blue text-white'
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
    
    // No assignments at all
    if (!hasAssignments) {
      return <span className="text-red-400 italic">Unassigned Route</span>;
    }
    
    // Single worker assignment
    if (route.assignedWorkerIds.length === 1) {
      const worker = getWorkerInfo(route.assignedWorkerIds[0]);
      if (worker) {
        const isTeamMember = isLawnRejuv && worker.teamId;
        const cart = isTeamMember ? teamCarts.find(c => c.teamId === worker.teamId) : null;
        
        if (cart && cart.workerIds.length > 1) {
          return (
            <span className="text-green-300 flex items-center gap-1">
              <Truck size={12} />
              Cart {cart.teamId} ({cart.workerIds.length})
            </span>
          );
        }
        return <span className="text-blue-300">{worker.firstName} {worker.lastName}</span>;
      }
    }
    
    // Multiple workers (split route)
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
          {isLawnRejuv && (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <Leaf size={12} />
              <span>Lawn Rejuv Mode - Assign by Cart</span>
            </div>
          )}
          <div className={`flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-sm ${!isLawnRejuv ? 'ml-auto' : ''}`}>
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
              {/* Route Identity & Assign Button */}
              <div className="flex items-center gap-3">
                {renderWorkerBubbles(route)}
                 
                <div>
                  <h3 className="font-bold text-xl text-white font-mono leading-none">{route.routeCode}</h3>
                  <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                    {renderRouteStatus(route)}
                  </div>
                </div>
              </div>

              {/* Stats & Expand */}
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
                        const notes = job['Log Sheet Notes'] || '';
                        
                        // Service badges for Lawn Rejuv
                        const services = job.services;
                        
                        return (
                            <div 
                                key={job['Booking ID']} 
                                className={`p-2 rounded border flex flex-col gap-2 ${
                                    isJobCompleted 
                                    ? 'bg-green-900/10 border-green-900/30 opacity-75' 
                                    : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                                }`}
                            >
                                <div className="flex justify-between items-start gap-3">
                                    {/* Job Details */}
                                    <div className="min-w-0 flex-1">
                                        <div className="font-bold text-gray-200 text-sm truncate flex items-center gap-2">
                                            {job['First Name']} {job['Last Name']}
                                            
                                            {/* Service Badges (Lawn Rejuv) */}
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
                                              onClick={() => handleCopy(job['Home Phone']!, `ph-${job['Booking ID']}`)}
                                              className="text-blue-400 text-xs flex items-center gap-1 hover:underline mt-1 w-fit"
                                            >
                                              <Phone size={10} /> {job['Home Phone']}
                                              {copiedId === `ph-${job['Booking ID']}` && <Check size={10} className="text-green-400" />}
                                            </button>
                                        )}
                                    </div>

                                    {/* Action & Price */}
                                    <div className="flex flex-col items-end gap-2">
                                        <div className="flex items-center gap-2">
                                            {job.Prepaid === 'x' && <span className="text-[9px] bg-green-900/30 text-green-400 px-1 py-0.5 rounded border border-green-800 font-bold">PP</span>}
                                            <span className="font-mono text-sm font-bold text-gray-300">{job.Price}</span>
                                        </div>

                                        {!isJobCompleted ? (
                                            <button
                                                onClick={() => setAssignModalData({
                                                    type: 'JOB',
                                                    targetId: job['Booking ID'],
                                                    currentWorkerId: job['Contractor Number'] || null,
                                                    routeCode: route.routeCode,
                                                    title: 'Assign Single Job'
                                                })}
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
                                {notes && (
                                    <div className="bg-gray-900/50 border border-gray-700/50 rounded px-2 py-1.5 text-[10px] text-gray-400 font-mono italic">
                                        {notes}
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

      {/* --- UNIVERSAL ASSIGNMENT MODAL --- */}
      {assignModalData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-gray-900 rounded-lg w-full max-w-md border border-gray-700 shadow-2xl p-4">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                 <MapIcon size={18} className="text-cps-blue" /> 
                 {assignModalData.title}
                 {isLawnRejuv && (
                   <span className="text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-700/50 ml-2">
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

              {/* Lawn Rejuv: Group by Cart */}
              {isLawnRejuv && contractorsByCart ? (
                Array.from(contractorsByCart.entries()).map(([cartId, cartWorkers]) => {
                  const isSoloCart = cartWorkers.length === 1;
                  const primaryWorker = cartWorkers[0];
                  const isSelected = cartWorkers.some(w => w.contractorId === assignModalData.currentWorkerId);
                  const assignedRoutes = workerRouteMap.get(primaryWorker.contractorId);
                  const hasRoute = assignedRoutes && assignedRoutes.length > 0;
                  
                  return (
                    <button
                      key={cartId}
                      onClick={() => handleAssignConfirm(primaryWorker.contractorId)}
                      className={`w-full text-left px-3 py-3 rounded text-sm flex items-center justify-between gap-3 transition-colors ${
                        isSelected 
                          ? 'bg-green-900/20 border border-green-700/50 text-white' 
                          : 'text-gray-300 hover:bg-gray-800 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                          isSoloCart 
                            ? isSelected ? 'bg-cps-blue text-white' : 'bg-gray-700 text-gray-300'
                            : isSelected ? 'bg-green-600 text-white' : 'bg-green-900/30 text-green-400 border border-green-700/50'
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
                              <span className="font-medium text-green-300">Cart: {cartId}</span>
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
                      
                      {/* Visual Badge for existing assignments */}
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

            {/* Transfer to Manager Button - Only if UNASSIGNED and Multiple Managers */}
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
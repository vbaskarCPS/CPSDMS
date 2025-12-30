// src/pages/Management/components/RMRoutesTab.tsx
import React, { useState, useEffect } from 'react';
import { 
  Map, AlertCircle, X, Check, ChevronDown, ChevronUp, 
  MapPin, Phone, User, Users 
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { TabStats } from '../RMLogbook';
import { RouteData, MasterBooking, Worker } from '../../../types';

interface RMRoutesTabProps {
  managerId: string;
  routes: RouteData[];
  bookings: MasterBooking[];
  workers: Worker[];
  onStatsUpdate: (stats: TabStats) => void;
  onRefresh: () => void;
}

interface RouteDisplay {
  routeCode: string;
  totalBookings: number;
  prepaidCount: number;
  totalValue: number;
  assignedWorkerId: string | null;
  items: MasterBooking[];
}

const RMRoutesTab: React.FC<RMRoutesTabProps> = ({
  managerId,
  routes,
  bookings,
  workers,
  onStatsUpdate,
  onRefresh,
}) => {
  // State
  const [displayRoutes, setDisplayRoutes] = useState<RouteDisplay[]>([]);
  const [contractors, setContractors] = useState<Worker[]>([]);
  
  // Selection State
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set());
  
  // Modal State
  const [assignModalData, setAssignModalData] = useState<{
    type: 'ROUTE' | 'JOB';
    targetId: string; // routeCode OR bookingId
    currentWorkerId: string | null;
    title: string;
  } | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

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

    // Distribute bookings
    let unassignedJobCount = 0;
    
    bookings.forEach(b => {
      const rCode = b['Route Number'];
      if (rCode && myRouteCodes.has(rCode)) {
        groupedBookings[rCode].push(b);
        if (!b['Contractor Number']) unassignedJobCount++;
      }
    });

    // Build Display Objects
    const enrichedRoutes = myRoutes.map((r) => {
      const routeBookings = groupedBookings[r.routeCode] || [];

      const value = routeBookings.reduce((sum, b) => {
        const price = parseFloat(String(b.Price).replace(/[^0-9.]/g, '')) || 0;
        return sum + price;
      }, 0);

      return {
        routeCode: r.routeCode,
        totalBookings: routeBookings.length,
        prepaidCount: routeBookings.filter((b) => b.Prepaid === 'x').length,
        totalValue: value,
        assignedWorkerId: r.assignedWorkerId,
        items: routeBookings
      };
    });

    // Sort: Unassigned Routes First, Then High Value
    enrichedRoutes.sort((a, b) => {
      if (!a.assignedWorkerId && b.assignedWorkerId) return -1;
      if (a.assignedWorkerId && !b.assignedWorkerId) return 1;
      return b.totalValue - a.totalValue;
    });

    setDisplayRoutes(enrichedRoutes);
    
    onStatsUpdate({
      unassignedRoutes: enrichedRoutes.filter((r) => !r.assignedWorkerId).length,
      unassignedBookings: unassignedJobCount
    });
  }, [managerId, routes, bookings, workers]);

  // --- 2. ACTIONS ---

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

  const handleAssignConfirm = async (workerId: string | null) => {
    if (!assignModalData) return;

    // Perform Assignment in DB
    if (assignModalData.type === 'ROUTE') {
      const routeCode = assignModalData.targetId;
      await sessionService.assignRouteToWorker(routeCode, workerId);

      // Also assign all pending jobs in that route
      const routeItems = displayRoutes.find(r => r.routeCode === routeCode)?.items || [];
      const pendingItems = routeItems.filter(b => b.Status !== 'completed');
      
      await Promise.all(pendingItems.map(job => 
        sessionService.assignBookingToWorker(job['Booking ID'], workerId)
      ));

    } else {
      await sessionService.assignBookingToWorker(assignModalData.targetId, workerId);
    }

    setAssignModalData(null);
    onRefresh(); // <--- TRIGGER PARENT REFRESH
  };

  // --- 3. HELPERS ---
  const getWorkerInfo = (id: string | null) => {
    if (!id) return null;
    return contractors.find((x) => x.contractorId === id);
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-4">
      {displayRoutes.length === 0 && (
          <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg border border-gray-700/50">
            No routes assigned to you.
          </div>
      )}

      {displayRoutes.map((route) => {
        const assignedRouteWorker = getWorkerInfo(route.assignedWorkerId);
        const isExpanded = expandedRoutes.has(route.routeCode);

        return (
          <div
            key={route.routeCode}
            className={`rounded-lg border transition-all overflow-hidden ${
              route.assignedWorkerId
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-800 border-red-900/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
            }`}
          >
            {/* --- HEADER --- */}
            <div className="p-3 flex items-center justify-between gap-3 bg-gray-800 relative">
              {/* Route Identity & Assign Button */}
              <div className="flex items-center gap-3">
                 <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        setAssignModalData({
                            type: 'ROUTE',
                            targetId: route.routeCode,
                            currentWorkerId: route.assignedWorkerId,
                            title: `Assign Route ${route.routeCode}`
                        });
                    }}
                    className={`h-10 w-10 rounded-lg flex items-center justify-center font-bold text-sm border shadow-lg transition-transform active:scale-95 ${
                        assignedRouteWorker 
                        ? 'bg-cps-blue text-white border-blue-500' 
                        : 'bg-gray-700 text-gray-500 border-gray-600 hover:border-red-500 hover:text-red-400'
                    }`}
                 >
                    {assignedRouteWorker ? (
                        <span>{assignedRouteWorker.firstName[0]}{assignedRouteWorker.lastName[0]}</span>
                    ) : (
                        <Users size={18} />
                    )}
                 </button>
                 
                 <div>
                    <h3 className="font-bold text-xl text-white font-mono leading-none">{route.routeCode}</h3>
                    <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                         {assignedRouteWorker ? (
                             <span className="text-blue-300">{assignedRouteWorker.firstName} {assignedRouteWorker.lastName}</span>
                         ) : (
                             <span className="text-red-400 italic">Unassigned Route</span>
                         )}
                    </div>
                 </div>
              </div>

              {/* Stats & Expand */}
              <div 
                onClick={() => toggleRouteExpand(route.routeCode)}
                className="flex items-center gap-4 cursor-pointer hover:bg-white/5 rounded px-2 py-1 transition-colors"
              >
                  <div className="text-right">
                      <div className="text-lg font-bold text-gray-200 font-mono">${route.totalValue.toFixed(0)}</div>
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
                                        <div className="font-bold text-gray-200 text-sm truncate">
                                            {job['First Name']} {job['Last Name']}
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
          <div className="bg-gray-900 rounded-lg w-full max-w-sm border border-gray-700 shadow-2xl p-4">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
              <h3 className="font-bold text-white flex items-center gap-2">
                 <Map size={18} className="text-cps-blue" /> 
                 {assignModalData.title}
              </h3>
              <button onClick={() => setAssignModalData(null)}>
                <X className="text-gray-400 hover:text-white" size={20} />
              </button>
            </div>
            
            <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar pr-1">
              <button
                onClick={() => handleAssignConfirm(null)}
                className="w-full text-left px-3 py-3 text-red-400 hover:bg-red-900/10 rounded flex items-center gap-2 mb-2 text-sm border border-transparent hover:border-red-900/30 transition-all"
              >
                <AlertCircle size={16} /> Unassign {assignModalData.type === 'ROUTE' ? 'Route' : 'Job'}
              </button>

              {contractors.map((w) => {
                  const isSelected = w.contractorId === assignModalData.currentWorkerId;
                  return (
                    <button
                      key={w.contractorId}
                      onClick={() => handleAssignConfirm(w.contractorId)}
                      className={`w-full text-left px-3 py-2.5 rounded text-sm flex items-center gap-3 transition-colors ${
                          isSelected 
                          ? 'bg-cps-blue/20 border border-cps-blue/50 text-white' 
                          : 'text-gray-300 hover:bg-gray-800 border border-transparent'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                          isSelected ? 'bg-cps-blue' : 'bg-gray-700'
                      }`}>
                        {w.firstName[0]}
                      </div>
                      {w.firstName} {w.lastName}
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
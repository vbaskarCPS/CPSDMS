// src/pages/Management/components/RMRoutesTab.tsx
import React, { useState, useEffect } from 'react';
import { Map, AlertCircle, X, CheckCircle } from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { TabStats } from '../RMLogbook';
import { RouteData, MasterBooking, Worker } from '../../../types';

interface RMRoutesTabProps {
  managerId: string;
  routes: RouteData[];
  bookings: MasterBooking[];
  workers: Worker[];
  onStatsUpdate: (stats: TabStats) => void;
}

interface RouteDisplay {
  routeCode: string;
  totalBookings: number;
  prepaidCount: number;
  totalValue: number;
  assignedWorkerId: string | null;
}

const RMRoutesTab: React.FC<RMRoutesTabProps> = ({
  managerId,
  routes,
  bookings,
  workers,
  onStatsUpdate,
}) => {
  const [displayRoutes, setDisplayRoutes] = useState<RouteDisplay[]>([]);
  const [contractors, setContractors] = useState<Worker[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);

  useEffect(() => {
    const myRoutes = routes.filter((r) => r.managerId === managerId);
    const myTeam = workers.filter((w) => w.assignedManagerId === managerId);

    const enrichedRoutes = myRoutes.map((r) => {
      const routeBookings = bookings.filter(
        (b) => b['Route Number'] === r.routeCode
      );

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
      };
    });

    // Sort: Unassigned first, then descending value
    enrichedRoutes.sort((a, b) => {
      if (!a.assignedWorkerId && b.assignedWorkerId) return -1;
      if (a.assignedWorkerId && !b.assignedWorkerId) return 1;
      return b.totalValue - a.totalValue;
    });

    setDisplayRoutes(enrichedRoutes);
    setContractors(myTeam);
    onStatsUpdate({
      unassignedRoutes: enrichedRoutes.filter((r) => !r.assignedWorkerId)
        .length,
    });
  }, [managerId, routes, bookings, workers]);

  const handleAssign = (routeCode: string, workerId: string | null) => {
    // 1. Identify previous owner (Logic similar to before, but now we must update the DB)
    // Note: In cloud, we just update the Route Record + Booking Records.

    const routeBookings = bookings.filter(
      (b) => b['Route Number'] === routeCode
    );

    // Assign all PENDING jobs in this route
    routeBookings.forEach((booking) => {
      if (booking.Status !== 'completed') {
        sessionService.assignBookingToWorker(booking['Booking ID'], workerId);
      }
    });

    // Update Route Ownership
    sessionService.assignRouteToWorker(routeCode, workerId);

    setSelectedRoute(null);
    // Note: A refresh is needed to see changes unless we use Realtime or optimistically update state.
    // For this refactor, we rely on the user refreshing or the parent re-fetching.
    // Ideally, pass a reload callback from parent.
  };

  const getContractorInitials = (id: string | null) => {
    if (!id) return '';
    const c = contractors.find((x) => x.contractorId === id);
    return c ? `${c.firstName[0]}${c.lastName[0]}` : '?';
  };

  const getContractorName = (id: string) => {
    const c = contractors.find((x) => x.contractorId === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown';
  };

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {displayRoutes.map((route) => (
          <div
            key={route.routeCode}
            onClick={() => setSelectedRoute(route.routeCode)}
            className={`p-4 rounded-lg border cursor-pointer transition-all active:scale-[0.98] ${
              route.assignedWorkerId
                ? 'bg-gray-800 border-gray-700 hover:border-gray-600'
                : 'bg-gray-800 border-red-900/50 hover:border-red-500/50'
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold text-white font-mono">
                {route.routeCode}
              </h3>
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                  route.assignedWorkerId
                    ? 'bg-cps-blue text-white'
                    : 'bg-gray-700 text-gray-500'
                }`}
              >
                {getContractorInitials(route.assignedWorkerId)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-400">
                  {route.totalBookings} Jobs
                </span>
                {route.prepaidCount > 0 && (
                  <span className="text-green-400 font-bold">
                    {route.prepaidCount} PP
                  </span>
                )}
              </div>

              <div className="flex justify-between items-center text-xs mt-1">
                <span className="bg-gray-700/50 px-1.5 py-0.5 rounded text-gray-300 font-mono">
                  ${route.totalValue.toFixed(0)}
                </span>
                {!route.assignedWorkerId && (
                  <span className="text-red-400 italic">Unassigned</span>
                )}
              </div>

              {route.assignedWorkerId && (
                <div className="text-xs text-green-400 truncate mt-1">
                  {getContractorName(route.assignedWorkerId)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {selectedRoute && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-lg p-4 w-full max-w-sm border border-gray-700 shadow-2xl">
            <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Map size={18} className="text-cps-blue" /> Assign{' '}
                {selectedRoute}
              </h3>
              <button
                onClick={() => setSelectedRoute(null)}
                className="p-1 hover:bg-gray-800 rounded-full"
              >
                <X size={20} className="text-gray-400" />
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1 custom-scrollbar pr-1">
              <button
                onClick={() => handleAssign(selectedRoute, null)}
                className="w-full text-left px-3 py-3 text-red-400 hover:bg-red-900/10 rounded-lg text-sm flex items-center gap-2 mb-2 border border-transparent hover:border-red-900/30"
              >
                <AlertCircle size={16} /> Unassign Route
              </button>

              {contractors.map((c) => (
                <button
                  key={c.contractorId}
                  onClick={() => handleAssign(selectedRoute, c.contractorId)}
                  className="w-full text-left px-3 py-2.5 rounded-lg flex justify-between items-center text-sm text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-white border border-gray-600">
                      {c.firstName[0]}
                      {c.lastName[0]}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium leading-none">
                        {c.firstName} {c.lastName}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono mt-0.5">
                        #{c.contractorId}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RMRoutesTab;

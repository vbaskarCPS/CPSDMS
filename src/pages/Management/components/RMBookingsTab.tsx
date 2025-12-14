// src/pages/Management/components/RMBookingsTab.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { User, Phone, MapPin, Check, X, AlertCircle, Mail } from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { TabStats } from '../RMLogbook';
import { MasterBooking, Worker, RouteData } from '../../../types';

interface RMBookingsTabProps {
  managerId: string;
  bookings: MasterBooking[];
  routes: RouteData[];
  workers: Worker[];
  onStatsUpdate: (stats: TabStats) => void;
}

const RMBookingsTab: React.FC<RMBookingsTabProps> = ({
  managerId,
  bookings,
  routes,
  workers,
  onStatsUpdate,
}) => {
  const [displayBookings, setDisplayBookings] = useState<MasterBooking[]>([]);
  const [team, setTeam] = useState<Worker[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<MasterBooking | null>(
    null
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    // Filter Bookings belonging to this Manager's Routes
    const myRouteCodes = new Set(
      routes.filter((r) => r.managerId === managerId).map((r) => r.routeCode)
    );
    const myBookings = bookings.filter(
      (b) => b['Route Number'] && myRouteCodes.has(b['Route Number'])
    );
    const myTeam = workers.filter((w) => w.assignedManagerId === managerId);

    setDisplayBookings(myBookings);
    setTeam(myTeam);
    onStatsUpdate({
      unassignedBookings: myBookings.filter((b) => !b['Contractor Number'])
        .length,
    });
  }, [managerId, bookings, routes, workers]);

  const handleAssignContractor = (workerId: string | null) => {
    if (!selectedBooking) return;
    sessionService.assignBookingToWorker(
      selectedBooking['Booking ID'],
      workerId
    );
    setSelectedBooking(null);
  };

  const handleCopy = (text: string, uniqueId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(uniqueId);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const grouped = useMemo(() => {
    return displayBookings.reduce((acc, b) => {
      const r = b['Route Number'] || 'Unassigned';
      if (!acc[r]) acc[r] = [];
      acc[r].push(b);
      return acc;
    }, {} as Record<string, MasterBooking[]>);
  }, [displayBookings]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {Object.entries(grouped)
        .sort()
        .map(([route, items]) => (
          <div key={route}>
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur py-2 border-b border-gray-800 mb-2 z-10 flex items-center gap-2">
              <span className="bg-gray-800 text-white font-mono px-2 py-0.5 rounded text-sm border border-gray-700">
                {route}
              </span>
              <span className="text-xs text-gray-500">
                ({items.length} jobs)
              </span>
            </div>

            <div className="space-y-2">
              {items.map((job) => {
                const assignedWorker = team.find(
                  (w) => w.contractorId === job['Contractor Number']
                );
                const notes = job['Log Sheet Notes'] || '';

                return (
                  <div
                    key={job['Booking ID']}
                    className="bg-gray-800 p-3 rounded-lg border border-gray-700 flex flex-col gap-3 text-sm group hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-200 truncate">
                          {job['First Name']} {job['Last Name']}
                        </div>
                        <div className="text-gray-500 text-xs truncate flex items-center gap-1">
                          <MapPin size={10} /> {job['Full Address']}
                        </div>
                        <div className="flex flex-col gap-1 mt-1.5">
                          {job['Home Phone'] && (
                            <button
                              onClick={() =>
                                handleCopy(
                                  job['Home Phone']!,
                                  `ph-${job['Booking ID']}`
                                )
                              }
                              className="text-blue-400 text-xs flex items-center gap-1 hover:underline w-fit"
                            >
                              <Phone size={10} /> {job['Home Phone']}
                              {copiedId === `ph-${job['Booking ID']}` && (
                                <Check size={10} className="text-green-400" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="text-right flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          {job.Prepaid === 'x' && (
                            <span className="text-[9px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-800 font-bold">
                              PP
                            </span>
                          )}
                          <span className="font-mono font-medium text-gray-300">
                            {job.Price}
                          </span>
                        </div>

                        <button
                          onClick={() => setSelectedBooking(job)}
                          className={`w-24 py-1.5 rounded text-xs border flex items-center justify-center gap-1 transition-colors ${
                            assignedWorker
                              ? 'bg-gray-700 border-green-900/50 text-green-400'
                              : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-white'
                          }`}
                        >
                          <User size={12} />
                          <span className="truncate max-w-[60px]">
                            {assignedWorker
                              ? assignedWorker.firstName
                              : 'Assign'}
                          </span>
                        </button>
                      </div>
                    </div>
                    {notes && (
                      <div className="w-full bg-gray-900/50 border border-gray-700/50 rounded px-2 py-1.5 text-xs text-gray-400 font-mono italic">
                        {notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {selectedBooking && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-lg w-full max-w-sm border border-gray-700 shadow-2xl p-4">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-800">
              <h3 className="font-bold text-white">Assign Job</h3>
              <button onClick={() => setSelectedBooking(null)}>
                <X className="text-gray-400 hover:text-white" size={20} />
              </button>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
              <button
                onClick={() => handleAssignContractor(null)}
                className="w-full text-left px-3 py-3 text-red-400 hover:bg-red-900/10 rounded flex items-center gap-2 mb-2 text-sm"
              >
                <AlertCircle size={16} /> Unassign
              </button>
              {team.map((w) => (
                <button
                  key={w.contractorId}
                  onClick={() => handleAssignContractor(w.contractorId)}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-800 rounded text-sm text-gray-300 flex items-center gap-3"
                >
                  <div className="w-6 h-6 rounded-full bg-cps-blue flex items-center justify-center text-[10px] text-white font-bold">
                    {w.firstName[0]}
                  </div>
                  {w.firstName} {w.lastName}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RMBookingsTab;

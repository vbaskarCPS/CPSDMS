{
  type: uploaded file
  fileName: src/pages/Management/components/RMTeamTab.tsx
  fullContent:
  // src/pages/Management/components/RMTeamTab.tsx
  import React, { useState, useEffect } from 'react';
  import { ChevronDown, ChevronUp, Phone, Check, MapPin, Route } from 'lucide-react';
  import { sessionService } from '../../../lib/sessionService';
  import { Worker, MasterBooking, LogsheetSession } from '../../../types';
  import { TabStats } from '../RMLogbook';
  import ContractorJobs from './ContractorJobs';
  
  interface RMTeamTabProps {
    managerId: string;
    workers: Worker[];
    allSessions: LogsheetSession[];
    onStatsUpdate: (stats: TabStats) => void;
  }
  
  interface TeamMemberDisplay extends Worker {
    displayBookings: MasterBooking[];
    financialStore: any[];
    assignedRoutes: string[];
    lastAddress: string | null;
    lastActionTime: string | null;
    stats: {
      steps: number;
      gross: number;
      eq: number;
      pending: number;
      upsellCount: number;
      upsellGross: number;
    };
  }
  
  const RMTeamTab: React.FC<RMTeamTabProps> = ({
    managerId,
    workers,
    allSessions,
    onStatsUpdate,
  }) => {
    const [teamMembers, setTeamMembers] = useState<TeamMemberDisplay[]>([]);
    const [expandedItem, setExpandedItem] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
  
    useEffect(() => {
      const loadData = async () => {
        const myTeam = workers.filter((w) => w.assignedManagerId === managerId);
  
        let totalSteps = 0,
          totalPending = 0,
          totalEQ = 0;
  
        // We need to resolve each worker's data asynchronously
        const enriched = await Promise.all(
          myTeam.map(async (w) => {
            // 1. Get Jobs (Cloud Fetch)
            const allBookings = await sessionService.getWorkerAssignments(
              w.contractorId
            );
  
            const pending = allBookings.filter((b) => b.Completed !== 'x');
  
            // 2. Find their session stats
            const session = allSessions.find(
              (s) => s.workerId === w.contractorId
            );
            const stats = session?.stats || sessionService.getEmptyStats();
            const financialStore = session?.financialStore || [];
  
            // 3. Derive Routes & Last Location
            const uniqueRoutes = Array.from(
              new Set(allBookings.map((b) => b['Route Number']).filter((r) => r && r !== 'Unassigned'))
            ).sort();
  
            let lastAddress = null;
            let lastActionTime = null;
  
            if (financialStore.length > 0) {
                // Sort by timestamp desc
                const sortedTx = [...financialStore].sort((a, b) => 
                    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );
                if (sortedTx[0]) {
                    lastAddress = sortedTx[0].address;
                    lastActionTime = sortedTx[0].timestamp;
                }
            }
  
            // Aggregate
            totalSteps += stats.stepCount;
            totalPending += pending.length;
            totalEQ += stats.totalEQ;
  
            return {
              ...w,
              displayBookings: allBookings,
              financialStore: financialStore,
              assignedRoutes: uniqueRoutes,
              lastAddress,
              lastActionTime,
              stats: {
                steps: stats.stepCount,
                gross: stats.prodGross + stats.upsellGross,
                eq: stats.totalEQ,
                pending: pending.length,
                upsellCount: stats.upsellCount,
                upsellGross: stats.upsellGross,
              },
            };
          })
        );
  
        setTeamMembers(enriched);
        onStatsUpdate({ totalSteps, totalPending, totalEQ });
      };
  
      loadData();
    }, [managerId, workers, allSessions]);
  
    const toggleItem = (id: string) =>
      setExpandedItem(expandedItem === id ? null : id);
  
    const copyPhone = (phone: string, id: string) => {
      navigator.clipboard.writeText(phone);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    };
  
    const formatTime = (isoString: string) => {
        const d = new Date(isoString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
  
    return (
      <div className="space-y-2 max-w-4xl mx-auto pb-10">
        {teamMembers.length === 0 && (
          <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg">
            No workers assigned to you.
          </div>
        )}
  
        {teamMembers.map((member) => (
          <div
            key={member.contractorId}
            className="bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-all overflow-hidden"
          >
            <button
              onClick={() => toggleItem(member.contractorId)}
              className="w-full text-left p-2.5"
            >
              {/* ROW 1: Name, ID, Phone */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      member.stats.pending > 0 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                  />
                  <span className="font-bold text-white text-sm truncate">
                      {member.firstName} {member.lastName}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono bg-gray-900 px-1 rounded">
                      {member.contractorId}
                  </span>
                  {member.cellPhone && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPhone(member.cellPhone!, member.contractorId);
                        }}
                        className="flex items-center gap-1 text-blue-400 cursor-pointer hover:underline text-[10px]"
                      >
                        <Phone size={10} />
                        {copiedId === member.contractorId && <Check size={10} className="text-green-400" />}
                      </div>
                  )}
                </div>
                {expandedItem === member.contractorId ? (
                  <ChevronUp size={16} className="text-gray-400" />
                ) : (
                  <ChevronDown size={16} className="text-gray-400" />
                )}
              </div>
  
              {/* ROW 2: Routes & Last Location (Compact) */}
              <div className="flex items-center gap-3 text-[10px] text-gray-400 mb-2 overflow-hidden">
                  <div className="flex items-center gap-1 shrink-0">
                      <Route size={10} className="text-gray-500" />
                      {member.assignedRoutes.length > 0 ? (
                          <div className="flex gap-1">
                              {member.assignedRoutes.map(r => (
                                  <span key={r} className="bg-gray-700 text-gray-200 px-1 rounded border border-gray-600 font-mono font-bold">
                                      {r}
                                  </span>
                              ))}
                          </div>
                      ) : (
                          <span className="italic opacity-50">No Routes</span>
                      )}
                  </div>
                  <div className="w-px h-3 bg-gray-700 shrink-0"></div>
                  <div className="flex items-center gap-1 truncate text-gray-300">
                      <MapPin size={10} className="text-gray-500 shrink-0" />
                      {member.lastAddress ? (
                          <span className="truncate">{member.lastAddress} <span className="text-gray-500 text-[9px]">({member.lastActionTime && formatTime(member.lastActionTime)})</span></span>
                      ) : (
                          <span className="italic opacity-50">No activity</span>
                      )}
                  </div>
              </div>
  
              {/* ROW 3: Slim Stats Grid */}
              <div className="grid grid-cols-5 gap-1 text-center bg-gray-900/50 p-1.5 rounded text-[10px] border border-gray-700/50">
                <div className="flex flex-col">
                  <span className="text-gray-500 uppercase text-[9px] leading-none mb-0.5">Steps</span>
                  <span className="text-white font-bold">{member.stats.steps}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 uppercase text-[9px] leading-none mb-0.5">Pend</span>
                  <span className="text-yellow-400 font-bold">{member.stats.pending}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 uppercase text-[9px] leading-none mb-0.5">Gross</span>
                  <span className="text-green-400 font-bold">${member.stats.gross.toFixed(0)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 uppercase text-[9px] leading-none mb-0.5">Upsell</span>
                  <span className="text-purple-400 font-bold">{member.stats.upsellCount}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-gray-500 uppercase text-[9px] leading-none mb-0.5">EQ</span>
                  <span className="text-blue-300 font-bold">{member.stats.eq.toFixed(1)}</span>
                </div>
              </div>
            </button>
  
            {expandedItem === member.contractorId && (
              <div className="mt-0 pt-0 border-t border-gray-700">
                <ContractorJobs
                  bookings={member.displayBookings}
                  financialStore={member.financialStore}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };
  
  export default RMTeamTab;
  }
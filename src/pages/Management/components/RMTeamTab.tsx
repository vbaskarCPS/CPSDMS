// src/pages/Management/components/RMTeamTab.tsx
import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Phone, Check } from 'lucide-react';
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

          // Aggregate
          totalSteps += stats.stepCount;
          totalPending += pending.length;
          totalEQ += stats.totalEQ;

          return {
            ...w,
            displayBookings: allBookings,
            financialStore: financialStore,
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

  return (
    <div className="space-y-3 max-w-4xl mx-auto pb-10">
      {teamMembers.length === 0 && (
        <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg">
          No workers assigned to you.
        </div>
      )}

      {teamMembers.map((member) => (
        <div
          key={member.contractorId}
          className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-all"
        >
          <button
            onClick={() => toggleItem(member.contractorId)}
            className="w-full text-left"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    member.stats.pending > 0 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                />
                <div>
                  <h3 className="font-bold text-white text-sm">
                    {member.firstName} {member.lastName}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-gray-500 font-mono">
                    <span>#{member.contractorId}</span>
                    {member.cellPhone && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPhone(member.cellPhone!, member.contractorId);
                        }}
                        className="flex items-center gap-1 text-blue-400 cursor-pointer hover:underline"
                      >
                        <Phone size={10} /> {member.cellPhone}
                        {copiedId === member.contractorId && (
                          <Check size={10} className="text-green-400" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {expandedItem === member.contractorId ? (
                <ChevronUp size={16} className="text-gray-400" />
              ) : (
                <ChevronDown size={16} className="text-gray-400" />
              )}
            </div>

            <div className="grid grid-cols-5 gap-2 text-center bg-gray-900/50 p-2 rounded text-xs border border-gray-700/50">
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Steps</div>
                <div className="text-white font-bold">{member.stats.steps}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Pend</div>
                <div className="text-yellow-400 font-bold">
                  {member.stats.pending}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">Gross</div>
                <div className="text-green-400 font-bold">
                  ${member.stats.gross.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">
                  Upsell
                </div>
                <div className="text-purple-400 font-bold">
                  {member.stats.upsellCount}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-[10px] uppercase">EQ</div>
                <div className="text-blue-300 font-bold">
                  {member.stats.eq.toFixed(2)}
                </div>
              </div>
            </div>
          </button>

          {expandedItem === member.contractorId && (
            <div className="mt-4 pt-2 border-t border-gray-700">
              <ContractorJobs
                bookings={member.displayBookings}
                financialStore={member.financialStore}
                // Revert logic is complex in cloud, disabling for basic refactor
                // onRevert={(job) => ...}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default RMTeamTab;

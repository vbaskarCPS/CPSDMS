import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Phone, 
  Check, 
  MoreVertical, 
  ArrowRight, 
  Trash2, 
  X,
  MapPin,
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { Worker, MasterBooking, LogsheetSession, ManagementUser } from '../../../types';
import ContractorJobs from './ContractorJobs';

interface RMTeamTabProps {
  managerId: string;
  workers: Worker[];
  allSessions: LogsheetSession[];
  allManagers?: ManagementUser[];
}

interface TeamMemberDisplay extends Worker {
  displayBookings: MasterBooking[];
  financialStore: any[];
  assignedRoutes: string[];
  lastActiveAddress: string | null;
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
  allManagers = [],
}) => {
  const [teamMembers, setTeamMembers] = useState<TeamMemberDisplay[]>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Management State
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [transferModeId, setTransferModeId] = useState<string | null>(null);
  const [selectedTransferManager, setSelectedTransferManager] = useState<string>("");

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      const myTeam = workers.filter((w) => w.assignedManagerId === managerId);

      const enriched = await Promise.all(
        myTeam.map(async (w) => {
          // 1. Fetch Bookings (Assignments)
          const allBookings = await sessionService.getWorkerAssignments(w.contractorId);
          
          // 2. Calculate Pending - FIXED: Exclude cancelled and next_time
          const pending = allBookings.filter((b) => 
            b.Completed !== 'x' && 
            b.Status !== 'completed' &&
            b.Status !== 'cancelled' &&
            b.Status !== 'next_time'
          );

          // 3. Fetch Fresh Session Data (Stats & Transactions)
          const freshSession = await sessionService.getActiveLogsheetSession(w.contractorId);
          
          const stats = freshSession?.stats || sessionService.getEmptyStats();
          const financialStore = freshSession?.financialStore || [];

          // Unique Routes
          const uniqueRoutes = Array.from(new Set(
            allBookings
              .map(b => b['Route Number'])
              .filter(r => r && r !== 'x' && r.trim() !== '')
          )) as string[];

          // Last Address (Calculated from fresh financialStore)
          let lastAddr = null;
          if (financialStore.length > 0) {
            const sortedTx = [...financialStore].sort((a, b) => 
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            lastAddr = sortedTx[0].address;
          }

          return {
            ...w,
            displayBookings: allBookings,
            financialStore: financialStore,
            assignedRoutes: uniqueRoutes,
            lastActiveAddress: lastAddr,
            stats: {
              steps: stats.stepCount,
              gross: stats.upsellGross,
              eq: stats.totalEQ,
              pending: pending.length,
              upsellCount: stats.upsellCount,
              upsellGross: stats.upsellGross,
            },
          };
        })
      );

      setTeamMembers(enriched);
    };

    loadData();
  }, [managerId, workers, allSessions]);

  const toggleItem = (id: string) => {
    setExpandedItem(expandedItem === id ? null : id);
    setMenuOpenId(null);
    setTransferModeId(null);
  };

  const copyPhone = (phone: string, id: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleTransfer = async (contractorId: string) => {
    if (!selectedTransferManager) return;
    
    try {
        await sessionService.transferWorker(contractorId, selectedTransferManager);
        setTeamMembers((prev) => prev.filter((m) => m.contractorId !== contractorId));
        setTransferModeId(null);
        setMenuOpenId(null);
        setSelectedTransferManager("");
    } catch (error) {
        console.error("Transfer failed:", error);
        alert("Failed to transfer contractor. Please try again.");
    }
  };

  const handleRemove = async (contractorId: string) => {
    if (window.confirm("Are you sure you want to remove this contractor? This will unassign any active routes/bookings.")) {
      try {
        await sessionService.deleteWorker(contractorId);
        setTeamMembers((prev) => prev.filter((m) => m.contractorId !== contractorId));
        setMenuOpenId(null);
      } catch (error) {
        console.error("Error removing contractor:", error);
        alert("Failed to remove contractor. Please refresh and try again.");
      }
    }
  };

  const isModifiable = (member: TeamMemberDisplay) => {
    const hasHistory = member.financialStore.length > 0;
    return !hasHistory;
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
          className="relative bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-all shadow-sm"
        >
          {/* Main Card Content */}
          <div className="p-2 pr-9">
            
            {/* TOP ROW: Name (Left) + Routes (Right) */}
            <div 
              className="flex items-center justify-between mb-1 cursor-pointer"
              onClick={() => toggleItem(member.contractorId)}
            >
              {/* Left: Status + Name */}
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    member.stats.pending > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
                  }`}
                />
                <h3 className="font-bold text-white text-sm whitespace-nowrap">
                  {member.firstName} {member.lastName}
                </h3>
              </div>

              {/* Right: Route Pills (Inline) */}
              <div className="flex flex-wrap justify-end gap-1 ml-2">
                {member.assignedRoutes.length > 0 ? (
                  member.assignedRoutes.map((route, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-indigo-900/60 text-indigo-200 border border-indigo-500/30 font-mono">
                      {route}
                    </span>
                  ))
                ) : member.displayBookings.length > 0 ? (
                   <span className="text-[9px] text-gray-500 italic">No Rte</span>
                ) : null}
              </div>
            </div>

            {/* SECOND ROW: Location + Phone + ID */}
            <div 
              className="flex items-center gap-3 pl-4 mb-2 cursor-pointer"
              onClick={() => toggleItem(member.contractorId)}
            >
              {/* Location */}
              <div className="flex items-center gap-1 text-[10px] text-gray-400 truncate max-w-[50%]">
                <MapPin size={9} className={member.lastActiveAddress ? "text-emerald-500" : "text-gray-600"} />
                {member.lastActiveAddress ? (
                  <span className="truncate">{member.lastActiveAddress}</span>
                ) : (
                  <span className="opacity-50 italic">No history</span>
                )}
              </div>

              {/* Separator */}
              <span className="text-gray-700 text-[10px]">|</span>

              {/* ID & Phone */}
              <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                <span>#{member.contractorId}</span>
                {member.cellPhone && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      copyPhone(member.cellPhone!, member.contractorId);
                    }}
                    className="flex items-center gap-1 text-blue-400 cursor-pointer hover:underline"
                  >
                    <Phone size={9} /> {member.cellPhone}
                    {copiedId === member.contractorId && (
                      <Check size={9} className="text-green-400" />
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* THIRD ROW: Compact Stats Grid */}
            <div 
              className="grid grid-cols-5 gap-1 text-center bg-gray-900/40 p-1 rounded text-[10px] border border-gray-700/30 cursor-pointer"
              onClick={() => toggleItem(member.contractorId)}
            >
              <div>
                <div className="text-gray-500 text-[8px] uppercase">Steps</div>
                <div className="text-white font-bold">{member.stats.steps}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[8px] uppercase">Pend</div>
                <div className="text-yellow-400 font-bold">{member.stats.pending}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[8px] uppercase">Up Gross</div>
                <div className="text-green-400 font-bold">${member.stats.gross.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[8px] uppercase">Upsell</div>
                <div className="text-purple-400 font-bold">{member.stats.upsellCount}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[8px] uppercase">EQ</div>
                <div className="text-blue-300 font-bold">{member.stats.eq.toFixed(1)}</div>
              </div>
            </div>

          </div>

          {/* ABSOLUTE MENU: Top Right */}
          <div className="absolute top-2 right-1.5">
             {isModifiable(member) ? (
               <div className="relative">
                 <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === member.contractorId ? null : member.contractorId);
                      setTransferModeId(null);
                    }}
                    className={`p-1 rounded hover:bg-gray-700 transition-colors ${menuOpenId === member.contractorId ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
                 >
                   <MoreVertical size={14} />
                 </button>
                 
                 {/* Dropdown Menu */}
                 {menuOpenId === member.contractorId && (
                   <div ref={menuRef} className="absolute right-0 top-6 w-48 bg-gray-800 border border-gray-600 rounded shadow-xl z-20 overflow-hidden">
                     {!transferModeId ? (
                       <div className="flex flex-col">
                         <button 
                           onClick={() => setTransferModeId(member.contractorId)}
                           className="flex items-center gap-2 px-3 py-2 text-xs text-blue-300 hover:bg-gray-700 text-left"
                         >
                           <ArrowRight size={14} /> Transfer Contractor
                         </button>
                         <button 
                           onClick={() => handleRemove(member.contractorId)}
                           className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-gray-700 text-left border-t border-gray-700"
                         >
                           <Trash2 size={14} /> Remove Contractor
                         </button>
                       </div>
                     ) : (
                       <div className="p-2 space-y-2">
                         <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                           <span>Select Manager</span>
                           <button onClick={() => setTransferModeId(null)}><X size={12}/></button>
                         </div>
                         <select 
                            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded p-1 outline-none"
                            value={selectedTransferManager}
                            onChange={(e) => setSelectedTransferManager(e.target.value)}
                         >
                           <option value="">Select...</option>
                           {allManagers
                            .filter(m => m.userId !== managerId)
                            .map(m => (
                             <option key={m.userId} value={m.userId}>{m.name}</option>
                           ))}
                         </select>
                         <button 
                           disabled={!selectedTransferManager}
                           onClick={() => handleTransfer(member.contractorId)}
                           className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs py-1 rounded"
                         >
                           Confirm
                         </button>
                       </div>
                     )}
                   </div>
                 )}
               </div>
             ) : (
               <div 
                 className="p-1 cursor-pointer"
                 onClick={() => toggleItem(member.contractorId)}
               >
                 {expandedItem === member.contractorId ? (
                    <ChevronUp size={14} className="text-gray-600" />
                 ) : (
                    <ChevronDown size={14} className="text-gray-600" />
                 )}
               </div>
             )}
          </div>

          {/* Accordion Content */}
          {expandedItem === member.contractorId && (
            <div className="mt-1 pt-1 border-t border-gray-700 px-2 pb-2">
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
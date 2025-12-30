import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Phone, 
  Check, 
  MoreVertical, 
  ArrowRight, // Replaced UserRight with ArrowRight
  Trash2, 
  X,
  MapPin,
  Route as RouteIcon
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { Worker, MasterBooking, LogsheetSession, ManagementUser } from '../../../types';
import { TabStats } from '../RMLogbook';
import ContractorJobs from './ContractorJobs';

interface RMTeamTabProps {
  managerId: string;
  workers: Worker[];
  allSessions: LogsheetSession[];
  // New prop to populate the transfer dropdown
  allManagers?: ManagementUser[];
  onStatsUpdate: (stats: TabStats) => void;
  // Action Handlers
  onTransferContractor?: (contractorId: string, newManagerId: string) => Promise<void>;
  onRemoveContractor?: (contractorId: string) => Promise<void>;
}

interface TeamMemberDisplay extends Worker {
  displayBookings: MasterBooking[];
  financialStore: any[];
  assignedRoutes: string[]; // New: Derived unique routes
  lastActiveAddress: string | null; // New: Derived last address
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
  allManagers = [], // Default to empty if not passed yet
  onStatsUpdate,
  onTransferContractor,
  onRemoveContractor
}) => {
  const [teamMembers, setTeamMembers] = useState<TeamMemberDisplay[]>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Management State
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [transferModeId, setTransferModeId] = useState<string | null>(null);
  const [selectedTransferManager, setSelectedTransferManager] = useState<string>("");

  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
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

          // 3. Derive Routes (Unique Route Numbers)
          const uniqueRoutes = Array.from(new Set(
            allBookings
              .map(b => b['Route Number'])
              .filter(r => r && r !== 'x' && r.trim() !== '')
          )) as string[];

          // 4. Derive Last Address (Most recent transaction)
          let lastAddr = null;
          if (financialStore.length > 0) {
            // Sort by timestamp desc to get latest
            const sortedTx = [...financialStore].sort((a, b) => 
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            lastAddr = sortedTx[0].address;
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
            lastActiveAddress: lastAddr,
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

  // --- Handlers ---

  const toggleItem = (id: string) => {
    setExpandedItem(expandedItem === id ? null : id);
    // Close menus when toggling accordion
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
    if (onTransferContractor) {
      await onTransferContractor(contractorId, selectedTransferManager);
    } else {
      console.log(`Transferring ${contractorId} to ${selectedTransferManager} (No handler provided)`);
    }
    setTransferModeId(null);
    setMenuOpenId(null);
  };

  const handleRemove = async (contractorId: string) => {
    if (window.confirm("Are you sure you want to remove this contractor? This cannot be undone.")) {
      if (onRemoveContractor) {
        await onRemoveContractor(contractorId);
      } else {
        console.log(`Removing ${contractorId} (No handler provided)`);
      }
      setMenuOpenId(null);
    }
  };

  // Logic to determine if menu is accessible
  const isModifiable = (member: TeamMemberDisplay) => {
    const hasBookings = member.displayBookings.length > 0;
    const hasHistory = member.financialStore.length > 0;
    return !hasBookings && !hasHistory;
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
          {/* Header Card Area */}
          <div className="p-2 pr-10"> {/* pr-10 reserves space for the menu button */}
            
            {/* Top Row: Name & Status */}
            <div 
              className="flex items-center gap-3 mb-2 cursor-pointer"
              onClick={() => toggleItem(member.contractorId)}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full shadow-sm ${
                  member.stats.pending > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
                }`}
              />
              <div>
                <h3 className="font-bold text-white text-sm leading-tight">
                  {member.firstName} {member.lastName}
                </h3>
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
                      <Phone size={10} /> {member.cellPhone}
                      {copiedId === member.contractorId && (
                        <Check size={10} className="text-green-400" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Row: Routes & Location (Clicking this also toggles accordion) */}
            <div 
              className="mb-2 space-y-1 cursor-pointer"
              onClick={() => toggleItem(member.contractorId)}
            >
              {/* Assigned Routes Pills */}
              <div className="flex flex-wrap gap-1">
                {member.assignedRoutes.length > 0 ? (
                  member.assignedRoutes.map((route, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-indigo-900/50 text-indigo-200 border border-indigo-500/30">
                      <RouteIcon size={8} />
                      {route}
                    </span>
                  ))
                ) : (
                   member.displayBookings.length > 0 ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-700 text-gray-300">
                         {member.displayBookings.length} Bookings (No Route)
                      </span>
                   ) : (
                    <span className="text-[10px] text-gray-600 italic">No active assignments</span>
                   )
                )}
              </div>

              {/* Last Address */}
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400 truncate">
                <MapPin size={10} className={member.lastActiveAddress ? "text-emerald-500" : "text-gray-600"} />
                {member.lastActiveAddress ? (
                  <span className="truncate">{member.lastActiveAddress}</span>
                ) : (
                  <span className="opacity-50 italic">No transaction history</span>
                )}
              </div>
            </div>

            {/* Bottom Row: Stats Grid (Compact) */}
            <div 
              className="grid grid-cols-5 gap-1 text-center bg-gray-900/50 p-1.5 rounded text-xs border border-gray-700/50 cursor-pointer"
              onClick={() => toggleItem(member.contractorId)}
            >
              <div>
                <div className="text-gray-500 text-[9px] uppercase">Steps</div>
                <div className="text-white font-bold">{member.stats.steps}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px] uppercase">Pend</div>
                <div className="text-yellow-400 font-bold">{member.stats.pending}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px] uppercase">Gross</div>
                <div className="text-green-400 font-bold">${member.stats.gross.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px] uppercase">Upsell</div>
                <div className="text-purple-400 font-bold">{member.stats.upsellCount}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[9px] uppercase">EQ</div>
                <div className="text-blue-300 font-bold">{member.stats.eq.toFixed(1)}</div>
              </div>
            </div>

          </div>

          {/* 3-Dot Menu Button (Absolute Top Right) */}
          <div className="absolute top-2 right-2">
             {isModifiable(member) ? (
               <div className="relative">
                 <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === member.contractorId ? null : member.contractorId);
                      setTransferModeId(null);
                    }}
                    className={`p-1 rounded-full hover:bg-gray-700 transition-colors ${menuOpenId === member.contractorId ? 'bg-gray-700 text-white' : 'text-gray-500'}`}
                 >
                   <MoreVertical size={16} />
                 </button>
                 
                 {/* Dropdown Menu */}
                 {menuOpenId === member.contractorId && (
                   <div ref={menuRef} className="absolute right-0 top-6 w-48 bg-gray-800 border border-gray-600 rounded shadow-xl z-20 overflow-hidden">
                     
                     {!transferModeId ? (
                       // Standard Menu
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
                       // Transfer Mode Sub-menu
                       <div className="p-2 space-y-2">
                         <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                           <span>Select Manager</span>
                           <button onClick={() => setTransferModeId(null)}><X size={12}/></button>
                         </div>
                         <select 
                            className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded p-1 focus:ring-1 focus:ring-blue-500 outline-none"
                            value={selectedTransferManager}
                            onChange={(e) => setSelectedTransferManager(e.target.value)}
                         >
                           <option value="">Select...</option>
                           {allManagers
                            .filter(m => m.userId !== managerId) // Exclude self
                            .map(m => (
                             <option key={m.userId} value={m.userId}>{m.name}</option>
                           ))}
                         </select>
                         <button 
                           disabled={!selectedTransferManager}
                           onClick={() => handleTransfer(member.contractorId)}
                           className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs py-1 rounded transition-colors"
                         >
                           Confirm Transfer
                         </button>
                       </div>
                     )}
                   </div>
                 )}
               </div>
             ) : (
               // Disabled/Hidden Menu State
               <div title="Cannot manage active contractor (Must have 0 assignments and 0 history)">
                 {expandedItem === member.contractorId ? (
                    <ChevronUp size={16} className="text-gray-600" onClick={() => toggleItem(member.contractorId)}/>
                 ) : (
                    <ChevronDown size={16} className="text-gray-600" onClick={() => toggleItem(member.contractorId)}/>
                 )}
               </div>
             )}
          </div>

          {/* Accordion Content */}
          {expandedItem === member.contractorId && (
            <div className="mt-2 pt-2 border-t border-gray-700 px-2 pb-2">
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
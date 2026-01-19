// src/pages/Management/components/RMTeamTab.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Truck,
  Users,
  Leaf,
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { Worker, MasterBooking, LogsheetSession, ManagementUser, SeasonType } from '../../../types';
import ContractorJobs from './ContractorJobs';

interface RMTeamTabProps {
  managerId: string;
  workers: Worker[];
  allSessions: LogsheetSession[];
  allManagers?: ManagementUser[];
  seasonType?: SeasonType;
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

interface CartDisplay {
  teamId: string;
  members: TeamMemberDisplay[];
  aggregatedStats: {
    steps: number;
    gross: number;
    eq: number;
    pending: number;
    upsellCount: number;
    upsellGross: number;
  };
}

type TeamSortOption = 'alpha' | 'steps' | 'equiv' | 'upGross';

const RMTeamTab: React.FC<RMTeamTabProps> = ({
  managerId,
  workers,
  allSessions,
  allManagers = [],
  seasonType = 'aeration',
}) => {
  const [teamMembers, setTeamMembers] = useState<TeamMemberDisplay[]>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [expandedCarts, setExpandedCarts] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isLawnRejuv = seasonType === 'lawn_rejuv';

  // Sort State - Default to alphabetical by last name
  const [sortBy, setSortBy] = useState<TeamSortOption>('alpha');

  // Management State (Aeration only)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [transferModeId, setTransferModeId] = useState<string | null>(null);
  const [selectedTransferManager, setSelectedTransferManager] = useState<string>("");

  // Refresh Key to trigger data reload
  const [refreshKey, setRefreshKey] = useState(0);

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
          
          // 2. Calculate Pending - Exclude cancelled and next_time
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

          // Fetch fresh upsellsEnabled status
          const upsellsEnabled = await sessionService.getWorkerUpsellsEnabled(w.contractorId);

          return {
            ...w,
            upsellsEnabled,
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
  }, [managerId, workers, allSessions, refreshKey]);

  // Group workers into carts for Lawn Rejuv
  const teamCarts = useMemo((): CartDisplay[] => {
    if (!isLawnRejuv) return [];

    const cartMap = new Map<string, TeamMemberDisplay[]>();

    teamMembers.forEach((member) => {
      const teamId = member.teamId || member.contractorId;
      if (!cartMap.has(teamId)) {
        cartMap.set(teamId, []);
      }
      cartMap.get(teamId)!.push(member);
    });

    return Array.from(cartMap.entries()).map(([teamId, members]) => {
      // Aggregate stats
      const aggregatedStats = members.reduce(
        (acc, m) => ({
          steps: acc.steps + m.stats.steps,
          gross: acc.gross + m.stats.gross,
          eq: acc.eq + m.stats.eq,
          pending: acc.pending + m.stats.pending,
          upsellCount: acc.upsellCount + m.stats.upsellCount,
          upsellGross: acc.upsellGross + m.stats.upsellGross,
        }),
        { steps: 0, gross: 0, eq: 0, pending: 0, upsellCount: 0, upsellGross: 0 }
      );

      return {
        teamId,
        members,
        aggregatedStats,
      };
    });
  }, [teamMembers, isLawnRejuv]);

  // Sorted team members (Aeration)
  const sortedTeamMembers = useMemo(() => {
    const members = [...teamMembers];
    
    switch (sortBy) {
      case 'alpha':
        return members.sort((a, b) => a.lastName.localeCompare(b.lastName));
      case 'steps':
        return members.sort((a, b) => b.stats.steps - a.stats.steps);
      case 'equiv':
        return members.sort((a, b) => b.stats.eq - a.stats.eq);
      case 'upGross':
        return members.sort((a, b) => b.stats.upsellGross - a.stats.upsellGross);
      default:
        return members;
    }
  }, [teamMembers, sortBy]);

  // Sorted carts (Lawn Rejuv)
  const sortedCarts = useMemo(() => {
    const carts = [...teamCarts];
    
    switch (sortBy) {
      case 'alpha':
        return carts.sort((a, b) => {
          const aName = a.members[0]?.lastName || a.teamId;
          const bName = b.members[0]?.lastName || b.teamId;
          return aName.localeCompare(bName);
        });
      case 'steps':
        return carts.sort((a, b) => b.aggregatedStats.steps - a.aggregatedStats.steps);
      case 'equiv':
        return carts.sort((a, b) => b.aggregatedStats.eq - a.aggregatedStats.eq);
      case 'upGross':
        return carts.sort((a, b) => b.aggregatedStats.upsellGross - a.aggregatedStats.upsellGross);
      default:
        return carts;
    }
  }, [teamCarts, sortBy]);

  const toggleItem = (id: string) => {
    setExpandedItem(expandedItem === id ? null : id);
    setMenuOpenId(null);
    setTransferModeId(null);
  };

  const toggleCart = (cartId: string) => {
    setExpandedCarts(prev => {
      const next = new Set(prev);
      if (next.has(cartId)) {
        next.delete(cartId);
      } else {
        next.add(cartId);
      }
      return next;
    });
  };

  const copyPhone = (phone: string, id: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRefreshData = () => {
    setRefreshKey(prev => prev + 1);
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

  const handleToggleUpsells = async (contractorId: string, currentValue: boolean) => {
    try {
      await sessionService.toggleWorkerUpsells(contractorId, !currentValue);
      // Update local state immediately for responsiveness
      setTeamMembers(prev => prev.map(m => 
        m.contractorId === contractorId 
          ? { ...m, upsellsEnabled: !currentValue }
          : m
      ));
    } catch (error) {
      console.error("Failed to toggle upsells:", error);
      alert("Failed to update upsell setting. Please try again.");
    }
  };

  const isModifiable = (member: TeamMemberDisplay) => {
    // Disable transfer/remove for Lawn Rejuv
    if (isLawnRejuv) return false;
    const hasHistory = member.financialStore.length > 0;
    return !hasHistory;
  };

  // Handler for when a job is clicked in ContractorJobs
  // For Route Managers, this is view-only, so we just refresh data
  const handleJobClick = (job: MasterBooking) => {
    // Route Managers view is read-only for jobs
    // Could add a modal to view job details in the future
    console.log('Job clicked:', job['Booking ID']);
    handleRefreshData();
  };

  // --- RENDER: Worker Card (shared between Aeration and Lawn Rejuv) ---
  const renderWorkerCard = (member: TeamMemberDisplay, isInCart: boolean = false) => {
    const canModify = isModifiable(member);
    
    return (
      <div
        key={member.contractorId}
        className={`relative bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-all shadow-sm ${
          isInCart ? 'ml-0' : ''
        }`}
      >
        {/* Main Card Content */}
        <div className="p-2 pr-9">
          
          {/* TOP ROW: Name (Left) + Routes (Center) + Upsell Toggle (Right) */}
          <div 
            className="flex items-center justify-between mb-1 cursor-pointer"
            onClick={() => toggleItem(member.contractorId)}
          >
            {/* Left: Status + Name */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  member.stats.pending > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
                }`}
              />
              <h3 className="font-bold text-white text-sm whitespace-nowrap">
                {member.firstName} {member.lastName}
              </h3>
              
              {/* Route Pills - Inline with name */}
              <div className="flex flex-wrap gap-1 ml-2">
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

            {/* Right: Upsell Toggle */}
            <div className="flex items-center gap-1 flex-shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
              <span className={`text-[8px] font-bold ${member.upsellsEnabled !== false ? 'text-purple-400' : 'text-gray-500'}`}>
                UP
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleUpsells(member.contractorId, member.upsellsEnabled !== false);
                }}
                className={`relative inline-flex h-3 w-5 flex-shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none items-center ${
                  member.upsellsEnabled !== false
                    ? 'bg-purple-600 border-purple-600'
                    : 'bg-gray-600 border-gray-600'
                }`}
                title={member.upsellsEnabled !== false ? 'Upsells Enabled' : 'Upsells Disabled'}
              >
                <span
                  className={`pointer-events-none inline-block h-2 w-2 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    member.upsellsEnabled !== false ? 'translate-x-[10px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
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
              <div className="text-green-400 font-bold">${member.stats.gross.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[8px] uppercase">Upsell</div>
              <div className="text-purple-400 font-bold">{member.stats.upsellCount}</div>
            </div>
            <div>
              <div className="text-gray-500 text-[8px] uppercase">EQ</div>
              <div className="text-blue-300 font-bold">{member.stats.eq.toFixed(2)}</div>
            </div>
          </div>

        </div>

        {/* ABSOLUTE MENU: Top Right (Aeration only) */}
        <div className="absolute top-2 right-1.5">
           {canModify ? (
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

        {/* Accordion Content - ContractorJobs */}
        {expandedItem === member.contractorId && (
          <div className="mt-1 pt-1 border-t border-gray-700 px-2 pb-2">
            <ContractorJobs
              jobs={member.displayBookings}
              onJobClick={handleJobClick}
              seasonType={seasonType}
            />
          </div>
        )}
      </div>
    );
  };

  // --- RENDER: Cart Card (Lawn Rejuv only) ---
  const renderCartCard = (cart: CartDisplay) => {
    const isExpanded = expandedCarts.has(cart.teamId);
    const isSoloCart = cart.members.length === 1;
    const primaryWorker = cart.members[0];
    const hasActivity = cart.aggregatedStats.steps > 0;

    return (
      <div
        key={cart.teamId}
        className={`rounded-lg border overflow-hidden transition-all ${
          isSoloCart
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-800 border-green-900/50'
        }`}
      >
        {/* Cart Header */}
        <div
          className="p-3 cursor-pointer hover:bg-gray-700/30 transition-colors"
          onClick={() => toggleCart(cart.teamId)}
        >
          <div className="flex items-center justify-between gap-3">
            {/* Left: Cart Icon + Info */}
            <div className="flex items-center gap-3">
              {/* Cart Badge */}
              <div
                className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                  isSoloCart
                    ? hasActivity
                      ? 'bg-cps-blue text-white'
                      : 'bg-gray-700 text-gray-400'
                    : hasActivity
                    ? 'bg-green-600 text-white'
                    : 'bg-green-900/30 text-green-400 border border-green-700/50'
                }`}
              >
                {isSoloCart ? (
                  <span className="text-sm font-bold">
                    {primaryWorker?.firstName[0]}
                    {primaryWorker?.lastName[0]}
                  </span>
                ) : (
                  <div className="flex flex-col items-center">
                    <Truck size={16} />
                    <span className="text-[9px] font-bold mt-0.5">{cart.members.length}</span>
                  </div>
                )}
              </div>

              {/* Names */}
              <div>
                <div className="font-bold text-white text-sm flex items-center gap-2">
                  {isSoloCart ? (
                    <span>
                      {primaryWorker?.firstName} {primaryWorker?.lastName}
                    </span>
                  ) : (
                    <span className="text-green-300">Cart: {cart.teamId}</span>
                  )}
                  {!hasActivity && (
                    <span className="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                      No Activity
                    </span>
                  )}
                </div>

                {/* Member names for team carts */}
                {!isSoloCart && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {cart.members.map((w) => `${w.firstName} ${w.lastName[0]}.`).join(', ')}
                  </div>
                )}

                {/* Solo worker ID */}
                {isSoloCart && (
                  <div className="text-[10px] text-gray-500 font-mono">
                    #{primaryWorker?.contractorId}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Stats + Chevron */}
            <div className="flex items-center gap-3">
              {/* Stats Pills */}
              <div className="hidden sm:flex items-center gap-2 text-xs">
                <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-300">
                  {cart.aggregatedStats.steps} steps
                </span>
                <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-blue-300">
                  {cart.aggregatedStats.eq.toFixed(1)} EQ
                </span>
                {cart.aggregatedStats.upsellCount > 0 && (
                  <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-900/30 text-purple-300 border border-purple-700/50">
                    {cart.aggregatedStats.upsellCount} up
                  </span>
                )}
              </div>

              {isExpanded ? (
                <ChevronUp className="text-gray-400" size={18} />
              ) : (
                <ChevronDown className="text-gray-400" size={18} />
              )}
            </div>
          </div>

          {/* Mobile Stats Row */}
          <div className="sm:hidden flex items-center gap-2 mt-2 text-xs">
            <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-300">
              {cart.aggregatedStats.steps} steps
            </span>
            <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-blue-300">
              {cart.aggregatedStats.eq.toFixed(1)} EQ
            </span>
            {cart.aggregatedStats.upsellGross > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-900/30 text-purple-300">
                ${cart.aggregatedStats.upsellGross.toFixed(0)}
              </span>
            )}
          </div>
        </div>

        {/* Expanded Content - Team Member Cards */}
        {isExpanded && (
          <div className="border-t border-gray-700 bg-gray-900/30 p-2 space-y-2">
            {cart.members.map((member) => renderWorkerCard(member, true))}
          </div>
        )}
      </div>
    );
  };

  // --- MAIN RENDER ---
  return (
    <div className="space-y-2 max-w-4xl mx-auto pb-10">
      {/* Header with Sort */}
      {teamMembers.length > 0 && (
        <div className="flex justify-between items-center mb-4">
          {isLawnRejuv && (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <Leaf size={14} />
              <span>
                {teamCarts.length} cart{teamCarts.length !== 1 ? 's' : ''} • {teamMembers.length} workers
              </span>
            </div>
          )}
          <div className={`flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-sm ${!isLawnRejuv ? 'ml-auto' : ''}`}>
            <span className="text-xs text-gray-400 font-medium">Sort by:</span>
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as TeamSortOption)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cps-blue cursor-pointer"
            >
              <option value="alpha">Last Name (A-Z)</option>
              <option value="steps">Highest Steps</option>
              <option value="equiv">Highest Equiv</option>
              <option value="upGross">Highest Upsell Gross</option>
            </select>
          </div>
        </div>
      )}

      {teamMembers.length === 0 && (
        <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg border border-gray-700/50">
          <Users size={48} className="mx-auto mb-2 opacity-20" />
          <p>No workers assigned to your team.</p>
        </div>
      )}

      {/* Lawn Rejuv: Render Cart Cards */}
      {isLawnRejuv && sortedCarts.map((cart) => renderCartCard(cart))}

      {/* Aeration: Render Worker Cards directly */}
      {!isLawnRejuv && sortedTeamMembers.map((member) => renderWorkerCard(member, false))}
    </div>
  );
};

export default RMTeamTab;
// src/pages/Management/components/RMTeamTab.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Shovel,
  Eye,
  Shuffle,
  Loader,
  AlertCircle,
  UserPlus,
  ArrowRightLeft,
  UserMinus,
  Bookmark,
} from 'lucide-react';
import { sessionService } from '../../../lib/sessionService';
import { seasonHasTeams } from '../../../lib/commandCenterService';
import { setStorageItem } from '../../../lib/localStorage';
import {
  Worker,
  MasterBooking,
  LogsheetSession,
  ManagementUser,
  SeasonType,
  SessionStats,
  SEASON_CONFIGS,
  PendingSale,
} from '../../../types';
import ContractorJobs from './ContractorJobs';

interface RMTeamTabProps {
  managerId: string;
  workers: Worker[];
  allSessions: LogsheetSession[];
  allManagers?: ManagementUser[];
  seasonType?: SeasonType;
  currentUser?: ManagementUser;
}

interface WorkerDisplay extends Worker {
  displayBookings: MasterBooking[];
  financialStore: any[];
  assignedRoutes: string[];
  lastActiveAddress: string | null;
  lastActiveTimestamp: string | null;
  lastActiveTime: string | null;
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
  sessionId: string;
  teamId: string;
  members: WorkerDisplay[];
  sharedBookings: MasterBooking[];
  sharedFinancialStore: any[];
  assignedRoutes: string[];
  lastActiveAddress: string | null;
  lastActiveTimestamp: string | null;
  lastActiveTime: string | null;
  aggregatedStats: {
    steps: number;
    gross: number;
    eq: number;
    pending: number;
    pendingSaleCount: number;
    upsellCount: number;
    upsellGross: number;
  };
}

type TeamSortOption = 'recent' | 'alpha' | 'steps' | 'equiv' | 'upGross';

const formatTimeShort = (timestamp: string): string => {
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minutesStr}${ampm}`;
};

const convertPendingSaleToBooking = (ps: PendingSale): MasterBooking => {
  const fullAddress = `${ps.houseNumber || ''} ${ps.streetName || ''}`.trim();
  return {
    'Booking ID': ps.id,
    'First Name': '',
    'Last Name': '',
    'Full Address': fullAddress,
    'House Number': ps.houseNumber,
    'Street Name': ps.streetName,
    'Route Number': ps.routeCode,
    'Price': ps.price || '',
    'Log Sheet Notes': ps.notes,
    'FO/BO/FP': ps.propertyType as any,
    Status: 'pending',
    services: ps.services,
    isPendingSale: true,
    pendingSaleId: ps.id,
  } as MasterBooking;
};

const RMTeamTab: React.FC<RMTeamTabProps> = ({
  managerId,
  workers,
  allSessions,
  allManagers = [],
  seasonType = 'aeration',
  currentUser,
}) => {
  const navigate = useNavigate();
  const [teamMembers, setTeamMembers] = useState<WorkerDisplay[]>([]);
  const [carts, setCarts] = useState<CartDisplay[]>([]);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [expandedCarts, setExpandedCarts] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isTeamSeason = seasonHasTeams(seasonType);
  const seasonConfig = SEASON_CONFIGS[seasonType];

  const [sortBy, setSortBy] = useState<TeamSortOption>('recent');

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [transferModeId, setTransferModeId] = useState<string | null>(null);
  const [selectedTransferManager, setSelectedTransferManager] = useState<string>("");

  const [refreshKey, setRefreshKey] = useState(0);

  const [showReassignModal, setShowReassignModal] = useState(false);
  const [selectedWorkerToMove, setSelectedWorkerToMove] = useState<WorkerDisplay | null>(null);
  const [selectedWorkerCart, setSelectedWorkerCart] = useState<CartDisplay | null>(null);
  const [reassignLoading, setReassignLoading] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignManagerId, setReassignManagerId] = useState('');
  const [reassignSuccess, setReassignSuccess] = useState<string | null>(null);

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
      if (isTeamSeason) {
        await loadTeamSeasonData(myTeam);
      } else {
        await loadAerationData(myTeam);
      }
    };
    loadData();
  }, [managerId, workers, allSessions, refreshKey, isTeamSeason]);

  const loadAerationData = async (myTeam: Worker[]) => {
    const enriched = await Promise.all(
      myTeam.map(async (w) => {
        const allBookings = await sessionService.getWorkerAssignments(w.contractorId);

        const pending = allBookings.filter((b) =>
          b.Completed !== 'x' &&
          b.Status !== 'completed' &&
          b.Status !== 'cancelled' &&
          b.Status !== 'next_time'
        );

        const freshSession = await sessionService.getActiveLogsheetSession(w.contractorId);
        const stats = freshSession?.stats || sessionService.getEmptyStats();
        const financialStore = freshSession?.financialStore || [];

        const uniqueRoutes = Array.from(new Set(
          allBookings
            .map(b => b['Route Number'])
            .filter(r => r && r !== 'x' && r.trim() !== '')
        )) as string[];

        let lastAddr: string | null = null;
        let lastTimestamp: string | null = null;
        let lastTimeFormatted: string | null = null;

        if (financialStore.length > 0) {
          const sortedTx = [...financialStore].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          lastAddr = sortedTx[0].address;
          lastTimestamp = sortedTx[0].timestamp;
          lastTimeFormatted = formatTimeShort(sortedTx[0].timestamp);
        }

        const upsellsEnabled = await sessionService.getWorkerUpsellsEnabled(w.contractorId);

        return {
          ...w,
          upsellsEnabled,
          displayBookings: allBookings,
          financialStore,
          assignedRoutes: uniqueRoutes,
          lastActiveAddress: lastAddr,
          lastActiveTimestamp: lastTimestamp,
          lastActiveTime: lastTimeFormatted,
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

  const loadTeamSeasonData = async (myTeam: Worker[]) => {
    const myTeamIds = new Set(myTeam.map(w => w.contractorId));
    const workerMap = new Map(myTeam.map(w => [w.contractorId, w]));

    const mySessions = allSessions.filter(session => {
      const ids = session.teamWorkerIds || [session.workerId];
      return ids.some(id => myTeamIds.has(id));
    });

    const cartDisplays = await Promise.all(
      mySessions.map(async (session) => {
        const sessionWorkerIds = (session.teamWorkerIds || [session.workerId]).filter(id => myTeamIds.has(id));
        const teamWorkers = sessionWorkerIds
          .map(id => workerMap.get(id))
          .filter(Boolean) as Worker[];

        const sharedFinancialStore = session.financialStore || [];
        const stats = session.stats || sessionService.getEmptyStats();

        let officeBookings: MasterBooking[] = [];
        let pendingSales: PendingSale[] = [];
        if (session.id) {
          const [bookingsRes, pendingSalesRes] = await Promise.all([
            sessionService.getSessionAssignments(session.id),
            sessionService.getPendingSalesForSession(session.id),
          ]);
          officeBookings = bookingsRes;
          pendingSales = pendingSalesRes;
        }

        const pendingSalesAsBookings = pendingSales.map(convertPendingSaleToBooking);
        const sharedBookings: MasterBooking[] = [...pendingSalesAsBookings, ...officeBookings];

        const pending = officeBookings.filter(b =>
          b.Completed !== 'x' &&
          b.Status !== 'completed' &&
          b.Status !== 'cancelled' &&
          b.Status !== 'next_time'
        );

        const uniqueRoutes = Array.from(new Set(
          officeBookings
            .map(b => b['Route Number'])
            .filter(r => r && r !== 'x' && r.trim() !== '')
        )) as string[];

        let lastAddr: string | null = null;
        let lastTimestamp: string | null = null;
        let lastTimeFormatted: string | null = null;

        if (sharedFinancialStore.length > 0) {
          const sortedTx = [...sharedFinancialStore].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          lastAddr = sortedTx[0].address;
          lastTimestamp = sortedTx[0].timestamp;
          lastTimeFormatted = formatTimeShort(sortedTx[0].timestamp);
        }

        const memberDisplays: WorkerDisplay[] = teamWorkers.map(w => ({
          ...w,
          displayBookings: [],
          financialStore: [],
          assignedRoutes: uniqueRoutes,
          lastActiveAddress: null,
          lastActiveTimestamp: null,
          lastActiveTime: null,
          stats: { steps: 0, gross: 0, eq: 0, pending: 0, upsellCount: 0, upsellGross: 0 },
        }));

        return {
          sessionId: session.id,
          teamId: sessionWorkerIds[0] || session.workerId,
          members: memberDisplays,
          sharedBookings,
          sharedFinancialStore,
          assignedRoutes: uniqueRoutes,
          lastActiveAddress: lastAddr,
          lastActiveTimestamp: lastTimestamp,
          lastActiveTime: lastTimeFormatted,
          aggregatedStats: {
            steps: stats.stepCount,
            gross: stats.upsellGross,
            eq: stats.totalEQ,
            pending: pending.length,
            pendingSaleCount: pendingSales.length,
            upsellCount: stats.upsellCount,
            upsellGross: stats.upsellGross,
          },
        };
      })
    );

    setCarts(cartDisplays);
    setTeamMembers(myTeam.map(w => ({
      ...w,
      displayBookings: [],
      financialStore: [],
      assignedRoutes: [],
      lastActiveAddress: null,
      lastActiveTimestamp: null,
      lastActiveTime: null,
      stats: { steps: 0, gross: 0, eq: 0, pending: 0, upsellCount: 0, upsellGross: 0 },
    })));
  };

  const sortedTeamMembers = useMemo(() => {
    const members = [...teamMembers];
    switch (sortBy) {
      case 'recent':
        return members.sort((a, b) => {
          if (!a.lastActiveTimestamp && !b.lastActiveTimestamp) return 0;
          if (!a.lastActiveTimestamp) return 1;
          if (!b.lastActiveTimestamp) return -1;
          return new Date(b.lastActiveTimestamp).getTime() - new Date(a.lastActiveTimestamp).getTime();
        });
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

  const sortedCarts = useMemo(() => {
    const cartList = [...carts];
    switch (sortBy) {
      case 'recent':
        return cartList.sort((a, b) => {
          if (!a.lastActiveTimestamp && !b.lastActiveTimestamp) return 0;
          if (!a.lastActiveTimestamp) return 1;
          if (!b.lastActiveTimestamp) return -1;
          return new Date(b.lastActiveTimestamp).getTime() - new Date(a.lastActiveTimestamp).getTime();
        });
      case 'alpha':
        return cartList.sort((a, b) => {
          const aName = a.members[0]?.lastName || a.teamId;
          const bName = b.members[0]?.lastName || b.teamId;
          return aName.localeCompare(bName);
        });
      case 'steps':
        return cartList.sort((a, b) => b.aggregatedStats.steps - a.aggregatedStats.steps);
      case 'equiv':
        return cartList.sort((a, b) => b.aggregatedStats.eq - a.aggregatedStats.eq);
      case 'upGross':
        return cartList.sort((a, b) => b.aggregatedStats.upsellGross - a.aggregatedStats.upsellGross);
      default:
        return cartList;
    }
  }, [carts, sortBy]);

  const toggleItem = (id: string) => {
    setExpandedItem(expandedItem === id ? null : id);
    setMenuOpenId(null);
    setTransferModeId(null);
  };

  const toggleCart = (cartId: string) => {
    setExpandedCarts(prev => {
      const next = new Set(prev);
      if (next.has(cartId)) next.delete(cartId);
      else next.add(cartId);
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

  const handleViewLogsheet = (worker: Worker, cartMembers?: Worker[]) => {
    if (!currentUser) {
      console.error('Cannot view logsheet: currentUser not available');
      return;
    }
    setStorageItem('rm_original_user', currentUser);
    setStorageItem('rm_view_mode', true);
    if (cartMembers && cartMembers.length > 1) {
      const cartNames = cartMembers.map(m => m.firstName).join(' & ');
      setStorageItem('rm_view_cart_names', cartNames);
    } else {
      setStorageItem('rm_view_cart_names', null);
    }
    setStorageItem('current_user', worker);
    navigate('/logsheet');
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
    if (window.confirm("Are you sure you want to remove this contractor?")) {
      try {
        await sessionService.deleteWorker(contractorId);
        setTeamMembers((prev) => prev.filter((m) => m.contractorId !== contractorId));
        setMenuOpenId(null);
      } catch (error) {
        console.error("Error removing contractor:", error);
        alert("Failed to remove contractor.");
      }
    }
  };

  const handleToggleUpsells = async (contractorId: string, currentValue: boolean) => {
    try {
      await sessionService.toggleWorkerUpsells(contractorId, !currentValue);
      setTeamMembers(prev => prev.map(m =>
        m.contractorId === contractorId ? { ...m, upsellsEnabled: !currentValue } : m
      ));
    } catch (error) {
      console.error("Failed to toggle upsells:", error);
    }
  };

  const isModifiable = (member: WorkerDisplay) => {
    if (isTeamSeason) return false;
    return member.financialStore.length === 0;
  };

  const openReassignModal = () => {
    setSelectedWorkerToMove(null);
    setSelectedWorkerCart(null);
    setReassignError(null);
    setReassignSuccess(null);
    setReassignManagerId('');
    setShowReassignModal(true);
  };

  const closeReassignModal = () => {
    setShowReassignModal(false);
    setSelectedWorkerToMove(null);
    setSelectedWorkerCart(null);
    setReassignError(null);
    setReassignSuccess(null);
  };

  const selectWorkerToMove = (worker: WorkerDisplay, cart: CartDisplay) => {
    setSelectedWorkerToMove(worker);
    setSelectedWorkerCart(cart);
    setReassignError(null);
    setReassignSuccess(null);
    setReassignManagerId('');
  };

  const handleReassignWorker = async (
    destination:
      | { type: 'existing_cart'; targetSessionId: string; label: string }
      | { type: 'new_solo' }
      | { type: 'different_manager'; targetManagerId: string }
  ) => {
    if (!selectedWorkerToMove) return;
    setReassignLoading(true);
    setReassignError(null);
    setReassignSuccess(null);

    try {
      await sessionService.reassignWorker(selectedWorkerToMove.contractorId, destination);

      let msg = '';
      if (destination.type === 'existing_cart') {
        msg = `${selectedWorkerToMove.firstName} moved to ${destination.label}`;
      } else if (destination.type === 'new_solo') {
        msg = `${selectedWorkerToMove.firstName} is now a solo cart`;
      } else {
        const mgr = allManagers.find(m => m.userId === destination.targetManagerId);
        msg = `${selectedWorkerToMove.firstName} moved to ${mgr?.name || 'new manager'}`;
      }

      setReassignSuccess(msg);
      setSelectedWorkerToMove(null);
      setSelectedWorkerCart(null);
      handleRefreshData();
    } catch (err: any) {
      console.error('Reassign failed:', err);
      setReassignError(err.message || 'Failed to reassign worker. Please try again.');
    } finally {
      setReassignLoading(false);
    }
  };

  const handleRemoveWorkerNoShow = async () => {
    if (!selectedWorkerToMove) return;
    if (!window.confirm(
      `Remove ${selectedWorkerToMove.firstName} ${selectedWorkerToMove.lastName} completely?\n\nThis removes them from the session and all stats. Use this for no-shows only.`
    )) return;

    setReassignLoading(true);
    setReassignError(null);
    setReassignSuccess(null);

    try {
      if (selectedWorkerCart && selectedWorkerCart.members.length > 1) {
        await sessionService.reassignWorker(
          selectedWorkerToMove.contractorId,
          { type: 'new_solo' }
        );
      }
      await sessionService.deleteWorker(selectedWorkerToMove.contractorId);

      setReassignSuccess(`${selectedWorkerToMove.firstName} removed from session`);
      setSelectedWorkerToMove(null);
      setSelectedWorkerCart(null);
      handleRefreshData();
    } catch (err: any) {
      console.error('Remove failed:', err);
      setReassignError(err.message || 'Failed to remove worker. Please try again.');
    } finally {
      setReassignLoading(false);
    }
  };

  const otherManagers = allManagers.filter(m => m.userId !== managerId && m.role === 'RouteManager');

  const renderWorkerCard = (member: WorkerDisplay) => {
    const canModify = isModifiable(member);

    return (
      <div
        key={member.contractorId}
        className="relative bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-all shadow-sm"
      >
        <div className="p-2 pr-9">
          <div
            className="flex items-center justify-between mb-1 cursor-pointer"
            onClick={() => toggleItem(member.contractorId)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  member.stats.pending > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
                }`}
              />
              <h3 className="font-bold text-white text-sm whitespace-nowrap">
                {member.firstName} {member.lastName}
              </h3>
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

            <div className="flex items-center gap-2 flex-shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={(e) => { e.stopPropagation(); handleViewLogsheet(member); }}
                className="p-1 rounded hover:bg-gray-700 transition-colors text-cyan-400 hover:text-cyan-300"
                title={`View ${member.firstName}'s logsheet`}
              >
                <Eye size={14} />
              </button>
              <span className={`text-[8px] font-bold ${member.upsellsEnabled !== false ? 'text-purple-400' : 'text-gray-500'}`}>
                UP
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleToggleUpsells(member.contractorId, member.upsellsEnabled !== false); }}
                className={`relative inline-flex h-3 w-5 flex-shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none items-center ${
                  member.upsellsEnabled !== false ? 'bg-purple-600 border-purple-600' : 'bg-gray-600 border-gray-600'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-2 w-2 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    member.upsellsEnabled !== false ? 'translate-x-[10px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          <div
            className="flex items-center gap-3 pl-4 mb-2 cursor-pointer"
            onClick={() => toggleItem(member.contractorId)}
          >
            <div className="flex items-center gap-1 text-[10px] text-gray-400 truncate max-w-[50%]">
              <MapPin size={9} className={member.lastActiveAddress ? "text-emerald-500" : "text-gray-600"} />
              {member.lastActiveAddress ? (
                <span className="truncate">
                  {member.lastActiveAddress}
                  {member.lastActiveTime && <span className="text-gray-500"> • {member.lastActiveTime}</span>}
                </span>
              ) : (
                <span className="opacity-50 italic">No history</span>
              )}
            </div>
            <span className="text-gray-700 text-[10px]">|</span>
            <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
              <span>#{member.contractorId}</span>
              {member.cellPhone && (
                <span
                  onClick={(e) => { e.stopPropagation(); copyPhone(member.cellPhone!, member.contractorId); }}
                  className="flex items-center gap-1 text-blue-400 cursor-pointer hover:underline"
                >
                  <Phone size={9} /> {member.cellPhone}
                  {copiedId === member.contractorId && <Check size={9} className="text-green-400" />}
                </span>
              )}
            </div>
          </div>

          <div
            className="grid grid-cols-5 gap-1 text-center bg-gray-900/40 p-1 rounded text-[10px] border border-gray-700/30 cursor-pointer"
            onClick={() => toggleItem(member.contractorId)}
          >
            <div><div className="text-gray-500 text-[8px] uppercase">Steps</div><div className="text-white font-bold">{member.stats.steps}</div></div>
            <div><div className="text-gray-500 text-[8px] uppercase">Pend</div><div className="text-yellow-400 font-bold">{member.stats.pending}</div></div>
            <div><div className="text-gray-500 text-[8px] uppercase">Up Gross</div><div className="text-green-400 font-bold">${member.stats.gross.toFixed(2)}</div></div>
            <div><div className="text-gray-500 text-[8px] uppercase">Upsell</div><div className="text-purple-400 font-bold">{member.stats.upsellCount}</div></div>
            <div><div className="text-gray-500 text-[8px] uppercase">EQ</div><div className="text-blue-300 font-bold">{member.stats.eq.toFixed(2)}</div></div>
          </div>
        </div>

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
                        <button onClick={() => setTransferModeId(null)}><X size={12} /></button>
                      </div>
                      <select
                        className="w-full bg-gray-900 border border-gray-600 text-white text-xs rounded p-1 outline-none"
                        value={selectedTransferManager}
                        onChange={(e) => setSelectedTransferManager(e.target.value)}
                      >
                        <option value="">Select...</option>
                        {allManagers.filter(m => m.userId !== managerId).map(m => (
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
            <div className="p-1 cursor-pointer" onClick={() => toggleItem(member.contractorId)}>
              {expandedItem === member.contractorId
                ? <ChevronUp size={14} className="text-gray-600" />
                : <ChevronDown size={14} className="text-gray-600" />
              }
            </div>
          )}
        </div>

        {expandedItem === member.contractorId && (
          <div className="mt-1 pt-1 border-t border-gray-700 px-2 pb-2">
            <ContractorJobs
              bookings={member.displayBookings}
              financialStore={member.financialStore}
              onRefresh={handleRefreshData}
              seasonType={seasonType}
            />
          </div>
        )}
      </div>
    );
  };

  const renderCartCard = (cart: CartDisplay) => {
    const isExpanded = expandedCarts.has(cart.sessionId);
    const isSoloCart = cart.members.length === 1;
    const primaryWorker = cart.members[0];

    return (
      <div
        key={cart.sessionId}
        className={`relative bg-gray-800 rounded-lg border hover:border-gray-600 transition-all shadow-sm ${
          isSoloCart ? 'border-gray-700' : 'border-green-900/50'
        }`}
      >
        <div className="p-2 pr-9">
          <div
            className="flex items-center justify-between mb-1 cursor-pointer"
            onClick={() => toggleCart(cart.sessionId)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  cart.aggregatedStats.pending > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
                }`}
              />
              {isSoloCart ? (
                <h3 className="font-bold text-white text-sm whitespace-nowrap">
                  {primaryWorker?.firstName} {primaryWorker?.lastName}
                </h3>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-900/30 border border-green-700/50">
                    <Truck size={12} className="text-green-400" />
                    <span className="text-green-300 text-xs font-bold">{cart.members.length}</span>
                  </div>
                  <h3 className="font-bold text-white text-sm whitespace-nowrap">
                    {cart.members.map(m => m.firstName).join(' & ')}
                  </h3>
                </div>
              )}
              <div className="flex flex-wrap gap-1 ml-2">
                {cart.assignedRoutes.length > 0 ? (
                  cart.assignedRoutes.slice(0, 3).map((route, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-indigo-900/60 text-indigo-200 border border-indigo-500/30 font-mono">
                      {route}
                    </span>
                  ))
                ) : (
                  <span className="text-[9px] text-gray-500 italic">No Rte</span>
                )}
                {cart.assignedRoutes.length > 3 && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-700 text-gray-400">
                    +{cart.assignedRoutes.length - 3}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div
            className="flex items-center gap-3 pl-4 mb-2 cursor-pointer flex-wrap"
            onClick={() => toggleCart(cart.sessionId)}
          >
            <div className="flex items-center gap-1 text-[10px] text-gray-400 truncate max-w-[40%]">
              <MapPin size={9} className={cart.lastActiveAddress ? "text-emerald-500" : "text-gray-600"} />
              {cart.lastActiveAddress ? (
                <span className="truncate">
                  {cart.lastActiveAddress}
                  {cart.lastActiveTime && <span className="text-gray-500"> • {cart.lastActiveTime}</span>}
                </span>
              ) : (
                <span className="opacity-50 italic">No history</span>
              )}
            </div>
            <span className="text-gray-700 text-[10px]">|</span>
            <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono flex-wrap">
              {cart.members.map((member, idx) => (
                <span key={member.contractorId} className="flex items-center gap-1">
                  <span>#{member.contractorId}</span>
                  {member.cellPhone && (
                    <span
                      onClick={(e) => { e.stopPropagation(); copyPhone(member.cellPhone!, member.contractorId); }}
                      className="flex items-center gap-1 text-blue-400 cursor-pointer hover:underline"
                    >
                      <Phone size={9} /> {member.cellPhone}
                      {copiedId === member.contractorId && <Check size={9} className="text-green-400" />}
                    </span>
                  )}
                  {idx < cart.members.length - 1 && <span className="text-gray-700 mx-1">•</span>}
                </span>
              ))}
            </div>
          </div>

          <div
            className="grid grid-cols-5 gap-1 text-center bg-gray-900/40 p-1 rounded text-[10px] border border-gray-700/30 cursor-pointer"
            onClick={() => toggleCart(cart.sessionId)}
          >
            <div><div className="text-gray-500 text-[8px] uppercase">Steps</div><div className="text-white font-bold">{cart.aggregatedStats.steps}</div></div>
            <div>
              <div className="text-gray-500 text-[8px] uppercase">Pend</div>
              <div className="font-bold flex items-center justify-center gap-1">
                <span className="text-green-400">{cart.aggregatedStats.pending}</span>
                {cart.aggregatedStats.pendingSaleCount > 0 && (
                  <>
                    <span className="text-gray-600 text-[9px]">+</span>
                    <span className="text-yellow-400 flex items-center gap-0.5">
                      <Bookmark size={8} />
                      {cart.aggregatedStats.pendingSaleCount}
                    </span>
                  </>
                )}
              </div>
            </div>
            <div><div className="text-gray-500 text-[8px] uppercase">Up Gross</div><div className="text-green-400 font-bold">${cart.aggregatedStats.upsellGross.toFixed(2)}</div></div>
            <div><div className="text-gray-500 text-[8px] uppercase">Upsell</div><div className="text-purple-400 font-bold">{cart.aggregatedStats.upsellCount}</div></div>
            <div><div className="text-gray-500 text-[8px] uppercase">EQ</div><div className="text-blue-300 font-bold">{cart.aggregatedStats.eq.toFixed(2)}</div></div>
          </div>
        </div>

        <div className="absolute top-2 right-1.5 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              const workersForCart = cart.members.map(m => ({ ...m } as Worker));
              handleViewLogsheet(primaryWorker, workersForCart);
            }}
            className="p-1 rounded hover:bg-gray-700 transition-colors text-cyan-400 hover:text-cyan-300"
            title={`View ${isSoloCart ? primaryWorker?.firstName + "'s" : 'cart'} logsheet`}
          >
            <Eye size={14} />
          </button>
          <div className="p-1 cursor-pointer" onClick={() => toggleCart(cart.sessionId)}>
            {isExpanded
              ? <ChevronUp size={14} className="text-gray-600" />
              : <ChevronDown size={14} className="text-gray-600" />
            }
          </div>
        </div>

        {isExpanded && (
          <div className="mt-1 pt-1 border-t border-gray-700 px-2 pb-2">
            <ContractorJobs
              bookings={cart.sharedBookings}
              financialStore={cart.sharedFinancialStore}
              onRefresh={handleRefreshData}
              seasonType={seasonType}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2 max-w-4xl mx-auto pb-10">
      {teamMembers.length > 0 && (
        <div className="flex justify-between items-center mb-4">
          {isTeamSeason && (
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 text-xs ${
                seasonType === 'sealing' ? 'text-slate-300' : 'text-green-400'
              }`}>
                {seasonType === 'sealing' ? <Shovel size={14} /> : <Leaf size={14} />}
                <span>{carts.length} cart{carts.length !== 1 ? 's' : ''} • {teamMembers.length} workers</span>
              </div>
              <button
                onClick={openReassignModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-900/30 hover:bg-orange-900/50 text-orange-300 border border-orange-700/50 text-xs font-bold transition-colors"
              >
                <ArrowRightLeft size={13} />
                Reassign Teams
              </button>
            </div>
          )}
          <div className={`flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-sm ${!isTeamSeason ? 'ml-auto' : ''}`}>
            <span className="text-xs text-gray-400 font-medium">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as TeamSortOption)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cps-blue cursor-pointer"
            >
              <option value="recent">Most Recent</option>
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

      {isTeamSeason && sortedCarts.map((cart) => renderCartCard(cart))}
      {!isTeamSeason && sortedTeamMembers.map((member) => renderWorkerCard(member))}

      {showReassignModal && isTeamSeason && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-xl border border-gray-700 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">

            <div className="p-4 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-orange-400" />
                <h3 className="text-lg font-bold text-white">Reassign Teams</h3>
                <span className="text-xs bg-orange-900/30 text-orange-400 border border-orange-700/50 px-2 py-0.5 rounded">
                  Transactions stay with original cart
                </span>
              </div>
              <button onClick={closeReassignModal} className="p-1.5 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            {reassignSuccess && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-green-900/30 border border-green-700/50 rounded-lg px-3 py-2 text-green-300 text-sm">
                <Check size={16} />{reassignSuccess}
              </div>
            )}
            {reassignError && (
              <div className="mx-4 mt-3 flex items-center gap-2 bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2 text-red-300 text-sm">
                <AlertCircle size={16} />{reassignError}
              </div>
            )}

            <div className="flex flex-1 overflow-hidden">

              <div className="w-1/2 border-r border-gray-700 flex flex-col">
                <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50 flex-shrink-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                    {selectedWorkerToMove ? '✓ Worker selected' : '1. Select worker to move'}
                  </p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {sortedCarts.map(cart => (
                    <div
                      key={cart.sessionId}
                      className={`rounded-lg border overflow-hidden ${
                        selectedWorkerCart?.sessionId === cart.sessionId
                          ? 'border-orange-600/50 bg-orange-900/10'
                          : 'border-gray-700 bg-gray-800/50'
                      }`}
                    >
                      <div className="px-3 py-1.5 bg-gray-800/80 border-b border-gray-700/50 flex items-center gap-2">
                        {cart.members.length > 1 ? (
                          <>
                            <Truck size={11} className="text-green-400" />
                            <span className="text-[10px] text-green-400 font-bold">Cart ({cart.members.length})</span>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-500 font-bold">Solo</span>
                        )}
                        <span className="text-[10px] text-gray-600 font-mono ml-auto">
                          {cart.aggregatedStats.eq.toFixed(1)} EQ
                        </span>
                      </div>
                      {cart.members.map(member => {
                        const isSelected = selectedWorkerToMove?.contractorId === member.contractorId;
                        return (
                          <button
                            key={member.contractorId}
                            onClick={() => selectWorkerToMove(member, cart)}
                            className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors text-sm ${
                              isSelected ? 'bg-orange-900/30 text-orange-200' : 'hover:bg-gray-700/50 text-gray-300'
                            }`}
                          >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                              isSelected ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300'
                            }`}>
                              {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{member.firstName} {member.lastName}</div>
                              <div className="text-[10px] text-gray-500 font-mono">#{member.contractorId}</div>
                            </div>
                            {isSelected && <Check size={14} className="text-orange-400 ml-auto flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="w-1/2 flex flex-col">
                <div className="px-4 py-2.5 border-b border-gray-700/50 bg-gray-800/50 flex-shrink-0">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">2. Move to...</p>
                </div>

                {!selectedWorkerToMove ? (
                  <div className="flex-1 flex items-center justify-center text-gray-600 text-sm italic p-4 text-center">
                    Select a worker on the left to see move options
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">

                    <div className="flex items-center gap-2 bg-orange-900/20 border border-orange-700/40 rounded-lg px-3 py-2">
                      <div className="w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
                        {selectedWorkerToMove.firstName.charAt(0)}{selectedWorkerToMove.lastName.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{selectedWorkerToMove.firstName} {selectedWorkerToMove.lastName}</div>
                        <div className="text-[10px] text-orange-400">
                          From: {selectedWorkerCart?.members.map(m => m.firstName).join(' & ')}
                        </div>
                      </div>
                    </div>

                    {sortedCarts.filter(c => c.sessionId !== selectedWorkerCart?.sessionId).length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Join existing cart</p>
                        <div className="space-y-1">
                          {sortedCarts
                            .filter(c => c.sessionId !== selectedWorkerCart?.sessionId)
                            .map(targetCart => {
                              const label = targetCart.members.map(m => m.firstName).join(' & ');
                              const newSize = targetCart.members.length + 1;
                              const newRate = newSize >= 2
                                ? `$${seasonConfig.payoutRateTeam}/EQ`
                                : `$${seasonConfig.payoutRateSolo}/EQ`;
                              return (
                                <button
                                  key={targetCart.sessionId}
                                  disabled={reassignLoading}
                                  onClick={() => handleReassignWorker({
                                    type: 'existing_cart',
                                    targetSessionId: targetCart.sessionId,
                                    label,
                                  })}
                                  className="w-full text-left px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-blue-500 rounded-lg transition-colors flex items-center justify-between gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {targetCart.members.length > 1
                                      ? <Truck size={14} className="text-green-400 flex-shrink-0" />
                                      : <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">{targetCart.members[0]?.firstName.charAt(0)}</div>
                                    }
                                    <div className="min-w-0">
                                      <div className="font-medium text-gray-200 truncate">{label}</div>
                                      <div className="text-[10px] text-gray-500">{targetCart.aggregatedStats.eq.toFixed(1)} EQ</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className="text-[10px] text-blue-400 bg-blue-900/30 border border-blue-700/50 px-1.5 py-0.5 rounded">→ {newRate}</span>
                                    {reassignLoading ? <Loader size={12} className="animate-spin text-gray-400" /> : <ArrowRight size={14} className="text-gray-500" />}
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Split off</p>
                      <button
                        disabled={reassignLoading || selectedWorkerCart?.members.length === 1}
                        onClick={() => handleReassignWorker({ type: 'new_solo' })}
                        className="w-full text-left px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-yellow-500 rounded-lg transition-colors flex items-center justify-between gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-2">
                          <UserPlus size={14} className="text-yellow-400 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-gray-200">Create solo cart</div>
                            <div className="text-[10px] text-gray-500">New cart, fresh start</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-yellow-400 bg-yellow-900/30 border border-yellow-700/50 px-1.5 py-0.5 rounded">${seasonConfig.payoutRateSolo}/EQ</span>
                          {reassignLoading ? <Loader size={12} className="animate-spin text-gray-400" /> : <ArrowRight size={14} className="text-gray-500" />}
                        </div>
                      </button>
                      {selectedWorkerCart?.members.length === 1 && (
                        <p className="text-[10px] text-gray-600 italic mt-1 pl-1">Already solo — join a cart instead</p>
                      )}
                    </div>

                    {otherManagers.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">Move to different manager</p>
                        <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 space-y-2">
                          <select
                            value={reassignManagerId}
                            onChange={(e) => setReassignManagerId(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select manager...</option>
                            {otherManagers.map(m => (
                              <option key={m.userId} value={m.userId}>{m.name}</option>
                            ))}
                          </select>
                          <button
                            disabled={reassignLoading || !reassignManagerId}
                            onClick={() => handleReassignWorker({ type: 'different_manager', targetManagerId: reassignManagerId })}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-bold transition-colors disabled:cursor-not-allowed"
                          >
                            {reassignLoading ? <Loader size={14} className="animate-spin" /> : <Shuffle size={14} />}
                            Transfer to Manager
                          </button>
                          <p className="text-[10px] text-gray-600 italic">Worker gets a new solo cart under the new manager</p>
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold mb-1.5">No-show</p>
                      <button
                        disabled={reassignLoading}
                        onClick={handleRemoveWorkerNoShow}
                        className="w-full text-left px-3 py-2.5 bg-gray-800 hover:bg-red-900/20 border border-gray-600 hover:border-red-700 rounded-lg transition-colors flex items-center justify-between gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-2">
                          <UserMinus size={14} className="text-red-400 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-red-300">Remove from session</div>
                            <div className="text-[10px] text-gray-500">Removes worker & stats entirely</div>
                          </div>
                        </div>
                        {reassignLoading
                          ? <Loader size={12} className="animate-spin text-gray-400" />
                          : <Trash2 size={14} className="text-red-500 flex-shrink-0" />
                        }
                      </button>
                    </div>

                  </div>
                )}
              </div>
            </div>

            <div className="p-3 border-t border-gray-700 flex justify-end flex-shrink-0">
              <button
                onClick={closeReassignModal}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RMTeamTab;
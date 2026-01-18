// src/pages/Management/components/RMTeamTab.tsx
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ChevronRight,
  Phone,
  Check,
  Clock,
  DollarSign,
  Award,
  AlertCircle,
  Users,
  Truck,
  Copy,
  Leaf,
} from 'lucide-react';
import { Worker, LogsheetSession, ManagementUser, SeasonType, TeamCart } from '../../../types';

interface RMTeamTabProps {
  managerId: string;
  workers: Worker[];
  allSessions: LogsheetSession[];
  allManagers: ManagementUser[];
  seasonType?: SeasonType;
}

type SortOption = 'alpha' | 'steps' | 'eq' | 'upsell';

const RMTeamTab: React.FC<RMTeamTabProps> = ({
  managerId,
  workers,
  allSessions,
  allManagers,
  seasonType = 'aeration',
}) => {
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState<SortOption>('alpha');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedCarts, setExpandedCarts] = useState<Set<string>>(new Set());

  const isLawnRejuv = seasonType === 'lawn_rejuv';

  // Filter to only this manager's workers
  const myWorkers = useMemo(() => {
    return workers.filter((w) => w.assignedManagerId === managerId);
  }, [workers, managerId]);

  // Create session lookup map
  const sessionMap = useMemo(() => {
    const map = new Map<string, LogsheetSession>();
    allSessions.forEach((s) => map.set(s.workerId, s));
    return map;
  }, [allSessions]);

  // Group workers into carts (for Lawn Rejuv)
  const teamCarts = useMemo(() => {
    if (!isLawnRejuv) return [];

    const cartMap = new Map<string, TeamCart>();

    myWorkers.forEach((worker) => {
      const teamId = worker.teamId || worker.contractorId;

      if (!cartMap.has(teamId)) {
        cartMap.set(teamId, {
          teamId,
          workerIds: [],
          workers: [],
        });
      }

      const cart = cartMap.get(teamId)!;
      cart.workerIds.push(worker.contractorId);
      cart.workers.push(worker);
    });

    return Array.from(cartMap.values());
  }, [myWorkers, isLawnRejuv]);

  // Calculate cart stats
  const cartStatsMap = useMemo(() => {
    const statsMap = new Map<
      string,
      {
        totalSteps: number;
        totalEQ: number;
        upsellCount: number;
        upsellGross: number;
        pendingJobs: number;
        completedJobs: number;
        hasLoggedIn: boolean;
      }
    >();

    teamCarts.forEach((cart) => {
      let totalSteps = 0;
      let totalEQ = 0;
      let upsellCount = 0;
      let upsellGross = 0;
      let pendingJobs = 0;
      let completedJobs = 0;
      let hasLoggedIn = false;

      cart.workerIds.forEach((workerId) => {
        const session = sessionMap.get(workerId);
        if (session) {
          hasLoggedIn = true;
          totalSteps += session.stats?.stepCount || 0;
          totalEQ += session.stats?.totalEQ || 0;
          upsellCount += session.stats?.upsellCount || 0;
          upsellGross += session.stats?.upsellGross || 0;
          pendingJobs += session.stats?.pendingJobCount || 0;
          completedJobs += session.stats?.completedJobCount || 0;
        }
      });

      statsMap.set(cart.teamId, {
        totalSteps,
        totalEQ,
        upsellCount,
        upsellGross,
        pendingJobs,
        completedJobs,
        hasLoggedIn,
      });
    });

    return statsMap;
  }, [teamCarts, sessionMap]);

  // Sort carts
  const sortedCarts = useMemo(() => {
    const carts = [...teamCarts];

    switch (sortBy) {
      case 'alpha':
        return carts.sort((a, b) => {
          const aName = a.workers[0]?.lastName || a.teamId;
          const bName = b.workers[0]?.lastName || b.teamId;
          return aName.localeCompare(bName);
        });
      case 'steps':
        return carts.sort((a, b) => {
          const aStats = cartStatsMap.get(a.teamId);
          const bStats = cartStatsMap.get(b.teamId);
          return (bStats?.totalSteps || 0) - (aStats?.totalSteps || 0);
        });
      case 'eq':
        return carts.sort((a, b) => {
          const aStats = cartStatsMap.get(a.teamId);
          const bStats = cartStatsMap.get(b.teamId);
          return (bStats?.totalEQ || 0) - (aStats?.totalEQ || 0);
        });
      case 'upsell':
        return carts.sort((a, b) => {
          const aStats = cartStatsMap.get(a.teamId);
          const bStats = cartStatsMap.get(b.teamId);
          return (bStats?.upsellGross || 0) - (aStats?.upsellGross || 0);
        });
      default:
        return carts;
    }
  }, [teamCarts, sortBy, cartStatsMap]);

  // Sort individual workers (for Aeration)
  const sortedWorkers = useMemo(() => {
    const workerList = [...myWorkers];

    switch (sortBy) {
      case 'alpha':
        return workerList.sort((a, b) => a.lastName.localeCompare(b.lastName));
      case 'steps':
        return workerList.sort((a, b) => {
          const aSession = sessionMap.get(a.contractorId);
          const bSession = sessionMap.get(b.contractorId);
          return (bSession?.stats?.stepCount || 0) - (aSession?.stats?.stepCount || 0);
        });
      case 'eq':
        return workerList.sort((a, b) => {
          const aSession = sessionMap.get(a.contractorId);
          const bSession = sessionMap.get(b.contractorId);
          return (bSession?.stats?.totalEQ || 0) - (aSession?.stats?.totalEQ || 0);
        });
      case 'upsell':
        return workerList.sort((a, b) => {
          const aSession = sessionMap.get(a.contractorId);
          const bSession = sessionMap.get(b.contractorId);
          return (bSession?.stats?.upsellGross || 0) - (aSession?.stats?.upsellGross || 0);
        });
      default:
        return workerList;
    }
  }, [myWorkers, sortBy, sessionMap]);

  const copyPhone = (phone: string, id: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const toggleCartExpand = (cartId: string) => {
    setExpandedCarts((prev) => {
      const next = new Set(prev);
      if (next.has(cartId)) {
        next.delete(cartId);
      } else {
        next.add(cartId);
      }
      return next;
    });
  };

  const navigateToWorker = (workerId: string) => {
    navigate(`/rm/contractor/${workerId}`);
  };

  // Empty state
  if (myWorkers.length === 0) {
    return (
      <div className="text-center text-gray-500 py-10 bg-gray-800/30 rounded-lg border border-gray-700/50">
        <Users size={48} className="mx-auto mb-2 opacity-20" />
        <p>No workers assigned to your team.</p>
        <p className="text-sm">Workers will appear here once assigned.</p>
      </div>
    );
  }

  // --- LAWN REJUV: Cart/Team View ---
  if (isLawnRejuv) {
    return (
      <div className="space-y-3 max-w-4xl mx-auto pb-10">
        {/* Header with Sort */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2 text-xs text-green-400">
            <Leaf size={14} />
            <span>
              {teamCarts.length} team{teamCarts.length !== 1 ? 's' : ''} • {myWorkers.length} workers
            </span>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-sm">
            <span className="text-xs text-gray-400 font-medium">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500 cursor-pointer"
            >
              <option value="alpha">By Name</option>
              <option value="steps">By Steps</option>
              <option value="eq">By EQ</option>
              <option value="upsell">By Upsells</option>
            </select>
          </div>
        </div>

        {/* Cart Cards */}
        {sortedCarts.map((cart) => {
          const stats = cartStatsMap.get(cart.teamId);
          const isSoloCart = cart.workerIds.length === 1;
          const isExpanded = expandedCarts.has(cart.teamId);
          const primaryWorker = cart.workers[0];

          return (
            <div
              key={cart.teamId}
              className={`rounded-lg border overflow-hidden transition-all ${
                isSoloCart
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-gray-800 border-green-900/50'
              } ${!stats?.hasLoggedIn ? 'opacity-60' : ''}`}
            >
              {/* Cart Header */}
              <div
                className="p-3 cursor-pointer hover:bg-gray-700/30 transition-colors"
                onClick={() => toggleCartExpand(cart.teamId)}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Left: Cart Icon + Info */}
                  <div className="flex items-center gap-3">
                    {/* Cart Badge */}
                    <div
                      className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                        isSoloCart
                          ? stats?.hasLoggedIn
                            ? 'bg-cps-blue text-white'
                            : 'bg-gray-700 text-gray-400'
                          : stats?.hasLoggedIn
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
                          <span className="text-[9px] font-bold mt-0.5">{cart.workerIds.length}</span>
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
                          <span className="text-green-300">Team: {cart.teamId}</span>
                        )}
                        {!stats?.hasLoggedIn && (
                          <span className="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                            Not Logged In
                          </span>
                        )}
                      </div>

                      {/* Member names for team carts */}
                      {!isSoloCart && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {cart.workers.map((w) => `${w.firstName} ${w.lastName[0]}.`).join(', ')}
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

                  {/* Right: Stats */}
                  <div className="flex items-center gap-3">
                    {/* Stats Pills */}
                    <div className="hidden sm:flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-300">
                        <Activity size={10} className="text-green-400" />
                        {stats?.totalSteps || 0}
                      </span>
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-blue-300">
                        {(stats?.totalEQ || 0).toFixed(1)} EQ
                      </span>
                      {(stats?.upsellCount || 0) > 0 && (
                        <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-900/30 text-purple-300 border border-purple-700/50">
                          <DollarSign size={10} />
                          {stats?.upsellCount}
                        </span>
                      )}
                    </div>

                    <ChevronRight
                      className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      size={18}
                    />
                  </div>
                </div>

                {/* Mobile Stats Row */}
                <div className="sm:hidden flex items-center gap-2 mt-2 text-xs">
                  <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-300">
                    <Activity size={10} className="text-green-400" />
                    {stats?.totalSteps || 0}
                  </span>
                  <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-blue-300">
                    {(stats?.totalEQ || 0).toFixed(1)} EQ
                  </span>
                  {(stats?.upsellCount || 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-900/30 text-purple-300">
                      ${(stats?.upsellGross || 0).toFixed(0)}
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-gray-700 bg-gray-900/30 p-3 space-y-3 animate-slide-down">
                  {/* Detailed Stats */}
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-gray-800 p-2 rounded border border-gray-700">
                      <div className="text-gray-500 text-[9px] uppercase mb-1">Steps</div>
                      <div className="font-bold text-white">{stats?.totalSteps || 0}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded border border-gray-700">
                      <div className="text-gray-500 text-[9px] uppercase mb-1">Total EQ</div>
                      <div className="font-bold text-blue-300">{(stats?.totalEQ || 0).toFixed(2)}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded border border-gray-700">
                      <div className="text-gray-500 text-[9px] uppercase mb-1">Upsells</div>
                      <div className="font-bold text-purple-300">{stats?.upsellCount || 0}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded border border-gray-700">
                      <div className="text-gray-500 text-[9px] uppercase mb-1">Up Gross</div>
                      <div className="font-bold text-green-400">
                        ${(stats?.upsellGross || 0).toFixed(0)}
                      </div>
                    </div>
                  </div>

                  {/* Team Members List (Stacked Vertically) */}
                  <div>
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase mb-2">
                      {isSoloCart ? 'Worker Info' : 'Team Members'}
                    </h4>
                    <div className="space-y-2">
                      {cart.workers.map((worker, idx) => {
                        const workerSession = sessionMap.get(worker.contractorId);

                        return (
                          <div
                            key={worker.contractorId}
                            className="bg-gray-800 p-3 rounded border border-gray-700 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              {/* Avatar */}
                              <div
                                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                                  idx === 0
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-600 text-gray-300'
                                }`}
                              >
                                {worker.firstName[0]}
                                {worker.lastName[0]}
                              </div>

                              {/* Name & Info */}
                              <div>
                                <div className="text-sm font-medium text-white flex items-center gap-2">
                                  {worker.firstName} {worker.lastName}
                                  {idx === 0 && !isSoloCart && (
                                    <span className="text-[9px] text-green-400">(Lead)</span>
                                  )}
                                </div>
                                <div className="text-[10px] text-gray-500 font-mono">
                                  #{worker.contractorId}
                                  {workerSession && (
                                    <span className="ml-2 text-gray-400">
                                      • {workerSession.stats?.stepCount || 0} steps
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Phone + View Button */}
                            <div className="flex items-center gap-2">
                              {worker.cellPhone && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyPhone(worker.cellPhone!, worker.contractorId);
                                  }}
                                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded hover:bg-gray-700"
                                >
                                  <Phone size={12} />
                                  <span className="font-mono hidden sm:inline">{worker.cellPhone}</span>
                                  {copiedId === worker.contractorId ? (
                                    <Check size={12} className="text-green-400" />
                                  ) : (
                                    <Copy size={10} className="sm:hidden" />
                                  )}
                                </button>
                              )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigateToWorker(worker.contractorId);
                                }}
                                className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Job Progress */}
                  <div className="flex items-center justify-between text-xs bg-gray-800 p-2 rounded border border-gray-700">
                    <span className="text-gray-400">Job Progress</span>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 flex items-center gap-1">
                        <Check size={10} /> {stats?.completedJobs || 0} done
                      </span>
                      <span className="text-gray-600">•</span>
                      <span className="text-yellow-400 flex items-center gap-1">
                        <Clock size={10} /> {stats?.pendingJobs || 0} pending
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // --- AERATION: Individual Worker View ---
  return (
    <div className="space-y-3 max-w-4xl mx-auto pb-10">
      {/* Header with Sort */}
      <div className="flex justify-between items-center mb-4">
        <div className="text-xs text-gray-400">{myWorkers.length} workers</div>
        <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-sm">
          <span className="text-xs text-gray-400 font-medium">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cps-blue cursor-pointer"
          >
            <option value="alpha">By Name</option>
            <option value="steps">By Steps</option>
            <option value="eq">By EQ</option>
            <option value="upsell">By Upsells</option>
          </select>
        </div>
      </div>

      {/* Worker Cards */}
      {sortedWorkers.map((worker) => {
        const session = sessionMap.get(worker.contractorId);
        const hasLoggedIn = !!session;

        return (
          <div
            key={worker.contractorId}
            onClick={() => navigateToWorker(worker.contractorId)}
            className={`rounded-lg border p-3 cursor-pointer transition-all hover:border-gray-600 ${
              hasLoggedIn
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-800/50 border-gray-700/50 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              {/* Left: Avatar + Info */}
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center text-sm font-bold ${
                    hasLoggedIn ? 'bg-cps-blue text-white' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {worker.firstName[0]}
                  {worker.lastName[0]}
                </div>

                <div>
                  <div className="font-bold text-white text-sm flex items-center gap-2">
                    {worker.firstName} {worker.lastName}
                    {!hasLoggedIn && (
                      <span className="text-[9px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                        Not Logged In
                      </span>
                    )}
                    {session?.stats?.silverStar && (
                      <Award size={14} className="text-gray-400" title="Silver Star" />
                    )}
                    {session?.stats?.goldStar && (
                      <Award size={14} className="text-yellow-400" title="Gold Star" />
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono">#{worker.contractorId}</div>
                </div>
              </div>

              {/* Right: Stats */}
              <div className="flex items-center gap-3">
                {hasLoggedIn && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-gray-300">
                      <Activity size={10} className="text-green-400" />
                      {session.stats?.stepCount || 0}
                    </span>
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-gray-700 text-blue-300">
                      {(session.stats?.totalEQ || 0).toFixed(1)} EQ
                    </span>
                    {(session.stats?.upsellCount || 0) > 0 && (
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-purple-900/30 text-purple-300 border border-purple-700/50">
                        <DollarSign size={10} />
                        {session.stats?.upsellCount}
                      </span>
                    )}
                  </div>
                )}

                <ChevronRight className="text-gray-400" size={18} />
              </div>
            </div>

            {/* Phone Row (Mobile) */}
            {worker.cellPhone && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyPhone(worker.cellPhone!, worker.contractorId);
                  }}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <Phone size={12} />
                  <span className="font-mono">{worker.cellPhone}</span>
                  {copiedId === worker.contractorId && (
                    <Check size={12} className="text-green-400" />
                  )}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default RMTeamTab;
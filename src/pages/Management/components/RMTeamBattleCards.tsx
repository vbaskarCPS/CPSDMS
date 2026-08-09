// src/pages/Management/components/RMTeamBattleCards.tsx
//
// COMPETITIVE TEAM CARDS — RM Logbook top-row strip (v2).
//
// Lives in the header's TOP ROW, replacing the manager-name/season cluster so
// the header gains NO extra height. One compact card per OTHER manager in the
// CC who has workers assigned (the logged-in manager's own team is excluded —
// the stats bar below already covers it). Ranked by completed gross
// (descending, ties broken by steps); the leader wears the trophy.
//
// Card format — no labels, colours carry the meaning (mirrors the stats bar):
//   white  = completed steps
//   green  = pending prebooks
//   yellow = pending (parked) sales
//   white $ = completed gross · yellow +$ = pending gross
//
// Pending gross = office pending dollars + parked-sale dollars, using the same
// flat-code-aware price parser as the header's Pending $ stat.
//
// Clicking a card opens a team overview modal: one row per cart (worker names,
// steps, sales done+pending, gross $, EQ) with a totals footer. No job-level
// detail by design.

import React, { useMemo, useState } from 'react';
import {
  X, Trophy, Users, Activity, CheckCircle2, DollarSign, Clock, Bookmark,
} from 'lucide-react';
import {
  ManagementUser,
  Worker,
  RouteData,
  MasterBooking,
  LogsheetSession,
  PendingSale,
  SeasonType,
  SEASON_CONFIGS,
} from '../../../types';

// Same parser the RM Logbook header uses for Pending $ — office flat codes
// (SP/RJ/FSL...) resolve to their configured dollar value, anything else is
// parsed numerically, blanks are $0.
function pendingDollarValue(priceStr: string | undefined | null, seasonType: SeasonType): number {
  if (!priceStr) return 0;
  const trimmed = priceStr.trim();
  if (!trimmed) return 0;

  if (/^[A-Za-z]+$/.test(trimmed)) {
    const upper = trimmed.toUpperCase();
    const flat = SEASON_CONFIGS[seasonType].officeFlats.find(f => f.code === upper);
    return flat ? flat.value : 0;
  }

  const numeric = trimmed.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(numeric);
  return isNaN(parsed) ? 0 : parsed;
}

interface CartOverviewRow {
  sessionId: string;
  workerNames: string;
  steps: number;
  salesDone: number;
  salesPending: number;
  gross: number;
  eq: number;
}

interface TeamCardData {
  managerId: string;
  firstName: string;
  fullName: string;
  workerCount: number;
  steps: number;
  pendingPrebooks: number;
  pendingSales: number;
  salesDone: number;
  completedGross: number;
  pendingGross: number;
  carts: CartOverviewRow[];
  totalEQ: number;
}

interface RMTeamBattleCardsProps {
  managers: ManagementUser[];
  workers: Worker[];
  routes: RouteData[];
  pendingBookings: MasterBooking[];
  allSessions: LogsheetSession[];
  allPendingSales: PendingSale[];
  // The logged-in manager — their own team is EXCLUDED from the strip.
  currentManagerId: string;
  seasonType: SeasonType;
}

const RMTeamBattleCards: React.FC<RMTeamBattleCardsProps> = ({
  managers,
  workers,
  routes,
  pendingBookings,
  allSessions,
  allPendingSales,
  currentManagerId,
  seasonType,
}) => {
  // managerId of the team whose overview modal is open, or null.
  const [openId, setOpenId] = useState<string | null>(null);

  const teams = useMemo<TeamCardData[]>(() => {
    const workerName = new Map(
      workers.map(w => [w.contractorId, `${w.firstName} ${w.lastName}`.trim()])
    );
    // Pending sales indexed by owning session (cart): count + dollar value.
    const pendingCountBySession = new Map<string, number>();
    const pendingDollarsBySession = new Map<string, number>();
    allPendingSales.forEach(ps => {
      pendingCountBySession.set(ps.sessionId, (pendingCountBySession.get(ps.sessionId) || 0) + 1);
      pendingDollarsBySession.set(
        ps.sessionId,
        (pendingDollarsBySession.get(ps.sessionId) || 0) + pendingDollarValue(ps.price, seasonType)
      );
    });

    const result: TeamCardData[] = [];

    for (const m of managers) {
      if (m.userId === currentManagerId) continue; // own team excluded
      const teamWorkers = workers.filter(w => w.assignedManagerId === m.userId);
      if (teamWorkers.length === 0) continue; // only managers with workers get a card

      const idSet = new Set(teamWorkers.map(w => w.contractorId));
      const myRouteCodes = new Set(
        routes.filter(r => r.managerId === m.userId).map(r => r.routeCode)
      );

      const mySessions = allSessions.filter(s => {
        const ids = (s.teamWorkerIds && s.teamWorkerIds.length > 0)
          ? s.teamWorkerIds
          : [s.workerId];
        return ids.some(id => idSet.has(id));
      });

      let steps = 0;
      let salesDone = 0;
      let pendingSalesCount = 0;
      let pendingSalesDollars = 0;
      let gross = 0;
      let eq = 0;
      const carts: CartOverviewRow[] = [];
      const seenSession = new Set<string>();

      for (const s of mySessions) {
        if (seenSession.has(s.id)) continue;
        seenSession.add(s.id);
        const ids = (s.teamWorkerIds && s.teamWorkerIds.length > 0)
          ? s.teamWorkerIds
          : [s.workerId];

        const cartSteps = s.stats?.stepCount || 0;
        // "Completed job" = Production or Sale transaction. Upgrades/Add-Ons
        // are upsells on an existing job, not sales of their own.
        const cartSalesDone = (s.financialStore || []).filter(
          tx => tx.type === 'Production' || tx.type === 'Sale'
        ).length;
        const cartSalesPending = pendingCountBySession.get(s.id) || 0;
        const cartGross = s.stats?.prodGross || 0;
        const cartEQ = s.stats?.totalEQ || 0;

        steps += cartSteps;
        salesDone += cartSalesDone;
        pendingSalesCount += cartSalesPending;
        pendingSalesDollars += pendingDollarsBySession.get(s.id) || 0;
        gross += cartGross;
        eq += cartEQ;

        carts.push({
          sessionId: s.id,
          workerNames: ids.map(id => workerName.get(id) || id).join(', '),
          steps: cartSteps,
          salesDone: cartSalesDone,
          salesPending: cartSalesPending,
          gross: cartGross,
          eq: cartEQ,
        });
      }

      // Pending prebooks attributable to this manager — mirrors the header
      // Pending stat: assigned to one of my workers, OR on one of my routes
      // and unassigned. Dollar values feed pending gross alongside the
      // parked-sale dollars.
      let pendingPrebooks = 0;
      let officePendingDollars = 0;
      for (const b of pendingBookings) {
        if (b.Completed || (b.Status && b.Status !== 'pending')) continue;
        const assignedToMine =
          b['Contractor Number'] && idSet.has(b['Contractor Number']);
        const onMyRouteUnassigned =
          b['Route Number'] && myRouteCodes.has(b['Route Number']) && !b['Contractor Number'];
        if (assignedToMine || onMyRouteUnassigned) {
          pendingPrebooks++;
          officePendingDollars += pendingDollarValue(b.Price, seasonType);
        }
      }

      carts.sort((a, b) => b.gross - a.gross);

      result.push({
        managerId: m.userId,
        firstName: (m.name || '').trim().split(/\s+/)[0] || m.name,
        fullName: m.name,
        workerCount: teamWorkers.length,
        steps,
        pendingPrebooks,
        pendingSales: pendingSalesCount,
        salesDone,
        completedGross: gross,
        pendingGross: officePendingDollars + pendingSalesDollars,
        carts,
        totalEQ: eq,
      });
    }

    // Competitive ranking: completed gross descending, ties broken by steps.
    result.sort((a, b) => (b.completedGross - a.completedGross) || (b.steps - a.steps));
    return result;
  }, [managers, workers, routes, pendingBookings, allSessions, allPendingSales, currentManagerId, seasonType]);

  // Resolve the open team from live data so the modal stays fresh across
  // the logbook's realtime refreshes.
  const openTeam = openId ? teams.find(t => t.managerId === openId) || null : null;

  if (teams.length === 0) return null;

  return (
    <>
      {/* ── CARD STRIP — single row, horizontally scrollable if crowded ── */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
        {teams.map((t, idx) => (
          <button
            key={t.managerId}
            onClick={() => setOpenId(t.managerId)}
            className="flex-shrink-0 text-left bg-gray-900/60 hover:bg-gray-700/60 border border-gray-700 rounded-lg px-2 py-0.5 transition-colors"
            title={`${t.fullName} — ${t.workerCount} worker${t.workerCount === 1 ? '' : 's'} · steps / pending prebooks + pending sales / gross + pending $ · tap for overview`}
          >
            <div className="flex items-center gap-1 leading-tight">
              <span className="text-[9px] font-bold text-gray-300 truncate max-w-[80px]">
                Team {t.firstName}
              </span>
              {idx === 0 && <Trophy size={9} className="text-yellow-400 flex-shrink-0" />}
            </div>
            <div className="flex items-center gap-1 text-[11px] font-bold leading-tight whitespace-nowrap">
              <span className="text-white">{t.steps}</span>
              <span className="text-gray-600">·</span>
              <span className="text-green-400">{t.pendingPrebooks}</span>
              <span className="text-gray-500 text-[9px]">+</span>
              <span className="text-yellow-400">{t.pendingSales}</span>
              <span className="text-gray-600">·</span>
              <span className="text-white">${t.completedGross.toFixed(0)}</span>
              <span className="text-yellow-400 text-[10px]">+${t.pendingGross.toFixed(0)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ── TEAM OVERVIEW MODAL ── */}
      {openTeam && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setOpenId(null)}
        >
          <div
            className="bg-gray-800 rounded-lg w-full max-w-lg border border-gray-700 shadow-xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <div className="flex items-center gap-2 min-w-0">
                <Users size={18} className="text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">Team {openTeam.firstName}</h3>
                  <p className="text-[11px] text-gray-400 truncate">
                    {openTeam.fullName} · {openTeam.workerCount} worker{openTeam.workerCount === 1 ? '' : 's'} · {openTeam.carts.length} cart{openTeam.carts.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <button onClick={() => setOpenId(null)} className="text-gray-400 hover:text-white flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            <div className="p-3 space-y-2 overflow-y-auto custom-scrollbar">
              {openTeam.carts.length === 0 ? (
                <div className="text-xs text-gray-500 text-center py-6">
                  No carts have opened a logsheet session yet.
                </div>
              ) : (
                openTeam.carts.map(cart => (
                  <div
                    key={cart.sessionId}
                    className="bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2"
                  >
                    <div className="text-xs font-bold text-white truncate mb-1.5">
                      {cart.workerNames || '—'}
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center">
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                          <Activity size={8} /> Steps
                        </div>
                        <div className="text-sm font-bold text-white">{cart.steps}</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                          <CheckCircle2 size={8} /> Sales
                        </div>
                        <div className="text-sm font-bold text-green-400">
                          {cart.salesDone}
                          {cart.salesPending > 0 && (
                            <span className="text-yellow-400 text-xs">+{cart.salesPending}</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                          <DollarSign size={8} /> Gross
                        </div>
                        <div className="text-sm font-bold text-white">${cart.gross.toFixed(0)}</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">EQ</div>
                        <div className="text-sm font-bold text-purple-300">{cart.eq.toFixed(1)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-gray-700 bg-gray-900/40 rounded-b-lg">
              <div className="grid grid-cols-5 gap-1 text-center">
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                    <Activity size={8} /> Steps
                  </div>
                  <div className="text-sm font-bold text-white">{openTeam.steps}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                    <Clock size={8} /> Prebk
                  </div>
                  <div className="text-sm font-bold text-green-400">{openTeam.pendingPrebooks}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                    <Bookmark size={8} /> Pend
                  </div>
                  <div className="text-sm font-bold text-yellow-400">{openTeam.pendingSales}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Gross</div>
                  <div className="text-sm font-bold text-white">${openTeam.completedGross.toFixed(0)}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Pend $</div>
                  <div className="text-sm font-bold text-yellow-400">${openTeam.pendingGross.toFixed(0)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RMTeamBattleCards;
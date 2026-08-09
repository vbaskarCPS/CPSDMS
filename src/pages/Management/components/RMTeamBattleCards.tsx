// src/pages/Management/components/RMTeamBattleCards.tsx
//
// COMPETITIVE TEAM CARDS — RM Logbook header strip.
//
// One card per manager in the CC who has workers assigned in the session,
// ranked by completed sales (descending, ties broken by steps). Renders on
// BOTH digital-mapping and non-mapping CCs, every season.
//
// Card stats (4-up, small type so four cards fit across):
//   STEPS — team total stepCount
//   PREBK — pending prebooks attributable to the manager (assigned to one of
//           their workers, OR on one of their routes and unassigned — same
//           logic as the header Pending stat)
//   PEND  — parked pending_sales rows across the manager's carts (counts every
//           row, including asphalt children — consistent with the header stat)
//   SALES — completed jobs + pending, rendered "7+3". "Completed job" =
//           Production or Sale transaction (upsell rows are NOT sales).
//
// Clicking a card opens a team overview modal: one row per cart (worker names,
// steps, sales done+pending, gross $, EQ) with a totals footer. No job-level
// detail by design.
//
// Data comes entirely from props the RM Logbook already holds (dailyData +
// allSessions) plus the CC-wide pending sales list (getAllPendingSalesForToday).
// Refresh cadence is therefore the logbook's own realtime/30s cycle.

import React, { useMemo, useState } from 'react';
import {
  X, Trophy, Users, Activity, Clock, Bookmark, CheckCircle2, DollarSign,
} from 'lucide-react';
import {
  ManagementUser,
  Worker,
  RouteData,
  MasterBooking,
  LogsheetSession,
  PendingSale,
} from '../../../types';

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
  carts: CartOverviewRow[];
  totalGross: number;
  totalEQ: number;
}

interface RMTeamBattleCardsProps {
  managers: ManagementUser[];
  workers: Worker[];
  routes: RouteData[];
  pendingBookings: MasterBooking[];
  allSessions: LogsheetSession[];
  allPendingSales: PendingSale[];
  currentManagerId: string;
}

const RMTeamBattleCards: React.FC<RMTeamBattleCardsProps> = ({
  managers,
  workers,
  routes,
  pendingBookings,
  allSessions,
  allPendingSales,
  currentManagerId,
}) => {
  // managerId of the team whose overview modal is open, or null.
  const [openId, setOpenId] = useState<string | null>(null);

  const teams = useMemo<TeamCardData[]>(() => {
    const workerName = new Map(
      workers.map(w => [w.contractorId, `${w.firstName} ${w.lastName}`.trim()])
    );
    // Pending sales indexed by owning session (cart).
    const pendingBySession = new Map<string, number>();
    allPendingSales.forEach(ps => {
      pendingBySession.set(ps.sessionId, (pendingBySession.get(ps.sessionId) || 0) + 1);
    });

    const result: TeamCardData[] = [];

    for (const m of managers) {
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
        const cartSalesPending = pendingBySession.get(s.id) || 0;
        const cartGross = s.stats?.prodGross || 0;
        const cartEQ = s.stats?.totalEQ || 0;

        steps += cartSteps;
        salesDone += cartSalesDone;
        pendingSalesCount += cartSalesPending;
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
      // and unassigned.
      const pendingPrebooks = pendingBookings.filter(b => {
        if (b.Completed || (b.Status && b.Status !== 'pending')) return false;
        const assignedToMine =
          b['Contractor Number'] && idSet.has(b['Contractor Number']);
        const onMyRouteUnassigned =
          b['Route Number'] && myRouteCodes.has(b['Route Number']) && !b['Contractor Number'];
        return assignedToMine || onMyRouteUnassigned;
      }).length;

      carts.sort((a, b) => b.salesDone - a.salesDone);

      result.push({
        managerId: m.userId,
        firstName: (m.name || '').trim().split(/\s+/)[0] || m.name,
        fullName: m.name,
        workerCount: teamWorkers.length,
        steps,
        pendingPrebooks,
        pendingSales: pendingSalesCount,
        salesDone,
        carts,
        totalGross: gross,
        totalEQ: eq,
      });
    }

    // Competitive ranking: sales descending, ties broken by steps.
    result.sort((a, b) => (b.salesDone - a.salesDone) || (b.steps - a.steps));
    return result;
  }, [managers, workers, routes, pendingBookings, allSessions, allPendingSales]);

  // Resolve the open team from live data so the modal stays fresh across
  // the logbook's realtime refreshes.
  const openTeam = openId ? teams.find(t => t.managerId === openId) || null : null;

  if (teams.length === 0) return null;

  return (
    <>
      {/* ── CARD STRIP ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 px-2 pb-2 pt-1.5 border-t border-gray-700">
        {teams.map((t, idx) => (
          <button
            key={t.managerId}
            onClick={() => setOpenId(t.managerId)}
            className={`text-left bg-gray-900/60 hover:bg-gray-700/60 border rounded-lg px-2 py-1.5 transition-colors ${
              t.managerId === currentManagerId
                ? 'border-blue-500/70'
                : 'border-gray-700'
            }`}
            title={`${t.fullName} — ${t.workerCount} worker${t.workerCount === 1 ? '' : 's'} · tap for team overview`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-white truncate">
                Team {t.firstName}
              </span>
              {idx === 0 ? (
                <Trophy size={11} className="text-yellow-400 flex-shrink-0" />
              ) : (
                <span className="text-[9px] text-gray-500 font-bold flex-shrink-0">#{idx + 1}</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-0.5 text-center">
              <div>
                <div className="text-[7px] uppercase tracking-wider text-gray-500 font-bold">Steps</div>
                <div className="text-[11px] font-bold text-blue-300">{t.steps}</div>
              </div>
              <div>
                <div className="text-[7px] uppercase tracking-wider text-gray-500 font-bold">Prebk</div>
                <div className="text-[11px] font-bold text-yellow-400">{t.pendingPrebooks}</div>
              </div>
              <div>
                <div className="text-[7px] uppercase tracking-wider text-gray-500 font-bold">Pend</div>
                <div className="text-[11px] font-bold text-amber-400">{t.pendingSales}</div>
              </div>
              <div>
                <div className="text-[7px] uppercase tracking-wider text-gray-500 font-bold">Sales</div>
                <div className="text-[11px] font-bold text-green-400 whitespace-nowrap">
                  {t.salesDone}
                  {t.pendingSales > 0 && (
                    <span className="text-amber-400">+{t.pendingSales}</span>
                  )}
                </div>
              </div>
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
                        <div className="text-sm font-bold text-blue-300">{cart.steps}</div>
                      </div>
                      <div>
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                          <CheckCircle2 size={8} /> Sales
                        </div>
                        <div className="text-sm font-bold text-green-400">
                          {cart.salesDone}
                          {cart.salesPending > 0 && (
                            <span className="text-amber-400 text-xs">+{cart.salesPending}</span>
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
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Steps</div>
                  <div className="text-sm font-bold text-blue-300">{openTeam.steps}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                    <Clock size={8} /> Prebk
                  </div>
                  <div className="text-sm font-bold text-yellow-400">{openTeam.pendingPrebooks}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold flex items-center justify-center gap-0.5">
                    <Bookmark size={8} /> Pend
                  </div>
                  <div className="text-sm font-bold text-amber-400">{openTeam.pendingSales}</div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Sales</div>
                  <div className="text-sm font-bold text-green-400">
                    {openTeam.salesDone}
                    {openTeam.pendingSales > 0 && (
                      <span className="text-amber-400 text-xs">+{openTeam.pendingSales}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Gross</div>
                  <div className="text-sm font-bold text-white">${openTeam.totalGross.toFixed(0)}</div>
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
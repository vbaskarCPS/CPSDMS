// src/components/RMAsphaltModal.tsx
//
// RM-facing modal for managing the queue of UNASSIGNED asphalt children
// produced by the sealing season's Ramp Crew + Asphalt workflow.
//
// Background:
//   When a non-RC cart sells a sealing job with an asphalt add-on, the
//   asphalt portion is parked as a `pending_sales` row with sale_type='asphalt'
//   and assigned_rc_session_id=NULL. This can happen via two paths:
//     - Worker hits "Save Pending" in QuickPendingModal with asphalt toggled on
//       (the createPendingSale orchestrator writes parent + child atomically).
//     - Worker completes a sale at NewJob/JobDetail with asphalt toggled on
//       and is NOT a Ramp Crew (Path 3 driveway-deferred mode — cart's tx is
//       written and a child pending row is created with shared_job_key set).
//
//   Either way, the child row lands UNASSIGNED in the RM's queue until the RM
//   picks an RC and assigns it. Once assigned, the row stops appearing here
//   and starts appearing on the RC's logsheet (via getAsphaltAssignmentsForSession).
//
// Scope:
//   This file is unassigned-only. Unassigning a previously-assigned asphalt
//   row is handled elsewhere (cart cards in RMTeamTab, delivery #16).
//
// Service contract:
//   - sessionService.getUnassignedAsphaltForManager(managerId)
//       → PendingSale[]  (filtered to this RM's team, sale_type='asphalt', unassigned)
//   - sessionService.assignAsphaltToRcSession(id, rcSessionId)  → void
//   - sessionService.getDailySession()
//       → workers + teamCarts (we read workers for assigned-manager + teamId)
//   - sessionService.getLogsheetSessions()
//       → all LogsheetSession[] for the day (we read team_worker_ids to map RC workers → sessions)

import React, { useEffect, useMemo, useState } from 'react';
import { X, Shovel, Loader, AlertCircle, CheckCircle, Users, MapPin, RefreshCw } from 'lucide-react';
import { sessionService } from '../lib/sessionService';
import {
  PendingSale,
  LogsheetSession,
  Worker as WorkerType,
  RAMP_CREW_TEAM_ID_PATTERN,
} from '../types';

interface RMAsphaltModalProps {
  managerId: string;
  managerName?: string;
  onClose: () => void;
  // Optional callback fired after at least one successful assign, so the
  // parent (RMLogbook) can refresh its asphalt count badge.
  onAssignmentChange?: () => void;
}

// --- HELPER: case-sensitive RC detection. Same pattern used in NewJob/JobDetail. ---
function isRC(teamId: string | undefined | null): boolean {
  if (!teamId) return false;
  return RAMP_CREW_TEAM_ID_PATTERN.test(teamId);
}

// --- HELPER: format an asphalt $ amount as a compact dollar string. ---
function formatDollars(n: number | undefined | null): string {
  if (!n || n <= 0) return '$0';
  const rounded = Math.round(n * 100) / 100;
  if (rounded === Math.floor(rounded)) return `$${Math.floor(rounded)}`;
  return `$${rounded.toFixed(2)}`;
}

// --- HELPER: assemble an address for a pending sale ---
// PendingSale stores houseNumber + streetName separately. Rebuild as one line
// for display; fall back to whichever is present, or a placeholder.
function assembleAddress(ps: PendingSale): string {
  const hn = (ps.houseNumber || '').trim();
  const sn = (ps.streetName || '').trim();
  if (hn && sn) return `${hn} ${sn}`;
  if (hn) return hn;
  if (sn) return sn;
  return '— address pending —';
}

// --- TYPE: a derived "assignable RC session" the dropdown displays ---
// Built from cross-referencing workers (with teamId) against logsheet sessions.
// We deduplicate by sessionId so a 2-worker RC cart shows up once.
interface AssignableRcSession {
  sessionId: string;
  teamId: string;          // e.g. "RC1" — used for sort + display prefix
  workerNames: string[];   // ordered first-last names for "John D., Jane S."
}

// --- HELPER: format an RC session for the assign dropdown ---
// Renders "RC1 · John D., Jane S." — short, scannable.
function formatRcSessionLabel(rc: AssignableRcSession): string {
  const namesPart = rc.workerNames.length > 0 ? rc.workerNames.join(', ') : '(no workers)';
  return `${rc.teamId} · ${namesPart}`;
}

// --- HELPER: format a worker's display name as "First L." ---
// Used in two places: the originating-cart attribution on each row, and the
// names list inside an RC session's dropdown label.
function shortName(first: string, last: string): string {
  const f = (first || '').trim();
  const l = (last || '').trim();
  if (!f && !l) return '(unknown)';
  if (!l) return f;
  return `${f} ${l.charAt(0)}.`;
}

const RMAsphaltModal: React.FC<RMAsphaltModalProps> = ({
  managerId,
  managerName,
  onClose,
  onAssignmentChange,
}) => {
  // --- DATA STATE ---
  // Three parallel fetches drive initial render: unassigned asphalt rows, the
  // daily session (for worker → teamId + manager assignment), and all logsheet
  // sessions (for session-id-to-cart mapping).
  const [unassigned, setUnassigned] = useState<PendingSale[]>([]);
  const [workers, setWorkers] = useState<WorkerType[]>([]);
  const [sessions, setSessions] = useState<LogsheetSession[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-row UI state:
  //   selectedRcByRow[asphaltPendingSaleId]   → chosen RC sessionId in the dropdown
  //   assigningByRow[asphaltPendingSaleId]    → true while the in-flight assign is pending
  //   recentlyAssignedRows                    → ids of rows just assigned, shown briefly
  //                                              with a "Assigned" checkmark before they
  //                                              disappear on the next refresh.
  const [selectedRcByRow, setSelectedRcByRow] = useState<Record<string, string>>({});
  const [assigningByRow, setAssigningByRow] = useState<Record<string, boolean>>({});
  const [recentlyAssigned, setRecentlyAssigned] = useState<Set<string>>(new Set());

  // Counter tracked so the parent's optional onAssignmentChange callback only
  // fires when something actually happened (avoids spurious refreshes).
  const [assignedThisSession, setAssignedThisSession] = useState(0);

  // --- INITIAL FETCH ---
  const refreshAll = async () => {
    setError(null);
    setLoading(true);
    try {
      const [unassignedRows, dailySession, allSessions] = await Promise.all([
        sessionService.getUnassignedAsphaltForManager(managerId),
        sessionService.getDailySession(),
        sessionService.getLogsheetSessions(),
      ]);
      setUnassigned(unassignedRows);
      setWorkers(dailySession?.workers || []);
      setSessions(allSessions || []);
    } catch (err: any) {
      console.error('[RMAsphaltModal] initial load failed:', err);
      setError(err?.message || 'Failed to load asphalt queue. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  // --- REFRESH ASPHALT LIST ONLY ---
  // After a successful assign, we only need to re-fetch the asphalt rows —
  // workers + sessions don't change mid-modal in any normal flow.
  const refreshUnassignedOnly = async () => {
    try {
      const rows = await sessionService.getUnassignedAsphaltForManager(managerId);
      setUnassigned(rows);
    } catch (err: any) {
      console.error('[RMAsphaltModal] post-assign refresh failed:', err);
      // Non-fatal — the row will eventually disappear on next reopen. Leave
      // the optimistic "Assigned" pill visible so the RM sees positive feedback.
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managerId]);

  // --- DERIVE: assignable RC sessions under this manager ---
  // We do this every render with useMemo because both `workers` and `sessions`
  // can change after refreshAll. The cost is small (cross-reference of a
  // typically-small worker list).
  const assignableRcSessions: AssignableRcSession[] = useMemo(() => {
    // 1. Filter workers: this manager's team, AND teamId is RC-shaped.
    const rcWorkers = workers.filter(w =>
      w.assignedManagerId === managerId && isRC(w.teamId)
    );

    if (rcWorkers.length === 0) return [];

    // 2. Build a lookup of contractorId → worker for name resolution.
    const workerById = new Map(rcWorkers.map(w => [w.contractorId, w]));

    // 3. Walk sessions, find ones whose team includes any RC worker. Dedupe
    //    by session.id so a 2-worker RC cart appears once.
    const seen = new Map<string, AssignableRcSession>();
    for (const sess of sessions) {
      const ids = (sess.teamWorkerIds && sess.teamWorkerIds.length > 0)
        ? sess.teamWorkerIds
        : [sess.workerId];

      const rcMembersOnThisSession = ids
        .map(id => workerById.get(id))
        .filter((w): w is WorkerType => !!w);

      if (rcMembersOnThisSession.length === 0) continue;

      // Use the FIRST RC member's teamId as the session's teamId label.
      // In practice all members on a cart share the same teamId; if they
      // somehow don't, this picks deterministically.
      const teamId = rcMembersOnThisSession[0].teamId || '';
      const workerNames = rcMembersOnThisSession.map(w => shortName(w.firstName, w.lastName));

      if (!seen.has(sess.id)) {
        seen.set(sess.id, {
          sessionId: sess.id,
          teamId,
          workerNames,
        });
      }
    }

    // 4. Sort by teamId (RC1 before RC2 before RC10 — natural numeric sort
    //    on the digits after "RC", with bare "RC" coming first).
    const result = Array.from(seen.values());
    result.sort((a, b) => {
      const numA = parseInt(a.teamId.replace(/^RC/, ''), 10);
      const numB = parseInt(b.teamId.replace(/^RC/, ''), 10);
      // Bare "RC" → NaN; treat as 0 so it sorts ahead of numbered RC1+.
      const safeA = isNaN(numA) ? 0 : numA;
      const safeB = isNaN(numB) ? 0 : numB;
      return safeA - safeB;
    });
    return result;
  }, [workers, sessions, managerId]);

  // --- DERIVE: cart-attribution lookup (sessionId → worker first+last name) ---
  // The asphalt child's session_id points to the SELLING cart's session.
  // For display we want "from John D.'s cart" so the RM has context.
  const cartAttributionBySessionId: Map<string, string> = useMemo(() => {
    const result = new Map<string, string>();
    for (const sess of sessions) {
      const primaryId = (sess.teamWorkerIds && sess.teamWorkerIds.length > 0)
        ? sess.teamWorkerIds[0]
        : sess.workerId;
      const primaryWorker = workers.find(w => w.contractorId === primaryId);
      if (primaryWorker) {
        // Cart label uses just the first worker — keeps the row tight. If you
        // want all team members shown, swap to teamWorkerIds.map().join(', ').
        result.set(sess.id, shortName(primaryWorker.firstName, primaryWorker.lastName));
      }
    }
    return result;
  }, [sessions, workers]);

  // --- HANDLE ASSIGN BUTTON ---
  const handleAssign = async (asphaltRowId: string) => {
    const targetSessionId = selectedRcByRow[asphaltRowId];
    if (!targetSessionId) {
      setError('Please choose a Ramp Crew before assigning.');
      return;
    }
    if (assigningByRow[asphaltRowId]) return;

    setError(null);
    setAssigningByRow(prev => ({ ...prev, [asphaltRowId]: true }));

    try {
      await sessionService.assignAsphaltToRcSession(asphaltRowId, targetSessionId);
      // Mark the row as recently assigned for a brief positive-feedback flash
      // before the next refresh removes it from the list.
      setRecentlyAssigned(prev => {
        const next = new Set(prev);
        next.add(asphaltRowId);
        return next;
      });
      setAssignedThisSession(c => c + 1);
      // Refresh asphalt list — assigned rows drop out. Workers + sessions
      // stay cached. If refresh fails, the optimistic pill remains visible.
      await refreshUnassignedOnly();
    } catch (err: any) {
      console.error('[RMAsphaltModal] assign failed:', err);
      setError(err?.message || 'Failed to assign. Please retry.');
    } finally {
      setAssigningByRow(prev => {
        const next = { ...prev };
        delete next[asphaltRowId];
        return next;
      });
    }
  };

  // --- CLOSE HANDLER ---
  // Fire onAssignmentChange exactly once at close time if anything happened,
  // so the parent (RMLogbook) refreshes its badge count.
  const handleClose = () => {
    if (assignedThisSession > 0 && onAssignmentChange) {
      onAssignmentChange();
    }
    onClose();
  };

  // --- NO RC SESSIONS AVAILABLE BANNER ---
  // If the RM has no RC carts under their authority, the dropdown will be
  // empty and there's nothing to do. Surface this clearly.
  const noRcAvailable = !loading && assignableRcSessions.length === 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-700 shadow-2xl">

        {/* HEADER */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-900/50 rounded-t-lg flex-shrink-0">
          <div className="flex items-center gap-3">
            <Shovel className="text-amber-400" size={20} />
            <div>
              <h2 className="text-lg font-bold text-white">Unassigned Asphalt</h2>
              <p className="text-xs text-gray-400">
                {managerName ? `${managerName} · ` : ''}
                {loading
                  ? 'Loading…'
                  : unassigned.length === 0
                    ? 'No asphalt rows waiting'
                    : `${unassigned.length} asphalt row${unassigned.length === 1 ? '' : 's'} awaiting assignment`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshAll}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={handleClose} className="text-gray-400 hover:text-white">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="overflow-y-auto p-4 space-y-3 flex-grow custom-scrollbar">

          {/* Error banner — non-fatal, dismissible by retrying. */}
          {error && (
            <div className="p-3 bg-red-900/30 text-red-300 border border-red-700 rounded-md text-sm flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {/* "No RC sessions available" warning. */}
          {noRcAvailable && (
            <div className="p-3 bg-amber-900/20 text-amber-300 border border-amber-700/60 rounded-md text-sm flex items-start gap-2">
              <Users size={16} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-bold mb-0.5">No Ramp Crew sessions under your authority.</p>
                <p className="text-[11px] opacity-90">
                  Asphalt rows cannot be assigned until at least one cart with a teamId matching
                  &quot;RC&quot;, &quot;RC1&quot;, &quot;RC2&quot;, etc. is set up under your management.
                  Contact your CC admin if this is unexpected.
                </p>
              </div>
            </div>
          )}

          {/* Loading state. */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader className="animate-spin mr-2" size={18} />
              <span className="text-sm">Loading asphalt queue…</span>
            </div>
          )}

          {/* Empty state. */}
          {!loading && unassigned.length === 0 && !noRcAvailable && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-500">
              <Shovel size={36} className="text-amber-400/30 mb-2" />
              <p className="text-sm font-bold text-gray-400">No asphalt waiting</p>
              <p className="text-[11px] mt-1">When workers sell asphalt without a Ramp Crew, it shows up here.</p>
            </div>
          )}

          {/* The asphalt list. */}
          {!loading && unassigned.length > 0 && (
            <div className="space-y-2">
              {unassigned.map((row) => {
                const isJustAssigned = recentlyAssigned.has(row.id);
                const isAssigning = assigningByRow[row.id] === true;
                const selectedRc = selectedRcByRow[row.id] || '';
                const cartAttribution = cartAttributionBySessionId.get(row.sessionId) || '(unknown cart)';
                const asphaltAmt = formatDollars(row.asphaltAmount);
                const isDeferred = typeof row.sharedJobKey === 'string' && row.sharedJobKey.length > 0;

                return (
                  <div
                    key={row.id}
                    className={`relative p-3 rounded-lg border ${
                      isJustAssigned
                        ? 'bg-green-900/20 border-green-600'
                        : 'bg-gray-900/40 border-amber-700/40'
                    }`}
                  >
                    {/* Top row: address + asphalt amount */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="bg-gray-700 text-gray-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-gray-600">
                            {row.routeCode || '--'}
                          </span>
                          {/* Path 3 deferred-pickup indicator — cart already
                              collected driveway cash; RC will only collect upsold. */}
                          {isDeferred && (
                            <span className="text-[9px] font-bold bg-amber-900/50 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700">
                              DEFERRED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-gray-200 text-sm font-medium">
                          <MapPin size={11} className="text-gray-500 shrink-0" />
                          <span className="truncate">{assembleAddress(row)}</span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          From {cartAttribution}&apos;s cart
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-gray-500 uppercase font-bold block">Asphalt</span>
                        <span className="text-amber-200 font-mono font-bold text-lg flex items-center gap-1">
                          <Shovel size={12} className="text-amber-400" />
                          {asphaltAmt}
                        </span>
                      </div>
                    </div>

                    {/* Bottom row: assign dropdown + button (or recently-assigned confirmation) */}
                    {isJustAssigned ? (
                      <div className="flex items-center gap-2 text-green-400 text-xs font-bold">
                        <CheckCircle size={14} />
                        Assigned. Will disappear on next refresh.
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedRc}
                          onChange={(e) =>
                            setSelectedRcByRow(prev => ({ ...prev, [row.id]: e.target.value }))
                          }
                          disabled={isAssigning || noRcAvailable}
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded p-2 text-white text-xs disabled:opacity-50"
                        >
                          <option value="">-- Choose Ramp Crew --</option>
                          {assignableRcSessions.map((rc) => (
                            <option key={rc.sessionId} value={rc.sessionId}>
                              {formatRcSessionLabel(rc)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssign(row.id)}
                          disabled={!selectedRc || isAssigning || noRcAvailable}
                          className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold rounded border border-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
                        >
                          {isAssigning ? (
                            <>
                              <Loader className="animate-spin" size={12} />
                              Assigning…
                            </>
                          ) : (
                            'Assign'
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="p-3 border-t border-gray-700 bg-gray-900/50 rounded-b-lg flex justify-end items-center gap-2 flex-shrink-0">
          {assignedThisSession > 0 && (
            <span className="text-[11px] text-green-400 mr-auto">
              <CheckCircle size={12} className="inline mr-1" />
              {assignedThisSession} assigned this session
            </span>
          )}
          <button
            onClick={handleClose}
            className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold rounded border border-gray-600"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default RMAsphaltModal;
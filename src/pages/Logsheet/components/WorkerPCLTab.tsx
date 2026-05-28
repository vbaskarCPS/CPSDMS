// src/pages/Logsheet/components/WorkerPCLTab.tsx
//
// CHANGELOG (this revision):
//   - Added cancellation guard so a stale request can't overwrite fresh data
//     when routeCodes change rapidly (latent race-condition fix).
//   - Added silent retry: if the first load fails, waits 1.5s and tries again
//     once. Worker never sees a red screen for transient network blips.
//   - On final failure (both attempts threw), logs error details to the
//     pcl_error_log Supabase table for server-side investigation.
//   - Added "Try again" button to the red error screen so workers aren't stuck.
//   - All UI (card layout, expand/collapse, history grid) is unchanged.
//
import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader,
  ChevronDown,
  ChevronUp,
  Phone,
  MapPin,
  Clock,
  AlertCircle,
  RotateCw,
} from 'lucide-react';
import { commandCenterService } from '../../../lib/commandCenterService';
import { getWorkerPCL, logPCLError, PCLClientGroup } from '../../../lib/pclCacheService';
import { getStorageItem } from '../../../lib/localStorage';

interface WorkerPCLTabProps {
  routeCodes: string[];
}

// Pull whichever id the current_user object happens to expose.
// Worker objects use contractorId; other roles may use user_id or id.
// Falls back to 'unknown' so the error log always has *something* useful.
function getCurrentWorkerId(): string {
  const user = getStorageItem<any>('current_user', null);
  if (!user) return 'unknown';
  return user.contractorId || user.user_id || user.id || 'unknown';
}

const ClientCard: React.FC<{ client: PCLClientGroup }> = ({ client }) => {
  const [expanded, setExpanded] = useState(false);
  const mostRecent = client.history[0];

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-start justify-between gap-3 text-left active:bg-gray-800 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white text-sm truncate">
            {client.firstName} {client.lastName}
          </div>
          <div className="flex items-center gap-1 text-gray-400 text-xs mt-0.5">
            <MapPin size={10} className="shrink-0" />
            <span className="truncate">{client.houseNum} {client.streetName}</span>
          </div>
          {client.phone && (
            <div className="flex items-center gap-1 text-gray-500 text-xs mt-0.5">
              <Phone size={10} className="shrink-0" />
              <span>{client.phone}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end shrink-0 gap-1">
          {mostRecent && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500">{mostRecent.year}</span>
              <span className="text-green-400 font-mono font-bold text-sm">{mostRecent.price}</span>
              <span className="text-[10px] bg-gray-700 border border-gray-600 text-gray-300 px-1 py-0.5 rounded">
                {mostRecent.serviceType}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 text-gray-500">
            <Clock size={10} />
            <span className="text-[10px]">{client.history.length}x</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-700/50">
          <div className="grid grid-cols-4 px-3 py-1.5 bg-gray-800/60">
            <span className="text-[9px] font-bold text-gray-500 uppercase">Year</span>
            <span className="text-[9px] font-bold text-gray-500 uppercase">Price</span>
            <span className="text-[9px] font-bold text-gray-500 uppercase">Type</span>
            <span className="text-[9px] font-bold text-gray-500 uppercase">Contractor</span>
          </div>
          {client.history.map((h, i) => (
            <div
              key={i}
              className={`grid grid-cols-4 px-3 py-2 border-t border-gray-800 ${
                i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/30'
              }`}
            >
              <span className="text-xs font-mono text-gray-300">{h.year}</span>
              <span className="text-xs font-mono text-green-400">{h.price}</span>
              <span className="text-xs text-gray-300">{h.serviceType}</span>
              <span className="text-xs text-gray-400 truncate">{h.contractor || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const WorkerPCLTab: React.FC<WorkerPCLTabProps> = ({ routeCodes }) => {
  const [loading, setLoading] = useState(true);
  const [pclMap, setPclMap] = useState<Map<string, PCLClientGroup[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  // Bumped by the "Try again" button to re-trigger the effect.
  const [retryNonce, setRetryNonce] = useState(0);

  const routeKey = routeCodes.slice().sort().join(',');

  // Single load attempt. Returns the data on success, throws on failure.
  const attemptLoad = useCallback(async (): Promise<Map<string, PCLClientGroup[]>> => {
    const cc = commandCenterService.getCurrentCommandCenter();
    if (!cc) throw new Error('No command center context');
    return await getWorkerPCL(routeCodes, cc.id);
  }, [routeCodes]);

  useEffect(() => {
    if (routeCodes.length === 0) {
      setLoading(false);
      setPclMap(new Map());
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      // Attempt 1
      try {
        const data = await attemptLoad();
        if (!cancelled) {
          setPclMap(data);
          setLoading(false);
        }
        return;
      } catch {
        // swallow — we're going to retry once before surfacing anything
      }

      // Wait 1.5s, then retry silently.
      await new Promise(res => setTimeout(res, 1500));
      if (cancelled) return;

      // Attempt 2
      try {
        const data = await attemptLoad();
        if (!cancelled) {
          setPclMap(data);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;

        // Both attempts failed — log it and show red screen.
        console.error('[WorkerPCLTab]', err);

        const cc = commandCenterService.getCurrentCommandCenter();
        // Fire-and-forget logging; we don't want it to block the UI.
        logPCLError({
          commandCenterId: cc?.id ?? null,
          workerUserId: getCurrentWorkerId(),
          routeCodes,
          errorMessage:
            (err instanceof Error ? err.message : String(err)) || 'Unknown error',
          errorStack: err instanceof Error ? err.stack ?? null : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }).catch(() => {
          /* swallow — logging must never break the UI */
        });

        setError('Could not load PCL data.');
        setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [routeKey, retryNonce, attemptLoad]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500">
        <Loader size={24} className="animate-spin mb-3 text-cps-blue" />
        <p className="text-sm">Loading previous clients…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500 p-6 text-center">
        <AlertCircle size={32} className="mb-3 opacity-40" />
        <p className="text-sm">{error}</p>
        <p className="text-xs text-gray-600 mt-1 mb-4">
          PCL data is cached during session setup by the admin.
        </p>
        <button
          onClick={() => setRetryNonce(n => n + 1)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-200 rounded-lg text-sm transition-colors"
        >
          <RotateCw size={14} />
          Try again
        </button>
      </div>
    );
  }

  const sortedRoutes = [...routeCodes].sort();
  const totalClients = sortedRoutes.reduce(
    (sum, rc) => sum + (pclMap.get(rc)?.length || 0),
    0,
  );

  if (totalClients === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500 p-6 text-center">
        <Clock size={32} className="mb-3 opacity-20" />
        <p className="text-sm">No previous client history for your routes.</p>
        <p className="text-xs text-gray-600 mt-1">
          History appears here after the first season's data is imported.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-5">
      {sortedRoutes.map(rc => {
        const clients = pclMap.get(rc);
        if (!clients || clients.length === 0) return null;
        return (
          <div key={rc}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold font-mono bg-gray-800 border border-gray-700 text-gray-300 px-2 py-0.5 rounded">
                {rc}
              </span>
              <span className="text-[10px] text-gray-600">
                {clients.length} previous client{clients.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-2">
              {clients.map((client, i) => (
                <ClientCard
                  key={`${client.houseNum}-${client.streetName.toLowerCase().replace(/\s+/g, '-')}-${i}`}
                  client={client}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WorkerPCLTab;
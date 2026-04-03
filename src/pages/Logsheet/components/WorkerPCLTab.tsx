// src/pages/Logsheet/components/WorkerPCLTab.tsx
import React, { useState, useEffect } from 'react';
import { Loader, ChevronDown, ChevronUp, Phone, MapPin, Clock, AlertCircle } from 'lucide-react';
import { commandCenterService } from '../../../lib/commandCenterService';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';

interface WorkerPCLTabProps {
  routeCodes: string[];
}

// ─── CLIENT CARD ─────────────────────────────────────────────────────────────

const ClientCard: React.FC<{ client: PCLClientGroup }> = ({ client }) => {
  const [expanded, setExpanded] = useState(false);
  const mostRecent = client.history[0];

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header Row — tap to expand */}
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
          {/* Most recent year + price + service type inline */}
          {mostRecent && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500">{mostRecent.year}</span>
              <span className="text-green-400 font-mono font-bold text-sm">{mostRecent.price}</span>
              <span className="text-[10px] bg-gray-700 border border-gray-600 text-gray-300 px-1 py-0.5 rounded">
                {mostRecent.serviceType}
              </span>
            </div>
          )}
          {/* History count + expand chevron */}
          <div className="flex items-center gap-1 text-gray-500">
            <Clock size={10} />
            <span className="text-[10px]">{client.history.length}x</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </div>
        </div>
      </button>

      {/* History Rows — shown when expanded */}
      {expanded && (
        <div className="border-t border-gray-700/50">
          {/* Column headers */}
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

// ─── MAIN TAB COMPONENT ───────────────────────────────────────────────────────

const WorkerPCLTab: React.FC<WorkerPCLTabProps> = ({ routeCodes }) => {
  const [loading, setLoading] = useState(true);
  const [pclMap, setPclMap] = useState<Map<string, PCLClientGroup[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Stable key so the effect only re-runs if route codes actually change
  const routeKey = routeCodes.slice().sort().join(',');

  useEffect(() => {
    if (routeCodes.length === 0) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const cc = commandCenterService.getCurrentCommandCenter();
        if (!cc) throw new Error('No command center context');
        const data = await getWorkerPCL(routeCodes, cc.id);
        setPclMap(data);
      } catch (err: any) {
        console.error('[WorkerPCLTab]', err);
        setError('Could not load PCL data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500">
        <Loader size={24} className="animate-spin mb-3 text-cps-blue" />
        <p className="text-sm">Loading previous clients…</p>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500 p-6 text-center">
        <AlertCircle size={32} className="mb-3 opacity-40" />
        <p className="text-sm">{error}</p>
        <p className="text-xs text-gray-600 mt-1">
          PCL data is cached during session setup by the admin.
        </p>
      </div>
    );
  }

  // ── Empty ──
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

  // ── Feed ──
  return (
    <div className="p-3 space-y-5">
      {sortedRoutes.map(rc => {
        const clients = pclMap.get(rc);
        if (!clients || clients.length === 0) return null;
        return (
          <div key={rc}>
            {/* Route section header */}
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
                  key={`${client.houseNum}-${normalizeKey(client.streetName)}-${i}`}
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

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

export default WorkerPCLTab;// src/pages/Logsheet/components/WorkerPCLTab.tsx
import React, { useState, useEffect } from 'react';
import { Loader, ChevronDown, ChevronUp, Phone, MapPin, Clock, AlertCircle } from 'lucide-react';
import { commandCenterService } from '../../../lib/commandCenterService';
import { getWorkerPCL, PCLClientGroup } from '../../../lib/pclCacheService';

interface WorkerPCLTabProps {
  routeCodes: string[];
}

// ─── CLIENT CARD ─────────────────────────────────────────────────────────────

const ClientCard: React.FC<{ client: PCLClientGroup }> = ({ client }) => {
  const [expanded, setExpanded] = useState(false);
  const mostRecent = client.history[0];

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header Row — tap to expand */}
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
          {/* Most recent year + price + service type inline */}
          {mostRecent && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500">{mostRecent.year}</span>
              <span className="text-green-400 font-mono font-bold text-sm">{mostRecent.price}</span>
              <span className="text-[10px] bg-gray-700 border border-gray-600 text-gray-300 px-1 py-0.5 rounded">
                {mostRecent.serviceType}
              </span>
            </div>
          )}
          {/* History count + expand chevron */}
          <div className="flex items-center gap-1 text-gray-500">
            <Clock size={10} />
            <span className="text-[10px]">{client.history.length}x</span>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </div>
        </div>
      </button>

      {/* History Rows — shown when expanded */}
      {expanded && (
        <div className="border-t border-gray-700/50">
          {/* Column headers */}
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

// ─── MAIN TAB COMPONENT ───────────────────────────────────────────────────────

const WorkerPCLTab: React.FC<WorkerPCLTabProps> = ({ routeCodes }) => {
  const [loading, setLoading] = useState(true);
  const [pclMap, setPclMap] = useState<Map<string, PCLClientGroup[]>>(new Map());
  const [error, setError] = useState<string | null>(null);

  // Stable key so the effect only re-runs if route codes actually change
  const routeKey = routeCodes.slice().sort().join(',');

  useEffect(() => {
    if (routeCodes.length === 0) {
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const cc = commandCenterService.getCurrentCommandCenter();
        if (!cc) throw new Error('No command center context');
        const data = await getWorkerPCL(routeCodes, cc.id);
        setPclMap(data);
      } catch (err: any) {
        console.error('[WorkerPCLTab]', err);
        setError('Could not load PCL data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500">
        <Loader size={24} className="animate-spin mb-3 text-cps-blue" />
        <p className="text-sm">Loading previous clients…</p>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-500 p-6 text-center">
        <AlertCircle size={32} className="mb-3 opacity-40" />
        <p className="text-sm">{error}</p>
        <p className="text-xs text-gray-600 mt-1">
          PCL data is cached during session setup by the admin.
        </p>
      </div>
    );
  }

  // ── Empty ──
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

  // ── Feed ──
  return (
    <div className="p-3 space-y-5">
      {sortedRoutes.map(rc => {
        const clients = pclMap.get(rc);
        if (!clients || clients.length === 0) return null;
        return (
          <div key={rc}>
            {/* Route section header */}
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
                  key={`${client.houseNum}-${normalizeKey(client.streetName)}-${i}`}
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

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

export default WorkerPCLTab;
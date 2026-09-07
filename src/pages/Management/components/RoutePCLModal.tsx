// src/pages/Management/components/RoutePCLModal.tsx
//
// ROUTE PCL VIEWER — the RM's own window onto a route's previous-client list.
//
// Opened from the assign modal's "View PCL" button and floats in the same
// space, on top of it. Deliberately NOT the worker's PCL tab: that one fetches
// for itself and speaks to a contractor. This one is handed the clients the
// map has already loaded for the route (no second fetch), and leads with the
// thing a manager wants to know first — who has worked this route most.
//
// Top strip: the three contractors appearing most often in the route's
// history, counted per history row (a client with three years under the same
// name counts three times for that name). Ties fall to alphabetical order;
// blank contractor names are ignored.

import React, { useMemo, useState } from 'react';
import {
  X, Users, Phone, MapPin, Clock, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { PCLClientGroup } from '../../../lib/pclCacheService';
import type { SeasonType } from '../../../types';

interface Props {
  routeCode: string;
  displayRouteCode: string;
  routeColor: string;
  clients: PCLClientGroup[];
  seasonType?: SeasonType;
  onClose: () => void;
}

interface TopWorker {
  name: string;
  count: number;
}

function topWorkers(clients: PCLClientGroup[], limit: number): TopWorker[] {
  const counts = new Map<string, number>();
  clients.forEach(c => {
    (c.history || []).forEach(h => {
      const name = String(h?.contractor || '').trim();
      if (!name) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const ClientCard: React.FC<{ client: PCLClientGroup; sealing: boolean }> = ({ client, sealing }) => {
  const [expanded, setExpanded] = useState(false);
  const mostRecent = client.history[0];

  const shellClass = sealing
    ? 'bg-indigo-950/40 border border-indigo-700/60 rounded-xl overflow-hidden'
    : 'bg-gray-900 border border-gray-700 rounded-xl overflow-hidden';
  const priceClass = sealing
    ? 'text-indigo-300 font-mono font-bold text-sm'
    : 'text-green-400 font-mono font-bold text-sm';
  const tagClass = sealing
    ? 'text-[10px] bg-indigo-900/60 border border-indigo-600 text-indigo-200 px-1 py-0.5 rounded'
    : 'text-[10px] bg-gray-700 border border-gray-600 text-gray-300 px-1 py-0.5 rounded';
  const rowPriceClass = sealing ? 'text-xs font-mono text-indigo-300' : 'text-xs font-mono text-green-400';

  return (
    <div className={shellClass}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full p-3 flex items-start justify-between gap-3 text-left active:bg-gray-800 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white text-sm truncate">
            {`${client.firstName || ''} ${client.lastName || ''}`.trim() || '(no name on record)'}
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
              <span className={priceClass}>{mostRecent.price}</span>
              <span className={tagClass}>{mostRecent.serviceType}</span>
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
              <span className={rowPriceClass}>{h.price}</span>
              <span className="text-xs text-gray-300">{h.serviceType}</span>
              <span className="text-xs text-gray-400 truncate">{h.contractor || '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RoutePCLModal: React.FC<Props> = ({
  routeCode, displayRouteCode, routeColor, clients, seasonType, onClose,
}) => {
  const sealing = seasonType === 'sealing';
  const workers = useMemo(() => topWorkers(clients, 3), [clients]);
  const totalJobs = useMemo(
    () => clients.reduce((sum, c) => sum + (c.history?.length || 0), 0),
    [clients],
  );

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="flex-shrink-0 p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="h-9 px-2.5 min-w-[48px] rounded-md flex items-center justify-center font-bold text-white text-xs flex-shrink-0 leading-none whitespace-nowrap"
              style={{ background: routeColor }}
            >
              {displayRouteCode}
            </div>
            <div>
              <div className="text-white font-bold text-sm">Previous clients</div>
              <div className="text-[10px] text-gray-400">
                {clients.length} client{clients.length !== 1 ? 's' : ''} • {totalJobs} job{totalJobs !== 1 ? 's' : ''} on record • {routeCode}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 flex items-center justify-center"
          ><X size={14} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {/* TOP WORKERS */}
          <div className="mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">
              <Users size={11} /> Most common workers on this route
            </div>
            {workers.length === 0 ? (
              <div className="text-xs text-gray-600 bg-gray-800/50 border border-gray-700 rounded-md px-3 py-2">
                No contractor names in this route's history.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {workers.map((w, i) => (
                  <div
                    key={w.name}
                    className={`rounded-lg border px-3 py-2 ${
                      sealing
                        ? 'bg-indigo-950/40 border-indigo-700/60'
                        : 'bg-gray-800 border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-gray-500">#{i + 1}</span>
                      <span className="text-sm font-bold text-white truncate">{w.name}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {w.count} job{w.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CLIENT LIST */}
          {clients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-500 text-center">
              <Clock size={32} className="mb-3 opacity-20" />
              <p className="text-sm">No previous client history for this route.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((client, i) => (
                <ClientCard
                  key={`${client.houseNum}-${String(client.streetName || '').toLowerCase().replace(/\s+/g, '-')}-${i}`}
                  client={client}
                  sealing={sealing}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RoutePCLModal;
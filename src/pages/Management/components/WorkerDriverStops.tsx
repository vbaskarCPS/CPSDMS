// src/pages/Management/components/WorkerDriverStops.tsx
//
// WORKER DRIVER STOPS — the RM's view of each worker driver's queue.
//
// A worker driver is a contractor who also ferries teams around. The RM drops
// "Worker driver" pins (map_pins.visibility = 'worker') for them in the order
// they should drive; the driver sees them on their map logsheet and navigates
// stop to stop, each Continue removing the stop they're at.
//
// Here the RM can reorder a queue (↑ / ↓), remove a stop, or clear a driver's
// whole queue. Tapping a stop shows it on the map. Used by both the desktop
// and the phone layout of the RM map.

import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader, MapPin, Trash2, Truck, X } from 'lucide-react';
import type { Worker } from '../../../types';
import type { MapPin as MapPinRecord } from '../../../lib/sessionService';

export const WORKER_STOP_COLOR = '#0d9488';

interface Props {
  pins: MapPinRecord[];
  workers: Worker[];
  /** Phone layout: rise from the bottom; desktop: centred. */
  asSheet?: boolean;
  /** Open with this driver's queue first. */
  focusWorkerId?: string | null;
  onClose: () => void;
  onShowPin: (pin: MapPinRecord) => void;
  onReorder: (pinIdsInOrder: string[]) => Promise<void>;
  onDelete: (pin: MapPinRecord) => Promise<void>;
}

export function workerName(workers: Worker[], id: string | null | undefined): string {
  const w = workers.find(x => x.contractorId === id);
  return w ? `${w.firstName} ${(w.lastName || '').charAt(0)}.`.trim() : (id || 'driver');
}

const WorkerDriverStops: React.FC<Props> = ({ pins, workers, asSheet, focusWorkerId, onClose, onShowPin, onReorder, onDelete }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queues = useMemo(() => {
    const byWorker = new Map<string, MapPinRecord[]>();
    pins.filter(p => p.visibility === 'worker' && p.targetWorkerId).forEach(p => {
      const k = p.targetWorkerId!;
      if (!byWorker.has(k)) byWorker.set(k, []);
      byWorker.get(k)!.push(p);
    });
    const list = [...byWorker.entries()].map(([wid, ps]) => ({
      workerId: wid,
      stops: ps.sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0) || (a.createdAt || "").localeCompare(b.createdAt || "")),
    }));
    return list.sort((a, b) => (a.workerId === focusWorkerId ? -1 : b.workerId === focusWorkerId ? 1 : workerName(workers, a.workerId).localeCompare(workerName(workers, b.workerId))));
  }, [pins, workers, focusWorkerId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); } catch { setError('Could not save — try again'); } finally { setBusy(null); }
  };

  const move = (stops: MapPinRecord[], i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const ids = stops.map(s => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(`mv:${stops[i].id}`, () => onReorder(ids));
  };

  const clearAll = (workerId: string, stops: MapPinRecord[]) => {
    if (!window.confirm(`Remove all ${stops.length} stops for ${workerName(workers, workerId)}?`)) return;
    run(`clr:${workerId}`, async () => { for (const s of stops) await onDelete(s); });
  };

  return (
    <div
      className={`fixed inset-0 bg-black/60 z-[60] flex justify-center ${asSheet ? 'items-end' : 'items-center p-4'}`}
      onClick={onClose}
    >
      <div
        className={asSheet
          ? 'bg-gray-900 border-t border-gray-700 rounded-t-2xl w-full max-h-[85vh] flex flex-col'
          : 'bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col'}
        style={asSheet ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-4 pb-2">
          <Truck size={18} style={{ color: WORKER_STOP_COLOR }} />
          <div className="text-white font-bold text-sm flex-1">Worker driver stops</div>
          {busy && <Loader size={14} className="animate-spin text-gray-400" />}
          <button onClick={onClose} className="w-9 h-9 -mr-2 flex items-center justify-center text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        {error && <div className="mx-4 mb-2 text-xs text-red-300 bg-red-900/30 border border-red-800 rounded-md px-3 py-2">{error}</div>}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-4">
          {queues.length === 0 && (
            <div className="text-xs text-gray-400 bg-gray-800 rounded-xl p-3">
              No driver stops yet. Drop a pin and choose <b className="text-gray-200">Worker driver</b> under "Who can see it" — stops queue up in the order you drop them.
            </div>
          )}
          {queues.map(q => (
            <div key={q.workerId}>
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className="text-xs font-bold text-white">{workerName(workers, q.workerId)}</span>
                <span className="text-[11px] text-gray-500">{q.stops.length} stop{q.stops.length === 1 ? '' : 's'}</span>
                <button
                  onClick={() => clearAll(q.workerId, q.stops)}
                  disabled={!!busy}
                  className="ml-auto text-[11px] font-bold text-red-300 hover:text-red-200 disabled:opacity-40"
                >Clear all</button>
              </div>
              <div className="space-y-1.5">
                {q.stops.map((s, i) => (
                  <div key={s.id} className="bg-gray-800 border border-gray-700 rounded-xl flex items-center gap-2 pl-2 pr-1 py-1.5">
                    <span className="w-7 h-7 rounded-full text-white text-xs font-extrabold flex items-center justify-center flex-shrink-0" style={{ background: WORKER_STOP_COLOR }}>{i + 1}</span>
                    <button onClick={() => onShowPin(s)} className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-white font-bold truncate">{s.label}</div>
                      <div className="text-[10px] text-gray-500 flex items-center gap-1"><MapPin size={10} /> show on map</div>
                    </button>
                    <button onClick={() => move(q.stops, i, -1)} disabled={i === 0 || !!busy} className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-300 hover:bg-gray-700 disabled:opacity-25" aria-label="Move up"><ArrowUp size={16} /></button>
                    <button onClick={() => move(q.stops, i, 1)} disabled={i === q.stops.length - 1 || !!busy} className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-300 hover:bg-gray-700 disabled:opacity-25" aria-label="Move down"><ArrowDown size={16} /></button>
                    <button onClick={() => run(`del:${s.id}`, () => onDelete(s))} disabled={!!busy} className="w-9 h-9 rounded-lg flex items-center justify-center text-red-300 hover:bg-red-900/40 disabled:opacity-25" aria-label="Remove stop"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WorkerDriverStops;

// src/pages/SuperAdmin/RouteDeleteModal.tsx — Map Builder: delete a route number and move the later
// routes of the prefix down one, across every map with that prefix (see src/lib/routeShift.ts).
// Shows what will move first; the map has to be saved, because the page reloads afterwards.
import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader, Trash2, X } from 'lucide-react';
import { deleteAndShift, describeShift, previewDeleteShift, type ShiftAnswer } from '../../lib/routeShift';

export const RouteDeleteModal: React.FC<{
  prefix: string; number: number; code: string;
  /** whether this map is saved ('loading' until its roads and saved routes are on the map) */
  mapState: () => Promise<'saved' | 'unsaved' | 'loading'>;
  onClose: () => void; onDone: () => void;
}> = ({ prefix, number, code, mapState, onClose, onDone }) => {
  const [preview, setPreview] = useState<ShiftAnswer | null>(null);
  const [state, setState] = useState<'saved' | 'unsaved' | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([previewDeleteShift(prefix, number), mapState()])
      .then(([p, st]) => { if (live) { setPreview(p); setState(st); } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [prefix, number]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await deleteAndShift(prefix, number);
      if (!r.ok) { setPreview(r); return; }
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const d = preview ? describeShift(preview, code) : null;
  const canRun = !!preview?.ok && state === 'saved' && !busy;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Delete ${code}`}>
        <div className="flex items-center gap-2 mb-3">
          <Trash2 size={18} className="text-red-400" />
          <h3 className="text-white font-bold">Delete {code}?</h3>
          {!busy && <button onClick={onClose} className="ml-auto text-gray-500 hover:text-white" aria-label="Close"><X size={16} /></button>}
        </div>

        {!preview && !error && <div className="text-gray-400 text-sm flex items-center gap-2"><Loader size={14} className="animate-spin" /> Checking what moves…</div>}

        {d && (
          <div className="text-sm text-gray-300 space-y-3">
            {d.blocked ? (
              <div className="text-red-300 bg-red-900/20 border border-red-800/50 rounded px-3 py-2 flex gap-2"><AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{d.blocked}</span></div>
            ) : (
              <>
                <p>{code}{preview?.area ? ` (${preview.area})` : ''} is removed{d.moves.length ? ' and every later route moves down one number:' : '. No later routes to move.'}</p>
                {d.moves.length > 0 && (
                  <ul className="bg-gray-800 rounded-lg px-3 py-2 space-y-1 font-mono text-xs">
                    {d.moves.map(m => <li key={m}>{m}</li>)}
                  </ul>
                )}
                {d.carried && <p>{d.carried} Clients, knocks and history keep their houses; only the route number changes.</p>}
                <p className="text-xs text-gray-500">Nothing else is deleted. The routes' managers see the new numbers next time they open the map.</p>
              </>
            )}
            {state === 'unsaved' && !d.blocked && (
              <div className="text-amber-200 bg-amber-900/20 border border-amber-800/50 rounded px-3 py-2 text-xs">
                This map has changes that aren't saved. Save first: the map reloads after the delete, and unsaved work would be lost.
              </div>
            )}
            {state === 'loading' && !d.blocked && (
              <div className="text-amber-200 bg-amber-900/20 border border-amber-800/50 rounded px-3 py-2 text-xs">
                The map's roads and saved routes haven't loaded yet. Wait for them (or click “Load More Roads”), then try again. Don't save before they show: that would save an empty map.
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-3 text-xs text-red-300 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{error}</div>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={busy} className="flex-1 h-10 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button onClick={run} disabled={!canRun} className="flex-1 h-10 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5">
            {busy ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}{busy ? 'Moving routes…' : `Delete ${code}`}
          </button>
        </div>
      </div>
    </div>
  );
};

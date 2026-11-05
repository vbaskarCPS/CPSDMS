// src/pages/SuperAdmin/RouteMoveModal.tsx — Map Builder: give a route another number (e.g. a route just added as
// WHR147 that belongs at WHR60). The routes in between move one number up or down, across every map with the
// prefix, with everything filed under them (see src/lib/routeShift.ts). Shows what will move first.
import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpDown, Loader, X } from 'lucide-react';
import { describeMove, moveRoute, previewMove, type MoveAnswer } from '../../lib/routeShift';

export const RouteMoveModal: React.FC<{
  prefix: string; number: number; code: string; format: (n: number) => string;
  /** the numbers this map holds, for the hint and the starting value */
  first: number; last: number;
  mapState: () => Promise<'saved' | 'unsaved' | 'loading'>;
  onClose: () => void; onDone: () => void;
}> = ({ prefix, number, code, format, first, last, mapState, onClose, onDone }) => {
  const [to, setTo] = useState<string>('');
  const [preview, setPreview] = useState<MoveAnswer | null>(null);
  const [checking, setChecking] = useState(false);
  const [state, setState] = useState<'saved' | 'unsaved' | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = /^\d+$/.test(to.trim()) ? parseInt(to.trim(), 10) : null;

  useEffect(() => { mapState().then(setState).catch(() => setState('loading')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // what moves, for the number typed (after a short pause)
  useEffect(() => {
    setPreview(null); setError(null);
    if (n == null || n === number) return;
    let live = true; setChecking(true);
    const t = setTimeout(() => {
      previewMove(prefix, number, n).then(p => { if (live) setPreview(p); })
        .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (live) setChecking(false); });
    }, 350);
    return () => { live = false; clearTimeout(t); setChecking(false); };
  }, [prefix, number, n]);

  const run = async () => {
    if (n == null) return;
    setBusy(true); setError(null);
    try {
      const r = await moveRoute(prefix, number, n);
      if (!r.ok) { setPreview(r); return; }
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const d = preview ? describeMove(preview, code) : null;
  const canRun = !!preview?.ok && state === 'saved' && !busy;
  const target = n != null ? format(n) : '';

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Move ${code}`}>
        <div className="flex items-center gap-2 mb-3">
          <ArrowUpDown size={18} className="text-blue-400" />
          <h3 className="text-white font-bold">Move {code} to another number</h3>
          {!busy && <button onClick={onClose} className="ml-auto text-gray-500 hover:text-white" aria-label="Close"><X size={16} /></button>}
        </div>

        <label className="block text-sm text-gray-300 mb-1" htmlFor="move-to">New number</label>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-gray-400 font-mono text-sm">{prefix}</span>
          <input id="move-to" autoFocus inputMode="numeric" value={to} onChange={e => setTo(e.target.value.replace(/[^\d]/g, ''))} placeholder={String(first)}
            className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white font-mono focus:outline-none focus:border-blue-500" />
        </div>
        <p className="text-xs text-gray-500 mb-3">This map's numbers: {format(first)}–{format(last)}. The routes in between move one number to make room.</p>

        {checking && <div className="text-gray-400 text-sm flex items-center gap-2"><Loader size={14} className="animate-spin" /> Checking what moves…</div>}

        {d && (
          <div className="text-sm text-gray-300 space-y-3">
            {d.blocked ? (
              <div className="text-red-300 bg-red-900/20 border border-red-800/50 rounded px-3 py-2 flex gap-2"><AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{d.blocked}</span></div>
            ) : (
              <>
                <p>{code} becomes <b className="text-white">{target}</b>{d.moves.length ? ', and these routes move one number to make room:' : '.'}</p>
                {d.moves.length > 0 && (
                  <ul className="bg-gray-800 rounded-lg px-3 py-2 space-y-1 font-mono text-xs">
                    {d.moves.map(m => <li key={m}>{m}</li>)}
                  </ul>
                )}
                {d.carried && <p>{d.carried} Everything stays on its houses and streets; only the route numbers change.</p>}
                <p className="text-xs text-gray-500">The routes' managers see the new numbers next time they open the map.</p>
              </>
            )}
            {state === 'unsaved' && !d.blocked && (
              <div className="text-amber-200 bg-amber-900/20 border border-amber-800/50 rounded px-3 py-2 text-xs">
                This map has changes that aren't saved. Save first: the map reloads after the move, and unsaved work would be lost.
              </div>
            )}
            {state === 'loading' && !d.blocked && (
              <div className="text-amber-200 bg-amber-900/20 border border-amber-800/50 rounded px-3 py-2 text-xs">
                The map's roads and saved routes haven't loaded yet. Wait for them, then try again.
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-3 text-xs text-red-300 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">{error}</div>}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} disabled={busy} className="flex-1 h-10 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button onClick={run} disabled={!canRun} className="flex-1 h-10 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-1.5">
            {busy ? <Loader size={14} className="animate-spin" /> : <ArrowUpDown size={14} />}{busy ? 'Moving routes…' : target ? `Make it ${target}` : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
};

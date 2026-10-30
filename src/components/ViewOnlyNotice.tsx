// src/components/ViewOnlyNotice.tsx — on the route manager's map: while there's no signal, a small
// "No signal · view only" pill at the top, and if they try to change something (assign a route,
// move a worker, mark a house…) a short note that it didn't happen. Background saves (like the
// manager's own GPS) don't trigger the note: only a change made by a tap in the last few seconds.
// Buttons that change things carry `data-change`: with no signal they're greyed, and a tap on one
// just shows the note.
import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { onChangeBlocked } from '../lib/offline/net';
import { useNoSignal } from './NoSignalCardSheet';

export const ViewOnlyNotice: React.FC = () => {
  const noSignal = useNoSignal();
  const [note, setNote] = useState(false);

  // grey the change buttons while there's no signal
  useEffect(() => {
    if (!document.getElementById('view-only-style')) {
      const st = document.createElement('style'); st.id = 'view-only-style';
      st.textContent = 'body[data-no-signal] [data-change]{opacity:.35!important;filter:grayscale(1);cursor:not-allowed!important}';
      document.head.appendChild(st);
    }
    if (noSignal) document.body.setAttribute('data-no-signal', ''); else document.body.removeAttribute('data-no-signal');
    return () => document.body.removeAttribute('data-no-signal');
  }, [noSignal]);

  useEffect(() => {
    let lastTap = 0;
    const tap = () => { lastTap = Date.now(); };
    window.addEventListener('pointerdown', tap, true);
    window.addEventListener('keydown', tap, true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => { setNote(true); if (timer) clearTimeout(timer); timer = setTimeout(() => setNote(false), 4000); };
    const off = onChangeBlocked(() => { if (Date.now() - lastTap <= 4000) show(); });
    // a tap on a greyed change button does nothing but show the note
    const guard = (e: MouseEvent) => {
      if (!document.body.hasAttribute('data-no-signal')) return;
      if ((e.target as Element | null)?.closest?.('[data-change]')) { e.preventDefault(); e.stopPropagation(); show(); }
    };
    window.addEventListener('click', guard, true);
    return () => {
      off(); window.removeEventListener('click', guard, true);
      window.removeEventListener('pointerdown', tap, true); window.removeEventListener('keydown', tap, true); if (timer) clearTimeout(timer);
    };
  }, []);

  if (!noSignal && !note) return null;
  return (
    <>
      {noSignal && (
        <div role="status" data-view-only style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, pointerEvents: 'none' }}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-900/90 border border-amber-500/60 text-amber-200 text-xs font-bold shadow-lg">
          <WifiOff size={13} /> No signal · view only
        </div>
      )}
      {note && (
        <div role="alert" data-change-blocked style={{ position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, maxWidth: 'calc(100vw - 32px)' }}
          className="px-4 py-3 rounded-xl bg-gray-900 border border-amber-500/70 text-white text-sm shadow-2xl text-center">
          No signal — changes are off for now. They come back on as soon as you have signal.
        </div>
      )}
    </>
  );
};

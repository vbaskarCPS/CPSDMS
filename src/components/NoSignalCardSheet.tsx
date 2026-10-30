// src/components/NoSignalCardSheet.tsx — what a worker sees instead of the card terminal when there's
// no signal. A card can only be taken online, so the choices are: park the sale as Pending (it's
// unpaid until the card goes through — take the card from the pending list once there's signal), or
// take another method now. Nothing about the card is asked for or kept on the phone. If the signal
// comes back while this is open, the terminal opens by itself.
import React, { useEffect, useSyncExternalStore } from 'react';
import { WifiOff, Bookmark, Repeat, X } from 'lucide-react';
import { netState, onNetChange } from '../lib/offline/net';

/** True while the app can't reach the server. */
export const useNoSignal = () => useSyncExternalStore(onNetChange, netState, () => 'online' as const) === 'offline';

export const NoSignalCardSheet: React.FC<{
  /** Park it as a pending sale (team seasons). Leave out where there's no pending list. */
  onSavePending?: () => void;
  /** Pick another payment method. */
  onOtherMethod: () => void;
  /** Signal is back: open the card terminal. */
  onSignalBack: () => void;
  onClose: () => void;
  /** What to call "leave it for later" where there's no pending list (e.g. a booked job stays on the list). */
  laterLabel?: string;
}> = ({ onSavePending, onOtherMethod, onSignalBack, onClose, laterLabel }) => {
  const noSignal = useNoSignal();
  useEffect(() => { if (!noSignal) onSignalBack(); }, [noSignal, onSignalBack]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-4" role="dialog" aria-label="No signal for a card">
      <div className="bg-gray-800 rounded-xl p-5 w-full max-w-sm border border-gray-700 shadow-xl">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 text-amber-300"><WifiOff size={20} /><h3 className="text-lg font-bold">No signal for a card</h3></div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close"><X size={20} /></button>
        </div>
        <p className="text-sm text-gray-300 mb-4">A card needs signal to go through. The terminal opens by itself as soon as you have signal.</p>
        <div className="space-y-2">
          {onSavePending && (
            <button onClick={onSavePending} className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 border border-slate-500 text-white font-bold flex items-center justify-center gap-2">
              <Bookmark size={16} /> Save Pending — take the card later
            </button>
          )}
          <button onClick={onOtherMethod} className="w-full py-3 rounded-lg bg-gray-700 hover:bg-gray-600 border border-gray-600 text-white font-bold flex items-center justify-center gap-2">
            <Repeat size={16} /> Use another method
          </button>
          {laterLabel && <button onClick={onClose} className="w-full py-2 text-sm text-gray-400 hover:text-white">{laterLabel}</button>}
        </div>
      </div>
    </div>
  );
};

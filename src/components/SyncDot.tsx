// src/components/SyncDot.tsx — the little coloured dot in a field user's header (no words):
//   green  = reaching the server, everything sent
//   yellow = reaching the server, but some of this phone's work is still waiting to send
//   grey   = no signal right now (the app keeps working from the phone's copy)
// Yellow comes from the outbox (workers only); route managers never have anything waiting.
import React, { useSyncExternalStore } from 'react';
import { netState, onNetChange } from '../lib/offline/net';

export type SyncColour = 'green' | 'yellow' | 'grey';
const COLOURS: Record<SyncColour, string> = { green: '#22c55e', yellow: '#facc15', grey: '#9ca3af' };
const LABELS: Record<SyncColour, string> = { green: 'Synced', yellow: 'Waiting to send', grey: 'No signal' };

/** Which colour, from the connection and whether anything is waiting. */
export const syncColour = (online: boolean, waiting: number): SyncColour => (!online ? 'grey' : waiting > 0 ? 'yellow' : 'green');

export const SyncDot: React.FC<{ waiting?: number; size?: number; className?: string }> = ({ waiting = 0, size = 10, className }) => {
  const state = useSyncExternalStore(onNetChange, netState, () => 'online' as const);
  const colour = syncColour(state === 'online', waiting);
  return (
    <span role="status" aria-label={LABELS[colour]} title={LABELS[colour]} data-sync={colour} className={className}
      style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: COLOURS[colour], flexShrink: 0,
        boxShadow: `0 0 0 2px rgba(0,0,0,.35), 0 0 6px ${COLOURS[colour]}88` }} />
  );
};

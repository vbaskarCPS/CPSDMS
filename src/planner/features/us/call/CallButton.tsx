// src/planner/features/us/call/CallButton.tsx — the video button in the header of their chat. A tap calls the other
// one: the camera comes on, the call screen opens (CallLayer) and their phone is rung (phone.ts). Not in the demo.
import { useSyncExternalStore } from 'react';
import { Video } from 'lucide-react';
import { otherName } from '../us';
import { callView, canCall, onCall, startCall } from './phone';
import './call.css';

export function CallButton() {
  const v = useSyncExternalStore(onCall, callView);
  if (!canCall()) return null;
  const busy = v.phase !== 'idle' && v.phase !== 'over';
  return (
    <button type="button" className="arvy-icon call-btn" disabled={busy} onClick={() => void startCall()} aria-label={`Video call ${otherName()}`} title="Video call">
      <Video />
    </button>
  );
}

// src/planner/features/us/call/CallBanner.tsx — the banner above every screen when the other one is calling:
// "<Name> is calling", with Answer and Decline. It rings softly and buzzes while it shows (ring.ts, started by
// phone.ts). The same place says when a call was missed, with a button to call back.
import { useSyncExternalStore } from 'react';
import { PhoneMissed, PhoneOff, Video } from 'lucide-react';
import { answerCall, callView, declineCall, missedOk, onCall, startCall } from './phone';
import './call.css';

const nameOf = (username: string) => username.charAt(0).toUpperCase() + username.slice(1);
/** When a call came in: the time today, the day and the time before that. */
export function calledAt(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

export function CallBanner() {
  const v = useSyncExternalStore(onCall, callView);
  if (v.ringing) {
    const name = nameOf(v.ringing.from);
    return (
      <div className="call-banner is-ringing" role="alertdialog" aria-label={`${name} is calling`}>
        <div className="call-banner-who">
          <span className="call-face" aria-hidden>{name.charAt(0)}</span>
          <div><b>{name} is calling</b><span>Video call</span></div>
        </div>
        <div className="call-banner-btns">
          <button type="button" className="call-no" onClick={declineCall}><PhoneOff aria-hidden /> Decline</button>
          <button type="button" className="call-yes" onClick={() => void answerCall()}><Video aria-hidden /> Answer</button>
        </div>
      </div>
    );
  }
  if (v.missed && (v.phase === 'idle' || v.phase === 'over')) {
    const name = nameOf(v.missed.from);
    return (
      <div className="call-banner" role="status">
        <div className="call-banner-who">
          <span className="call-face is-missed" aria-hidden><PhoneMissed /></span>
          <div><b>{v.missed.count > 1 ? `${v.missed.count} missed video calls` : 'Missed video call'}</b><span>{name} · {calledAt(v.missed.at)}</span></div>
        </div>
        <div className="call-banner-btns">
          <button type="button" className="call-quiet" onClick={missedOk}>OK</button>
          <button type="button" className="call-yes" onClick={() => void startCall()}><Video aria-hidden /> Call back</button>
        </div>
      </div>
    );
  }
  return null;
}

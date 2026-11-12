// src/planner/features/us/call/CallLayer.tsx — the call itself, over the whole screen: the other one large, yourself
// small in a corner; mute, camera off, flip the camera, hang up; a timer; "Calling …" and "Connecting…" until the two
// phones have each other, and a plain line afterwards if it didn't work out. `Calls` is what the app mounts, once,
// above every screen (ui/Shell.tsx): it starts the watch for calls and holds this layer and the banner.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, MicOff, PhoneOff, SwitchCamera, Video, VideoOff } from 'lucide-react';
import { isDemo } from '../../../lib/app';
import { clock } from './call';
import { CallBanner } from './CallBanner';
import { callView, closeOver, flipCamera, hangUp, onCall, startCalls, toggleCamera, toggleMute } from './phone';
import './call.css';

/** Put a camera's picture on a video element, and start it (a phone may hold the sound back until a touch). */
function show(el: HTMLVideoElement | null, stream: MediaStream | null): void {
  if (!el) return;
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream) void el.play().catch(() => undefined);
}

export function CallLayer() {
  const v = useSyncExternalStore(onCall, callView);
  const them = useRef<HTMLVideoElement>(null), me = useRef<HTMLVideoElement>(null);
  const [, setBeat] = useState(0);
  // their picture fills the screen when it is the same way up as this phone; a wide picture on a tall screen (they
  // are on a laptop, or holding the phone sideways) is shown whole instead, so their face isn't cut off
  const [shape, setShape] = useState<'wide' | 'tall' | ''>('');
  const sized = (el: HTMLVideoElement) => setShape(!el.videoWidth || !el.videoHeight ? '' : el.videoWidth > el.videoHeight ? 'wide' : 'tall');
  const up = v.phase !== 'idle' && v.phase !== 'over';
  useEffect(() => { show(me.current, v.local); }, [v.local, up]);
  useEffect(() => { show(them.current, v.remote); }, [v.remote, up]);
  // the timer: once a second while the two are talking
  useEffect(() => {
    if (v.phase !== 'live') return;
    const id = window.setInterval(() => setBeat(n => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [v.phase]);
  if (v.phase === 'idle') return null;
  if (v.phase === 'over') {
    return (
      <div className="call-layer is-over" role="dialog" aria-modal="true" aria-label="Video call">
        <div className="call-over" role="status">
          <h2>{v.over?.title}</h2>
          {v.over?.more && <p>{v.over.more}</p>}
          <button type="button" className="pl-btn pl-btn--primary" onClick={closeOver}>Close</button>
        </div>
      </div>
    );
  }
  const live = v.phase === 'live';
  const status = live ? (v.shaky ? 'Reconnecting…' : clock((Date.now() - (v.liveAt || Date.now())) / 1000))
    : v.phase === 'starting' || v.phase === 'calling' ? `Calling ${v.name}…` : 'Connecting…';
  const seeThem = live && !v.theirCamOff;
  return (
    <div className={`call-layer ${live ? 'is-live' : 'is-waiting'}`} role="dialog" aria-modal="true" aria-label={`Video call with ${v.name}`}
      onPointerDown={() => { if (them.current?.paused && v.remote) void them.current.play().catch(() => undefined); }}>
      <video ref={them} className={`call-them ${shape ? `is-${shape}` : ''} ${seeThem ? '' : 'is-hidden'}`} autoPlay playsInline aria-label={v.name}
        onLoadedMetadata={e => sized(e.currentTarget)} onResize={e => sized(e.currentTarget)} />
      <video ref={me} className={`call-me ${v.mirrored ? 'is-mirrored' : ''} ${v.camOff || !v.local ? 'is-hidden' : ''}`} autoPlay playsInline muted aria-label="You" />
      <div className="call-top">
        <b>{v.name}</b>
        <span role="status" aria-live={live ? 'off' : 'polite'}>{status}</span>
        {v.note && <small>{v.note}</small>}
      </div>
      {!seeThem && (
        <div className="call-mid">
          <span className="call-face" aria-hidden>{v.name.charAt(0)}</span>
          {live && <span>{v.name}’s camera is off</span>}
        </div>)}
      {live && v.camOff && <div className="call-me call-me-off">Your camera is off</div>}
      <div className="call-bar">
        <button type="button" className={`call-key ${v.muted ? 'is-off' : ''}`} disabled={!v.local} onClick={toggleMute} aria-pressed={v.muted}>
          <i>{v.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}</i>{v.muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" className={`call-key ${v.camOff ? 'is-off' : ''}`} disabled={!v.local} onClick={toggleCamera} aria-pressed={v.camOff}>
          <i>{v.camOff ? <VideoOff aria-hidden /> : <Video aria-hidden />}</i>{v.camOff ? 'Camera on' : 'Camera off'}
        </button>
        {v.canFlip && (
          <button type="button" className="call-key" disabled={!v.local || v.camOff} onClick={() => void flipCamera()}>
            <i><SwitchCamera aria-hidden /></i>Flip
          </button>)}
        <button type="button" className="call-key call-end" onClick={hangUp}>
          <i><PhoneOff aria-hidden /></i>Hang up
        </button>
      </div>
    </div>
  );
}

/** Video calls, mounted once above every screen: the watch for the other one calling, the banner and the call. */
export function Calls() {
  useEffect(() => startCalls(), []);
  if (isDemo()) return null;
  return <><CallLayer /><CallBanner /></>;
}

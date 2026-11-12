// src/planner/features/us/call/phone.ts — a video call on this phone. It keeps a light eye on the call docs (is the
// other one calling? what has their side said?), turns the camera and microphone on for a call and off the moment
// it ends, connects the two phones to each other, and holds what the banner and the call screen show.
// The rules are in call.ts; no React here (CallBanner, CallLayer and CallButton read `callView`).
//
// How two phones find each other with no call server: each collects its own connection details (its addresses, as
// the STUN server below sees them), then saves them once, in its own doc: the caller's offer in call/<id>, the
// answer in call/<id>~answer. Each phone reads the other's doc, and the video then runs straight between them.
import { getPass } from '../../../lib/auth';
import { isDemo } from '../../../lib/app';
import { getDoc, getDocs, putDoc, putDocs } from '../../../lib/docs';
import { logArvy } from '../../arvy/log';
import { otherName, say } from '../us';
import { CALL_KIND, CALL_TEXT, KEEP_MS, TIMES_KEY, answerKey, callKey, cameraProblem, doneKeys, endWords, missedFor, newCallId, nextStep, oldKeys, pairsFrom, pollEvery, ringingFor, timesFrom,
  type AnswerDoc, type CallDoc, type Ended, type EndWhy, type Missed, type Pair, type Phase, type Step, type Times } from './call';
import { startRing } from './ring';

/** The servers that help the two phones find each other: the one list, used for every call. A STUN server only tells
 *  a phone its own address as the internet sees it; the video itself goes phone to phone. If calls turn out to fail on
 *  mobile data ("Couldn't connect"), a relay (TURN) server gets added HERE, as one more entry:
 *  { urls: 'turn:…', username: '…', credential: '…' }. Nothing else needs to change. */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

type Facing = 'user' | 'environment';
/** What the banner, the call screen and the button show. */
export interface CallView {
  /** idle = no call on this phone */ phase: Phase;
  /** the other one's first name */ name: string;
  /** this phone's camera, and theirs */ local: MediaStream | null; remote: MediaStream | null;
  muted: boolean; camOff: boolean; theirCamOff: boolean;
  /** the picture of yourself is flipped like a mirror (the front camera) */ mirrored: boolean;
  /** this phone has a second camera to flip to */ canFlip: boolean;
  /** when the two phones connected (for the timer) */ liveAt: number | null;
  /** mid-call, the connection has gone quiet */ shaky: boolean;
  /** the call is over: what to say about it */ over: { title: string; more?: string } | null;
  /** a small line under the name (the notification didn't go out, the other camera didn't open) */ note: string | null;
  /** the other one is calling: the banner */ ringing: CallDoc | null;
  /** a call from them that was missed */ missed: Missed | null;
}
const QUIET = { local: null, remote: null, muted: false, camOff: false, theirCamOff: false, mirrored: true, canFlip: false, liveAt: null, shaky: false, over: null, note: null };
let view: CallView = { phase: 'idle', name: '', ...QUIET, ringing: null, missed: null };
const watchers = new Set<() => void>();
function set(patch: Partial<CallView>): void { view = { ...view, ...patch }; for (const fn of [...watchers]) fn(); }
export const onCall = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };
export const callView = (): CallView => view;

const me = () => getPass()?.user.username || '';
const them = () => { const n = otherName(me()); return n === 'Household' ? '' : n.toLowerCase(); };
const nameOf = (username: string) => username.charAt(0).toUpperCase() + username.slice(1);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const times = (): Times => { try { return timesFrom(localStorage.getItem(TIMES_KEY)); } catch { return timesFrom(null); } };
/** Can a call be made from here? Not in the demo, and only between the two of them. */
export const canCall = (): boolean => !isDemo() && !!them();

/** This phone's side of the one call it is in. */
interface Session {
  id: string; role: 'caller' | 'callee'; phase: Phase;
  /** the caller's doc: mine once it is saved, theirs when I'm the one answering */ call: CallDoc | null;
  /** my answer, when I'm the one called */ mine: AnswerDoc | null;
  /** my doc is saved, so the other phone can see it */ wrote: boolean;
  /** how it ended, for my doc */ ended: Ended | null;
  pc: RTCPeerConnection | null; line: RTCDataChannel | null; video: RTCRtpSender | null;
  stream: MediaStream | null; facing: Facing; flipping: boolean;
  connectingAt?: number; liveAt?: number; lost: number; closing: number;
  /** over: nothing more may happen on it */ dead: boolean;
}
let session: Session | null = null;
const inCall = () => !!session && !session.dead;
const newSession = (role: Session['role'], call: CallDoc | null): Session =>
  ({ id: call?.id || newCallId(), role, phase: 'idle', call, mine: null, wrote: false, ended: null, pc: null, line: null, video: null, stream: null, facing: 'user', flipping: false, lost: 0, closing: 0, dead: false });

// ── the docs ──
let pairs: Pair[] = [];
let seenAt: string | null = null;       // the newest call they've been told about; null = not read yet
const putAside = new Set<string>();     // calls this phone has declined or taken: their banner doesn't come back
const gone = new Set<string>();         // docs this phone has already thrown away
let reading: Promise<void> | null = null;
/** Read the calls of the last day. One read at a time, so an old answer never lands on top of a newer one. It stops
 *  waiting after a few seconds (the read may still land later): on a connection that has gone quiet, what was last
 *  seen stands and the waits still run out, so a call never hangs on a read. */
function refresh(): Promise<void> {
  reading ||= (async () => {
    try {
      const from = Math.min(Date.now() - KEEP_MS, session?.call ? Date.parse(session.call.at) : Infinity);
      pairs = pairsFrom(await getDocs(CALL_KIND, iso(from)));
    } catch { /* offline: the same */ }
    finally { reading = null; }
  })();
  return Promise.race([reading, new Promise<void>(done => window.setTimeout(done, 5000))]);
}
function markSeen(at = iso()): void {
  if (seenAt !== null && at <= seenAt) return;
  seenAt = at;
  void putDoc('prefs', 'callseen', { at }).catch(() => undefined);
}
let asking = false;
/** Read which calls they have already been told about (asked again at the next look if it didn't come through). */
function readSeen(): void {
  if (seenAt !== null || asking) return;
  asking = true;
  getDoc<{ at?: string }>('prefs', 'callseen').then(d => { const at = d?.at || ''; if (seenAt === null || at > seenAt) seenAt = at; look(); }, () => undefined).finally(() => { asking = false; });
}

// ── keeping an eye on it ──
let stopRing: (() => void) | null = null;
/** From the docs as last read: move this phone's call along, and say whether the other one is calling or was missed. */
function look(): void {
  if (!running) return;
  const now = Date.now(), t = times();
  const s = session;
  // a call this phone has declined or taken is not rung for again, given way to, or called missed (this phone's own
  // answer to it may not be back from the server yet)
  const others = pairs.filter(p => !putAside.has(p.call.id));
  if (s && !s.dead && s.call) act(s, nextStep({ role: s.role, phase: s.phase, id: s.id, at: s.call.at, connectingAt: s.connectingAt }, pairs.filter(p => p.call.id === s.id || !putAside.has(p.call.id)), me(), now, t));
  const ringing = inCall() ? null : ringingFor(others, me(), now, t);
  const missed = inCall() || ringing || seenAt === null ? null : missedFor(others, me(), seenAt, now, t);
  if ((ringing?.id || '') !== (view.ringing?.id || '')) {
    stopRing?.(); stopRing = ringing ? startRing() : null;
  }
  if (ringing?.id !== view.ringing?.id || missed?.at !== view.missed?.at || missed?.count !== view.missed?.count) set({ ringing, missed });
  // calls that are over and have nothing left to tell anyone are thrown away (by whichever phone gets there first)
  const done = doneKeys(pairs, me(), seenAt, now, t).filter(k => !gone.has(k));
  if (done.length) {
    for (const k of done) gone.add(k);
    void putDocs(done.map(key => ({ kind: CALL_KIND, key, data: null }))).catch(() => { for (const k of done) gone.delete(k); });
  }
}
async function tick(): Promise<void> {
  if (!getPass()) return;
  readSeen();
  await refresh();
  look();
}
let timer = 0, running = false;
function schedule(): void {
  window.clearTimeout(timer);
  if (!running) return;
  // about once a second while a call is being set up or this phone is ringing, every few seconds otherwise, and not
  // at all while the planner is in the background
  timer = window.setTimeout(async () => { if (document.visibilityState === 'visible') await tick(); schedule(); }, pollEvery(inCall() ? session!.phase : 'idle', !!view.ringing));
}
/** Start watching for calls (CallLayer.tsx does, while someone is signed in). Returns the stop. */
export function startCalls(): () => void {
  if (isDemo()) return () => undefined;
  running = true;
  const wake = () => { if (document.visibilityState !== 'visible') return; void tick(); schedule(); if (inCall()) void holdAwake(); };
  const leave = () => hangUp();   // the planner is being closed: the call ends, and the other phone is told
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('pagehide', leave);
  void tick();
  // once per open: anything older than a day goes, whatever state it was left in
  void getDocs(CALL_KIND).then(docs => { const old = oldKeys(docs, Date.now()); if (old.length) return putDocs(old.map(key => ({ kind: CALL_KIND, key, data: null }))); }).catch(() => undefined);
  schedule();
  return () => {
    running = false; window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', wake); window.removeEventListener('pagehide', leave);
    hangUp(); closeOver();
    stopRing?.(); stopRing = null;
    pairs = []; seenAt = null; putAside.clear();
    set({ ringing: null, missed: null });
  };
}

// ── the camera and the screen ──
const wants = (facing: Facing): MediaTrackConstraints => ({ facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } });
async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw Object.assign(new Error('no calls'), { name: 'NoCalls' });
  return opened(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: wants('user') }));
}
// every camera and microphone track this phone has switched on for the call. A call that ends, however it ends,
// stops them all: that is what puts the camera light out.
const on = new Set<MediaStreamTrack>();
const opened = (stream: MediaStream): MediaStream => { for (const t of stream.getTracks()) on.add(t); return stream; };
const stopTrack = (t: MediaStreamTrack | undefined) => { if (!t) return; try { t.stop(); } catch { /* already stopped */ } on.delete(t); };
const stopAll = (stream?: MediaStream | null) => { for (const t of stream ? stream.getTracks() : [...on]) stopTrack(t); };
/** Is the picture from this track the front camera's (shown like a mirror)? */
const isFront = (t: MediaStreamTrack | undefined) => t?.getSettings?.().facingMode !== 'environment';
async function countCameras(): Promise<number> {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').length; } catch { return 1; }
}
// the screen stays awake during a call, where the phone allows it (it lets go by itself in the background)
let lock: WakeLockSentinel | null = null;
async function holdAwake(): Promise<void> {
  try { if (!lock || lock.released) lock = await navigator.wakeLock?.request('screen') ?? null; } catch { /* this phone doesn't allow it */ }
  if (!inCall()) letSleep();
}
function letSleep(): void { try { void lock?.release().catch(() => undefined); } catch { /* already let go */ } lock = null; }

// ── the connection ──
/** Wait until this phone has collected all its connection details, or long enough. */
function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  return new Promise(done => {
    if (pc.iceGatheringState === 'complete') { done(); return; }
    const t = window.setTimeout(end, ms);
    function end() { window.clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); done(); }
    function check() { if (pc.iceGatheringState === 'complete') end(); }
    pc.addEventListener('icegatheringstatechange', check);
  });
}
function makePc(s: Session, stream: MediaStream): RTCPeerConnection {
  // one connection carries the sound, the picture and the line of words (max-bundle): one set of addresses to
  // collect instead of three, so a call is set up sooner
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, bundlePolicy: 'max-bundle' });
  s.pc = pc;
  for (const t of stream.getTracks()) { const sender = pc.addTrack(t, stream); if (t.kind === 'video') s.video = sender; }
  // a line of words between the two phones, next to the video: "bye" and "my camera is off" arrive at once this way,
  // without waiting for the next look at the docs
  try {
    const line = pc.createDataChannel('call', { negotiated: true, id: 0 });
    s.line = line;
    line.onopen = () => tell(s, view.camOff ? 'cam:off' : 'cam:on');
    line.onmessage = e => {
      if (s.dead) return;
      if (e.data === 'bye') finish(s, 'hangup', 'them');
      else if (e.data === 'cam:off' || e.data === 'cam:on') set({ theirCamOff: e.data === 'cam:off' });
    };
  } catch { /* no line: the docs and the connection itself still say when it's over */ }
  pc.ontrack = e => { if (!s.dead && e.streams[0] && view.remote !== e.streams[0]) set({ remote: e.streams[0] }); };
  const state = () => {
    if (s.dead || s.pc !== pc) return;
    const c = pc.connectionState, i = pc.iceConnectionState;
    if (c ? c === 'connected' : i === 'connected' || i === 'completed') {
      window.clearTimeout(s.lost); s.lost = 0;
      s.liveAt ||= Date.now(); s.phase = 'live';
      set({ phase: 'live', liveAt: s.liveAt, shaky: false });
      schedule();
    } else if (c === 'failed' || i === 'failed') finish(s, s.liveAt ? 'dropped' : 'failed', 'me');
    else if ((c === 'disconnected' || i === 'disconnected') && s.liveAt && !s.lost) {
      // gone quiet mid-call: it often comes back by itself (a lift, a switch from Wi-Fi), so it gets a little while
      set({ shaky: true });
      s.lost = window.setTimeout(() => finish(s, 'dropped', 'me'), times().lostMs);
    }
  };
  pc.onconnectionstatechange = state; pc.oniceconnectionstatechange = state;
  return pc;
}
function tell(s: Session, words: string): void { try { if (s.line?.readyState === 'open') s.line.send(words); } catch { /* the line is down */ } }

function act(s: Session, step: Step): void {
  if (step.do === 'end') finish(s, step.why, step.by);
  else if (step.do === 'connect') {
    // they answered: with their connection details in, the two phones start reaching for each other
    s.phase = 'connecting'; s.connectingAt = Date.now();
    set({ phase: 'connecting' });
    s.pc?.setRemoteDescription({ type: 'answer', sdp: step.answer }).catch(() => finish(s, 'failed', 'me'));
  } else if (step.do === 'yield') {
    // both called at once and theirs was first: mine is dropped, and theirs is answered with the camera already on
    const stream = s.stream;
    finish(s, 'crossed', 'me', undefined, true);
    void answer(step.to, stream);
  }
}

/** Call the other one: camera and microphone on, "Calling …", then their phone is rung (the doc they watch for, and a
 *  chat message so they get the usual notification). */
export async function startCall(): Promise<void> {
  if (!canCall() || inCall()) return;
  closeOver();
  if (view.ringing) { await answerCall(); return; }   // they are calling right now: that call is answered instead
  const s = session = newSession('caller', null);
  s.phase = 'starting';
  markSeen();
  set({ phase: 'starting', name: otherName(me()), ...QUIET, ringing: null, missed: null });
  void holdAwake(); schedule();
  let stream: MediaStream;
  try { stream = await openCamera(); }
  catch (e) { finish(s, 'cancelled', 'me', { title: 'The call didn’t start', more: cameraProblem((e as { name?: string } | null)?.name) }); return; }
  if (s.dead) { stopAll(stream); return; }   // they gave up while the phone was asking
  s.stream = stream;
  set({ local: stream, mirrored: isFront(stream.getVideoTracks()[0]) });
  void countCameras().then(n => { if (!s.dead) set({ canFlip: n > 1 }); });
  try {
    const pc = makePc(s, stream);
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, times().gatherMs);
    if (s.dead) return;
    // one last look before their phone is rung: if they have just called, theirs is answered and mine is never sent
    await refresh();
    if (s.dead) return;
    const theirs = ringingFor(pairs, me(), Date.now(), times());
    if (theirs && !putAside.has(theirs.id)) { finish(s, 'crossed', 'me', undefined, true); await answer(theirs, stream); return; }
    s.call = { id: s.id, from: me(), to: them(), at: iso(), offer: pc.localDescription?.sdp || '' };
    await putDoc(CALL_KIND, callKey(s.call), s.call);
    s.wrote = true;
    if (s.dead) { writeEnd(s, 'me'); return; }   // hung up while it was being saved: their phone is told so
    s.phase = 'calling';
    set({ phase: 'calling' });
    schedule();
    say(CALL_TEXT).catch(() => { if (!s.dead) set({ note: `The notification didn’t go out. ${view.name} will only see this call with the planner open.` }); });
  } catch { finish(s, 'cancelled', 'me', { title: 'The call didn’t start', more: 'Check your connection and try again.' }); }
}

/** Answer the call that is ringing. */
export async function answerCall(): Promise<void> {
  const c = view.ringing;
  if (c && !inCall()) await answer(c, null);
}
async function answer(call: CallDoc, had: MediaStream | null): Promise<void> {
  closeOver();
  const s = session = newSession('callee', call);
  s.phase = 'answering';
  putAside.add(call.id);   // however this goes, this phone has taken the call: it doesn't ring for it again
  stopRing?.(); stopRing = null;
  markSeen();
  set({ phase: 'answering', name: nameOf(call.from), ...QUIET, local: had, ringing: null, missed: null });
  void holdAwake(); schedule();
  let stream = had;
  if (!stream) {
    // the phone refused the camera: the caller is told the call was declined, and this phone says why
    try { stream = await openCamera(); }
    catch (e) { finish(s, 'declined', 'me', { title: 'The call didn’t start', more: cameraProblem((e as { name?: string } | null)?.name) }); return; }
  }
  if (s.dead) { stopAll(stream); return; }
  s.stream = stream;
  set({ local: stream, mirrored: isFront(stream.getVideoTracks()[0]) });
  void countCameras().then(n => { if (!s.dead) set({ canFlip: n > 1 }); });
  try {
    const pc = makePc(s, stream);
    await pc.setRemoteDescription({ type: 'offer', sdp: call.offer || '' });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc, times().gatherMs);
    if (s.dead) return;
    s.mine = { id: call.id, by: me(), at: iso(), state: 'answered', answer: pc.localDescription?.sdp || '' };
    await putDoc(CALL_KIND, answerKey(call), s.mine);
    s.wrote = true;
    if (s.dead) { writeEnd(s, 'me'); return; }
    if (s.phase === 'answering') { s.phase = 'connecting'; s.connectingAt = Date.now(); set({ phase: 'connecting' }); }
    schedule();
  } catch { finish(s, 'failed', 'me'); }
}
/** Decline the call that is ringing: the banner goes, and the caller's phone says so. */
export function declineCall(): void {
  const c = view.ringing;
  if (!c) return;
  putAside.add(c.id);
  void putDoc(CALL_KIND, answerKey(c), { id: c.id, by: me(), at: iso(), state: 'declined' } satisfies AnswerDoc).catch(() => undefined);
  look();
}

/** Hang up, from either side and at any point (before an answer it takes the call back). */
export function hangUp(): void {
  const s = session;
  if (!s || s.dead) return;
  finish(s, s.liveAt ? 'hangup' : s.role === 'caller' ? 'cancelled' : s.wrote ? 'hangup' : 'declined', 'me');
}
/** Close the "call ended" screen. */
export function closeOver(): void {
  const s = session;
  if (!s || !s.dead) return;
  window.clearTimeout(s.closing);
  session = null;
  set({ phase: 'idle', ...QUIET });
  look();
}

/** The one way a call ends on this phone, whatever the reason: the camera and microphone are released, the connection
 *  is closed, this phone's doc is marked ended (so the other phone ends too), and the screen says what happened. */
function finish(s: Session, why: EndWhy, by: 'me' | 'them', words?: { title: string; more?: string }, keepCamera = false): void {
  if (s.dead) return;
  s.dead = true;
  window.clearTimeout(s.lost);
  const secs = s.liveAt ? Math.max(1, Math.round((Date.now() - s.liveAt) / 1000)) : undefined;
  s.ended = { at: iso(), why, ...(secs ? { secs } : {}) };
  if (why === 'failed') logFailed(s);
  if (by === 'me') tell(s, 'bye');
  // every track is stopped (the camera light goes off here), then the connection is closed, a moment later so "bye"
  // gets out. The one exception: this call gave way to theirs, which is answered with the same camera.
  if (!keepCamera) stopAll();
  s.stream = null;
  const pc = s.pc; s.pc = null;
  if (pc) {
    pc.ontrack = null; pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null;
    window.setTimeout(() => { try { pc.close(); } catch { /* already closed */ } }, 250);
  }
  if (!keepCamera) letSleep();
  writeEnd(s, by);
  const text = words || endWords(why, by, view.name, secs);
  if (session !== s) return;
  if (!text) { session = null; set({ phase: 'idle', ...QUIET }); }
  else {
    s.phase = 'over';
    set({ phase: 'over', ...QUIET, over: text });
    if (why === 'hangup') s.closing = window.setTimeout(closeOver, 2500);   // an ordinary ending closes by itself
  }
  schedule();
}
/** Mark my own doc ended, without its connection details. The other phone reads this and ends too. */
function writeEnd(s: Session, by: 'me' | 'them'): void {
  if (!s.call || !s.ended) return;
  const save = (key: string, data: CallDoc | AnswerDoc) => { void putDoc(CALL_KIND, key, data).catch(() => undefined); };
  if (s.role === 'caller') {
    if (s.wrote) save(callKey(s.call), { id: s.call.id, from: s.call.from, to: s.call.to, at: s.call.at, ended: s.ended });
  } else if (s.wrote && s.mine) save(answerKey(s.call), { id: s.mine.id, by: s.mine.by, at: s.mine.at, state: 'answered', ended: s.ended });
  else if (by === 'me') save(answerKey(s.call), { id: s.call.id, by: me(), at: s.ended.at, state: 'declined' });   // backed out before answering
}
/** "Couldn't connect" goes in Arvy's log, so it can be seen how often it happens: it is the case a relay would fix.
 *  What kinds of address each phone offered is noted; the addresses themselves are not. */
function logFailed(s: Session): void {
  const kinds = (sdp?: string) => {
    const n: Record<string, number> = {};
    for (const m of (sdp || '').matchAll(/^a=candidate:.* typ (\w+)/gm)) n[m[1]] = (n[m[1]] || 0) + 1;
    return Object.entries(n).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  };
  const net = (navigator as unknown as { connection?: { type?: string; effectiveType?: string } }).connection;
  void logArvy({
    type: 'error', area: 'call', path: 'us/call',
    title: `Video call couldn’t connect (${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`,
    detail: [`${s.role === 'caller' ? 'Calling' : 'Answering a call from'} ${view.name}.`, `Connection: ${s.pc?.connectionState || 'unknown'}, ice: ${s.pc?.iceConnectionState || 'unknown'}.`,
      `Addresses offered by this phone: ${kinds(s.pc?.localDescription?.sdp)}; by the other: ${kinds(s.pc?.remoteDescription?.sdp)}.`,
      net?.type || net?.effectiveType ? `Network: ${[net.type, net.effectiveType].filter(Boolean).join(', ')}.` : '',
      'If this keeps happening on mobile data, a relay (TURN) server in ICE_SERVERS (us/call/phone.ts) is the fix.'].filter(Boolean).join(' '),
  });
}

// ── the buttons during a call ──
export function toggleMute(): void {
  const s = session;
  if (!s?.stream || s.dead) return;
  const muted = !view.muted;
  for (const t of s.stream.getAudioTracks()) t.enabled = !muted;
  set({ muted });
}
export function toggleCamera(): void {
  const s = session;
  if (!s?.stream || s.dead) return;
  const camOff = !view.camOff;
  for (const t of s.stream.getVideoTracks()) t.enabled = !camOff;
  set({ camOff });
  tell(s, camOff ? 'cam:off' : 'cam:on');
}
/** Front camera to back, and back again. */
export async function flipCamera(): Promise<void> {
  const s = session;
  if (!s?.stream || s.dead || s.flipping) return;
  s.flipping = true;
  const old = s.stream.getVideoTracks()[0], sound = s.stream.getAudioTracks();
  const swap = async (facing: Facing) => {
    const next = opened(await navigator.mediaDevices.getUserMedia({ video: wants(facing) })).getVideoTracks()[0];
    if (s.dead) { stopTrack(next); return; }
    next.enabled = !view.camOff;
    await s.video?.replaceTrack(next);
    if (s.dead) { stopTrack(next); return; }
    s.facing = facing;
    s.stream = new MediaStream([...sound, next]);
    set({ local: s.stream, mirrored: isFront(next), note: null });
  };
  try {
    stopTrack(old);   // most phones open one camera at a time: the one that's on goes first
    try { await swap(s.facing === 'user' ? 'environment' : 'user'); }
    catch { await swap(s.facing); if (!s.dead) set({ note: 'The other camera didn’t open.' }); }
  } catch { if (!s.dead) set({ camOff: true, note: 'The camera didn’t come back on. Hang up and call again.' }); }
  finally { s.flipping = false; }
}

// ── a missed call ──
/** "OK" on a missed call: it isn't shown again. */
export function missedOk(): void { markSeen(); look(); }

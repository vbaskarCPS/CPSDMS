// src/planner/features/us/call/call.ts — video calls between the two of them: the plain rules. No camera, no network
// and no React in here (phone.ts runs a call on this phone; CallBanner and CallLayer draw it).
//
// There is no call server. The two phones leave each other their connection details in planner docs of kind 'call',
// which the household shares the way it shares the chat. A call is two docs, and each phone only ever writes its own:
//   call/<started>~<id>          by the one calling: who is calling whom, and their connection details (the offer)
//   call/<started>~<id>~answer   by the one called: answered (with their connection details), or declined
// Each side marks its own doc `ended` when it is done, and its connection details are wiped at that moment.
// What this file decides: whose phone should be ringing, what a phone in a call does next (they answered, they
// declined, nobody answered, it never connected, the other one hung up), what happens when both call at once, which
// calls were missed, which docs can be thrown away, and the words for all of it.

export const CALL_KIND = 'call';
/** The chat message a call leaves (sent through the chat's own say(), so the other phone gets the usual notification). */
export const CALL_TEXT = '📞 Video call';

/** How a call came to an end. cancelled = the caller hung up before an answer; failed = it was answered but the two
 *  phones never reached each other; dropped = they were talking and the connection went; crossed = both called at
 *  once and this one gave way to the other. */
export type EndWhy = 'hangup' | 'cancelled' | 'declined' | 'noanswer' | 'failed' | 'dropped' | 'crossed';
export interface Ended { at: string; why: EndWhy; /** how long they talked, in seconds, if they did */ secs?: number }
/** call/<at>~<id>: written only by the one calling. */
export interface CallDoc { id: string; from: string; to: string; at: string; offer?: string; ended?: Ended }
/** call/<at>~<id>~answer: written only by the one called. */
export interface AnswerDoc { id: string; by: string; at: string; state: 'answered' | 'declined'; answer?: string; ended?: Ended }
/** A call as both phones see it: the caller's doc, and the answer if there is one. */
export interface Pair { call: CallDoc; answer?: AnswerDoc }

const ANSWER = '~answer';
export const callKey = (c: Pick<CallDoc, 'at' | 'id'>): string => `${c.at}~${c.id}`;
export const answerKey = (c: Pick<CallDoc, 'at' | 'id'>): string => `${callKey(c)}${ANSWER}`;
export const newCallId = (): string => Math.random().toString(36).slice(2, 10);

// ── how long things wait ──
export interface Times {
  /** how long the other phone rings */ ringMs: number;
  /** a little longer the caller waits past that: an Answer tapped on the last ring still needs a moment to arrive */ graceMs: number;
  /** answered, but the two phones haven't reached each other after this long: "couldn't connect" */ connectMs: number;
  /** the longest a phone spends collecting its connection details before sending what it has */ gatherMs: number;
  /** mid-call, the connection has been silent this long: the call has dropped */ lostMs: number;
  /** a call that is over keeps its docs this long, so the other phone is sure to have seen how it ended; then they go */ tidyMs: number;
}
export const TIMES: Times = { ringMs: 60_000, graceMs: 4_000, connectMs: 25_000, gatherMs: 4_000, lostMs: 10_000, tidyMs: 120_000 };
/** Where a test keeps shorter waits (localStorage, as JSON: {"ringMs": 4000}), so "no answer" needn't take a minute. */
export const TIMES_KEY = 'planner-call-times';
export function timesFrom(raw: string | null | undefined): Times {
  const out = { ...TIMES };
  try {
    const o = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (o && typeof o === 'object') for (const k of Object.keys(TIMES) as (keyof Times)[]) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 600_000) out[k] = v; }
  } catch { /* not a setting: the usual waits */ }
  return out;
}
/** Docs of calls are kept a day at most. */
export const KEEP_MS = 864e5;

// ── the docs, read ──
const isCall = (c: CallDoc | null | undefined): c is CallDoc => !!c && typeof c === 'object' && typeof c.id === 'string' && !!c.id && typeof c.from === 'string' && !!c.from
  && typeof c.to === 'string' && !!c.to && c.from !== c.to && typeof c.at === 'string' && !isNaN(Date.parse(c.at));
/** Is `a` the earlier of two calls? By when it started; two started in the very same millisecond go by id, so both
 *  phones always agree. */
export const earlier = (a: Pick<CallDoc, 'at' | 'id'>, b: Pick<CallDoc, 'at' | 'id'>): boolean => a.at < b.at || (a.at === b.at && a.id < b.id);
/** The docs of kind 'call' as calls, each with its answer, oldest first. Anything that isn't a call is left out. */
export function pairsFrom(docs: { key: string; data: unknown }[]): Pair[] {
  const calls = new Map<string, Pair>();
  for (const d of docs) { const c = d.data as CallDoc; if (isCall(c) && d.key === callKey(c)) calls.set(d.key, { call: c }); }
  for (const d of docs) {
    if (!d.key.endsWith(ANSWER)) continue;
    const p = calls.get(d.key.slice(0, -ANSWER.length)), a = d.data as AnswerDoc | null;
    // an answer counts only from the one who was called
    if (p && a && typeof a === 'object' && a.id === p.call.id && a.by === p.call.to && (a.state === 'answered' || a.state === 'declined')) p.answer = a;
  }
  return [...calls.values()].sort((a, b) => (earlier(a.call, b.call) ? -1 : 1));
}

const age = (c: Pick<CallDoc, 'at'>, now: number) => Math.max(0, now - Date.parse(c.at));
/** Still ringing: started under a minute ago, and not answered, declined or ended. */
export const isRinging = (p: Pair, now: number, t: Times = TIMES): boolean => !p.call.ended && !p.answer && !!p.call.offer && age(p.call, now) < t.ringMs;
/** The call this person's phone should be showing "… is calling" for: the other one's call to them that is still
 *  ringing (the newest, if a phone that lost its first try has called again). Answered on their other phone, declined,
 *  hung up or a minute old: nothing. */
export function ringingFor(pairs: Pair[], me: string, now: number, t: Times = TIMES): CallDoc | null {
  const live = pairs.filter(p => p.call.to === me && isRinging(p, now, t));
  return live.length ? live[live.length - 1].call : null;
}

// ── what a phone in a call does next ──
export type Phase = 'idle' | 'starting' | 'calling' | 'answering' | 'connecting' | 'live' | 'over';
/** This phone's side of the call it is in. `at` = when the call started; `connectingAt` = when this phone had both
 *  sets of connection details and began waiting for the other. */
export interface Mine { role: 'caller' | 'callee'; phase: Phase; id: string; at: string; connectingAt?: number }
export type Step =
  | { do: 'wait' }
  | { do: 'connect'; answer: string }                     // the caller: they answered, and these are their connection details
  | { do: 'yield'; to: CallDoc }                          // the caller: they called a moment before me. Mine is dropped and theirs is answered
  | { do: 'end'; why: EndWhy; by: 'me' | 'them' };
const WAIT: Step = { do: 'wait' };
/** From the docs as they are now: what this phone should do about its call. */
export function nextStep(mine: Mine, pairs: Pair[], me: string, now: number, t: Times = TIMES): Step {
  const p = pairs.find(x => x.call.id === mine.id);
  if (mine.role === 'caller' && mine.phase === 'calling') {
    // both tapped Call: the earlier call wins. The later caller drops their own and answers; the earlier one just keeps ringing
    const first = pairs.filter(x => x.call.to === me && x.call.id !== mine.id && isRinging(x, now, t) && earlier(x.call, mine)).pop();
    if (first) return { do: 'yield', to: first.call };
    const a = p?.answer;
    if (a?.state === 'declined') return { do: 'end', why: 'declined', by: 'them' };
    if (a?.ended) return { do: 'end', why: a.ended.why, by: 'them' };
    if (a?.state === 'answered' && a.answer) return { do: 'connect', answer: a.answer };
    if (now - Date.parse(mine.at) >= t.ringMs + t.graceMs) return { do: 'end', why: 'noanswer', by: 'me' };
    return WAIT;
  }
  if (mine.phase !== 'answering' && mine.phase !== 'connecting' && mine.phase !== 'live') return WAIT;
  // the other side's doc says it is over (they hung up, gave up, or their phone could not connect)
  const theirs = mine.role === 'caller' ? p?.answer?.ended : p?.call.ended;
  if (theirs) return { do: 'end', why: theirs.why, by: 'them' };
  if (mine.phase === 'connecting' && mine.connectingAt !== undefined && now - mine.connectingAt >= t.connectMs) return { do: 'end', why: 'failed', by: 'me' };
  return WAIT;
}
/** How often to look at the docs (ms): about once a second while a call is being set up or a phone is ringing, every
 *  few seconds otherwise. (Not at all while the planner is in the background: phone.ts sees to that.) */
export const pollEvery = (phase: Phase, ringing: boolean): number =>
  ringing || phase === 'starting' || phase === 'calling' || phase === 'answering' || phase === 'connecting' ? 1000 : phase === 'live' ? 3000 : 4000;

// ── afterwards ──
/** Calls from the other one that this person never picked up and hasn't been told about: how many, and the newest. */
export interface Missed { from: string; at: string; count: number }
export function missedFor(pairs: Pair[], me: string, seenAt: string, now: number, t: Times = TIMES): Missed | null {
  const list = pairs.filter(p => p.call.to === me && !p.answer && p.call.ended?.why !== 'crossed' && p.call.at > seenAt && !isRinging(p, now, t) && age(p.call, now) < KEEP_MS);
  const last = list[list.length - 1];
  return last ? { from: last.call.from, at: last.call.at, count: list.length } : null;
}

/** When a call was over, as far as the docs say; null while it may still be going. */
function overAt(p: Pair, t: Times): number | null {
  const marks = [p.call.ended?.at, p.answer?.ended?.at, p.answer?.state === 'declined' ? p.answer.at : undefined].filter((x): x is string => !!x).map(x => Date.parse(x)).filter(x => !isNaN(x));
  if (marks.length) return Math.max(...marks);
  return p.answer ? null : Date.parse(p.call.at) + t.ringMs + t.graceMs;   // never answered: over once it stopped ringing
}
/** The keys of calls that are over and have nothing left to tell anyone. A call that was missed is kept until the one
 *  who missed it has been told (`seenAt`: the newest call this person has been told about; null = not known yet). */
export function doneKeys(pairs: Pair[], me: string, seenAt: string | null, now: number, t: Times = TIMES): string[] {
  const keys: string[] = [];
  for (const p of pairs) {
    const over = overAt(p, t);
    if (over === null || now - over < t.tidyMs) continue;
    const missed = !p.answer && p.call.ended?.why !== 'crossed';
    if (missed && !(p.call.to === me && seenAt !== null && p.call.at <= seenAt)) continue;
    keys.push(callKey(p.call));
    if (p.answer) keys.push(answerKey(p.call));
  }
  return keys;
}
/** The keys of anything of kind 'call' older than a day, whatever state it was left in (a phone that died mid-call
 *  never marks its doc ended). Read off the key, or off when the doc was last saved if the key says nothing. */
export function oldKeys(docs: { key: string; updated_at?: string }[], now: number): string[] {
  return docs.filter(d => {
    const stamp = d.key.split('~')[0];
    const when = /^\d{4}-\d{2}-\d{2}T/.test(stamp) && !isNaN(Date.parse(stamp)) ? Date.parse(stamp) : Date.parse(d.updated_at || '');
    return !isNaN(when) && now - when >= KEEP_MS;
  }).map(d => d.key);
}

// ── words ──
/** A length of time on a clock: 0:07, 4:12, 1:02:03. */
export function clock(secs: number): string {
  const s = Math.max(0, Math.floor(secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}
/** What the screen says once a call is over; null = nothing to say, the screen just closes (they hung up before an
 *  answer themselves, or their call gave way to the other one's). */
export function endWords(why: EndWhy, by: 'me' | 'them', name: string, secs?: number): { title: string; more?: string } | null {
  switch (why) {
    case 'hangup': return { title: 'Call ended', ...(secs ? { more: clock(secs) } : {}) };
    case 'cancelled': return by === 'me' ? null : { title: `${name} hung up` };
    case 'declined': return by === 'me' ? null : { title: `${name} declined the call` };
    case 'noanswer': return by === 'me' ? { title: `${name} didn’t answer` } : { title: 'Too late', more: 'The call had already stopped ringing.' };
    case 'failed': return { title: 'Couldn’t connect', more: 'This can happen on mobile data. Try again on Wi-Fi.' };
    case 'dropped': return { title: 'The call dropped', more: 'Check your connection and call again.' };
    case 'crossed': return null;
  }
}
/** Why the camera or microphone didn't start, said plainly. `name` is the browser's name for the error. */
export function cameraProblem(name: string | undefined): string {
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera and microphone are blocked for the planner. Allow them in your phone’s settings for this site, then call again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The planner can’t find a camera and microphone on this phone.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Something else is using the camera. Close it and call again.';
  if (name === 'NoCalls') return 'This browser can’t make video calls.';
  return 'The camera and microphone didn’t start. Try again.';
}

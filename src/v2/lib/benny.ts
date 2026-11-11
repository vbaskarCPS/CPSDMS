// src/v2/lib/benny.ts — The Benny, the in-app assistant: the call to its server (benny-assist) and the
// browser's own speech: speech to text for the mic, and text to speech for spoken answers.
import { db } from './client';
import type { BennyProposal } from './bennyActions';
import { byRoad, withOrder } from './bennyDrive';

/** pins with n are stops in an order: drawn numbered, joined in that order from start (where the manager is) when given:
 *  along path (the road, as [lng, lat] points) when the road is known, else in straight lines */
export interface BennyMap { maps: string[]; highlight: string[]; pins: { lat: number; lng: number; label: string; route: string | null; n?: number }[]; start?: { lat: number; lng: number } | null; path?: [number, number][]; title?: string }
export interface BennyMsg {
  role: 'user' | 'assistant'; text: string; spoken?: boolean; map?: BennyMap | null; error?: boolean;
  proposal?: BennyProposal | null;
  /** the card's state: done (with what happened), dismissed, or failed */
  outcome?: { state: 'done' | 'dismissed' | 'failed'; text: string } | null;
}
export interface BennyContext {
  center_id?: string; center_name?: string; today: string; path: string; screen?: string;
  /** on the RM map: the old-app id of the manager whose map is open */
  rm_manager?: string; user_name?: string;
  /** on the floater map: the managers followed there (old-app ids) and their names */
  following?: string[]; following_names?: string[];
  /** the last message was spoken: the server sends the day's real names along so misheard ones are put right */
  spoken?: boolean;
  diag?: { ua?: string; viewport?: string; build?: string; errors?: string[] };
}

/** What the Benny is told about each message: its words, plus what happened to a card. */
export function forServer(messages: BennyMsg[]) {
  return messages.filter(m => !m.error).map(m => ({ role: m.role,
    content: m.outcome ? `${m.text}\n\n[The card: ${m.outcome.state === 'done' ? 'confirmed, done' : m.outcome.state}: ${m.outcome.text}]` : m.text }));
}

/** The change cards this build of the app can show. Sent with every question, so the server never sends a card that an
 *  older open tab can't draw (it says "refresh" instead). Add a kind here when describe() and doProposal() handle it. */
export const CARDS: BennyProposal['kind'][] = ['start_day', 'give_route', 'partner', 'solo', 'booking', 'booking_emails', 'pin', 'stops', 'job', 'payouts'];

export async function askBenny(messages: BennyMsg[], context: BennyContext): Promise<{ reply: string; map: BennyMap | null; proposal: BennyProposal | null }> {
  const lastAsk = [...messages].reverse().find(m => m.role === 'user');
  const body = { messages: forServer(messages), context: { ...context, spoken: !!lastAsk?.spoken, diag: diag(), cards: CARDS } };
  const { data, error } = await db.functions.invoke('benny-assist', { body });
  if (error) {
    // the function's own message (e.g. "for super admins") rides in the response body
    const res = (error as { context?: Response }).context;
    const msg = res ? await res.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || error.message || 'The Benny didn’t answer');
  }
  if (data?.error) throw new Error(data.error);
  const got = (data?.proposal as BennyProposal) || null;
  const answer = { reply: String(data?.reply || ''), map: (data?.map as BennyMap) || null, proposal: got && CARDS.includes(got.kind) ? got : null };
  // an order comes planned in straight lines: here it is put in driving order by the road's own times, when they can be read
  if (answer.proposal?.kind === 'stops') return withOrder(answer, answer.proposal.check, await byRoad(answer.proposal.check).catch(() => null));
  return answer;
}

/** The kept outlines of these master maps (only the ones that have one). Light, and open to anyone who can use the Benny. */
export async function bennyOutlines(centerId: string | null, maps: string[]): Promise<Record<string, GeoJSON.Geometry>> {
  if (!maps.length) return {};
  const { data, error } = await db.rpc('benny_outlines', { p_center: centerId, p_maps: maps });
  if (error) throw new Error(error.message);
  return (data as Record<string, GeoJSON.Geometry>) || {};
}

/** What to say out loud: the reply without markdown, lists or long numbers of lines (the screen has the rest). */
export function speakable(text: string, maxSentences = 3): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]?/g) || [];
  return sentences.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
}

// ── speech to text (the phone's or browser's own recognition, as keyboard dictation uses) ──
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const RecCtor = (): (new () => Rec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};
export const canListen = () => typeof window !== 'undefined' && !!RecCtor();

/** Listen once: `onText` gets the words so far; resolves with the final words when the person pauses or `stop()` is called. */
export function listen(onText: (text: string) => void): { done: Promise<string>; stop: () => void; cancel: () => void } {
  const Ctor = RecCtor();
  if (!Ctor) return { done: Promise.reject(new Error('Talking isn’t supported in this browser')), stop: () => undefined, cancel: () => undefined };
  const rec = new Ctor();
  rec.lang = 'en-CA'; rec.interimResults = true; rec.continuous = false;
  let text = ''; let cancelled = false;
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = e => {
      let all = '';
      for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript;
      text = all.trim(); onText(text);
    };
    rec.onerror = e => { if (e.error === 'no-speech' || e.error === 'aborted') return; reject(new Error(e.error === 'not-allowed' ? 'Microphone access is blocked for this site' : e.error)); };
    rec.onend = () => resolve(cancelled ? '' : text);
  });
  try { rec.start(); } catch { /* already started */ }
  return { done, stop: () => rec.stop(), cancel: () => { cancelled = true; rec.abort(); } };
}

// ── the Benny's voice: Google's (the benny-voice function), never the phone's own ──
// Phones only let a page play sound that a tap started. The answer arrives later, so a tap (the mic, the speaker
// switch) first plays a moment of silence on the same player; after that the phone lets it speak.
const SILENCE = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';
let player: HTMLAudioElement | null = null;
let saying = 0;   // each new line (or a stop) makes older ones, still on their way, stay quiet
const thePlayer = () => (player = player || new Audio());

/** Call inside a tap, before the answer is asked for. */
export function primeVoice(): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  try {
    const p = thePlayer();
    if (!p.paused) return;
    p.src = SILENCE;
    void p.play().catch(() => undefined);
  } catch { /* no sound on this device */ }
}

/** Say it in the Benny's voice. Rejects with the reason when the voice can't be had (the caller shows it). */
export async function speak(text: string): Promise<void> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  const line = speakable(text);
  if (!line) return;
  const mine = ++saying;
  const { data, error } = await db.functions.invoke('benny-voice', { body: { text: line } });
  if (error) {
    const res = (error as { context?: Response }).context;
    const msg = res ? await res.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || error.message || 'The voice didn’t answer');
  }
  if (!data?.audio) throw new Error(data?.error || 'The voice didn’t answer');
  if (mine !== saying) return;   // stopped, or something newer is being said
  const p = thePlayer();
  p.src = `data:audio/mpeg;base64,${data.audio}`;
  await p.play();
}
export const stopSpeaking = () => { saying++; try { player?.pause(); } catch { /* none */ } };

// ── the first-time demo: the next time someone who can use the Benny opens the app, it opens and walks them through a
//    quick try. Remembered per person on each phone; if they close it without finishing it comes back, three times at most.
export interface DemoSeen { opens: number; done: boolean }
const demoKey = (user: string) => `benny-demo:${user}`;
export function readDemo(user: string): DemoSeen {
  try { const d = JSON.parse(localStorage.getItem(demoKey(user)) || '{}'); return { opens: Number(d.opens) || 0, done: !!d.done }; }
  catch { return { opens: 0, done: false }; }
}
export function writeDemo(user: string, d: DemoSeen): void { try { localStorage.setItem(demoKey(user), JSON.stringify(d)); } catch { /* private window: it shows again */ } }
export const demoDue = (d: DemoSeen) => !d.done && d.opens < 3;

// ── the log (Super Admin › Bug log): what people told the Benny was broken, and what they asked for that it couldn't do ──
export interface BugReport {
  id: string; created_at: string; title: string; status: 'open' | 'done'; resolved_at?: string; resolved_by?: string;
  /** a bug, or something someone asked the Benny for that it couldn't do (no tool for it) */
  kind?: 'bug' | 'request';
  by?: string; center?: string; path?: string;
  /** what the scheduled check found when it looked into this entry */
  findings?: { verdict?: string; summary?: string; cause?: string; fix?: string; size?: string; risk?: string; needs?: string; pr?: string } | null;
  investigated_at?: string;
  report: { what_happened?: string; expected?: string; steps?: string[]; where?: string; severity?: 'blocking' | 'annoying' | 'minor';
    asked?: string; why_not?: string; would_need?: string; reply?: string; auto?: boolean; spoken?: boolean;
    screen?: string | null; rm_manager?: string | null; diag?: BennyContext['diag'] | null };
}
export interface BugLog { open: number; done: number; open_bugs?: number; open_requests?: number; bugs: BugReport[] }
export async function listBugs(status: 'open' | 'done' | null): Promise<BugLog> {
  const { data, error } = await db.rpc('benny_bugs_list', { p_status: status });
  if (error) throw new Error(error.message);
  return (data as BugLog) || { open: 0, done: 0, bugs: [] };
}
export async function resolveBug(id: string, done: boolean): Promise<void> {
  const { error } = await db.rpc('benny_bug_resolve', { p_id: id, p_done: done });
  if (error) throw new Error(error.message);
}

// ── for bug reports: the last errors on the page, the browser and the app build ──
const errors: string[] = [];
let listening = false;
export function watchErrors(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const keep = (s: string) => { errors.push(`${new Date().toISOString().slice(11, 19)} ${s}`.slice(0, 400)); if (errors.length > 12) errors.shift(); };
  window.addEventListener('error', e => keep(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e => keep(`Unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
}
export function diag(): BennyContext['diag'] {
  if (typeof window === 'undefined') return undefined;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  return { ua: navigator.userAgent, viewport: `${window.innerWidth}×${window.innerHeight}`, build: env.VITE_COMMIT_SHA || env.VITE_VERCEL_GIT_COMMIT_SHA || env.MODE, errors: [...errors] };
}

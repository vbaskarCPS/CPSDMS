// src/v2/lib/benny.ts — The Benny, the in-app assistant: the call to its server (benny-assist) and the
// browser's own speech: speech to text for the mic, and text to speech for spoken answers.
import { db } from './client';
import type { BennyProposal } from './bennyActions';

export interface BennyMap { maps: string[]; highlight: string[]; pins: { lat: number; lng: number; label: string; route: string | null }[]; title?: string }
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
  diag?: { ua?: string; viewport?: string; build?: string; errors?: string[] };
}

/** What the Benny is told about each message: its words, plus what happened to a card. */
export function forServer(messages: BennyMsg[]) {
  return messages.filter(m => !m.error).map(m => ({ role: m.role,
    content: m.outcome ? `${m.text}\n\n[The card: ${m.outcome.state === 'done' ? 'confirmed, done' : m.outcome.state}: ${m.outcome.text}]` : m.text }));
}

export async function askBenny(messages: BennyMsg[], context: BennyContext): Promise<{ reply: string; map: BennyMap | null; proposal: BennyProposal | null }> {
  const body = { messages: forServer(messages), context: { ...context, diag: diag() } };
  const { data, error } = await db.functions.invoke('benny-assist', { body });
  if (error) {
    // the function's own message (e.g. "for super admins") rides in the response body
    const res = (error as { context?: Response }).context;
    const msg = res ? await res.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || error.message || 'The Benny didn’t answer');
  }
  if (data?.error) throw new Error(data.error);
  return { reply: String(data?.reply || ''), map: (data?.map as BennyMap) || null, proposal: (data?.proposal as BennyProposal) || null };
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

// ── text to speech ──
export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const line = speakable(text);
  if (!line) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(line);
  u.lang = 'en-CA'; u.rate = 1.05;
  window.speechSynthesis.speak(u);
}
export const stopSpeaking = () => { try { window.speechSynthesis?.cancel(); } catch { /* none */ } };

// ── the bug log (Super Admin › Bug log): what people told the Benny was broken ──
export interface BugReport {
  id: string; created_at: string; title: string; status: 'open' | 'done'; resolved_at?: string; resolved_by?: string;
  by?: string; center?: string; path?: string;
  report: { what_happened?: string; expected?: string; steps?: string[]; where?: string; severity?: 'blocking' | 'annoying' | 'minor';
    screen?: string | null; rm_manager?: string | null; diag?: BennyContext['diag'] | null };
}
export interface BugLog { open: number; done: number; bugs: BugReport[] }
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

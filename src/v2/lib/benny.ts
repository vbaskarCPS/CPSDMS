// src/v2/lib/benny.ts — The Benny, the in-app assistant: the call to its server (benny-assist) and the
// browser's own speech: speech to text for the mic, and text to speech for spoken answers.
import { db } from './client';

export interface BennyMap { maps: string[]; highlight: string[]; pins: { lat: number; lng: number; label: string; route: string | null }[]; title?: string }
export interface BennyMsg { role: 'user' | 'assistant'; text: string; spoken?: boolean; map?: BennyMap | null; error?: boolean }
export interface BennyContext { center_id?: string; center_name?: string; today: string; path: string; screen?: string }

export async function askBenny(messages: BennyMsg[], context: BennyContext): Promise<{ reply: string; map: BennyMap | null }> {
  const body = { messages: messages.filter(m => !m.error).map(m => ({ role: m.role, content: m.text })), context };
  const { data, error } = await db.functions.invoke('benny-assist', { body });
  if (error) {
    // the function's own message (e.g. "for super admins") rides in the response body
    const res = (error as { context?: Response }).context;
    const msg = res ? await res.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || error.message || 'The Benny didn’t answer');
  }
  if (data?.error) throw new Error(data.error);
  return { reply: String(data?.reply || ''), map: (data?.map as BennyMap) || null };
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

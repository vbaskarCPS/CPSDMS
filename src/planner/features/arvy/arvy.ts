// src/planner/features/arvy/arvy.ts — talking with Arvy: the conversation loop, listening, and Arvy's voice.
// One question = a few steps: the server asks Claude; when Claude wants tools, they run here (run.ts) and the results
// go back, until Claude answers. Past questions are sent as plain text (tools are looked up fresh each time).
import { invoke } from '../../lib/ai';
import { dayKey } from '../../lib/docs';
import { isDemo } from '../../lib/app';
import { getPass } from '../../lib/auth';
import { runTool } from './run';
import { speakable, type Block, type Msg } from '../../../../supabase/functions/planner-arvy/tools';

export interface ChatLine { role: 'user' | 'assistant'; text: string; at: string; used?: string[] }
export interface Turn { reply: string; navigate?: string; used: string[] }

const MAX_STEPS = 8;
/** What each tool is called on screen while Arvy works ("Checking your calendar…"). */
export const TOOL_LABEL: Record<string, string> = {
  today_overview: 'your day', calendar: 'the calendar', shopping_list: 'the shopping list', food_log: 'your food log',
  workouts: 'your training', habits: 'your habits', money: 'the money', cycle: 'your cycle', remember: 'a note',
  open_screen: 'the screen', cant_do_yet: 'that request',
};

export function context(path: string, spoken: boolean) {
  const units = (getPass()?.user.settings?.units as string) === 'kg' ? 'kg' : 'lb';
  return {
    today: dayKey(), weekday: new Date().toLocaleDateString('en-CA', { weekday: 'long' }),
    now: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), path, spoken, units,
  };
}

/** The earlier conversation as Claude messages: text only, last 12 lines, starting with a question. */
export function history(lines: ChatLine[]): Msg[] {
  const out: Msg[] = lines.slice(-12).filter(l => l.text.trim()).map(l => ({ role: l.role, content: l.text.slice(0, 3000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  // two in a row from the same side (an error left a question unanswered): keep the later one
  return out.filter((m, i) => !(out[i + 1] && out[i + 1].role === m.role));
}

/** Ask Arvy. `onStep` says which tools are running, for the "looking at…" line. */
export async function ask(lines: ChatLine[], question: string, path: string, spoken: boolean, onStep?: (tools: string[]) => void): Promise<Turn> {
  if (isDemo()) return demoTurn(question);
  const msgs: Msg[] = [...history(lines), { role: 'user', content: question }];
  const used: string[] = [];
  let navigate: string | undefined;
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await invoke<{ content: Block[]; stop_reason: string }>({ action: 'turn', messages: msgs, context: context(path, spoken) }, 'planner-arvy');
    const content = Array.isArray(r.content) ? r.content : [];
    const calls = content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    const text = content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
    if (r.stop_reason !== 'tool_use' || !calls.length) return { reply: text || 'Hmm, I lost my train of thought there. Try asking again?', navigate, used };
    onStep?.(calls.map(c => c.name));
    const results = await Promise.all(calls.map(async c => {
      used.push(c.name);
      const out = await runTool(c.name, c.input || {});
      if (out.navigate) navigate = out.navigate;
      return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(out.result).slice(0, 13000), ...(out.error ? { is_error: true } : {}) };
    }));
    msgs.push({ role: 'assistant', content }, { role: 'user', content: results });
  }
  return { reply: 'That one took me too many steps. Could you ask it a simpler way?', navigate, used };
}

// ── demo (/demo): a canned answer, nothing sent anywhere ──
async function demoTurn(q: string): Promise<Turn> {
  await new Promise(r => setTimeout(r, 900));
  if (/budget|money|spend/i.test(q)) return { reply: 'This month you’ve spent about $2,140 of your $3,200 budget. Groceries is the one to watch: $610 of $650 with a week to go. Want me to open the budget?', used: ['money'] };
  if (/calendar|week|saturday|weekend/i.test(q)) return { reply: 'Saturday you’ve got Kiaan’s swim class at 10 and dinner at your mom’s at 6. Sunday’s wide open!', used: ['calendar'] };
  return { reply: 'Here’s today: 3 of 5 to-dos done, the gym’s ticked, and you’re at 110 g of 160 g protein. Next up is the release notes at 2. You’ve got this!', used: ['today_overview'] };
}

// ── listening: the phone's or browser's own speech recognition ──
type Rec = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const RecCtor = (): (new () => Rec) | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};
export const canListen = () => !!RecCtor();

/** Listen once: `onText` gets the words so far; resolves with the final words when you pause or `stop()` is called. */
export function listen(onText: (text: string) => void): { done: Promise<string>; stop: () => void; cancel: () => void } {
  const Ctor = RecCtor();
  if (!Ctor) return { done: Promise.reject(new Error('Talking isn’t supported in this browser')), stop: () => undefined, cancel: () => undefined };
  const rec = new Ctor();
  rec.lang = 'en-CA'; rec.interimResults = true; rec.continuous = false;
  let text = ''; let cancelled = false;
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = e => { let all = ''; for (let i = 0; i < e.results.length; i++) all += e.results[i][0].transcript; text = all.trim(); onText(text); };
    rec.onerror = e => { if (e.error === 'no-speech' || e.error === 'aborted') return; reject(new Error(e.error === 'not-allowed' ? 'Microphone access is blocked for this site' : e.error)); };
    rec.onend = () => resolve(cancelled ? '' : text);
  });
  try { rec.start(); } catch { /* already started */ }
  return { done, stop: () => rec.stop(), cancel: () => { cancelled = true; rec.abort(); } };
}

// ── Arvy's voice (Google's, from planner-arvy). Phones only play sound a tap started, so a tap primes the player first. ──
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let player: HTMLAudioElement | null = null;
let saying = 0;
const thePlayer = () => (player = player || new Audio());
export function primeVoice(): void {
  if (typeof Audio === 'undefined') return;
  try { const p = thePlayer(); if (!p.paused) return; p.src = SILENCE; void p.play().catch(() => undefined); } catch { /* no sound */ }
}
export async function speak(text: string): Promise<void> {
  if (typeof Audio === 'undefined' || isDemo()) return;
  const line = speakable(text);
  if (!line) return;
  const mine = ++saying;
  const r = await invoke<{ audio?: string }>({ action: 'speak', text: line }, 'planner-arvy');
  if (!r.audio || mine !== saying) return;
  const p = thePlayer();
  p.src = `data:audio/mpeg;base64,${r.audio}`;
  await p.play();
}
export const stopSpeaking = () => { saying++; try { player?.pause(); } catch { /* none */ } };

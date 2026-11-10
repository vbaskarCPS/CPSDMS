// src/planner/features/arvy/arvy.ts — talking with Arvy: the conversation loop, listening, and Arvy's voice.
// One question = a few steps: the server asks Claude; when Claude wants tools, they run here (run.ts) and the results
// go back, until Claude answers. Past questions are sent as plain text (tools are looked up fresh each time).
import { invoke } from '../../lib/ai';
import { dayKey } from '../../lib/docs';
import { isDemo } from '../../lib/app';
import { getPass } from '../../lib/auth';
import { docsChanged } from '../../lib/docs';
import { runTool } from './run';
import { prepare, Refuse, type Change, type Undo } from './act';
import { changeOf, speakable, type Block, type Msg } from '../../../../supabase/functions/planner-arvy/tools';

/** A change shown under Arvy's reply. done: made (Undo while this visit lasts); waiting: Confirm/Cancel. */
export type ChangeState = 'done' | 'waiting' | 'cancelled' | 'undone' | 'failed' | 'expired';
export interface ChangeView { id: string; lines: string[]; state: ChangeState; error?: string }
export interface ChatLine { role: 'user' | 'assistant'; text: string; at: string; used?: string[]; changes?: ChangeView[] }
export interface Turn { reply: string; navigate?: string; used: string[]; changes: ChangeView[] }

// What the panel can still do with a change: the Undo for a made one, or the worked-out change waiting for Confirm.
// Kept for this visit only (they're functions); after a reload, waiting cards show as expired.
const undos = new Map<string, Undo>();
const waiting = new Map<string, Change>();
const newId = () => Math.random().toString(36).slice(2, 10);
export const canUndo = (id: string) => undos.has(id);
export const isWaiting = (id: string) => waiting.has(id);

/** Make a change and remember how to undo it. Screens showing that data reload. */
async function make(c: Change, id: string): Promise<void> {
  const undo = await c.apply();
  undos.set(id, undo);
  docsChanged(c.kinds);
}
export async function confirmChange(id: string): Promise<void> {
  const c = waiting.get(id);
  if (!c) throw new Error('That one has expired. Ask Arvy again.');
  waiting.delete(id);
  await make(c, id);
}
export const cancelChange = (id: string) => { waiting.delete(id); };
export async function undoChange(id: string): Promise<void> {
  const u = undos.get(id);
  if (!u) throw new Error('That can’t be undone any more.');
  undos.delete(id);
  await u();
}

/** Run a change tool: work it out, then make it now or hold it for Confirm. What Claude is told back. */
async function runChange(name: string, input: Record<string, unknown>, out: ChangeView[]): Promise<{ result: unknown; error?: boolean }> {
  let c: Change | null;
  try { c = await prepare(name, input); } catch (e) {
    return e instanceof Refuse ? { result: { not_done: e.message } } : { result: { error: e instanceof Error ? e.message : String(e) }, error: true };
  }
  if (!c) return { result: { error: `unknown tool ${name}` }, error: true };
  const id = newId();
  if (c.confirm || changeOf(name) === 'confirm') {
    waiting.set(id, c);
    out.push({ id, lines: c.lines, state: 'waiting' });
    return { result: { waiting_for_confirm: c.lines, note: 'Not done yet: a Confirm button is showing under your reply. Ask them to tap it.' } };
  }
  try { await make(c, id); } catch (e) {
    out.push({ id, lines: c.lines, state: 'failed', error: e instanceof Error ? e.message : String(e) });
    return { result: { error: e instanceof Error ? e.message : String(e) }, error: true };
  }
  out.push({ id, lines: c.lines, state: 'done' });
  return { result: { done: c.lines } };
}

/** How a change ended, for the next question's history (so Arvy knows if they confirmed or undid it). */
const stateWords: Record<ChangeState, string> = { done: 'done', waiting: 'waiting for Confirm', cancelled: 'they cancelled it', undone: 'they undid it', failed: 'it failed', expired: 'never confirmed' };

const MAX_STEPS = 8;
/** What each tool is called on screen while Arvy works ("Checking your calendar…"). */
export const TOOL_LABEL: Record<string, string> = {
  today_overview: 'your day', calendar: 'the calendar', shopping_list: 'the shopping list', food_log: 'your food log',
  workouts: 'your training', habits: 'your habits', money: 'the money', cycle: 'your cycle', remember: 'a note',
  open_screen: 'the screen', cant_do_yet: 'that request',
  add_shopping_items: 'the shopping list', check_off_shopping: 'the shopping list', remove_shopping_items: 'the shopping list',
  add_todos: 'your to-dos', complete_todos: 'your to-dos', remove_todos: 'your to-dos', log_meal: 'that meal', mark_habit: 'your habits',
  log_body_weight: 'your weight', add_event: 'the calendar', change_event: 'the calendar', delete_event: 'the calendar',
  add_cash_expense: 'the cash wallet', recategorize: 'the transactions',
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
  const out: Msg[] = lines.slice(-12).filter(l => l.text.trim()).map(l => ({ role: l.role,
    content: (l.text + (l.changes?.length ? `\n[Changes: ${l.changes.map(c => `${c.lines.join(' ')} (${stateWords[c.state]})`).join('; ')}]` : '')).slice(0, 3000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  // two in a row from the same side (an error left a question unanswered): keep the later one
  return out.filter((m, i) => !(out[i + 1] && out[i + 1].role === m.role));
}

/** Ask Arvy. `onStep` says which tools are running, for the "looking at…" line. */
export async function ask(lines: ChatLine[], question: string, path: string, spoken: boolean, onStep?: (tools: string[]) => void): Promise<Turn> {
  const changes: ChangeView[] = [];
  if (isDemo()) return demoTurn(question, changes);
  const msgs: Msg[] = [...history(lines), { role: 'user', content: question }];
  const used: string[] = [];
  let navigate: string | undefined;
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await invoke<{ content: Block[]; stop_reason: string }>({ action: 'turn', messages: msgs, context: context(path, spoken) }, 'planner-arvy');
    const content = Array.isArray(r.content) ? r.content : [];
    const calls = content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    const text = content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
    if (r.stop_reason !== 'tool_use' || !calls.length) return { reply: text || (changes.length ? 'Done!' : 'Hmm, I lost my train of thought there. Try asking again?'), navigate, used, changes };
    onStep?.(calls.map(c => c.name));
    const res = new Map<string, { result: unknown; error?: boolean; navigate?: string }>();
    // look-ups together; changes one at a time, in order (each one's Undo snapshot is taken just before it)
    await Promise.all(calls.filter(c => !changeOf(c.name)).map(async c => { res.set(c.id, await runTool(c.name, c.input || {})); }));
    for (const c of calls.filter(c => changeOf(c.name))) res.set(c.id, await runChange(c.name, c.input || {}, changes));
    const results = calls.map(c => {
      used.push(c.name);
      const out = res.get(c.id)!;
      if (out.navigate) navigate = out.navigate;
      return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(out.result).slice(0, 13000), ...(out.error ? { is_error: true } : {}) };
    });
    msgs.push({ role: 'assistant', content }, { role: 'user', content: results });
  }
  return { reply: 'That one took me too many steps. Could you ask it a simpler way?', navigate, used, changes };
}

// ── demo (/demo): canned answers, nothing sent anywhere. Changes are real, on the demo's own data. ──
async function demoTurn(q: string, changes: ChangeView[]): Promise<Turn> {
  await new Promise(r => setTimeout(r, 900));
  const add = q.match(/add (.+?) to (?:the |my )?(?:shopping )?list/i);
  if (add) {
    await runChange('add_shopping_items', { items: add[1].split(/,\s*|\s+and\s+/).map(text => ({ text })) }, changes);
    return { reply: changes[0]?.state === 'done' ? 'Added to the list!' : 'Hmm, that didn’t work.', used: ['add_shopping_items'], changes };
  }
  if (/dentist|book|schedule/i.test(q)) {
    const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await runChange('add_event', { title: 'Dentist', date, time: '15:00', end_time: '16:00' }, changes);
    return { reply: 'Dentist on Friday at 3 is ready to go. Tap Confirm and it’s on the calendar!', used: ['add_event'], changes };
  }
  if (/budget|money|spend/i.test(q)) return { reply: 'This month you’ve spent about $2,140 of your $3,200 budget. Groceries is the one to watch: $610 of $650 with a week to go. Want me to open the budget?', used: ['money'], changes };
  if (/calendar|week|saturday|weekend/i.test(q)) return { reply: 'Saturday you’ve got Kiaan’s swim class at 10 and dinner at your mom’s at 6. Sunday’s wide open!', used: ['calendar'], changes };
  return { reply: 'Here’s today: 3 of 5 to-dos done, the gym’s ticked, and you’re at 110 g of 160 g protein. Next up is the release notes at 2. You’ve got this!', used: ['today_overview'], changes };
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

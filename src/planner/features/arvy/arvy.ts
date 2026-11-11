// src/planner/features/arvy/arvy.ts — talking with Arvy: the conversation loop, listening, and Arvy's voice.
// One question = a few steps: the server asks Claude; when Claude wants tools, they run here (run.ts) and the results
// go back, until Claude answers. Past questions are sent as plain text (tools are looked up fresh each time).
// Once a question has read something from outside the planner (the web, GoodLife's class timetable), every change it
// sets up waits for a Confirm tap, and where it read is linked under the reply.
import { invoke } from '../../lib/ai';
import { dayKey } from '../../lib/docs';
import { isDemo, profileOf } from '../../lib/app';
import { asksWhatsNew, newsNote } from '../../lib/news';
import { getPass } from '../../lib/auth';
import { docsChanged } from '../../lib/docs';
import { runTool } from './run';
import { prepare, Refuse, type Change, type Undo } from './act';
import { logArvy } from './log';
import { memoryContext } from '../../lib/memory';
import { changeOf, speakable, TOOLS_VERSION, type Block, type Msg, type Source } from '../../../../supabase/functions/planner-arvy/tools';
import { gymPageUrl } from '../../../../supabase/functions/planner-arvy/gym';

/** A change shown under Arvy's reply. done: made (Undo while this visit lasts); waiting: Confirm/Cancel. */
export type ChangeState = 'done' | 'waiting' | 'cancelled' | 'undone' | 'failed' | 'expired';
export interface ChangeView { id: string; lines: string[]; state: ChangeState; error?: string }
/** A button under a reply: tapping it sends `send` (or the label) as their next message. */
export interface Choice { label: string; send?: string }
export interface ChatLine { role: 'user' | 'assistant'; text: string; at: string; used?: string[]; changes?: ChangeView[]; down?: boolean /* thumbs-down given */;
  old?: boolean /* carried over from the Coach chat (chat.ts) */;
  sources?: Source[] /* the web pages the reply cites */; choices?: Choice[] /* buttons to pick from */ }
export interface Turn { reply: string; navigate?: string; used: string[]; changes: ChangeView[]; sources?: Source[]; choices?: Choice[] }

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
/** Make a change that was waiting for Confirm. Returns a screen to open, when the change starts something (a workout). */
export async function confirmChange(id: string): Promise<Change['go']> {
  const c = waiting.get(id);
  if (!c) throw new Error('That one has expired. Ask Arvy again.');
  waiting.delete(id);
  try { await make(c, id); } catch (e) {
    void logArvy({ type: 'error', title: `A confirmed change failed: ${c.lines[0] || ''}`.slice(0, 160), detail: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  return c.go;
}

// ── opening Arvy from a screen's own button ("Ask Arvy" on Train, after a workout…) ──
export interface OpenAsk { suggest?: string[]; ask?: string; mic?: boolean }
const openers = new Set<(o: OpenAsk) => void>();
let waitingOpen: OpenAsk | null = null;   // asked to open before the chat was on screen (the set-up's last tap): opened once it is
export const onOpenArvy = (fn: (o: OpenAsk) => void) => {
  openers.add(fn);
  // a moment later, and only if this listener is still there: the chat's own clean-up closes it, and in development
  // React mounts, cleans up and mounts again
  if (waitingOpen) setTimeout(() => { if (waitingOpen && openers.has(fn)) { const o = waitingOpen; waitingOpen = null; fn(o); } }, 0);
  return () => { openers.delete(fn); };
};
/** Open the chat; `suggest` = the chips to offer, `ask` = a question to send straight away, `mic` = start listening
 *  (the RV button held down). */
export const openArvy = (o: OpenAsk = {}) => { if (!openers.size) { waitingOpen = o; return; } for (const fn of [...openers]) fn(o); };

// ── is the chat open, and is it listening? Shared with the bottom bar's RV button (ui/Shell.tsx): a tap opens and
//    closes the chat, a hold opens it listening, and the button shows a mic while it listens ──
let chatOpen = false;
let chatHearing = false;
const barWatchers = new Set<() => void>();
const tellBar = () => { for (const fn of [...barWatchers]) fn(); };
let chatNews = false;   // Arvy has posted what's new and the chat hasn't been opened since: RV shows a dot
export const arvyHasNews = (): boolean => chatNews;
export function setArvyNews(v: boolean): void { if (v !== chatNews) { chatNews = v; tellBar(); } }
export const arvyIsOpen = (): boolean => chatOpen;
export const arvyIsHearing = (): boolean => chatHearing;
/** Told when the chat opens or closes, and when it starts or stops listening. */
export const onArvyChange = (fn: () => void) => { barWatchers.add(fn); return () => { barWatchers.delete(fn); }; };
export function setArvyOpen(open: boolean): void {
  if (open === chatOpen) return;
  chatOpen = open;
  if (open) chatNews = false;
  tellBar();
}
export function setArvyHearing(hearing: boolean): void {
  if (hearing === chatHearing) return;
  chatHearing = hearing;
  tellBar();
}
/** The RV button: open the chat, or close it when it's open. Call it from the tap itself: opening unlocks the voice. */
export function toggleArvy(): void { if (!chatOpen) primeVoice(); setArvyOpen(!chatOpen); }
/** What to offer when the chat is opened for coaching (what the Coach screen offered). */
export const COACH_ASKS = ['Plan my next session', 'Shake up my next session', 'Build me a kettlebell circuit', 'I’m sore — adjust my next session', 'Why am I stuck on bench?'];
export const cancelChange = (id: string) => { waiting.delete(id); };
/** Undo a change. `why` = the lines it showed and what was asked: an undo usually means Arvy got it wrong, so it's logged. */
export async function undoChange(id: string, why?: { lines?: string[]; question?: string }): Promise<void> {
  if (why) void logArvy({ type: 'undo', title: `Undone: ${why.lines?.[0] || 'a change'}`.slice(0, 160), detail: why.lines?.join('\n'), question: why.question });
  const u = undos.get(id);
  if (!u) throw new Error('That can’t be undone any more.');
  undos.delete(id);
  await u();
}

/** Run a change tool: work it out, then make it now or hold it for Confirm. What Claude is told back.
 *  `hold` = make it wait for Confirm whatever the tool: the question read something from outside the planner (the web,
 *  the gym's timetable), and nothing read out there may change the planner without their tap. */
async function runChange(name: string, input: Record<string, unknown>, out: ChangeView[], about: { question?: string; path?: string } = {}, hold = false): Promise<{ result: unknown; error?: boolean }> {
  let c: Change | null;
  try { c = await prepare(name, input); } catch (e) {
    if (e instanceof Refuse) {
      if (e.miss) void logArvy({ type: 'miss', title: e.message, tools: [name], ...about });
      return { result: { not_done: e.message } };
    }
    return { result: { error: e instanceof Error ? e.message : String(e) }, error: true };
  }
  if (!c) return { result: { error: `unknown tool ${name}` }, error: true };
  const id = newId();
  if (c.confirm || hold || changeOf(name) === 'confirm') {
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
const stateWords: Record<ChangeState, string> = { done: 'MADE and saved (confirmed, if it needed Confirm)', waiting: 'still waiting for their Confirm tap', cancelled: 'they cancelled it: not made', undone: 'they undid it', failed: 'it failed: not made', expired: 'never confirmed: not made' };
/** When a message was sent, for the history: "Tue Nov 10, 11:28 PM". Old chats say "tomorrow" about a day that's now today. */
const sentAt = (iso: string): string => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

const MAX_STEPS = 8;
/** How long to wait before the second try (the tests don't wait). */
export const RETRY_WAIT = { ms: 1200 };
/** What a question ends with when the phone can't reach Arvy's server, even on the second try. Not something to fix
 *  in the app, so the chat doesn't put it in the improvements log. */
export const NO_CONNECTION = 'I couldn’t reach the server. Check your connection and ask again.';
const dropped = (e: unknown) => /failed to send a request|failed to fetch|networkerror|network request failed|load failed/i.test(e instanceof Error ? e.message : String(e));
/** One step with Arvy's server. A connection that drops mid-question (the phone changes networks, a tunnel) is tried
 *  once more after a moment: a step changes nothing on the server, so asking it twice is safe. */
async function serverStep<T>(body: Record<string, unknown>, wait = 1200): Promise<T> {
  try { return await invoke<T>(body, 'planner-arvy'); }
  catch (e) {
    if (!dropped(e)) throw e;
    await new Promise(r => setTimeout(r, wait));
    try { return await invoke<T>(body, 'planner-arvy'); }
    catch (again) { throw dropped(again) ? new Error(NO_CONNECTION) : again; }
  }
}
/** How much of a tool's answer Claude gets (characters). The coaching context is the whole planner, so it gets more. */
const RESULT_CAP: Record<string, number> = { coaching_context: 36000 };
/** What each tool is called on screen while Arvy works ("Checking your calendar…"). */
export const TOOL_LABEL: Record<string, string> = {
  today_overview: 'your day', calendar: 'the calendar', shopping_list: 'the shopping list', food_log: 'your food log',
  workouts: 'your training', habits: 'your habits', money: 'the money', cycle: 'your cycle', remember: 'a note',
  open_screen: 'the screen', cant_do_yet: 'that request',
  add_shopping_items: 'the shopping list', check_off_shopping: 'the shopping list', remove_shopping_items: 'the shopping list',
  add_todos: 'your to-dos', complete_todos: 'your to-dos', remove_todos: 'your to-dos', log_meal: 'that meal', mark_habit: 'your habits',
  log_body_weight: 'your weight', coaching_context: 'your training, sleep and food', plan_workout: 'your session', log_feedback: 'the improvements log', add_event: 'the calendar', change_event: 'the calendar', delete_event: 'the calendar',
  add_cash_expense: 'the cash wallet', recategorize: 'the transactions',
  set_must: 'your must-dos', log_favourite_meal: 'your favourites', save_favourite: 'your favourites', set_food_targets: 'your food targets',
  create_habit: 'your habits', pause_habit: 'your habits', set_budget: 'the budget', log_cycle_day: 'your cycle', log_period: 'your cycle',
  adjust_day: 'your day', change_routine: 'your routine', offer_choices: 'your options', web_search: 'the web', gym_classes: 'GoodLife’s class times',
};
/** Look-ups that read something outside the planner (the web search is the other one: it runs on the server). */
const OUTSIDE = new Set(['gym_classes']);

export function context(path: string, spoken: boolean) {
  const units = (getPass()?.user.settings?.units as string) === 'kg' ? 'kg' : 'lb';
  return {
    today: dayKey(), weekday: new Date().toLocaleDateString('en-CA', { weekday: 'long' }),
    now: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), path, spoken, units,
    v: TOOLS_VERSION,   // which tools this app can run: Arvy is only offered those
  };
}

/** The notes they've told Arvy to keep (Settings › Tell Arvy, or "remember that…"): they ride along with every question. */
async function aboutMe(): Promise<string[]> {
  try { return (await memoryContext(25)).map(n => `${n.date}: ${n.note}`.slice(0, 300)); } catch { return []; }
}

/** The earlier conversation as Claude messages: text only, last 12 lines, starting with a question. What they asked
 *  carries when it was sent (so "tomorrow" in an old exchange isn't read as tomorrow from now), and each change Arvy
 *  set up carries what became of it, the outcome first. */
export function history(lines: ChatLine[]): Msg[] {
  const out: Msg[] = lines.slice(-12).filter(l => l.text.trim()).map(l => ({ role: l.role,
    content: ((l.role === 'user' && sentAt(l.at) ? `[${sentAt(l.at)}] ` : '') + l.text
      + (l.changes?.length ? l.changes.map(c => `\n[Change: ${stateWords[c.state]}. ${c.lines.join(' ')}]`).join('') : '')).slice(0, 3000) }));
  while (out.length && out[0].role !== 'user') out.shift();
  // two in a row from the same side (an error left a question unanswered): keep the later one
  return out.filter((m, i) => !(out[i + 1] && out[i + 1].role === m.role));
}

/** The buttons Arvy asked for (offer_choices), checked: 2 to 4, short, no repeats. Fewer than 2 = none. */
export function choicesFrom(input: unknown): Choice[] {
  const raw = (input as { options?: unknown })?.options;
  const out: Choice[] = [];
  for (const o of Array.isArray(raw) ? raw : []) {
    const label = String((o as { label?: unknown })?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const send = String((o as { send?: unknown })?.send ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!label || out.some(c => c.label === label)) continue;
    out.push({ label, ...(send && send !== label ? { send } : {}) });
    if (out.length >= 4) break;
  }
  return out.length >= 2 ? out : [];
}

/** Ask Arvy. `onStep` says which tools are running, for the "looking at…" line. */
export async function ask(lines: ChatLine[], question: string, path: string, spoken: boolean, onStep?: (tools: string[]) => void): Promise<Turn> {
  const changes: ChangeView[] = [];
  if (isDemo()) return demoTurn(question, changes);
  // "what's new?": the planner's release notes ride along with the question (they aren't shown in the chat)
  const profile = profileOf(getPass()?.user.settings);
  const msgs: Msg[] = [...history(lines), { role: 'user', content: asksWhatsNew(question) ? `${question}\n\n${newsNote(profile)}` : question }];
  const ctx = { ...context(path, spoken), about: await aboutMe() };
  const used: string[] = [];
  let navigate: string | undefined;
  const sources: Source[] = [];   // the web pages the answer cites (and the gym timetable it read), shown under it
  const found: Source[] = [];     // the pages the searches turned up: shown when the answer cites none
  let choices: Choice[] = [];     // buttons to pick from (offer_choices)
  let searched = false;           // the web was searched in this question…
  let outside = false;            // …or something else outside the planner was read: from then on every change waits for Confirm
  const keep = (to: Source[], from?: Source[]) => { for (const s of from || []) if (/^https?:\/\//i.test(s?.url || '') && !to.some(x => x.url === s.url) && to.length < 6) to.push({ url: s.url, title: String(s.title || '') }); };
  // one link a site (two pages of the same site would show as the same name twice); found pages only when none is cited
  const site = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const pages = () => { const list = sources.length ? sources : found; return list.filter((s, i) => list.findIndex(x => site(x.url) === site(s.url)) === i).slice(0, sources.length ? 6 : 4); };
  const extras = () => ({ ...(pages().length ? { sources: pages() } : {}), ...(choices.length ? { choices } : {}) });
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await serverStep<{ content: Block[]; stop_reason: string; raw?: Block[]; web?: { searches?: string[]; sources?: Source[]; found?: Source[] } }>({ action: 'turn', messages: msgs, context: ctx }, RETRY_WAIT.ms);
    const content = Array.isArray(r.content) ? r.content : [];
    if (r.web) {
      if (!searched) used.push('web_search');
      searched = outside = true;
      keep(sources, r.web.sources); keep(found, r.web.found);
    }
    const calls = content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    const text = content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n').trim();
    for (const c of calls) if (c.name === 'offer_choices') choices = choicesFrom(c.input);
    if (r.stop_reason !== 'tool_use' || !calls.length) return { reply: text || (changes.length ? 'Done!' : 'Hmm, I lost my train of thought there. Try asking again?'), navigate, used, changes, ...extras() };
    // the reply came with its buttons and nothing else to run: that's the answer, no need to go back to Claude
    if (text && choices.length && calls.every(c => c.name === 'offer_choices')) return { reply: text, navigate, used, changes, ...extras() };
    onStep?.([...(r.web ? ['web_search'] : []), ...calls.map(c => c.name).filter(n => n !== 'offer_choices')]);   // a search asked for alongside a look-up runs during the next step
    const res = new Map<string, { result: unknown; error?: boolean; navigate?: string; sources?: Source[] }>();
    const about = { question, path };
    // look-ups together; changes one at a time, in order (each one's Undo snapshot is taken just before it)
    await Promise.all(calls.filter(c => !changeOf(c.name)).map(async c => { res.set(c.id, await runTool(c.name, c.input || {}, about)); }));
    if (calls.some(c => OUTSIDE.has(c.name))) outside = true;
    for (const c of calls.filter(c => changeOf(c.name))) res.set(c.id, await runChange(c.name, c.input || {}, changes, about, outside));
    const results = calls.map(c => {
      used.push(c.name);
      const out = res.get(c.id)!;
      if (out.navigate) navigate = out.navigate;
      keep(sources, out.sources);
      if (out.error) void logArvy({ type: 'error', title: `${c.name} didn’t work`, detail: JSON.stringify(out.result).slice(0, 600), tools: [c.name], ...about });
      return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(out.result).slice(0, RESULT_CAP[c.name] || 13000), ...(out.error ? { is_error: true } : {}) };
    });
    // a step that searched goes back as Claude wrote it (`raw`: the search and its results too), or it would search again
    msgs.push({ role: 'assistant', content: r.raw?.length ? r.raw : content }, { role: 'user', content: results });
  }
  void logArvy({ type: 'error', title: 'Arvy ran out of steps on a question', question, path, tools: used });
  return { reply: 'That one took me too many steps. Could you ask it a simpler way?', navigate, used, changes, ...extras() };
}

// ── demo (/demo): canned answers, nothing sent anywhere. Changes are real, on the demo's own data. ──
async function demoTurn(q: string, changes: ChangeView[]): Promise<Turn> {
  await new Promise(r => setTimeout(r, 900));
  const add = q.match(/add (.+?) to (?:the |my )?(?:shopping )?list/i);
  if (add) {
    await runChange('add_shopping_items', { items: add[1].split(/,\s*|\s+and\s+/).map(text => ({ text })) }, changes);
    return { reply: changes[0]?.state === 'done' ? 'Added to the list!' : 'Hmm, that didn’t work.', used: ['add_shopping_items'], changes };
  }
  if (/sick|sore throat|skip the gym|no sauna|sleep in|rest day/i.test(q)) {
    await runChange('adjust_day', { why: 'Sick day', skip: ['gym', 'sauna'], wake: '07:00',
      add: [{ title: 'Home stretch', time: '07:00', note: 'easy, about 20 minutes', session: true }, { title: 'Breakfast', time: '07:30', note: 'protein first, something warm' }] }, changes);
    await runChange('plan_workout', { name: 'Home stretch and reset', when: 'today', home: true, exercises: [
      { name: 'Cat-Cow', sets: 1, reps: '8', no_weight: true, cue: 'slow, with your breath' },
      { name: '90/90 Hip Rotations', sets: 2, reps: '6', per_side: true, no_weight: true, muscle: 'glutes', equipment: 'bodyweight' },
      { name: 'Thoracic Open Book', sets: 2, reps: '6', per_side: true, no_weight: true, muscle: 'back', equipment: 'bodyweight' },
      { name: 'Chest Doorway Stretch', sets: 2, seconds: 30, per_side: true, no_weight: true, muscle: 'chest', equipment: 'bodyweight' },
      { name: 'Child’s Pose', sets: 1, seconds: 45, no_weight: true, muscle: 'back', equipment: 'bodyweight' },
    ] }, changes);
    return { reply: 'Sorry you’re feeling rough. Today’s plan is changed: no gym, no sauna, up at 7, breakfast at 7:30. The stretch is set up as today’s session on Train: tap Confirm and the 7:00 block opens it. Your gym session waits for tomorrow.', used: ['adjust_day', 'plan_workout'], changes };
  }
  // class times at the gym (made up here; the real ones come from GoodLife's timetable): pick one, then it goes on the calendar
  if (/\b(yoga|class|classes)\b/i.test(q) && /calendar/i.test(q)) {
    await runChange('add_event', { title: 'Yoga · GoodLife Queenston', date: dayKey(), time: '19:45', end_time: '20:45' }, changes, {}, true);
    return { reply: 'Yoga at 7:45 tonight is ready to go on the calendar: tap Confirm. Book your spot in the GoodLife app, there were 37 left.', used: ['add_event'], changes };
  }
  if (/\b(yoga|class|classes|goodlife)\b/i.test(q)) {
    return { reply: 'Yoga at Queenston tonight is at 7:45 in the CoEd studio, 37 of 40 spots left. Tomorrow there’s Stretch and Relax at 10:00 am. At Burlington Centre the yoga is hot yoga, a paid add-on: Hot Yin at 6:00 pm, 17 of 25 left. Which one should go on the calendar? You’d still book it in the GoodLife app.',
      used: ['gym_classes'], changes, sources: [{ title: 'GoodLife class schedule (demo)', url: gymPageUrl(201) }],
      choices: [{ label: 'Yoga 7:45 pm, Queenston', send: 'Put tonight’s 7:45 pm Yoga at Queenston on my calendar' }, { label: 'Hot Yin 6:00 pm, Burlington', send: 'Put tonight’s 6:00 pm Hot Yin Yoga class at Burlington Centre on my calendar' }] };
  }
  // looked up on the web: options to pick from, with where they came from (the demo's are made up; nothing is searched)
  if (/look ?up|search|online|on the web|google/i.test(q)) {
    return { reply: 'I looked at what physios and health services suggest for a sore lower back. Three ways to go:\n\n1. **Gentle mobility flow (15 min):** pelvic tilts, cat-cow, knees to chest, child’s pose. The calmest one.\n2. **Core stability (20 min):** bird dog, dead bug, side plank on knees, glute bridge. The usual pick when discs are involved.\n3. **Hips and hamstrings (20 min):** hip flexor, figure-4 and hamstring stretches. Tight hips load the lower back.\n\nI’d start with 1 today. Stop on any pain down the leg, and your chiropractor has the last word. Which one?',
      used: ['coaching_context', 'web_search'], changes,
      sources: [{ title: 'Back pain (demo source)', url: 'https://www.nhs.uk/' }, { title: 'Low back pain (demo source)', url: 'https://www.mayoclinic.org/' }, { title: 'Exercises for your back (demo source)', url: 'https://www.csp.org.uk/' }],
      choices: [{ label: '1. Gentle mobility', send: 'Build me the gentle mobility session' }, { label: '2. Core stability', send: 'Build me the core stability session' }, { label: '3. Hips and hamstrings', send: 'Build me the hips and hamstrings session' }] };
  }
  if (/session|workout|sore|bench|train/i.test(q)) {
    await runChange('plan_workout', { name: 'Kettlebell shake-up', exercises: [
      { name: 'Bike', sets: 6, seconds: 20, rest_seconds: 40, style: 'intervals', cue: 'hard but controllable' },
      { name: 'Kettlebell Swing', sets: 3, reps: '12', weight: 35, group: 'A', rest_seconds: 0 },
      { name: 'Kettlebell Goblet Squat', sets: 3, reps: '10', weight: 35, group: 'A', rest_seconds: 75 },
      { name: 'Dumbbell Bench Press', sets: 4, reps_by_set: [12, 10, 8, 6], weight_by_set: [30, 35, 40, 45], style: 'pyramid', rest_seconds: 90 },
      { name: 'Half-kneeling Kettlebell Chop', sets: 1, reps: '8', per_side: true, weight: 25, group: 'B', group_style: 'emom', group_minutes: 6, muscle: 'core', equipment: 'kettlebell' },
      { name: 'Kettlebell Halo', sets: 1, reps: '5', per_side: true, weight: 25, group: 'B', group_style: 'emom', group_minutes: 6, muscle: 'shoulders', equipment: 'kettlebell' },
      { name: 'Side Plank', sets: 2, seconds: 25, per_side: true, rest_seconds: 30 },
    ] }, changes);
    return { reply: 'You slept 6 hours and chest was two days ago, so here’s a change of pace: same work, new shapes.\n- Bike intervals: 6 × 20 s on, 40 s easy\n- Superset A: swings 3 × 12 + goblet squats 3 × 10\n- Bench pyramid: 12-10-8-6, weight going up\n- EMOM 6 min: chops and halos, a minute each\n- Side plank: 2 × 25 s each side\nTap Confirm and it’s on your Train page!', used: ['coaching_context', 'plan_workout'], changes };
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

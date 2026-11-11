// src/planner/features/arvy/act.ts — what Arvy can change. Each change is worked out first (prepare), then done (apply),
// with a snapshot of every doc it touches taken just before, so Undo puts them back exactly.
//   Small, everyday changes are done straight away with an Undo: shopping items, to-dos, a meal, a habit mark, body weight.
//   Bigger ones wait for a Confirm card: calendar events, removing anything, money.
//   The schedule too: one day reshaped (a block skipped, a time moved, a block added: straight away, with an Undo) or
//   the standing routine changed (after Confirm).
// The same functions and doc shapes as the screens; after a change, screens holding a copy reload (lib/docs docsChanged).
import { calendarKey, dayKey, docsChanged, getDoc, getDocs, putDocs } from '../../lib/docs';
import { estimateFoodText } from '../../lib/ai';
import { getPass } from '../../lib/auth';
import { uid } from '../../ui/primitives';
import { loadList, addLines } from '../shop/store';
import type { ShopItem } from '../shop/types';
import { normalizeDay, syncPriorities, type Day } from '../plan';
import type { Todo } from '../plan/types';
import { DEFAULT_TARGETS, mealKey, nowTime, round, sum, type FavMeal, type Meal, type Targets } from '../food/model';
import { ALL_DAYS, DAY_SHORT, emptyHabit, type Habit, type HabitLog } from '../habits/types';
import type { CyclePrefs, DayLog, Period } from '../cycle/types';
import { FLOWS, MOODS, SYMPTOMS } from '../cycle/types';
import { eventKey, occursOn, type CalEvent, type Repeat, type Who } from '../calendar/types';
import { loadEvents } from '../calendar/store';
import { addCashRow, removeCashRow } from '../money/receipts';
import { loadAccounts, loadMonths, monthKey, recategorize, visibleMonths } from '../money/lib';
import { CATEGORIES } from '../money/categories';
import { daysAgo, loadCustomExercises, loadTemplates, loadWorkouts, startFromTemplate, templateFromPlan } from '../workout/store';
import { workoutKey, type Template } from '../workout/types';
import { planExercisesFrom, sessionLines } from '../workout/format';
import { findExercise } from '../workout/library';
import { adjustWords, blocks, clock, loadRoutine, mergeAdjust, saveRoutine, SKIPPABLE, type AddedBlock, type AdjustTime, type DayAdjust, type Routine } from '../../lib/routine';
import { autoMark } from '../habits/auto';
import type { Budget } from '../money/types';

type AnyIn = Record<string, unknown>;
/** A change Arvy worked out. `lines` say exactly what will happen (shown under the reply). */
export interface Change { kinds: string[]; lines: string[]; confirm: boolean; apply: () => Promise<Undo>;
  /** set by apply when the change opens a screen (a workout started now) */ go?: { to: string; state?: unknown } }
export type Undo = () => Promise<void>;
/** The request can't be done as asked: Arvy explains. `miss` = nothing matched the name given (worth a look in the log). */
export class Refuse extends Error { constructor(message: string, public miss = false) { super(message); } }

const me = () => getPass()?.user.username || 'me';
const str = (v: unknown, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(x => str(x)).filter(Boolean).slice(0, 30);
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/s$/, '');
const pretty = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const time12 = (t?: string) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

/** The best match for a phrase among names: exact, then whole-word containment either way. More than one = ask. */
export function pick<T>(items: T[], name: (t: T) => string, phrase: string): T | T[] | null {
  const p = norm(phrase);
  if (!p) return null;
  const exact = items.filter(i => norm(name(i)) === p);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact;
  const has = items.filter(i => { const n = norm(name(i)); return n.includes(p) || p.includes(n); });
  if (has.length === 1) return has[0];
  if (has.length) return has;
  // last try, word by word ("reading" finds "Read 10 pages"): every word said is in the name
  const words = (t: string) => norm(t).split(' ').filter(w => w.length > 2).map(stem);
  const said = words(phrase);
  const loose = said.length ? items.filter(i => { const n = new Set(words(name(i))); return said.every(w => n.has(w)); }) : [];
  return loose.length === 1 ? loose[0] : loose.length ? loose : null;
}
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ed|es)$/, '') : w);
function one<T>(items: T[], name: (t: T) => string, phrase: string, what: string): T {
  const r = pick(items, name, phrase);
  if (!r) throw new Refuse(`No ${what} matching “${phrase}”.`, true);
  if (Array.isArray(r)) throw new Refuse(`“${phrase}” matches more than one ${what}: ${r.slice(0, 6).map(name).join('; ')}. Which one?`);
  return r;
}

/** Snapshot docs (by key) before a change; the undo writes them back (null = it didn't exist). */
async function snapshot(kind: string, keys: string[]): Promise<Undo> {
  const before = await Promise.all(keys.map(async key => ({ kind, key, data: await getDoc(kind, key) })));
  return async () => { await putDocs(before.map(b => ({ kind: b.kind, key: b.key, data: b.data ?? null }))); docsChanged([kind]); };
}
/** Snapshot a whole kind (when the keys a change makes aren't known ahead, like adding shopping items). */
async function snapshotKind(kind: string): Promise<() => Promise<Undo>> {
  const before = new Map((await getDocs(kind)).map(d => [d.key, d.data]));
  return async () => {
    const after = await getDocs(kind);
    const touched = after.filter(d => JSON.stringify(before.get(d.key) ?? null) !== JSON.stringify(d.data)).map(d => d.key);
    return async () => { await putDocs(touched.map(key => ({ kind, key, data: before.get(key) ?? null }))); docsChanged([kind]); };
  };
}

// ───────────── shopping ─────────────
async function addShopping(input: AnyIn): Promise<Change> {
  const items = (Array.isArray(input.items) ? input.items : []).map(i => (typeof i === 'string' ? { text: i } : i as AnyIn))
    .map(i => ({ text: str(i.text, 80), qty: str(i.qty, 20) || undefined })).filter(i => i.text).slice(0, 30);
  if (!items.length) throw new Refuse('Nothing to add.');
  return {
    kinds: ['shop'], confirm: false,
    lines: [`Shopping list: add ${items.map(i => `${i.text}${i.qty ? ` (${i.qty})` : ''}`).join(', ')}`],
    apply: async () => { const done = await snapshotKind('shop'); await addLines(items, me()); return done(); },
  };
}
async function tickShopping(input: AnyIn, done: boolean): Promise<Change> {
  const names = list(input.items);
  if (!names.length) throw new Refuse('Which items?');
  const all = await loadList();
  const pool = all.filter(i => i.done !== done);
  const hits = names.map(n => one(pool, i => i.text, n, done ? 'item still to get' : 'ticked-off item'));
  return {
    kinds: ['shop'], confirm: false,
    lines: [`Shopping list: ${done ? 'tick off' : 'put back'} ${hits.map(h => h.text).join(', ')}`],
    apply: async () => {
      const undo = await snapshot('shop', hits.map(h => h.id));
      const at = new Date().toISOString();
      await putDocs(hits.map(h => ({ kind: 'shop', key: h.id, data: { ...h, done, doneAt: done ? at : undefined } as ShopItem })));
      return undo;
    },
  };
}
async function removeShopping(input: AnyIn): Promise<Change> {
  const names = list(input.items);
  const all = await loadList();
  const hits = names.map(n => one(all, i => i.text, n, 'item on the list'));
  return {
    kinds: ['shop'], confirm: true,
    lines: [`Shopping list: remove ${hits.map(h => h.text).join(', ')}`],
    apply: async () => { const undo = await snapshot('shop', hits.map(h => h.id)); await putDocs(hits.map(h => ({ kind: 'shop', key: h.id, data: null }))); return undo; },
  };
}

// ───────────── to-dos (the day page) ─────────────
async function dayDoc(date: string): Promise<Day> { return normalizeDay(await getDoc<Partial<Day>>('day', date)); }
async function addTodos(input: AnyIn): Promise<Change> {
  const date = isDate(input.date) ? input.date : dayKey();
  const todos = (Array.isArray(input.todos) ? input.todos : []).map(t => (typeof t === 'string' ? { text: t } : t as AnyIn))
    .map(t => ({ text: str(t.text, 140), time: isTime(t.time) ? t.time : undefined, must: t.must === true })).filter(t => t.text).slice(0, 15);
  if (!todos.length) throw new Refuse('Nothing to add.');
  const day = date === dayKey() ? 'today' : pretty(date);
  return {
    kinds: ['day'], confirm: false,
    lines: todos.map(t => `To-do ${day}: ${t.time ? `${time12(t.time)} ` : ''}${t.text}${t.must ? ' (a must)' : ''}`),
    apply: async () => {
      const undo = await snapshot('day', [date]);
      const d = await dayDoc(date);
      const add: Todo[] = todos.map(t => ({ id: uid(), text: t.text, done: false, from: 'me', ...(t.time ? { time: t.time } : {}), ...(t.must ? { must: true } : {}) }));
      await putDocs([{ kind: 'day', key: date, data: syncPriorities({ ...d, todos: [...d.todos, ...add] }) }]);
      return undo;
    },
  };
}
async function setTodos(input: AnyIn, mode: 'done' | 'undone' | 'remove'): Promise<Change> {
  const date = isDate(input.date) ? input.date : dayKey();
  const d = await dayDoc(date);
  const names = list(input.todos);
  if (!names.length) throw new Refuse('Which to-dos?');
  const hits = names.map(n => one(d.todos, t => t.text, n, 'to-do'));
  const day = date === dayKey() ? 'today' : pretty(date);
  return {
    kinds: ['day'], confirm: mode === 'remove',
    lines: hits.map(h => `To-do ${day}: ${mode === 'remove' ? 'remove' : mode === 'done' ? 'done ✓' : 'not done'} “${h.text}”`),
    apply: async () => {
      const undo = await snapshot('day', [date]);
      const fresh = await dayDoc(date);
      const ids = new Set(hits.map(h => h.id));
      const todos = mode === 'remove' ? fresh.todos.filter(t => !ids.has(t.id)) : fresh.todos.map(t => (ids.has(t.id) ? { ...t, done: mode === 'done' } : t));
      await putDocs([{ kind: 'day', key: date, data: syncPriorities({ ...fresh, todos }) }]);
      return undo;
    },
  };
}

// ───────────── the schedule: one day reshaped, or the standing routine ─────────────
/** What Arvy calls a block → the routine's own id. */
const BLOCK_OF: Record<string, string> = { gym: 'gym', sauna: 'sauna', brief: 'brief', the_brief: 'brief', kitchen: 'kitchen', kitchen_closed: 'kitchen', dinner: 'dinner',
  morning: 'morning', morning_routine: 'morning', miracle_morning: 'morning', kiaan_up: 'kiaanUp', kiaanup: 'kiaanUp', evening: 'evening', evening_review: 'evening' };
const blockIds = (v: unknown) => list(v).map(x => { const k = x.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); return BLOCK_OF[k] || k; });
/** What Arvy sends for a time → the routine's field. */
const DAY_TIMES: [string, AdjustTime, string][] = [['wake', 'wake', 'up at'], ['gym', 'gym', 'gym at'], ['list_start', 'review', 'the list from'], ['kitchen_closes', 'kitchenClose', 'kitchen closes'],
  ['dinner', 'eatOpen', 'dinner at'], ['lights_out', 'lightsOut', 'lights out'], ['kiaan_up', 'kiaanUp', 'Kiaan up at']];
const NIGHT_ONLY = new Set<AdjustTime>(['gym', 'review', 'kitchenClose']);
const dayRun = (r: Routine, a: DayAdjust | undefined) => blocks(r, a).map(b => `${clock(b.at)} ${b.label}`).join(' · ');

/** Reshape one day: blocks left out, times moved, blocks added (Day.adjust). A skipped gym is a planned rest day:
 *  the missed-gym question isn't asked and the gym habit is marked "skip", which keeps its streak. */
async function adjustDay(input: AnyIn): Promise<Change> {
  const today = dayKey();
  const date = isDate(input.date) ? input.date : today;
  if (date < today) throw new Refuse('That day is over: I can change today or a day ahead.');
  const [r, d] = await Promise.all([loadRoutine(), dayDoc(date)]);
  const word = date === today ? 'Today' : pretty(date);
  const has = new Set(blocks(r).map(b => b.id as string));
  const before = d.adjust;

  let next: DayAdjust | undefined;
  if (input.reset === true) {
    if (!before) throw new Refuse(`${word} already runs as the normal routine.`);
    next = undefined;
  } else {
    const can = new Set(SKIPPABLE[r.profile]);
    const skip = blockIds(input.skip), unskip = blockIds(input.unskip);
    for (const b of skip) {
      if (!can.has(b)) throw new Refuse(`“${b}” can’t be skipped: getting up, the list and lights out always stay. What can be left out: ${[...can].filter(x => has.has(x)).join(', ')}.`);
      if (!has.has(b)) throw new Refuse(`There’s no ${b} block in the routine, so there’s nothing to skip.`);
    }
    const times: Partial<Record<AdjustTime, string>> = {};
    for (const [key, field] of DAY_TIMES) {
      const v = input[key];
      if (v === undefined || v === null || v === '') continue;
      if (!isTime(v)) throw new Refuse(`I need “${key.replace('_', ' ')}” as a time (like 07:00).`);
      if (r.profile === 'morning' && NIGHT_ONLY.has(field)) throw new Refuse(`There’s no ${key.replace('_', ' ')} time in this routine.`);
      times[field] = v;
    }
    const saunaMin = typeof input.sauna_minutes === 'number' && r.profile === 'night' ? Math.max(0, Math.min(90, Math.round(input.sauna_minutes))) : undefined;
    const add: AddedBlock[] = (Array.isArray(input.add) ? input.add : []).map(x => x as AnyIn)
      .filter(x => x && str(x.title, 60) && isTime(x.time)).slice(0, 8)
      .map(x => ({ id: uid().slice(0, 8), at: x.time as string, label: str(x.title, 60), ...(isTime(x.end_time) ? { until: x.end_time } : {}), ...(str(x.note, 140) ? { note: str(x.note, 140) } : {}) }));
    if (Array.isArray(input.add) && input.add.length && !add.length) throw new Refuse('Each block to add needs a title and a time (like 07:00).');
    const remove = list(input.remove).map(n => one(before?.added || [], x => x.label, n, 'added block').id);
    next = mergeAdjust(before, { why: str(input.why, 60) || undefined, skip, unskip, times, saunaMin, add, remove });
    if (JSON.stringify({ ...next, at: 0 }) === JSON.stringify({ ...before, at: 0 })) throw new Refuse(before ? `${word} already runs that way.` : 'Nothing to change: tell me what to skip, move or add.');
  }

  // what the gym and sauna being off (or back on) means for the day: a planned rest, habits marked "skip"
  const gymOff = !!next?.skip?.includes('gym'), gymWasOff = !!before?.skip?.includes('gym');
  const saunaOff = !!next?.skip?.includes('sauna'), saunaWasOff = !!before?.skip?.includes('sauna');
  // the card says everything that's different about that day now (not only this step), then how the day runs
  const changed = next ? adjustWords(next) : ['back to the normal routine'];
  return {
    kinds: ['day', 'habitlog'], confirm: false,
    lines: [`${word}’s plan${next?.why ? ` (${next.why})` : ''}: ${changed.join(' · ')}`, `  The day now runs: ${dayRun(r, next)}`],
    apply: async () => {
      const undoDay = await snapshot('day', [date]);
      const undoHabits = await snapshot('habitlog', [date]);
      const fresh = await dayDoc(date);
      let gym = fresh.gym;
      if (gymOff && !gym && !fresh.ticks.gym) gym = { answer: 'rest', at: new Date().toISOString(), planned: true };
      if (!gymOff && gym?.planned) gym = undefined;
      await putDocs([{ kind: 'day', key: date, data: { ...fresh, adjust: next, gym } }]);
      if (gymOff !== gymWasOff) await autoMark('gym', gymOff, date, 'skip');
      if (saunaOff !== saunaWasOff) await autoMark('sauna', saunaOff, date, 'skip');
      return async () => { await undoHabits(); await undoDay(); };
    },
  };
}

/** What Arvy sends → a field of the standing routine. */
const ROUTINE_TIMES: [string, keyof Routine, string][] = [['wake', 'wake', 'Up'], ['gym', 'gym', 'Gym'], ['list_start', 'review', 'The list starts'], ['dinner', 'eatOpen', 'Dinner'],
  ['window_closes', 'eatClose', 'Eating window closes'], ['lights_out', 'lightsOut', 'Lights out'], ['kiaan_up', 'kiaanUp', 'Kiaan up']];
const ROUTINE_MINS: [string, keyof Routine, string, number][] = [['wake_grace_minutes', 'wakeGrace', 'Wake-up grace', 120], ['sauna_minutes', 'saunaMin', 'Sauna', 60], ['brief_minutes', 'briefMinutes', 'Brief', 60],
  ['stretch_minutes', 'stretchMin', 'Stretch', 60], ['meditate_minutes', 'meditateMin', 'Meditate', 60], ['workout_minutes', 'workoutMin', 'Light workout', 90]];
const shiftTime = (t: string, by: number) => { const [h, m] = t.split(':').map(Number); const n = (((h * 60 + m + by) % 1440) + 1440) % 1440; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const minsOf = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Change the standing routine (Settings › My routine): every day from now on. Waits for Confirm. */
async function changeRoutine(input: AnyIn): Promise<Change> {
  const r = await loadRoutine();
  const next: Routine = { ...r };
  const set = <K extends keyof Routine>(k: K, v: Routine[K]) => { next[k] = v; };
  for (const [key, field] of ROUTINE_TIMES) {
    const v = input[key];
    if (v === undefined || v === null || v === '') continue;
    if (!isTime(v)) throw new Refuse(`I need “${key.replace(/_/g, ' ')}” as a time (like 05:30).`);
    set(field, v as never);
  }
  for (const [key, field, , max] of ROUTINE_MINS) {
    const v = input[key];
    if (typeof v === 'number' && Number.isFinite(v)) set(field, Math.max(field === 'briefMinutes' ? 1 : 0, Math.min(max, Math.round(v))) as never);
  }
  const kc = input.kitchen_closes;
  if (typeof kc === 'string' && kc.trim()) {
    if (/^(none|off|no)$/i.test(kc.trim())) next.kitchenClose = '';
    else if (isTime(kc)) next.kitchenClose = kc;
    else throw new Refuse('I need “kitchen closes” as a time (like 14:00), or “none”.');
  }
  if (typeof input.eating_window === 'boolean') next.fast = input.eating_window;
  // the morning hangs off the wake time: moving it moves the gym and the start of the list too, unless they were given
  const by = minsOf(next.wake) - minsOf(r.wake);
  if (by && r.profile === 'night') {
    if (input.gym === undefined) next.gym = shiftTime(r.gym, by);
    if (input.list_start === undefined) next.review = shiftTime(r.review, by);
  }
  if (next.lightsOut !== r.lightsOut) next.windDown = shiftTime(r.windDown, minsOf(next.lightsOut) - minsOf(r.lightsOut));

  const show = (v: Routine[keyof Routine]) => (typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'number' ? `${v} min` : v ? clock(String(v)) : 'none');
  const labels: [keyof Routine, string][] = [...ROUTINE_TIMES.map(([, f, l]) => [f, l] as [keyof Routine, string]), ...ROUTINE_MINS.map(([, f, l]) => [f, l] as [keyof Routine, string]), ['kitchenClose', 'Kitchen closes'], ['fast', 'Eating window']];
  const lines = labels.filter(([f]) => next[f] !== r[f]).map(([f, l]) => `Routine, every day: ${l} ${show(r[f])} → ${show(next[f])}`);
  if (!lines.length) throw new Refuse('The routine already runs that way.');
  return {
    kinds: ['prefs', 'day'], confirm: true,
    lines: [...lines, `  A normal day then runs: ${dayRun(next, undefined)}`],
    apply: async () => {
      await saveRoutine(next);
      return async () => { await saveRoutine(r); docsChanged(['prefs', 'day']); };
    },
  };
}
// ───────────── food ─────────────
async function logMeal(input: AnyIn): Promise<Change> {
  const what = str(input.description, 400);
  if (!what) throw new Refuse('What did you eat?');
  const date = isDate(input.date) ? input.date : dayKey();
  const time = isTime(input.time) ? input.time : nowTime();
  const est = await estimateFoodText(what);
  if (!est.items.length) throw new Refuse('I couldn’t work out the food in that. Try describing it a little more.');
  const totals = round(sum(est.items));
  const meal: Meal = { id: uid(), date, time, name: str(input.name, 60) || what.slice(0, 60), items: est.items, totals, note: undefined, source: 'text' };
  return {
    kinds: ['meal'], confirm: false,
    lines: [`Food ${date === dayKey() ? 'today' : pretty(date)} ${time12(time)}: ${meal.name} — ${totals.kcal} kcal, ${totals.protein} g protein (${est.items.map(i => i.name).join(', ')})`],
    apply: async () => { const key = mealKey(meal); const undo = await snapshot('meal', [key]); await putDocs([{ kind: 'meal', key, data: meal }]); return undo; },
  };
}

// ───────────── habits and body weight ─────────────
async function markHabit(input: AnyIn): Promise<Change> {
  const date = isDate(input.date) ? input.date : dayKey();
  const habits = (await getDocs<Habit>('habit')).map(d => ({ ...d.data, id: d.data?.id || d.key })).filter(h => h && !h.archived && h.name);
  const h = one(habits, x => x.name, str(input.habit, 80), 'habit');
  const mark = ['done', 'mini', 'skip', 'clear'].includes(String(input.mark)) ? String(input.mark) : 'done';
  return {
    kinds: ['habitlog'], confirm: false,
    lines: [`Habit ${date === dayKey() ? 'today' : pretty(date)}: ${h.name} → ${mark === 'clear' ? 'not marked' : mark === 'mini' ? 'mini version' : mark === 'skip' ? 'skipped (rest day)' : 'done ✓'}`],
    apply: async () => {
      const undo = await snapshot('habitlog', [date]);
      const log: HabitLog = { ...((await getDoc<HabitLog>('habitlog', date)) || {}) };
      if (mark === 'clear') delete log[h.id]; else log[h.id] = mark as HabitLog[string];
      await putDocs([{ kind: 'habitlog', key: date, data: log }]);
      return undo;
    },
  };
}
async function bodyWeight(input: AnyIn): Promise<Change> {
  const w = Math.round(Number(input.weight) * 10) / 10;
  if (!(w > 40 && w < 700)) throw new Refuse('That weight doesn’t look right.');
  const date = isDate(input.date) ? input.date : dayKey();
  const units = (getPass()?.user.settings?.units as string) === 'kg' ? 'kg' : 'lb';
  return {
    kinds: ['bodyweight'], confirm: false, lines: [`Body weight ${date === dayKey() ? 'today' : pretty(date)}: ${w} ${units}`],
    apply: async () => { const undo = await snapshot('bodyweight', [date]); await putDocs([{ kind: 'bodyweight', key: date, data: { weight: w } }]); return undo; },
  };
}

// ───────────── calendar (always confirmed) ─────────────
const WHO: Who[] = ['vijay', 'rosh', 'both', 'kiaan'];
const REPEAT: Repeat[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly'];
const who = (v: unknown): Who => (WHO.includes(String(v).toLowerCase() as Who) ? String(v).toLowerCase() as Who : (me() === 'rosh' ? 'rosh' : 'vijay'));
const whoLabel = (w: Who) => ({ vijay: 'Vijay', rosh: 'Rosh', both: 'both of you', kiaan: 'Kiaan' }[w]);
const evText = (e: CalEvent) => `${e.title}, ${pretty(e.date)}${e.time ? ` ${time12(e.time)}${e.endTime ? `–${time12(e.endTime)}` : ''}` : ' (all day)'} for ${whoLabel(e.who)}${e.repeat && e.repeat !== 'none' ? `, repeats ${e.repeat}${e.until ? ` until ${pretty(e.until)}` : ''}` : ''}${e.notes ? ` — ${e.notes}` : ''}`;

async function addEvent(input: AnyIn): Promise<Change> {
  const title = str(input.title, 100);
  if (!title || !isDate(input.date)) throw new Refuse('I need a title and a date.');
  const e: CalEvent = { id: uid(), title, date: input.date, who: who(input.who), repeat: REPEAT.includes(input.repeat as Repeat) ? input.repeat as Repeat : 'none', createdBy: me(), createdAt: new Date().toISOString() };
  if (isTime(input.time)) e.time = input.time;
  if (e.time && isTime(input.end_time) && input.end_time > e.time) e.endTime = input.end_time;
  if (str(input.notes)) e.notes = str(input.notes, 300);
  if (e.repeat !== 'none' && isDate(input.until) && input.until >= e.date) e.until = input.until;
  return {
    kinds: ['event'], confirm: true, lines: [`Calendar: add ${evText(e)}`],
    apply: async () => { const key = eventKey(e); const undo = await snapshot('event', [key]); await putDocs([{ kind: 'event', key, data: e }]); return undo; },
  };
}
async function findEvent(input: AnyIn): Promise<CalEvent> {
  if (!isDate(input.date)) throw new Refuse('Which day is it on?');
  const events = (await loadEvents(input.date, input.date)).filter(e => occursOn(e, input.date as string));
  if (!events.length) throw new Refuse(`Nothing on the calendar on ${pretty(input.date)}.`);
  return str(input.title) ? one(events, e => e.title, str(input.title), `event on ${pretty(input.date)}`)
    : events.length === 1 ? events[0] : (() => { throw new Refuse(`There’s more than one event on ${pretty(input.date as string)}: ${events.map(e => e.title).join('; ')}. Which one?`); })();
}
async function changeEvent(input: AnyIn): Promise<Change> {
  const old = await findEvent(input);
  const repeating = !!old.repeat && old.repeat !== 'none';
  const next: CalEvent = { ...old };
  if (str(input.new_title)) next.title = str(input.new_title, 100);
  if (isDate(input.new_date)) next.date = input.new_date;
  if (input.all_day === true) { delete next.time; delete next.endTime; }
  if (isTime(input.new_time)) { const shiftEnd = old.time && old.endTime; next.time = input.new_time;
    if (shiftEnd) { const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); const e = mins(input.new_time) + (mins(old.endTime!) - mins(old.time!)); next.endTime = e < 1440 ? `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}` : undefined; } }
  if (isTime(input.new_end_time) && next.time && input.new_end_time > next.time) next.endTime = input.new_end_time;
  if (input.who) next.who = who(input.who);
  if (typeof input.notes === 'string') next.notes = str(input.notes, 300) || undefined;
  if (repeating && next.date !== old.date) throw new Refuse(`“${old.title}” repeats, so I can only move its time or details for the whole series, not its day. Change the day on the Calendar screen.`);
  const same = JSON.stringify(next) === JSON.stringify(old);
  if (same) throw new Refuse('That’s already how it is.');
  return {
    kinds: ['event'], confirm: true,
    lines: [`Calendar: change ${evText(old)}`, `→ ${evText(next)}${repeating ? ' (every time it repeats)' : ''}`],
    apply: async () => {
      const oldKey = eventKey(old), newKey = eventKey(next);
      const undo = await snapshot('event', oldKey === newKey ? [oldKey] : [oldKey, newKey]);
      await putDocs(oldKey === newKey ? [{ kind: 'event', key: newKey, data: next }] : [{ kind: 'event', key: oldKey, data: null }, { kind: 'event', key: newKey, data: next }]);
      return undo;
    },
  };
}
async function deleteEvent(input: AnyIn): Promise<Change> {
  const e = await findEvent(input);
  const repeating = !!e.repeat && e.repeat !== 'none';
  const all = !repeating || input.scope === 'all';
  const date = input.date as string;
  return {
    kinds: ['event'], confirm: true,
    lines: [all ? `Calendar: delete ${evText(e)}${repeating ? ' (every time)' : ''}` : `Calendar: skip ${e.title} on ${pretty(date)} only (the rest of the series stays)`],
    apply: async () => {
      const key = eventKey(e); const undo = await snapshot('event', [key]);
      await putDocs([{ kind: 'event', key, data: all ? null : { ...e, skip: [...new Set([...(e.skip || []), date])] } }]);
      return undo;
    },
  };
}

// ───────────── money (always confirmed) ─────────────
const SPEND = CATEGORIES.filter(c => c.spending).map(c => c.name);
const category = (v: unknown): string => { const c = String(v || ''); const hit = CATEGORIES.find(x => x.name.toLowerCase() === c.toLowerCase()); if (!hit) throw new Refuse(`“${c}” isn’t a category. Pick one of: ${SPEND.join(', ')}.`); return hit.name; };
async function cashExpense(input: AnyIn): Promise<Change> {
  const amount = Math.round(Math.abs(Number(input.amount)) * 100) / 100;
  if (!(amount > 0 && amount < 100000)) throw new Refuse('How much was it?');
  const desc = str(input.what, 80) || 'Cash';
  const cat = category(input.category);
  const date = isDate(input.date) ? input.date : dayKey();
  return {
    kinds: ['txns', 'account'], confirm: true,
    lines: [`Cash wallet: $${amount.toFixed(2)} ${desc} [${cat}] on ${pretty(date)}`],
    apply: async () => { const row = await addCashRow({ date, desc, amount, category: cat }); return async () => { await removeCashRow(row.id, date.slice(0, 7)); docsChanged(['txns']); }; },
  };
}
async function recategorizeTxns(input: AnyIn): Promise<Change> {
  const q = str(input.search, 60).toLowerCase();
  if (q.length < 2) throw new Refuse('Which transactions? Give me a store or merchant name.');
  const cat = category(input.category);
  const month = typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month) ? input.month : monthKey();
  const [months, accounts] = await Promise.all([loadMonths(month, month), loadAccounts()]);
  const rows = (visibleMonths(months, accounts)[month] || []).filter(t => `${t.merchant} ${t.desc}`.toLowerCase().includes(q) && t.category !== cat);
  if (!rows.length) throw new Refuse(`No ${month} transactions matching “${q}” to change.`);
  return {
    kinds: ['txns'], confirm: true,
    lines: [`Money ${month}: ${rows.length} transaction${rows.length === 1 ? '' : 's'} matching “${q}” → ${cat}`, ...rows.slice(0, 5).map(t => `  ${t.date} ${t.merchant || t.desc} $${Math.abs(t.amount).toFixed(2)} (was ${t.category})`)],
    apply: async () => {
      const undo = await snapshot('txns', [month]);
      await recategorize(await loadMonths(month, month), new Set(rows.map(r => r.id)), cat);
      return undo;
    },
  };
}


// ───────────── phase 3: the rest of the planner ─────────────
const today = (d: string) => (d === dayKey() ? 'today' : pretty(d));
const plusDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00`); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

// must-dos (the day's priorities are the starred to-dos)
async function setMust(input: AnyIn): Promise<Change> {
  const date = isDate(input.date) ? input.date : dayKey();
  const d = await dayDoc(date);
  const hits = list(input.todos).map(n => one(d.todos, t => t.text, n, 'to-do'));
  if (!hits.length) throw new Refuse('Which to-dos?');
  const must = input.must !== false;
  return {
    kinds: ['day'], confirm: false,
    lines: hits.map(h => `To-do ${today(date)}: “${h.text}” ${must ? '★ a must-do' : 'no longer a must-do'}`),
    apply: async () => {
      const undo = await snapshot('day', [date]);
      const fresh = await dayDoc(date); const ids = new Set(hits.map(h => h.id));
      await putDocs([{ kind: 'day', key: date, data: syncPriorities({ ...fresh, todos: fresh.todos.map(t => (ids.has(t.id) ? { ...t, must } : t)) }) }]);
      return undo;
    },
  };
}

// food: favourites and targets
async function favourites(): Promise<FavMeal[]> { return (await getDocs<FavMeal>('favmeal')).map(d => d.data).filter(f => f && f.id && f.name); }
async function logFavourite(input: AnyIn): Promise<Change> {
  const f = one(await favourites(), x => x.name, str(input.favourite, 80), 'favourite meal');
  const date = isDate(input.date) ? input.date : dayKey();
  const time = isTime(input.time) ? input.time : nowTime();
  const meal: Meal = { id: uid(), date, time, name: f.name, items: f.items, totals: f.totals, source: 'favourite' };
  return {
    kinds: ['meal', 'favmeal'], confirm: false,
    lines: [`Food ${today(date)} ${time12(time)}: ${f.name} — ${Math.round(f.totals.kcal)} kcal, ${Math.round(f.totals.protein)} g protein`],
    apply: async () => {
      const key = mealKey(meal);
      const u1 = await snapshot('meal', [key]); const u2 = await snapshot('favmeal', [f.id]);
      await putDocs([{ kind: 'meal', key, data: meal }, { kind: 'favmeal', key: f.id, data: { ...f, uses: (f.uses || 0) + 1, lastUsed: new Date().toISOString() } }]);
      return async () => { await u1(); await u2(); };
    },
  };
}
async function saveFavourite(input: AnyIn): Promise<Change> {
  const date = isDate(input.date) ? input.date : dayKey();
  const meals = (await getDocs<Meal>('meal', `${date}~`, `${date}~￿`)).map(d => d.data).filter(m => m && m.id);
  const m = one(meals, x => x.name, str(input.meal, 80), `meal logged ${today(date)}`);
  const name = str(input.name, 60) || m.name;
  const existing = (await favourites()).find(f => norm(f.name) === norm(name));
  const fav: FavMeal = existing ? { ...existing, items: m.items, totals: round(sum(m.items)), lastUsed: new Date().toISOString() }
    : { id: uid(), name, items: m.items, totals: round(sum(m.items)), thumb: m.thumb, uses: 1, lastUsed: new Date().toISOString() };
  return {
    kinds: ['favmeal'], confirm: false,
    lines: [`Favourites: ${existing ? 'update' : 'save'} “${name}” (${fav.totals.kcal} kcal, ${fav.totals.protein} g protein)`],
    apply: async () => { const undo = await snapshot('favmeal', [fav.id]); await putDocs([{ kind: 'favmeal', key: fav.id, data: fav }]); return undo; },
  };
}
async function setTargets(input: AnyIn): Promise<Change> {
  const cur: Targets = (await getDoc<Targets>('foodprefs', 'targets')) || DEFAULT_TARGETS;
  const n = (v: unknown, lo: number, hi: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : undefined; };
  const next: Targets = { kcal: n(input.kcal, 800, 6000) ?? cur.kcal, protein: n(input.protein, 20, 400) ?? cur.protein, carbs: n(input.carbs, 0, 800) ?? cur.carbs, fat: n(input.fat, 0, 400) ?? cur.fat };
  if (JSON.stringify(next) === JSON.stringify({ ...cur, carbs: cur.carbs, fat: cur.fat })) throw new Refuse('Those are already your targets (or the numbers look off).');
  const t = (x: Targets) => `${x.kcal} kcal, ${x.protein} g protein${x.carbs ? `, ${x.carbs} g carbs` : ''}${x.fat ? `, ${x.fat} g fat` : ''}`;
  return {
    kinds: ['foodprefs'], confirm: true, lines: [`Food targets: ${t(cur)}`, `→ ${t(next)}`],
    apply: async () => { const undo = await snapshot('foodprefs', ['targets']); await putDocs([{ kind: 'foodprefs', key: 'targets', data: next }]); return undo; },
  };
}

// habits: make one, pause one
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function days(v: unknown): number[] {
  const out = new Set<number>();
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x === 'number' && x >= 0 && x <= 6) out.add(x);
    const i = DAY_NAMES.indexOf(String(x).toLowerCase().slice(0, 3)); if (i >= 0) out.add(i);
  }
  return out.size ? [...out].sort() : [...ALL_DAYS];
}
async function createHabit(input: AnyIn): Promise<Change> {
  const name = str(input.name, 80);
  if (!name) throw new Refuse('What’s the habit?');
  const all = (await getDocs<Habit>('habit')).map(d => d.data).filter(Boolean);
  if (all.some(h => !h.archived && norm(h.name) === norm(name))) throw new Refuse(`You already have “${name}”.`);
  const h: Habit = { ...emptyHabit(all.length), id: uid(), name, days: days(input.days), twoMinute: str(input.two_minute, 120), why: str(input.why, 200), stack: str(input.after, 120), identity: str(input.identity, 160) };
  const when = h.days.length === 7 ? 'every day' : h.days.map(d => DAY_SHORT[d]).join(', ');
  return {
    kinds: ['habit'], confirm: true,
    lines: [`New habit: ${name}, ${when}${h.stack ? `, after I ${h.stack}` : ''}${h.twoMinute ? ` (mini: ${h.twoMinute})` : ''}`],
    apply: async () => { const undo = await snapshot('habit', [h.id]); await putDocs([{ kind: 'habit', key: h.id, data: h }]); return undo; },
  };
}
async function pauseHabit(input: AnyIn): Promise<Change> {
  const resume = input.resume === true;
  const all = (await getDocs<Habit>('habit')).map(d => ({ ...d.data, id: d.data?.id || d.key })).filter(h => h && h.name && !!h.archived === resume);
  const h = one(all, x => x.name, str(input.habit, 80), resume ? 'paused habit' : 'habit');
  return {
    kinds: ['habit'], confirm: true, lines: [`Habit: ${resume ? 'bring back' : 'pause (archive)'} “${h.name}”${resume ? '' : '. Its history is kept'}`],
    apply: async () => { const undo = await snapshot('habit', [h.id]); await putDocs([{ kind: 'habit', key: h.id, data: { ...h, archived: !resume } }]); return undo; },
  };
}

// money: a budget line
async function setBudget(input: AnyIn): Promise<Change> {
  const cat = category(input.category);
  if (!SPEND.includes(cat)) throw new Refuse(`${cat} isn’t a spending category, so it has no budget.`);
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!(amount >= 0 && amount < 100000)) throw new Refuse('How much a month?');
  const b: Budget = (await getDoc<Budget>('budget', 'current')) || {};
  const was = Number(b[cat]) || 0;
  if (was === amount) throw new Refuse(`${cat} is already $${amount} a month.`);
  const next: Budget = { ...b }; if (amount > 0) next[cat] = amount; else delete next[cat];
  return {
    kinds: ['budget'], confirm: true, lines: [`Budget: ${cat} ${was ? `$${was}` : 'no budget'} → ${amount ? `$${amount}` : 'no budget'} a month`],
    apply: async () => { const undo = await snapshot('budget', ['current']); await putDocs([{ kind: 'budget', key: 'current', data: next }]); return undo; },
  };
}

// cycle (Rosh): periods and daily logs. Cycle days are calendar days (midnight), like the Cycle screen.
const pickFrom = <T extends string>(allowed: readonly T[], v: unknown): T[] => list(v).map(x => allowed.find(a => a === x.toLowerCase())).filter((x): x is T => !!x);
async function logCycleDay(input: AnyIn): Promise<Change> {
  const date = isDate(input.date) ? input.date : calendarKey();
  const cur: DayLog = (await getDoc<DayLog>('cyclelog', date)) || {};
  const next: DayLog = { ...cur };
  const flow = FLOWS.find(f => f === String(input.flow || '').toLowerCase());
  if (flow) next.flow = flow;
  const sy = pickFrom(SYMPTOMS, input.symptoms); if (sy.length) next.symptoms = [...new Set([...(cur.symptoms || []), ...sy])];
  const mo = pickFrom(MOODS, input.mood); if (mo.length) next.mood = [...new Set([...(cur.mood || []), ...mo])];
  if (str(input.notes)) next.notes = [cur.notes, str(input.notes, 300)].filter(Boolean).join(' · ');
  if (JSON.stringify(next) === JSON.stringify(cur)) throw new Refuse(`Nothing I can log there. Symptoms: ${SYMPTOMS.join(', ')}. Moods: ${MOODS.join(', ')}. Flow: ${FLOWS.join(', ')}.`);
  const bits = [flow && `flow ${flow}`, sy.length && sy.join(', '), mo.length && `mood ${mo.join(', ')}`, str(input.notes) && `note “${str(input.notes, 80)}”`].filter(Boolean);
  return {
    kinds: ['cyclelog'], confirm: false, lines: [`Cycle ${date === calendarKey() ? 'today' : pretty(date)}: ${bits.join('; ')}`],
    apply: async () => { const undo = await snapshot('cyclelog', [date]); await putDocs([{ kind: 'cyclelog', key: date, data: next }]); return undo; },
  };
}
async function logPeriod(input: AnyIn): Promise<Change> {
  const date = isDate(input.date) ? input.date : calendarKey();
  const periods = (await getDocs<Period>('period')).map(d => d.data).filter(p => p && p.start && p.end).sort((a, b) => a.start.localeCompare(b.start));
  if (input.action === 'ended') {
    const p = [...periods].reverse().find(x => x.start <= date && date <= plusDays(x.end, 7));
    if (!p) throw new Refuse('I can’t find a period that started before then.');
    return {
      kinds: ['period'], confirm: false, lines: [`Cycle: period that started ${pretty(p.start)} ended ${pretty(date)}`],
      apply: async () => { const undo = await snapshot('period', [p.start]); await putDocs([{ kind: 'period', key: p.start, data: { ...p, end: date } }]); return undo; },
    };
  }
  if (periods.some(p => p.start <= date && date <= p.end)) throw new Refuse(`There’s already a period logged covering ${pretty(date)}.`);
  const prefs = await getDoc<Partial<CyclePrefs>>('cycleprefs', 'settings');
  const recent = periods.slice(-6).map(p => (new Date(`${p.end}T12:00:00`).getTime() - new Date(`${p.start}T12:00:00`).getTime()) / 864e5 + 1);
  const len = prefs?.periodLength || (recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 5);
  const p: Period = { start: date, end: plusDays(date, len - 1), source: 'app' };
  return {
    kinds: ['period'], confirm: false, lines: [`Cycle: period started ${pretty(date)} (expected to ${pretty(p.end)}; say when it ends)`],
    apply: async () => { const undo = await snapshot('period', [p.start]); await putDocs([{ kind: 'period', key: p.start, data: p }]); return undo; },
  };
}

// ───────────── training: a session Arvy planned (what the Coach chat's buttons did) ─────────────
async function planWorkout(input: AnyIn): Promise<Change> {
  const units = (getPass()?.user.settings?.units as string) === 'kg' ? 'kg' : 'lb';
  const exs = planExercisesFrom(input.exercises);
  if (!exs.length) throw new Refuse('The session has no exercises.');
  const [custom, templates, workouts] = await Promise.all([loadCustomExercises(), loadTemplates(), loadWorkouts(daysAgo(28))]);
  const { template, created } = templateFromPlan({ name: str(input.name, 60) || 'Arvy’s plan', exercises: exs }, units, custom);
  const todayKey = dayKey();
  const doneToday = workouts.some(w => w.date === todayKey && (w.endedAt || !w.discarded));
  const when = ['today', 'tomorrow', 'template', 'now'].includes(String(input.when)) ? String(input.when) : doneToday ? 'tomorrow' : 'today';
  const shown = sessionLines(template.exercises, id => [...custom, ...created].find(e => e.id === id) || findExercise(id || ''));
  if (created.length) shown.push(`  New exercises: ${created.map(e => e.name).join(', ')}`);
  const newExercises = created.map(e => ({ kind: 'exercise', key: e.id, data: { ...e, custom: true } }));
  const snap = async (kind: string, keys: string[]) => (keys.length ? snapshot(kind, keys) : (async () => undefined) as Undo);

  if (when === 'now') {
    const running = workouts.find(w => !w.endedAt && !w.discarded);
    if (running) throw new Refuse(`“${running.name}” is still in progress. Finish or discard it on the Train screen first.`);
    const c: Change = {
      kinds: ['workout', 'exercise'], confirm: true, lines: [`Train: start “${template.name}” now (${template.exercises.length} exercises)`, ...shown],
      apply: async () => {
        const w = startFromTemplate({ ...template, id: '' }, workouts, units, [...custom, ...created]);
        delete w.templateId;
        const key = workoutKey(w);
        const u1 = await snap('exercise', created.map(e => e.id)); const u2 = await snapshot('workout', [key]);
        await putDocs([...newExercises, { kind: 'workout', key, data: w }]);
        c.go = { to: `/workout/live/${w.id}`, state: { key } };
        return async () => { await u2(); await u1(); };
      },
    };
    return c;
  }
  if (when === 'template') {
    const existing = str(input.replace) ? one(templates.filter(t => !t.archived), t => t.name, str(input.replace), 'workout template') : undefined;
    const t: Template = existing ? { ...existing, name: str(input.name, 60) || existing.name, exercises: template.exercises } : { ...template, order: templates.length };
    return {
      kinds: ['template', 'exercise'], confirm: true, lines: [`Train: ${existing ? `replace the template “${existing.name}”` : `save the template “${t.name}”`} (${t.exercises.length} exercises)`, ...shown],
      apply: async () => { const u1 = await snap('exercise', created.map(e => e.id)); const u2 = await snapshot('template', [t.id]); await putDocs([...newExercises, { kind: 'template', key: t.id, data: t }]); return async () => { await u2(); await u1(); }; },
    };
  }
  const date = when === 'tomorrow' ? plusDays(todayKey, 1) : todayKey;
  const existing = templates.find(t => t.plannedFor === date && !t.archived);
  const t: Template = { ...template, id: existing?.id || template.id, plannedFor: date, order: -1 };
  return {
    kinds: ['template', 'exercise'], confirm: true,
    lines: [`Train ${when} (${pretty(date)}): “${t.name}” (${t.exercises.length} exercises)${existing ? `, instead of “${existing.name}”` : ''}`, ...shown],
    apply: async () => { const u1 = await snap('exercise', created.map(e => e.id)); const u2 = await snapshot('template', [t.id]); await putDocs([...newExercises, { kind: 'template', key: t.id, data: t }]); return async () => { await u2(); await u1(); }; },
  };
}

/** Work out a change. Throws Refuse with a reason when it can't be done as asked. null = not a change tool. */
export async function prepare(name: string, input: AnyIn): Promise<Change | null> {
  switch (name) {
    case 'add_shopping_items': return addShopping(input);
    case 'check_off_shopping': return tickShopping(input, input.done !== false);
    case 'remove_shopping_items': return removeShopping(input);
    case 'add_todos': return addTodos(input);
    case 'complete_todos': return setTodos(input, input.done === false ? 'undone' : 'done');
    case 'remove_todos': return setTodos(input, 'remove');
    case 'log_meal': return logMeal(input);
    case 'mark_habit': return markHabit(input);
    case 'log_body_weight': return bodyWeight(input);
    case 'add_event': return addEvent(input);
    case 'change_event': return changeEvent(input);
    case 'delete_event': return deleteEvent(input);
    case 'add_cash_expense': return cashExpense(input);
    case 'recategorize': return recategorizeTxns(input);
    case 'set_must': return setMust(input);
    case 'log_favourite_meal': return logFavourite(input);
    case 'save_favourite': return saveFavourite(input);
    case 'set_food_targets': return setTargets(input);
    case 'create_habit': return createHabit(input);
    case 'pause_habit': return pauseHabit(input);
    case 'set_budget': return setBudget(input);
    case 'log_cycle_day': return logCycleDay(input);
    case 'log_period': return logPeriod(input);
    case 'plan_workout': return planWorkout(input);
    case 'adjust_day': return adjustDay(input);
    case 'change_routine': return changeRoutine(input);
    default: return null;
  }
}

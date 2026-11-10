// src/planner/features/arvy/act.ts — what Arvy can change. Each change is worked out first (prepare), then done (apply),
// with a snapshot of every doc it touches taken just before, so Undo puts them back exactly.
//   Small, everyday changes are done straight away with an Undo: shopping items, to-dos, a meal, a habit mark, body weight.
//   Bigger ones wait for a Confirm card: calendar events, removing anything, money.
// The same functions and doc shapes as the screens; after a change, screens holding a copy reload (lib/docs docsChanged).
import { dayKey, docsChanged, getDoc, getDocs, putDocs } from '../../lib/docs';
import { estimateFoodText } from '../../lib/ai';
import { getPass } from '../../lib/auth';
import { uid } from '../../ui/primitives';
import { loadList, addLines } from '../shop/store';
import type { ShopItem } from '../shop/types';
import { normalizeDay, syncPriorities, type Day } from '../plan';
import type { Todo } from '../plan/types';
import { mealKey, nowTime, round, sum, type Meal } from '../food/model';
import type { Habit, HabitLog } from '../habits/types';
import { eventKey, occursOn, type CalEvent, type Repeat, type Who } from '../calendar/types';
import { loadEvents } from '../calendar/store';
import { addCashRow, removeCashRow } from '../money/receipts';
import { loadAccounts, loadMonths, monthKey, recategorize, visibleMonths } from '../money/lib';
import { CATEGORIES } from '../money/categories';

type AnyIn = Record<string, unknown>;
/** A change Arvy worked out. `lines` say exactly what will happen (shown under the reply). */
export interface Change { kinds: string[]; lines: string[]; confirm: boolean; apply: () => Promise<Undo> }
export type Undo = () => Promise<void>;
export class Refuse extends Error {}   // the request can't be done as asked: Arvy explains

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
  if (!r) throw new Refuse(`No ${what} matching “${phrase}”.`);
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
    default: return null;
  }
}

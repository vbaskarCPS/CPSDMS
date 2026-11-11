// src/planner/features/widgets/widgets.ts — what is on the Today page, in what order and at what size.
// Two sorts of thing live there: the planner's own blocks (the streaks, the day's plan, the feature cards), which a
// person can move, shrink or switch off, and the ones a person adds (a countdown, a note, the month, the habit week).
// Everything here is plain functions with no React (tested in widgets.test.ts): the list of blocks, how a saved
// arrangement is read back safely, and the countdown's sums. Saved per person in the doc 'prefs' / 'widgets' (store.ts).
//
// The rule that matters most: a block the saved arrangement doesn't mention still shows, at its usual place. So a block
// added to Today in a later update turns up for someone who arranged their page before it existed.
import type { Profile } from '../../lib/app';
import { upcoming } from '../us/occasions';

/** The planner's own blocks on Today. The day's plan holds the routine and the to-do list. */
export type TodayBlockId = 'streaks' | 'plan' | 'calendar' | 'shop' | 'cycle' | 'habits' | 'train' | 'food' | 'money';
export type Size = 'full' | 'compact';
/** `only` = on one kind of planner only; `always` = can't be switched off; `sizes` = what each size shows, when it has two. */
export interface TodayBlock { id: TodayBlockId; name: string; about: string; only?: Profile; always?: boolean; sizes?: Record<Size, string> }

/** In the order Today has always drawn them (screens/Today.tsx). The cycle card is on the morning planner only. */
export const BLOCKS: TodayBlock[] = [
  { id: 'streaks', name: 'Streaks', about: 'Your days in a row' },
  { id: 'plan', name: 'The day’s plan', about: 'Your routine and the to-do list', always: true, sizes: { full: 'The whole day', compact: 'What’s finished earlier in the day folds away' } },
  { id: 'calendar', name: 'Calendar', about: 'What’s on today and tomorrow', sizes: { full: 'Each event', compact: 'One line' } },
  { id: 'shop', name: 'Shopping', about: 'How much is on the list' },
  { id: 'cycle', name: 'Cycle', about: 'The day of your cycle and what’s next', only: 'morning', sizes: { full: 'With the two weeks ahead', compact: 'One line' } },
  { id: 'habits', name: 'Habits', about: 'Today’s habits, to tick', sizes: { full: 'Each habit, to tick', compact: 'One line' } },
  { id: 'train', name: 'Train', about: 'Today’s session' },
  { id: 'food', name: 'Food', about: 'Calories and protein so far', sizes: { full: 'With the ring', compact: 'One line' } },
  { id: 'money', name: 'Money', about: 'This month’s spending' },
];
export const blocksFor = (profile: Profile): TodayBlock[] => BLOCKS.filter(b => !b.only || b.only === profile);
/** Today as it is before anyone arranges it. */
export const defaultOrder = (profile: Profile): TodayBlockId[] => blocksFor(profile).map(b => b.id);

// ── the ones a person adds ──
export type AddedKind = 'countdown' | 'note' | 'month' | 'habitweek';
/** A note's paper. The colours come from the look that's on: plain card, the bright colour, a tint of the main one, green, warm. */
export type Paper = 'plain' | 'bright' | 'tint' | 'fresh' | 'warm';
export const PAPERS: Paper[] = ['plain', 'bright', 'tint', 'fresh', 'warm'];
/** `yearly` = comes round every year; `occasion` = one of the coming occasions (its date can move: Easter, Diwali). */
export interface Countdown { id: string; kind: 'countdown'; title: string; date: string; yearly?: boolean; occasion?: string }
/** The words on a note are kept in their own doc ('widgetnote' / id), so typing never rewrites the arrangement. */
export interface Note { id: string; kind: 'note'; paper: Paper }
export interface Month { id: string; kind: 'month' }
export interface HabitWeek { id: string; kind: 'habitweek' }
export type Added = Countdown | Note | Month | HabitWeek;

/** What each added one is called, how many fit on a page, and whether it has a small size (two small ones sit side by side). */
export const ADDED: Record<AddedKind, { name: string; about: string; max: number; small: boolean }> = {
  countdown: { name: 'Countdown', about: 'The days left to a day you pick', max: 6, small: true },
  note: { name: 'Note', about: 'A sticky note to type on', max: 6, small: true },
  month: { name: 'Mini calendar', about: 'This month, with a dot on the days something is on', max: 1, small: true },
  habitweek: { name: 'Habit tracker', about: 'This week’s ticks for your habits', max: 1, small: false },
};
export const MAX_ADDED = 12;
export const TITLE_MAX = 40;
export const NOTE_MAX = 600;
const OCCASIONS = ['halloween', 'diwali', 'christmas', 'newyear', 'valentine', 'easter', 'birthday'];
const ADDED_ID = /^x-[a-z0-9]{3,24}$/;
/** An id for something a person adds. Never the same as one of the planner's own blocks. */
export const newId = (): string => `x-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── the saved shape ──
/** order: ids top to bottom (the planner's blocks and added ones). off: blocks switched off. size: the ones made
 *  compact (full is not written down). added: what the person added, with its settings. kept: added ones of a kind this
 *  version doesn't know (their other phone is a version ahead), carried along untouched so saving here doesn't lose them. */
export interface WidgetPrefs { v: 1; order: string[]; off: string[]; size: Record<string, Size>; added: Added[]; kept?: unknown[] }
export const EMPTY: WidgetPrefs = { v: 1, order: [], off: [], size: {}, added: [] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ids = (v: unknown): string[] => [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40) : [])].slice(0, 80);

function cleanAdded(a: unknown): Added | null {
  if (!isObj(a) || typeof a.id !== 'string' || !ADDED_ID.test(a.id)) return null;
  const id = a.id;
  if (a.kind === 'countdown') {
    if (!isDay(a.date)) return null;
    const title = (typeof a.title === 'string' ? a.title : '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || 'Countdown';
    return { id, kind: 'countdown', title, date: a.date, ...(a.yearly === true ? { yearly: true } : {}), ...(typeof a.occasion === 'string' && OCCASIONS.includes(a.occasion) ? { occasion: a.occasion } : {}) };
  }
  if (a.kind === 'note') return { id, kind: 'note', paper: PAPERS.includes(a.paper as Paper) ? (a.paper as Paper) : 'plain' };
  if (a.kind === 'month' || a.kind === 'habitweek') return { id, kind: a.kind };
  return null;
}

/** Whatever was saved (nothing, an older shape, something broken), made safe to use. Never throws.
 *  Ids it doesn't know are kept in `order`, `off` and `size` (another phone may be a version ahead) and simply not drawn. */
export function clean(raw: unknown): WidgetPrefs {
  const r = isObj(raw) ? raw : {};
  const added: Added[] = [], kept: Record<string, unknown>[] = [];
  for (const a of [...(Array.isArray(r.added) ? r.added : []), ...(Array.isArray(r.kept) ? r.kept : [])]) {
    const w = cleanAdded(a);
    if (!w) {
      // a kind from a newer version: not drawn here, but not thrown away either
      if (isObj(a) && typeof a.id === 'string' && ADDED_ID.test(a.id) && typeof a.kind === 'string' && a.kind.length <= 24 && !(a.kind in ADDED) && kept.length < MAX_ADDED && !kept.some(x => x.id === a.id)) kept.push(a);
      continue;
    }
    if (added.length >= MAX_ADDED || added.some(x => x.id === w.id)) continue;
    if (added.filter(x => x.kind === w.kind).length >= ADDED[w.kind].max) continue;
    added.push(w);
  }
  const off = ids(r.off).filter(id => !BLOCKS.some(b => b.id === id && b.always) && !ADDED_ID.test(id));
  const size: Record<string, Size> = {};
  for (const id of isObj(r.size) ? Object.keys(r.size).slice(0, 80) : []) {
    if ((r.size as Record<string, unknown>)[id] !== 'compact' || id.length > 40) continue;
    const block = BLOCKS.find(b => b.id === id), mine = added.find(x => x.id === id);
    if (block ? !block.sizes : ADDED_ID.test(id) && !(mine && ADDED[mine.kind].small) && !kept.some(x => x.id === id)) continue;   // one size only, or gone
    size[id] = 'compact';
  }
  return { v: 1, order: ids(r.order), off, size, added, ...(kept.length ? { kept } : {}) };
}

// ── the arranged list ──
/** One thing on the list: one of the planner's blocks or an added one, whether it shows, and its size. */
export interface Item { id: string; name: string; block?: TodayBlock; added?: Added; on: boolean; size: Size; resizable: boolean }

/** Everything that can be on this person's Today, top to bottom, switched-off ones included (the arrange screen lists
 *  them too). The saved order first; unknown and repeated ids are dropped; a block the order doesn't have goes to its
 *  usual place: straight after the block that comes before it on the original page. */
export function arrange(prefs: WidgetPrefs, profile: Profile): Item[] {
  const p = clean(prefs), blocks = blocksFor(profile);
  const known = new Set<string>([...blocks.map(b => b.id), ...p.added.map(a => a.id)]);
  const order = p.order.filter(id => known.has(id));
  blocks.forEach((b, i) => {
    if (order.includes(b.id)) return;
    for (let j = i - 1; j >= 0; j--) { const at = order.indexOf(blocks[j].id); if (at >= 0) { order.splice(at + 1, 0, b.id); return; } }
    for (let j = i + 1; j < blocks.length; j++) { const at = order.indexOf(blocks[j].id); if (at >= 0) { order.splice(at, 0, b.id); return; } }
    order.push(b.id);
  });
  for (const a of p.added) if (!order.includes(a.id)) order.push(a.id);
  return order.map(id => {
    const block = blocks.find(b => b.id === id);
    if (block) return { id, name: block.name, block, on: !!block.always || !p.off.includes(id), size: block.sizes && p.size[id] === 'compact' ? 'compact' : 'full', resizable: !!block.sizes };
    const added = p.added.find(a => a.id === id)!;
    const small = ADDED[added.kind].small;
    return { id, name: added.kind === 'countdown' ? added.title : ADDED[added.kind].name, added, on: true, size: small && p.size[id] === 'compact' ? 'compact' : 'full', resizable: small };
  });
}

/** What Today draws: the list without what's switched off, in rows. Two small added ones next to each other in the
 *  order share a row, side by side; everything else has a row to itself. */
export function rows(items: Item[]): Item[][] {
  const small = (i: Item) => !!i.added && i.size === 'compact';
  const out: Item[][] = [];
  for (const it of items.filter(i => i.on)) {
    const last = out[out.length - 1];
    if (small(it) && last && last.length === 1 && small(last[0])) last.push(it); else out.push([it]);
  }
  return out;
}

// ── changing it (each gives back a new arrangement; the old one is not touched) ──
const orderOf = (p: WidgetPrefs, profile: Profile): string[] => arrange(p, profile).map(i => i.id);

/** One place up (-1) or down (1). At the end of the list nothing happens. */
export function move(p: WidgetPrefs, profile: Profile, id: string, by: -1 | 1): WidgetPrefs {
  const order = orderOf(p, profile), i = order.indexOf(id);
  return i < 0 ? p : moveTo(p, profile, id, i + by);
}
/** To a place in the list (0 = the top). */
export function moveTo(p: WidgetPrefs, profile: Profile, id: string, to: number): WidgetPrefs {
  const order = orderOf(p, profile), i = order.indexOf(id);
  if (i < 0 || to < 0 || to >= order.length || to === i) return p;
  order.splice(i, 1); order.splice(to, 0, id);
  return { ...clean(p), order };
}
/** Switch one of the planner's blocks off or back on. The always-shown ones stay on. */
export function setOn(p: WidgetPrefs, id: string, on: boolean): WidgetPrefs {
  const c = clean(p), block = BLOCKS.find(b => b.id === id);
  if (!block || block.always) return c;
  return { ...c, off: on ? c.off.filter(x => x !== id) : [...c.off.filter(x => x !== id), id] };
}
export function setSize(p: WidgetPrefs, id: string, size: Size): WidgetPrefs {
  const c = clean(p), rest = { ...c.size };
  delete rest[id];
  return clean({ ...c, size: size === 'compact' ? { ...rest, [id]: 'compact' } : rest });   // clean drops it for a one-size block
}
/** Can another of this kind go on the page? */
export function canAdd(p: WidgetPrefs, kind: AddedKind): boolean {
  const c = clean(p);
  return c.added.length < MAX_ADDED && c.added.filter(a => a.kind === kind).length < ADDED[kind].max;
}
/** Add one, at the top of Today, so it's seen at once. */
export function add(p: WidgetPrefs, profile: Profile, w: Added): WidgetPrefs {
  const c = clean(p);
  if (!canAdd(c, w.kind) || c.added.some(a => a.id === w.id) || !cleanAdded(w)) return c;
  return clean({ ...c, added: [...c.added, w], order: [w.id, ...orderOf(c, profile)] });
}
/** Change an added one's settings (a countdown's title or date, a note's paper). */
export function change(p: WidgetPrefs, w: Added): WidgetPrefs {
  const c = clean(p);
  return clean({ ...c, added: c.added.map(a => (a.id === w.id && a.kind === w.kind ? w : a)) });
}
/** Take an added one off the page. */
export function remove(p: WidgetPrefs, id: string): WidgetPrefs {
  const c = clean(p), size = { ...c.size };
  delete size[id];
  return { ...c, added: c.added.filter(a => a.id !== id), order: c.order.filter(x => x !== id), size };
}
/** "Put it back as it was": the planner's own blocks in their original order and size, all showing. What the person
 *  added is theirs (a note has words on it), so it stays, below the rest. */
export function putBack(p: WidgetPrefs, profile: Profile): WidgetPrefs {
  const c = clean(p), mine = orderOf(c, profile).filter(id => c.added.some(a => a.id === id));
  const size: Record<string, Size> = {};
  for (const id of mine) if (c.size[id]) size[id] = c.size[id];
  return { v: 1, order: [...defaultOrder(profile), ...mine], off: [], size, added: c.added, ...(c.kept ? { kept: c.kept } : {}) };
}
/** Is the planner's part of the page as it originally was (with anything added below it)? Then there's nothing to put back. */
export function isAsItWas(p: WidgetPrefs, profile: Profile): boolean {
  const list = arrange(p, profile), usual = defaultOrder(profile);
  return list.slice(0, usual.length).every((it, i) => it.id === usual[i] && it.on && it.size === 'full');
}
/** Has this person never changed anything? Today is then drawn exactly as it always was. */
export const untouched = (p: WidgetPrefs, profile: Profile): boolean => clean(p).added.length === 0 && isAsItWas(p, profile);

/** The compact day's plan: a block from earlier in the day that's finished folds away. One not done yet never does,
 *  nor does the one the clock is in, so nothing still to do is ever out of sight. */
export const foldsAway = (compact: boolean, b: { past: boolean; done: boolean; now?: boolean }): boolean => compact && b.past && b.done && !b.now;

// ── days and the countdown ──
const two = (n: number) => String(n).padStart(2, '0');
const at = (key: string): number => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const keyOf = (ms: number): string => { const d = new Date(ms); return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`; };
/** A real calendar day written YYYY-MM-DD (so not 2026-02-30). */
export function isDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && keyOf(at(v)) === v;
}
/** Whole days from one day to another: 2026-12-31 → 2027-01-01 is 1; a day gone by is below zero. */
export const daysBetween = (from: string, to: string): number => Math.round((at(to) - at(from)) / 864e5);

/** How a countdown reads today: the big number (or "today!"), the few words beside it, and whether it's gone by. */
export function countdownView(date: string, today: string): { days: number; state: 'coming' | 'today' | 'passed'; big: string; small: string } {
  const days = daysBetween(today, date);
  if (days === 0) return { days, state: 'today', big: 'today!', small: 'It’s here' };
  if (days > 0) return { days, state: 'coming', big: String(days), small: days === 1 ? 'day to go · tomorrow' : 'days to go' };
  return { days, state: 'passed', big: '', small: days === -1 ? 'was yesterday' : `was ${-days} days ago` };
}
/** The same day a year on. The 29th of February becomes the 28th in a year without one. */
export function yearOn(date: string, years = 1): string {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${two(m)}-${two(Math.min(d, last))}`;
}
/** For a countdown that has gone by: the next time its day comes round, or null if it only happens once (or the next
 *  date isn't known). An occasion whose date moves (Easter, Diwali) gets its own next date, not the same day a year on. */
export function nextTime(c: Pick<Countdown, 'date' | 'yearly' | 'occasion'>, today: string): string | null {
  if (c.occasion && c.occasion !== 'birthday') {
    const o = upcoming(today).find(x => x.id === c.occasion);
    return o && o.date && o.date > c.date ? o.date : null;
  }
  if (!c.yearly) return null;
  for (let n = 1; n <= 80; n++) { const d = yearOn(c.date, n); if (d >= today) return d; }
  return null;
}

/** A month ('2026-11') as the cells of a calendar page, Sunday first: null for the gaps before the 1st, then each day. */
export function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array.from({ length: lead }, () => null), ...Array.from({ length: n }, (_, i) => `${month}-${two(i + 1)}`)];
}

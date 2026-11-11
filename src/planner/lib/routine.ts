// src/planner/lib/routine.ts — the shape of Vijay's day. Every feature reads its times from here.
// Vijay (the 'night' profile, now the 5 am club): up at 5, straight to the gym, then the sauna, where he does
// yesterday's review and today's Brief → the to-do list, and the protein road (2 meals + shakes, eaten by 2 pm when the
// kitchen closes); the list through the day, lights out at 9:30. Nothing to do at night but go to bed. Rosh ('morning'): Miracle Morning, bed at 9.
// Kept in doc kind 'prefs', key 'routine'; editable in Settings.
//
// The planner's "day" rolls over at 4 am, not midnight: lights out at 1 am still belongs to the day
// that's ending (see dayKey in docs.ts).
//
// One day can differ from the routine (sick: no gym, no sauna, up at 7): those changes are kept on the day
// (Day.adjust) and worked out by supabase/functions/planner-push/adjust.ts, which the reminders share. blocks(),
// currentBlock() and routineFor() take the day's changes; without them they give the standing routine.
import { dayKey, getDoc, putDoc } from './docs';
import { profileOf, type Profile } from './app';
import { cleanAdjust, lateGym, routineFor, type AddedBlock, type DayAdjust } from '../../../supabase/functions/planner-push/adjust';
export { cleanAdjust, lateGym, mergeAdjust, routineFor, SKIPPABLE, isHM, type AddedBlock, type AdjustTime, type DayAdjust } from '../../../supabase/functions/planner-push/adjust';

export interface Routine {
  profile: Profile;    // 'night' (Vijay: the 5 am club — gym at 5, sauna review + Brief, bed at 9:30) | 'morning' (Rosh: Miracle Morning, bed at 9)
  // morning profile only
  stretchMin: number; meditateMin: number; workoutMin: number;   // the Miracle Morning blocks
  kiaanUp: string;     // when Kiaan is up (morning profile: after the routine)
  fast: boolean;       // follow an eating window (false = plain calorie tracking)
  wake: string;        // 'HH:MM' target, with Kiaan
  wakeGrace: number;   // minutes after `wake` that still count as on time
  briefMinutes: number;// the Bed Brief must fit in this
  daycare: string;     // drop-off
  eatOpen: string;     // the fast ends: first meal
  eatClose: string;    // last food (the shake)
  gym: string;         // session start
  shake: string;       // post-gym protein shake
  saunaMin: number;    // night profile: the sauna after the gym, where yesterday's review and today's Brief happen (0 = none)
  review: string;      // night profile: out of the sauna, review and Brief done — the list starts
  unwindCap: number;   // morning profile: minutes of games/unwind before the review (0 = no cap)
  windDown: string;    // night profile: hard stop for the unwind — teeth, face, phone on charge, bed
  lightsOut: string;   // in bed, lights off
  kitchenClose: string;// night profile: last food of the day ('' = no cut-off); the protein road's slots all land before it
}

export const NIGHT_ROUTINE: Routine = {
  profile: 'night', stretchMin: 0, meditateMin: 0, workoutMin: 0, kiaanUp: '07:30', fast: true,
  wake: '05:00', wakeGrace: 15, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '20:30', gym: '05:15', shake: '20:30', saunaMin: 25, review: '06:45', unwindCap: 0, windDown: '21:30', lightsOut: '21:30', kitchenClose: '14:00',
};
export const MORNING_ROUTINE: Routine = {
  profile: 'morning', stretchMin: 10, meditateMin: 10, workoutMin: 20, kiaanUp: '08:00', fast: false,
  wake: '05:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '20:00', gym: '06:00', shake: '20:00', saunaMin: 0, review: '20:30', unwindCap: 30, windDown: '20:45', lightsOut: '21:00', kitchenClose: '',
};
export const DEFAULT_ROUTINE: Routine = NIGHT_ROUTINE;
export const defaultsFor = (p: Profile): Routine => (p === 'morning' ? MORNING_ROUTINE : NIGHT_ROUTINE);

let cached: Routine | null = null;
const listeners = new Set<(r: Routine) => void>();

/** The signed-in person's profile decides the defaults; their saved routine overrides them. */
let profile: Profile = profileOf(null);
export function setProfile(p: Profile): void { if (p !== profile) { profile = p; cached = null; } }
export async function loadRoutine(): Promise<Routine> {
  if (cached) return cached;
  const d = await getDoc<Partial<Routine>>('prefs', 'routine').catch(() => null);
  cached = { ...defaultsFor(profile), ...(d || {}), profile };
  return cached;
}
export function routineNow(): Routine { return cached || defaultsFor(profile); }
export async function saveRoutine(r: Routine): Promise<void> {
  cached = { ...defaultsFor(profile), ...r, profile };
  await putDoc('prefs', 'routine', cached);
  listeners.forEach(fn => { try { fn(cached!); } catch { /* ignore */ } });
}
export function onRoutineChange(fn: (r: Routine) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** 'HH:MM' → minutes since midnight. */
export const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** minutes since midnight → 'HH:MM' */
export const hhmm = (mins: number): string => { const m = ((mins % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** 'HH:MM' → '8:30 am' */
export function clock(hhmmStr: string): string {
  const m = minutesOf(hhmmStr), h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** Minutes into the planner's day (which starts at 4 am): 8:30 am → 270; 1:00 am → 1260. */
export function routineMinutes(d = new Date()): number { return ((d.getHours() * 60 + d.getMinutes() - 240) + 1440) % 1440; }
/** The same scale for a routine time: 'HH:MM' → minutes since 4 am, so 01:00 sorts after 23:00. */
export const routineMin = (t: string): number => (minutesOf(t) - 240 + 1440) % 1440;

/** Is `now` inside the eating window? Also how long the fast has run / until it ends. */
export function fastState(r: Routine, d = new Date()): { eating: boolean; openIn: number; closeIn: number; fastedFor: number } {
  const now = routineMinutes(d), open = routineMin(r.eatOpen), close = routineMin(r.eatClose);
  const eating = now >= open && now < close;
  const openIn = eating ? 0 : now < open ? open - now : 1440 - now + open;
  const closeIn = eating ? close - now : 0;
  // fasted since the window closed (yesterday's close when before today's open)
  const fastedFor = eating ? 0 : now >= close ? now - close : now + (1440 - close);
  return { eating, openIn, closeIn, fastedFor };
}

export type BlockId = 'wake' | 'brief' | 'daycare' | 'work' | 'dinner' | 'kitchen' | 'gym' | 'sauna' | 'night' | 'shake' | 'unwind' | 'windDown' | 'lightsOut'
  | 'morning' | 'kiaanUp' | 'evening'
  | `x:${string}`;   // a block added for one day (Day.adjust.added)
/** Night profile (5 am club): gym → sauna (yesterday's review, today's Brief) → out at r.review, the list starts. */
export const reviewAt = (r: Routine) => r.review;
export const saunaAt = (r: Routine) => hhmm(minutesOf(r.review) - r.saunaMin);
/** When the review and Brief happen: in the sauna, or straight after the gym when there's no sauna. */
export const planAt = (r: Routine) => (r.saunaMin ? saunaAt(r) : r.review);
/** `added` = a block added for that one day (its tick lives with it). */
export interface Block { id: BlockId; label: string; at: string; until?: string; blurb: string; added?: AddedBlock }

/** The day as an ordered list of blocks. `a` = that day's changes (Day.adjust): skipped blocks are left out, moved
 *  times apply, a gym moved to later in the day sits there with its sauna, and added blocks slot in at their times. */
export function blocks(r: Routine, a?: DayAdjust | null): Block[] {
  if (!a) return r.profile === 'morning' ? morningBlocks(r) : nightBlocks(r);
  const e = routineFor(r, a), skip = new Set(a.skip || []), late = lateGym(r, a);
  const noMorningGym = skip.has('gym') || !!late;
  if (e.profile === 'night' && skip.has('kitchen')) skip.add('dinner');   // no cut-off today doesn't bring the dinner block back
  let list = (e.profile === 'morning' ? morningBlocks(e) : nightBlocks(e, { noMorningGym, nextWake: r.wake })).filter(b => !skip.has(b.id));
  if (late) {
    list = list.filter(b => b.id !== 'gym');
    list.push({ id: 'gym', label: 'Gym', at: late.at, until: late.until, blurb: 'log the session · Complete workout' });
    if (late.saunaUntil) list.push({ id: 'sauna', label: 'Sauna', at: late.until, until: late.saunaUntil, blurb: `${(minutesOf(late.saunaUntil) - minutesOf(late.until) + 1440) % 1440} min` });
  }
  for (const x of a.added || []) list.push({ id: `x:${x.id}`, label: x.label, at: x.at, until: x.until, blurb: x.note || '', added: x });
  // by time on the planner's clock (the day starts at 4 am); blocks at the same time keep their order
  return list.map((b, i) => ({ b, i })).sort((p, q) => routineMin(p.b.at) - routineMin(q.b.at) || p.i - q.i).map(x => x.b);
}

function nightBlocks(r: Routine, o: { noMorningGym?: boolean; nextWake?: string } = {}): Block[] {
  return [
    o.noMorningGym
      ? { id: 'wake', label: 'Up', at: r.wake, blurb: `by ${clock(hhmm(minutesOf(r.wake) + r.wakeGrace))} counts` }
      : { id: 'wake', label: 'Up — straight to the gym', at: r.wake, blurb: `by ${clock(hhmm(minutesOf(r.wake) + r.wakeGrace))} counts · no snooze, shoes on, out the door` },
    { id: 'gym', label: 'Gym', at: r.gym, until: planAt(r), blurb: 'log the session · Complete workout' },
    ...(r.saunaMin ? [{ id: 'sauna' as BlockId, label: 'Sauna', at: saunaAt(r), until: r.review, blurb: `${r.saunaMin} min · plan the meals, then today's Brief` }] : []),
    { id: 'brief', label: "Today's Brief", at: planAt(r), ...(planAt(r) !== r.review ? { until: r.review } : {}), blurb: 'one word · 3 must-dos · → today\'s list' },
    { id: 'work', label: 'Tackle the list', at: r.review, blurb: r.fast ? 'today\'s list · fasting: water, black coffee, tea' : 'today\'s list' },
    r.kitchenClose
      ? { id: 'kitchen', label: 'Kitchen closed', at: r.kitchenClose, blurb: 'done eating for the day · water, coffee, tea' }
      : { id: 'dinner', label: r.fast ? 'Dinner — first meal' : 'Dinner', at: r.eatOpen, blurb: r.fast ? `fast ends · protein first · window closes ${clock(r.eatClose)}` : 'log it' },
    { id: 'lightsOut', label: 'Lights out', at: r.lightsOut, blurb: `phone down — up at ${clock(o.nextWake || r.wake)}` },
  ];
}

/** Rosh's day: Miracle Morning before Kiaan is up, bed with him at 9. With no minutes for the routine (stretch,
 *  meditate and move all 0: her choice in the set-up) there is no Miracle Morning block and the Brief starts the day. */
function morningBlocks(r: Routine): Block[] {
  const routineMins = r.stretchMin + r.meditateMin + r.workoutMin;
  const routineEnd = hhmm(minutesOf(r.wake) + routineMins);
  const briefEnd = hhmm(minutesOf(routineEnd) + r.briefMinutes);
  return [
    { id: 'wake', label: 'Up', at: r.wake, blurb: `by ${clock(hhmm(minutesOf(r.wake) + r.wakeGrace))} counts` },
    ...(routineMins > 0 ? [{ id: 'morning' as BlockId, label: 'Miracle Morning', at: r.wake, until: routineEnd, blurb: [r.stretchMin ? `stretch ${r.stretchMin}` : '', r.meditateMin ? `meditate ${r.meditateMin}` : '', r.workoutMin ? `move ${r.workoutMin}` : ''].filter(Boolean).join(' · ') }] : []),
    { id: 'brief', label: 'Morning Brief', at: routineEnd, until: briefEnd, blurb: `${r.briefMinutes} minutes, before the house wakes` },
    { id: 'kiaanUp', label: 'Kiaan up', at: r.kiaanUp, blurb: 'breakfast, ready for the day' },
    { id: 'work', label: 'Tackle the list', at: r.kiaanUp, until: r.eatOpen, blurb: 'the to-do list from the Morning Brief' },
    { id: 'dinner', label: 'Dinner', at: r.eatOpen, blurb: 'log it' },
    { id: 'evening', label: 'Evening review', at: hhmm(minutesOf(r.lightsOut) - 30), until: r.lightsOut, blurb: '3 lines · scorecard · tomorrow\'s #1' },
    { id: 'lightsOut', label: 'Bed with Kiaan', at: r.lightsOut, blurb: 'lights out' },
  ];
}

/** Which block the clock is in right now (on a changed day: among that day's blocks). */
export function currentBlock(r: Routine, d = new Date(), a?: DayAdjust | null): BlockId {
  const now = routineMinutes(d);
  const list = blocks(r, a);
  let cur: BlockId = 'lightsOut';
  for (const b of list) if (routineMin(b.at) <= now) cur = b.id;
  if (now < routineMin(routineFor(r, a).wake)) cur = 'lightsOut';   // still night
  return cur;
}

const BLOCK_NAME: Record<string, string> = { gym: 'gym', sauna: 'sauna', brief: 'Brief', kitchen: 'kitchen cut-off', dinner: 'dinner', morning: 'morning routine', kiaanUp: 'Kiaan up', evening: 'evening review' };
const TIME_NAME: Record<string, string> = { wake: 'up at', gym: 'gym at', review: 'list from', lightsOut: 'lights out', kitchenClose: 'kitchen closes', eatOpen: 'dinner at', kiaanUp: 'Kiaan up at' };
/** A day's changes in a few words each: "no gym", "up at 7:00 am", "+ Stretch 7:00 am". Shown on Today and told to Arvy. */
export function adjustWords(a?: DayAdjust | null): string[] {
  if (!a) return [];
  return [
    ...(a.skip || []).map(s => `no ${BLOCK_NAME[s] || s}`),
    ...Object.entries(a.times || {}).map(([k, v]) => (k === 'kitchenClose' && !v ? 'no kitchen cut-off' : `${TIME_NAME[k] || k} ${clock(v as string)}`)),
    ...(a.saunaMin !== undefined && !a.skip?.includes('sauna') ? [`sauna ${a.saunaMin} min`] : []),
    ...(a.added || []).map(x => `+ ${x.label} ${clock(x.at)}`),
  ];
}

/** A day's saved changes (today's by default), checked. undefined when the day runs as the routine says. */
export async function loadDayAdjust(date = dayKey()): Promise<DayAdjust | undefined> {
  const d = await getDoc<{ adjust?: unknown }>('day', date).catch(() => null);
  return cleanAdjust(d?.adjust);
}

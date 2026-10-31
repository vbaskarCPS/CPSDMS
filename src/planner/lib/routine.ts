// src/planner/lib/routine.ts — the shape of Vijay's day. Every feature reads its times from here:
// wake with Kiaan, the Bed Brief, daycare, the eating window (fast until dinner), gym at 9, the shake,
// the Miracle Night wind-down and lights out. Kept in doc kind 'prefs', key 'routine'; editable in Settings.
//
// The planner's "day" rolls over at 4 am, not midnight: lights out at 1 am still belongs to the day
// that's ending (see dayKey in docs.ts).
import { getDoc, putDoc } from './docs';
import { profileOf, type Profile } from './app';

export interface Routine {
  profile: Profile;    // 'night' (Vijay: fast, gym at 9, Miracle Night, bed at 1) | 'morning' (Rosh: Miracle Morning, bed at 9)
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
  saunaMin: number;    // night profile: sauna after the gym, before the day review (0 = none)
  review: string;      // night profile: the day review (its own time, separate from the shake)
  unwindCap: number;   // morning profile: minutes of games/unwind before the review (0 = no cap)
  windDown: string;    // night profile: hard stop for the unwind — teeth, face, phone on charge, bed
  lightsOut: string;   // in bed, lights off
}

export const NIGHT_ROUTINE: Routine = {
  profile: 'night', stretchMin: 0, meditateMin: 0, workoutMin: 0, kiaanUp: '08:30', fast: true,
  wake: '08:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '23:00', gym: '21:00', shake: '23:00', saunaMin: 10, review: '22:30', unwindCap: 60, windDown: '00:45', lightsOut: '01:00',
};
export const MORNING_ROUTINE: Routine = {
  profile: 'morning', stretchMin: 10, meditateMin: 10, workoutMin: 20, kiaanUp: '08:00', fast: false,
  wake: '05:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '20:00', gym: '06:00', shake: '20:00', saunaMin: 0, review: '20:30', unwindCap: 30, windDown: '20:45', lightsOut: '21:00',
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

export type BlockId = 'wake' | 'brief' | 'daycare' | 'work' | 'dinner' | 'gym' | 'sauna' | 'night' | 'shake' | 'unwind' | 'windDown' | 'lightsOut'
  | 'morning' | 'kiaanUp' | 'evening';
/** Night profile: gym → sauna → day review (r.review, its own time) → shake → unwind. */
export const reviewAt = (r: Routine) => r.review;
export const saunaAt = (r: Routine) => hhmm(minutesOf(r.review) - r.saunaMin);
export interface Block { id: BlockId; label: string; at: string; until?: string; blurb: string }

/** The day as an ordered list of blocks. */
export function blocks(r: Routine): Block[] {
  if (r.profile === 'morning') return morningBlocks(r);
  const briefEnd = hhmm(minutesOf(r.wake) + r.briefMinutes);
  return [
    { id: 'wake', label: 'Up with Kiaan', at: r.wake, blurb: `by ${clock(hhmm(minutesOf(r.wake) + r.wakeGrace))} counts` },
    { id: 'brief', label: 'Bed Brief', at: r.wake, until: briefEnd, blurb: `${r.briefMinutes} minutes, from bed` },
    { id: 'work', label: 'Tackle the list', at: briefEnd, until: r.eatOpen, blurb: 'the to-do list from the Bed Brief · fasting: water, black coffee, tea' },
    { id: 'dinner', label: 'Dinner — first meal', at: r.eatOpen, until: r.gym, blurb: 'fast ends · protein first' },
    { id: 'gym', label: 'Gym with the boys', at: r.gym, until: r.saunaMin ? saunaAt(r) : reviewAt(r), blurb: 'log the session · Complete workout' },
    ...(r.saunaMin ? [{ id: 'sauna' as BlockId, label: 'Sauna', at: saunaAt(r), until: reviewAt(r), blurb: `${r.saunaMin} min · think the day over` }] : []),
    { id: 'night', label: 'Day review', at: reviewAt(r), blurb: '3 lines · scorecard · tomorrow\'s #1' },
    { id: 'shake', label: 'Protein shake', at: r.shake, blurb: 'closes the eating window' },
    { id: 'unwind', label: 'Unwind', at: r.shake, until: r.windDown, blurb: `games, show, whatever — hard stop ${clock(r.windDown)}` },
    { id: 'windDown', label: 'Teeth & bed', at: r.windDown, until: r.lightsOut, blurb: 'teeth, face, phone on charge' },
    { id: 'lightsOut', label: 'Lights out', at: r.lightsOut, blurb: 'phone down' },
  ];
}

/** Rosh's day: Miracle Morning before Kiaan is up, bed with him at 9. */
function morningBlocks(r: Routine): Block[] {
  const routineMins = r.stretchMin + r.meditateMin + r.workoutMin;
  const routineEnd = hhmm(minutesOf(r.wake) + routineMins);
  const briefEnd = hhmm(minutesOf(routineEnd) + r.briefMinutes);
  return [
    { id: 'wake', label: 'Up', at: r.wake, blurb: `by ${clock(hhmm(minutesOf(r.wake) + r.wakeGrace))} counts` },
    { id: 'morning', label: 'Miracle Morning', at: r.wake, until: routineEnd, blurb: `stretch ${r.stretchMin} · meditate ${r.meditateMin} · move ${r.workoutMin}` },
    { id: 'brief', label: 'Morning Brief', at: routineEnd, until: briefEnd, blurb: `${r.briefMinutes} minutes, before the house wakes` },
    { id: 'kiaanUp', label: 'Kiaan up', at: r.kiaanUp, blurb: 'breakfast, ready for the day' },
    { id: 'work', label: 'Tackle the list', at: r.kiaanUp, until: r.eatOpen, blurb: 'the to-do list from the Morning Brief' },
    { id: 'dinner', label: 'Dinner', at: r.eatOpen, blurb: 'log it' },
    { id: 'evening', label: 'Evening review', at: hhmm(minutesOf(r.lightsOut) - 30), until: r.lightsOut, blurb: '3 lines · scorecard · tomorrow\'s #1' },
    { id: 'lightsOut', label: 'Bed with Kiaan', at: r.lightsOut, blurb: 'lights out' },
  ];
}

/** Which block the clock is in right now. */
export function currentBlock(r: Routine, d = new Date()): BlockId {
  const now = routineMinutes(d);
  const list = blocks(r);
  let cur: BlockId = 'lightsOut';
  for (const b of list) if (routineMin(b.at) <= now) cur = b.id;
  if (now < routineMin(r.wake)) cur = 'lightsOut';   // still night
  return cur;
}

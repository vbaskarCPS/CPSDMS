// src/planner/lib/routine.ts — the shape of Vijay's day. Every feature reads its times from here:
// wake with Kiaan, the Bed Brief, daycare, the eating window (fast until dinner), gym at 9, the shake,
// the Miracle Night wind-down and lights out. Kept in doc kind 'prefs', key 'routine'; editable in Settings.
//
// The planner's "day" rolls over at 4 am, not midnight: lights out at 1 am still belongs to the day
// that's ending (see dayKey in docs.ts).
import { getDoc, putDoc } from './docs';

export interface Routine {
  wake: string;        // 'HH:MM' target, with Kiaan
  wakeGrace: number;   // minutes after `wake` that still count as on time
  briefMinutes: number;// the Bed Brief must fit in this
  daycare: string;     // drop-off
  eatOpen: string;     // the fast ends: first meal
  eatClose: string;    // last food (the shake)
  gym: string;         // session start
  shake: string;       // post-gym protein shake
  unwindCap: number;   // minutes of games/unwind before the review (0 = no cap)
  lightsOut: string;   // in bed, lights off
}

export const DEFAULT_ROUTINE: Routine = {
  wake: '08:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '23:00', gym: '21:00', shake: '23:00', unwindCap: 60, lightsOut: '01:00',
};

let cached: Routine | null = null;
const listeners = new Set<(r: Routine) => void>();

export async function loadRoutine(): Promise<Routine> {
  if (cached) return cached;
  const d = await getDoc<Partial<Routine>>('prefs', 'routine').catch(() => null);
  cached = { ...DEFAULT_ROUTINE, ...(d || {}) };
  return cached;
}
export function routineNow(): Routine { return cached || DEFAULT_ROUTINE; }
export async function saveRoutine(r: Routine): Promise<void> {
  cached = { ...DEFAULT_ROUTINE, ...r };
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

export type BlockId = 'wake' | 'brief' | 'daycare' | 'work' | 'dinner' | 'gym' | 'shake' | 'night' | 'lightsOut';
export interface Block { id: BlockId; label: string; at: string; until?: string; blurb: string }

/** The day as an ordered list of blocks. */
export function blocks(r: Routine): Block[] {
  const briefEnd = hhmm(minutesOf(r.wake) + r.briefMinutes);
  return [
    { id: 'wake', label: 'Up with Kiaan', at: r.wake, blurb: `by ${clock(hhmm(minutesOf(r.wake) + r.wakeGrace))} counts` },
    { id: 'brief', label: 'Bed Brief', at: r.wake, until: briefEnd, blurb: `${r.briefMinutes} minutes, from bed` },
    { id: 'daycare', label: 'Kiaan → daycare', at: r.daycare, blurb: 'ready, fed, out the door' },
    { id: 'work', label: 'Work & handle things', at: r.daycare, until: r.eatOpen, blurb: 'fasting · water, black coffee, tea' },
    { id: 'dinner', label: 'Dinner — first meal', at: r.eatOpen, until: r.gym, blurb: 'fast ends · protein first' },
    { id: 'gym', label: 'Gym with the boys', at: r.gym, until: r.shake, blurb: 'log the session' },
    { id: 'shake', label: 'Protein shake', at: r.shake, blurb: 'closes the eating window' },
    { id: 'night', label: 'Miracle Night', at: r.shake, until: r.lightsOut, blurb: r.unwindCap ? `unwind ${r.unwindCap} min · review · tomorrow's #1` : 'unwind · review · tomorrow\'s #1' },
    { id: 'lightsOut', label: 'Lights out', at: r.lightsOut, blurb: 'phone down' },
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

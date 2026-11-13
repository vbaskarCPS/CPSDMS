// src/planner/features/habits/types.ts — the habit documents (kinds 'habit' and 'habitlog').
export type HabitMark = 'done' | 'mini' | 'skip';

export interface Habit {
  id: string;
  name: string;
  identity: string;      // "I'm the kind of person who…"
  cue: { time: string; place: string };
  stack: string;         // "After I …"
  twoMinute: string;     // the version that takes under 2 minutes
  why: string;
  days: number[];        // 0–6 (Sunday = 0); which weekdays it's due
  color?: string;
  createdAt: string;
  archived?: boolean;
  order: number;
  anchor?: { block: string; when: 'before' | 'after' };   // stacked on a slot of the routine (lib/routine blocks)
  auto?: AutoTrigger;   // ticks itself when this happens (auto.ts)
  // rules for a habit that ticks itself (rules.ts); left out = it counts whenever it happens
  by?: string;           // 'HH:MM': only if it happened by this time that planner day
  withinUpMin?: number;  // only if it happened within this many minutes of I'm up
}

/** What can tick a habit by itself (auto.ts says what each one is). */
export type AutoTrigger = 'wake' | 'brief' | 'daycare' | 'fast' | 'dinner' | 'gymStart' | 'gym' | 'sauna' | 'review' | 'shake' | 'lightsOut' | 'protein';

/** key = YYYY-MM-DD → { [habitId]: mark } */
export type HabitLog = Record<string, HabitMark>;

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function emptyHabit(order = 0): Habit {
  return { id: '', name: '', identity: '', cue: { time: '', place: '' }, stack: '', twoMinute: '', why: '', days: [...ALL_DAYS], createdAt: new Date().toISOString(), order };
}

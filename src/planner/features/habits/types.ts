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
}

/** key = YYYY-MM-DD → { [habitId]: mark } */
export type HabitLog = Record<string, HabitMark>;

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function emptyHabit(order = 0): Habit {
  return { id: '', name: '', identity: '', cue: { time: '', place: '' }, stack: '', twoMinute: '', why: '', days: [...ALL_DAYS], createdAt: new Date().toISOString(), order };
}

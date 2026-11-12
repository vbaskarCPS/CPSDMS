// src/planner/features/habits/auto.ts — habits that tick themselves. A habit with `auto` set is marked
// done for the day when the matching thing happens elsewhere in the app (a tick on Today, the Brief
// finishing, a workout completed, the review filled in); un-ticking clears it again. A real 'done' replaces a
// 'mini' or 'skip' (the home challenge, then the gym after all); un-ticking only clears what it set.
import { dayKey, getDoc, getDocs, putDoc } from '../../lib/docs';
import type { Habit, HabitLog } from './types';
import { habitTicked } from './ticked';
import { momentOf, msOf } from '../widgets/race';

export type AutoTrigger = 'wake' | 'brief' | 'daycare' | 'fast' | 'dinner' | 'gymStart' | 'gym' | 'sauna' | 'review' | 'shake' | 'lightsOut';
export const AUTO_LABELS: Record<AutoTrigger, string> = {
  wake: 'I tick "I\'m up"', brief: 'the Bed/Morning Brief is finished', daycare: '(retired) daycare was ticked', fast: 'dinner is ticked with no food before the window',
  dinner: 'dinner is ticked', gymStart: 'Start workout is pressed within 30 min of I\'m up', gym: 'a workout is completed', sauna: 'the sauna is ticked', review: 'the day review is filled in (3 lines)', shake: 'the shake is ticked', lightsOut: 'lights out / in bed is ticked',
};

/** Start workout counts for the habit only this soon after I'm up (Vijay, 12 Nov: "I didn't get into the gym within
 *  30 mins so it isn't a successful habit"). */
export const GYM_START_WITHIN_MIN = 30;
/** Did this session start within GYM_START_WITHIN_MIN of Up? No Up tick that day: no (it can be ticked by hand). */
export function startedInTime(ticks: { up?: string; upAt?: string } | undefined, day: string, startedAt: string): boolean {
  const start = msOf(startedAt);
  let up = msOf(ticks?.upAt);
  if (up === null || dayKey(new Date(up)) !== day) up = momentOf(day, ticks?.up);
  if (start === null || up === null) return false;
  return start >= up && start - up <= GYM_START_WITHIN_MIN * 60_000;
}
/** Start workout was pressed: tick the habits set to that, if it was in time. A session done at home doesn't count. */
export async function markGymStart(w: { date: string; startedAt: string; kind?: string }): Promise<void> {
  try {
    if (w.kind === 'home') return;
    const d = await getDoc<{ ticks?: { up?: string; upAt?: string } }>('day', w.date);
    if (startedInTime(d?.ticks, w.date, w.startedAt)) await autoMark('gymStart', true, w.date);
  } catch { /* the habit can still be ticked by hand */ }
}

/** Mark (on) or clear (off) today's log for every habit with this trigger. Quiet on failure.
 *  `mark` 'mini' = the small version (the home challenge after a missed gym day); 'skip' = a planned rest day, which
 *  doesn't count for or against the streak. Either is only written over an empty day or a 'skip', never over a 'done'. */
export async function autoMark(trigger: AutoTrigger, on = true, key = dayKey(), mark: 'done' | 'mini' | 'skip' = 'done'): Promise<void> {
  try {
    const habits = (await getDocs<Habit>('habit')).map(d => d.data).filter(h => h && !h.archived && h.auto === trigger);
    if (!habits.length) return;
    const log: HabitLog = (await getDoc<HabitLog>('habitlog', key)) || {};
    let changed = false;
    for (const h of habits) {
      const cur = log[h.id];
      if (on && mark === 'done' && cur !== 'done') { log[h.id] = 'done'; changed = true; }
      if (on && mark !== 'done' && (!cur || cur === 'skip') && cur !== mark) { log[h.id] = mark; changed = true; }
      if (!on && cur === mark) { delete log[h.id]; changed = true; }
    }
    if (changed) { await putDoc('habitlog', key, log); habitTicked(); }
  } catch { /* the habit can still be ticked by hand */ }
}

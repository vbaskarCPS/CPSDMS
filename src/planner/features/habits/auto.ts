// src/planner/features/habits/auto.ts — habits that tick themselves. A habit with `auto` set is marked
// done for the day when the matching thing happens elsewhere in the app (a tick on Today, the Brief
// finishing, a workout completed, the review filled in, the protein goal reached); un-ticking clears it again. A real
// 'done' replaces a 'mini' or 'skip' (the home challenge, then the gym after all); un-ticking only clears what it set.
// A habit can carry rules ("by 5:05", "within 30 minutes of I'm up", rules.ts): the caller says when the thing
// happened, and a habit only ticks if that moment passes its rules. Un-ticking ignores the rules.
// Which trigger ticked which habit is kept per day in the doc 'habitauto' / day ({ [habitId]: trigger }), so a trigger
// that can take its tick back (protein: a meal removed) never clears a tick made by hand.
import { dayKey, getDoc, getDocs, putDocs } from '../../lib/docs';
import type { AutoTrigger, Habit, HabitLog } from './types';
import { habitTicked } from './ticked';
import { msOf, upMoment } from '../widgets/race';
import { countsFor, hasRules, rulesOf, TRIGGER_RULES } from './rules';

export type { AutoTrigger };
export const AUTO_LABELS: Record<AutoTrigger, string> = {
  wake: 'I tick "I\'m up"', brief: 'the Bed/Morning Brief is finished', daycare: '(retired) daycare was ticked', fast: 'dinner is ticked with no food before the window',
  dinner: 'dinner is ticked', gymStart: 'Start workout is pressed', gym: 'a workout is completed', sauna: 'the sauna is ticked', review: 'the day review is filled in (3 lines)', shake: 'the shake is ticked', lightsOut: 'lights out / in bed is ticked',
  protein: 'the day\'s protein goal is logged',
};

/** Start workout counts for the habit only this soon after I'm up, unless the habit sets its own minutes (rules.ts). */
export const GYM_START_WITHIN_MIN = TRIGGER_RULES.gymStart!.withinUpMin!;
/** Did this session start within GYM_START_WITHIN_MIN of Up? No Up tick that day: no (it can be ticked by hand).
 *  The same check every habit rule goes through (rules.ts), kept under its old name. */
export function startedInTime(ticks: { up?: string; upAt?: string } | undefined, day: string, startedAt: string): boolean {
  return countsFor({ withinUpMin: GYM_START_WITHIN_MIN }, day, msOf(startedAt), upMoment({ key: day, ticks })?.at ?? null);
}
/** Start workout was pressed: tick the habits set to that, if it was in time for each one's rules. A session done at
 *  home doesn't count. */
export async function markGymStart(w: { date: string; startedAt: string; kind?: string }): Promise<void> {
  try {
    if (w.kind === 'home') return;
    await autoMark('gymStart', true, w.date, 'done', { at: msOf(w.startedAt) });
  } catch { /* the habit can still be ticked by hand */ }
}
/** I'm up was ticked for the first time today (Today, the Miracle Morning, the Brief), at `at`. */
export function markWake(at: number, day = dayKey(new Date(at))): Promise<void> {
  return autoMark('wake', true, day, 'done', { at, up: at });
}

/** When the thing happened, for the habits' rules. `at` = its moment (ms); `up` = when I'm up was ticked that day, if
 *  the caller knows (else it is read from the day when a rule needs it); `onlyIfMine` = when clearing, only clear a
 *  tick this trigger made. */
export interface AutoWhen { at?: number | null; up?: number | null; onlyIfMine?: boolean }
export type AutoLog = Record<string, AutoTrigger>;

/** Mark (on) or clear (off) today's log for every habit with this trigger. Quiet on failure.
 *  `mark` 'mini' = the small version (the home challenge after a missed gym day); 'skip' = a planned rest day, which
 *  doesn't count for or against the streak. Either is only written over an empty day or a 'skip', never over a 'done'. */
export async function autoMark(trigger: AutoTrigger, on = true, key = dayKey(), mark: 'done' | 'mini' | 'skip' = 'done', when: AutoWhen = {}): Promise<void> {
  try {
    let habits = (await getDocs<Habit>('habit')).map(d => ({ ...d.data, id: d.data?.id || d.key })).filter(h => h && !h.archived && h.auto === trigger);
    if (!habits.length) return;
    // the rules: only for something done (a rest day isn't held to a time), and only when it's being ticked
    if (on && mark !== 'skip') {
      let up = when.up;
      if (up === undefined && habits.some(h => rulesOf(h).withinUpMin)) {
        const d = await getDoc<{ ticks?: { up?: string; upAt?: string } }>('day', key).catch(() => null);
        up = upMoment({ key, ticks: d?.ticks })?.at ?? null;
      }
      habits = habits.filter(h => { const r = rulesOf(h); return !hasRules(r) || countsFor(r, key, when.at, up); });
      if (!habits.length) return;
    }
    const [log, mine]: [HabitLog, AutoLog] = await Promise.all([
      getDoc<HabitLog>('habitlog', key).then(l => l || {}),
      getDoc<AutoLog>('habitauto', key).then(l => l || {}).catch(() => ({} as AutoLog)),
    ]);
    let changed = false, mineChanged = false;
    for (const h of habits) {
      const cur = log[h.id];
      let set = false, cleared = false;
      if (on && mark === 'done' && cur !== 'done') { log[h.id] = 'done'; set = true; }
      if (on && mark !== 'done' && (!cur || cur === 'skip') && cur !== mark) { log[h.id] = mark; set = true; }
      if (!on && cur === mark && (!when.onlyIfMine || mine[h.id] === trigger)) { delete log[h.id]; cleared = true; }
      // remember who made the tick, so a tick made by hand is never this trigger's to take back
      if (set && mine[h.id] !== trigger) { mine[h.id] = trigger; mineChanged = true; }
      if (cleared && mine[h.id]) { delete mine[h.id]; mineChanged = true; }
      changed = changed || set || cleared;
    }
    if (changed || mineChanged) {
      await putDocs([...(changed ? [{ kind: 'habitlog', key, data: log }] : []), ...(mineChanged ? [{ kind: 'habitauto', key, data: Object.keys(mine).length ? mine : null }] : [])]);
      if (changed) habitTicked();
    }
  } catch { /* the habit can still be ticked by hand */ }
}

/** A habit marked by hand: whatever trigger ticked it that day no longer owns the tick. Quiet; one read when nothing
 *  is recorded. */
export async function handMarked(habitId: string, key: string): Promise<void> {
  try {
    const mine = await getDoc<AutoLog>('habitauto', key);
    if (!mine || !mine[habitId]) return;
    delete mine[habitId];
    await putDocs([{ kind: 'habitauto', key, data: Object.keys(mine).length ? mine : null }]);
  } catch { /* at worst a meal removed later clears the tick */ }
}

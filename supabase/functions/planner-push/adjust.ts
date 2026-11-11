// supabase/functions/planner-push/adjust.ts — one day's changes to the routine ("sick today: no gym, no sauna, up at 7").
// No Deno and no network here: the app imports this file too (src/planner/lib/routine.ts), so the Today screen and the
// reminders work a changed day out the same way. Tested from src/planner/lib/routine.test.ts.
//
// The changes are kept on the day itself (doc kind 'day', field `adjust`). Arvy sets them from the conversation
// (adjust_day, src/planner/features/arvy/act.ts); "Back to normal" on the Today screen clears them.

/** The parts of the routine a day's changes touch (the app's Routine has more). */
export interface RoutineTimes {
  profile: 'night' | 'morning';
  wake: string; gym: string; review: string; saunaMin: number; lightsOut: string; windDown: string;
  kitchenClose: string; eatOpen: string; kiaanUp: string;
  stretchMin: number; meditateMin: number; workoutMin: number;
}
/** A block added for one day: a stretch session at 7, breakfast at 7:30, a nap. `done` = when it was ticked ('HH:MM'). */
export interface AddedBlock { id: string; at: string; until?: string; label: string; note?: string; done?: string }
export type AdjustTime = 'wake' | 'gym' | 'review' | 'lightsOut' | 'kitchenClose' | 'eatOpen' | 'kiaanUp';
export const ADJUST_TIMES: AdjustTime[] = ['wake', 'gym', 'review', 'lightsOut', 'kitchenClose', 'eatOpen', 'kiaanUp'];
export interface DayAdjust {
  why?: string;                                 // a few words, shown on Today: "Sick day"
  skip?: string[];                              // blocks left out that day (see SKIPPABLE)
  times?: Partial<Record<AdjustTime, string>>;  // times moved that day, 'HH:MM' (kitchenClose '' = no cut-off that day)
  saunaMin?: number;                            // a shorter or longer sauna that day
  added?: AddedBlock[];
  at?: string;                                  // when it was last changed (ISO)
}
/** Blocks that can be left out of a day. Up, the list and lights out always stay. */
export const SKIPPABLE: Record<'night' | 'morning', string[]> = {
  night: ['gym', 'sauna', 'brief', 'kitchen', 'dinner'],
  morning: ['morning', 'brief', 'kiaanUp', 'dinner', 'evening'],
};
const ANY_SKIP = new Set([...SKIPPABLE.night, ...SKIPPABLE.morning]);

export const isHM = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const mins = (t: string): number => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hm = (n: number): string => { const m = ((Math.round(n) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const text = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** A day's changes as stored, checked: unknown blocks and bad times are dropped. undefined = nothing changed. */
export function cleanAdjust(raw: unknown): DayAdjust | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const skip = [...new Set((Array.isArray(a.skip) ? a.skip : []).filter((s): s is string => typeof s === 'string' && ANY_SKIP.has(s)))];
  const times: Partial<Record<AdjustTime, string>> = {};
  const t = (a.times && typeof a.times === 'object' ? a.times : {}) as Record<string, unknown>;
  for (const k of ADJUST_TIMES) if (isHM(t[k]) || (k === 'kitchenClose' && t[k] === '')) times[k] = t[k] as string;
  const saunaMin = typeof a.saunaMin === 'number' && Number.isFinite(a.saunaMin) ? Math.max(0, Math.min(90, Math.round(a.saunaMin))) : undefined;
  const added: AddedBlock[] = [];
  for (const x of (Array.isArray(a.added) ? a.added : []) as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object' || !isHM(x.at) || !text(x.label, 60) || typeof x.id !== 'string' || !x.id) continue;
    added.push({ id: x.id.slice(0, 24), at: x.at, label: text(x.label, 60), ...(isHM(x.until) ? { until: x.until } : {}), ...(text(x.note, 140) ? { note: text(x.note, 140) } : {}), ...(isHM(x.done) ? { done: x.done } : {}) });
    if (added.length >= 12) break;
  }
  if (!skip.length && !Object.keys(times).length && saunaMin === undefined && !added.length) return undefined;
  return {
    ...(text(a.why, 60) ? { why: text(a.why, 60) } : {}),
    ...(skip.length ? { skip } : {}),
    ...(Object.keys(times).length ? { times } : {}),
    ...(saunaMin !== undefined ? { saunaMin } : {}),
    ...(added.length ? { added } : {}),
    ...(typeof a.at === 'string' ? { at: a.at.slice(0, 30) } : {}),
  };
}

/** How long the gym block usually runs: from the gym's start to the sauna (or to the list, without one). */
const gymLen = (r: RoutineTimes): number => Math.max(0, mins(r.review) - (r.saunaMin || 0) - mins(r.gym));
const saunaOf = (r: RoutineTimes, a: DayAdjust): number => (a.skip?.includes('sauna') ? 0 : a.saunaMin ?? (r.saunaMin || 0));
/** How much later than usual the gym has to be before it stops being part of the morning (minutes). */
const LATE_GYM = 120;

/** The gym moved out of the morning for a day ("gym at 5 tonight"): when it runs, and the sauna after it.
 *  null = it's in its usual place straight after getting up (or skipped): then routineFor carries it. */
export function lateGym(r: RoutineTimes, a?: DayAdjust | null): { at: string; until: string; saunaUntil?: string } | null {
  if (r.profile !== 'night' || !a || a.skip?.includes('gym')) return null;
  const g = a.times?.gym;
  if (!isHM(g)) return null;
  const shift = isHM(a.times?.wake) ? mins(a.times!.wake!) - mins(r.wake) : 0;
  if (mins(g) - (mins(r.gym) + shift) < LATE_GYM) return null;
  const end = mins(g) + (gymLen(r) || 75), sauna = saunaOf(r, a);
  return { at: g, until: hm(end), ...(sauna ? { saunaUntil: hm(end + sauna) } : {}) };
}

/** The routine as it runs on a changed day. The 5 am club's morning is a chain (up → gym → sauna → the list): moving
 *  the wake time moves the chain with it, and a skipped link closes the gap, so the list starts when the morning ends.
 *  A gym moved to later in the day (lateGym) leaves the chain; its sauna goes with it (saunaMin is then 0 here). */
export function routineFor<R extends RoutineTimes>(r: R, a?: DayAdjust | null): R {
  if (!a) return r;
  const t = a.times || {}, skip = new Set(a.skip || []);
  const out: R = { ...r };
  const shift = isHM(t.wake) ? mins(t.wake) - mins(r.wake) : 0;
  if (isHM(t.wake)) out.wake = t.wake;
  if (isHM(t.lightsOut)) { out.windDown = hm(mins(r.windDown) + mins(t.lightsOut) - mins(r.lightsOut)); out.lightsOut = t.lightsOut; }
  if (t.kitchenClose === '' || isHM(t.kitchenClose)) out.kitchenClose = t.kitchenClose;
  if (skip.has('kitchen')) out.kitchenClose = '';
  if (isHM(t.eatOpen)) out.eatOpen = t.eatOpen;
  if (isHM(t.kiaanUp)) out.kiaanUp = t.kiaanUp;
  if (r.profile === 'morning') {
    if (skip.has('morning')) { out.stretchMin = 0; out.meditateMin = 0; out.workoutMin = 0; }
    return out;
  }
  const late = lateGym(r, a);
  const sauna = late ? 0 : saunaOf(r, a);
  const gymAt = late ? mins(late.at) : isHM(t.gym) ? mins(t.gym) : mins(r.gym) + shift;
  // where the morning carries on from: the end of the gym, or the time it would have started when there's none
  const from = late || skip.has('gym') ? mins(r.gym) + shift : gymAt + gymLen(r);
  out.gym = hm(gymAt);
  out.saunaMin = sauna;
  out.review = isHM(t.review) ? t.review : hm(from + sauna);
  return out;
}

/** Add one set of changes to what a day already has (what Arvy sends is "only what changes"). */
export function mergeAdjust(base: DayAdjust | undefined, change: { why?: string; skip?: string[]; unskip?: string[]; times?: Partial<Record<AdjustTime, string | null>>; saunaMin?: number | null; add?: AddedBlock[]; remove?: string[] }, now = new Date()): DayAdjust | undefined {
  const b = base || {};
  const skip = new Set([...(b.skip || []), ...(change.skip || [])]);
  for (const s of change.unskip || []) skip.delete(s);
  const times: Partial<Record<AdjustTime, string>> = { ...(b.times || {}) };
  for (const k of ADJUST_TIMES) { const v = change.times?.[k]; if (v === null) delete times[k]; else if (v !== undefined) times[k] = v; }
  const gone = new Set(change.remove || []);
  const added = [...(b.added || []).filter(x => !gone.has(x.id)), ...(change.add || [])];
  const saunaMin = change.saunaMin === null ? undefined : change.saunaMin ?? b.saunaMin;
  return cleanAdjust({ why: change.why ?? b.why, skip: [...skip], times, saunaMin, added, at: now.toISOString() });
}

// supabase/functions/planner-push/reminders.ts — which routine reminders are due, and when. No Deno and no network
// here, so the rules are tested from the app's tests (src/planner/lib/reminders.test.ts).
// A day whose plan was changed (adjust.ts: sick, so no gym, no sauna, up at 7, a stretch at 7) gets that day's
// reminders: nothing for a skipped block, moved times, and one for each block added to the day.
import { cleanAdjust, lateGym, routineFor, type DayAdjust } from './adjust.ts';

export const TZ = 'America/Toronto';
export const DAY_START_HOUR = 4;   // the planner's day rolls over at 4 am (src/planner/lib/docs.ts)

// Same defaults as src/planner/lib/routine.ts (night: Vijay, morning: Rosh); the app comes from settings.app
export type Profile = 'night' | 'morning';
export type AppId = 'vijayplanner' | 'roshplanner';
export interface Routine { profile: Profile; wake: string; wakeGrace: number; briefMinutes: number; daycare: string; eatOpen: string; eatClose: string; gym: string; shake: string; saunaMin: number; review: string; windDown: string; unwindCap: number; lightsOut: string; stretchMin: number; meditateMin: number; workoutMin: number; kiaanUp: string; fast: boolean; kitchenClose: string }
// night profile = Vijay's 5 am club: up at 5, gym, the sauna (yesterday's review + today's Brief), lights out 9:30
export const NIGHT_ROUTINE: Routine = {
  profile: 'night', stretchMin: 0, meditateMin: 0, workoutMin: 0, kiaanUp: '07:30', fast: true,
  wake: '05:00', wakeGrace: 15, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '20:30', gym: '05:15', shake: '20:30', saunaMin: 25, review: '06:45', windDown: '21:30', unwindCap: 0, lightsOut: '21:30', kitchenClose: '14:00',
};
export const MORNING_ROUTINE: Routine = {
  profile: 'morning', stretchMin: 10, meditateMin: 10, workoutMin: 20, kiaanUp: '08:00', fast: false,
  wake: '05:30', wakeGrace: 30, briefMinutes: 10, daycare: '09:30',
  eatOpen: '18:00', eatClose: '20:00', gym: '06:00', shake: '20:00', saunaMin: 0, review: '20:30', windDown: '20:45', unwindCap: 30, lightsOut: '21:00', kitchenClose: '',
};

// ───────────── time, Toronto ─────────────
/** Local wall-clock parts in the planner's time zone. */
export function local(now: Date): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') };
}
/** The planner day key (YYYY-MM-DD, rolls over at 4 am) for an instant. */
export function plannerDayKey(now: Date): string {
  const t = local(new Date(now.getTime() - DAY_START_HOUR * 3600_000));
  return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
}
export const minutesOf = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Minutes since 4 am, so 01:00 sorts after 23:00 — same scale as src/planner/lib/routine.ts. */
export const routineMin = (mins: number): number => ((mins - DAY_START_HOUR * 60) + 1440) % 1440;
export function clock(hhmm: string): string {
  const m = minutesOf(hhmm), h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export interface Reminder { id: string; at: number; body: string; url: string; done: (day: DayDoc) => boolean }
export interface DayDoc { brief?: { finishedAt?: string }; ticks?: Record<string, string | undefined>; night?: { review?: Record<string, string> }; adjust?: unknown }

/** The day's reminders. `a` = that day's changes to the routine; `r` is the standing routine. */
export function reminders(r: Routine, app: AppId, a?: DayAdjust | null): Reminder[] {
  const u = (path: string) => `/${app}${path}`;
  const e = routineFor(r, a);              // the routine as it runs that day
  const skip = new Set(a?.skip || []);
  // a block added for the day: a nudge at its time, until it's ticked
  const added: Reminder[] = (a?.added || []).map(x => ({
    id: `x:${x.id}`, at: routineMin(minutesOf(x.at)), body: `${clock(x.at)} · ${x.label}${x.note ? ` — ${x.note}` : ''}`, url: u('/'),
    done: d => !!cleanAdjust(d.adjust)?.added?.find(y => y.id === x.id)?.done,
  }));
  if (r.profile === 'morning') return [
    { id: 'wake', at: routineMin(minutesOf(e.wake)), body: skip.has('morning') ? 'Morning. An easy start today, then the Brief.' : 'Morning. Stretch, breathe, move — then the Brief.', url: u(skip.has('morning') ? '/' : '/plan/morning'), done: d => !!d.ticks?.up },
    ...(skip.has('evening') ? [] : [{ id: 'evening', at: routineMin(minutesOf(e.lightsOut) - 30), body: 'Evening review, then bed with Kiaan.', url: u('/plan/night'), done: (d: DayDoc) => !!d.ticks?.lightsOut }]),
    { id: 'bed', at: routineMin(minutesOf(e.lightsOut) - 10), body: 'Lights out.', url: u('/plan/night'), done: d => !!d.ticks?.lightsOut },
    ...added,
  ];
  // the 5 am club: nothing at night but lights out
  const late = lateGym(r, a);               // the gym moved to later in the day
  const morningGym = !skip.has('gym') && !late;
  const planAt = minutesOf(e.review) - (e.saunaMin || 0);
  const up = clock(e.wake).replace(':00', '');
  return [
    { id: 'wake', at: routineMin(minutesOf(e.wake)), body: morningGym ? `${up}. Up — straight to the gym, no snooze.` : `${up}. Up.${a?.why ? ` ${a.why}: no` : ' No'} gym this morning${late ? ` — it's at ${clock(late.at)}` : ''}.`, url: u('/'), done: d => !!d.ticks?.up || !!d.ticks?.gym },
    ...(skip.has('brief') ? [] : [{ id: 'sauna', at: routineMin(planAt), body: `${e.saunaMin ? 'Sauna: look' : 'Look'} back at yesterday, plan the protein road, then today's Brief → the list.`, url: u('/plan/sauna'), done: (d: DayDoc) => !!d.brief?.finishedAt }]),
    ...(late ? [{ id: 'gym', at: routineMin(minutesOf(late.at) - 15), body: `Gym at ${clock(late.at)} today.`, url: u('/workout'), done: (d: DayDoc) => !!d.ticks?.gym }] : []),
    // the body gets the grams still to go when it's sent (see 'tick')
    ...(e.kitchenClose ? [{ id: 'kitchen', at: routineMin(minutesOf(e.kitchenClose) - 30), body: `Kitchen closes at ${clock(e.kitchenClose)} — 30 minutes.`, url: u('/food'), done: () => false }] : []),
    ...(e.fast && !skip.has('dinner') ? [{ id: 'window', at: routineMin(minutesOf(e.eatOpen) - 15), body: `Eating window opens at ${clock(e.eatOpen)}. Protein first.`, url: u('/food'), done: (d: DayDoc) => !!d.ticks?.dinner }] : []),
    { id: 'lightsOut', at: routineMin(minutesOf(e.lightsOut) - 15), body: `Lights out at ${clock(e.lightsOut)} — up at ${clock(r.wake)}.`, url: u('/'), done: d => !!d.ticks?.lightsOut },
    ...added,
  ];
}

/** Which reminders fire at `now`: within [t, t+10 min) and not yet logged or already done. The day's own changes
 *  (day.adjust) decide which reminders there are. Pure. */
export function dueReminders(r: Routine, now: Date, log: Record<string, string>, day: DayDoc, app: AppId = 'vijayplanner'): Reminder[] {
  const t = local(now);
  const nowMin = routineMin(t.h * 60 + t.min);
  return reminders(r, app, cleanAdjust(day.adjust)).filter(x => nowMin >= x.at && nowMin < x.at + 10 && !log[x.id] && !x.done(day));
}

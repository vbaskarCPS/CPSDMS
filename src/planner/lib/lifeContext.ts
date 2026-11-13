// src/planner/lib/lifeContext.ts — everything Arvy can see: the routine, the coach's memory notes,
// recent days (brief, priorities, ticks, review, scores), habits and their marks, meals, workouts with every
// set and note, body weight, and (morning profile) the cycle. Read straight from the docs so any feature's
// AI box can ask for it. Trimmed to stay well inside the function's context cap.
import { dayKey, getDocs } from './docs';
import { adjustWords, blocks, cleanAdjust, loadRoutine } from './routine';
import { memoryContext } from './memory';
import { eventsOn, type CalEvent } from '../features/calendar/types';
import { trainingState, type MealLite } from '../features/workout/trainingState';
import { LIBRARY } from '../features/workout/library';
import type { Exercise, Workout } from '../features/workout/types';

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
const daysAhead = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const calDate = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pick = <T extends object, K extends keyof T>(o: T, keys: K[]): Partial<T> => { const out: Partial<T> = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== '' && o[k] !== null) out[k] = o[k]; return out; };

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The formats a session used ("superset", "pyramid", "intervals"…), or ["straight sets"]: what Arvy rotates between. */
const formatsOf = (exercises: AnyDoc[]): string[] => {
  const f = new Set<string>();
  for (const e of exercises) { if (e.group) f.add(e.groupKind || 'superset'); if (e.style) f.add(e.style); }
  return f.size ? [...f] : ['straight sets'];
};

export interface LifeContext { today: string; weekday: string; units: string; [k: string]: unknown }

export async function lifeContext(units: string, opts: { workoutsDays?: number; fullSessions?: number; daysBack?: number } = {}): Promise<LifeContext> {
  const { workoutsDays = 28, fullSessions = 6, daysBack = 7 } = opts;
  const today = dayKey();
  const routine = await loadRoutine();
  const [memory, days, habits, habitLogs, meals, workouts, templates, events, weights, periods, cycleLogs, customEx, targets, sleepDays, longWorkouts] = await Promise.all([
    memoryContext(),
    getDocs<AnyDoc>('day', daysAgo(daysBack), today).catch(() => []),
    getDocs<AnyDoc>('habit').catch(() => []),
    getDocs<AnyDoc>('habitlog', daysAgo(14), today).catch(() => []),
    getDocs<AnyDoc>('meal', `${daysAgo(daysBack)}~`, `${today}~￿`).catch(() => []),
    getDocs<AnyDoc>('workout', daysAgo(workoutsDays), `${today}~￿`).catch(() => []),
    getDocs<AnyDoc>('template').catch(() => []),
    getDocs<AnyDoc>('event', `${daysAgo(366)}~`, `${daysAhead(14)}~\uffff`).catch(() => []),
    getDocs<AnyDoc>('bodyweight', daysAgo(90)).catch(() => []),
    routine.profile === 'morning' ? getDocs<AnyDoc>('period').catch(() => []) : Promise.resolve([]),
    routine.profile === 'morning' ? getDocs<AnyDoc>('cyclelog', daysAgo(45), today).catch(() => []) : Promise.resolve([]),
    getDocs<Exercise>('exercise').catch(() => []),
    getDocs<AnyDoc>('foodprefs', 'targets', 'targets').catch(() => []),
    getDocs<AnyDoc>('day', daysAgo(8), today).catch(() => []),
    getDocs<Workout>('workout', daysAgo(56), `${today}~￿`).catch(() => []),
  ]);

  const habitNames: Record<string, string> = {};
  const activeHabits = habits.map(d => d.data).filter(h => h && !h.archived);
  for (const h of activeHabits) habitNames[h.id] = h.name;

  const ws = workouts.map(d => d.data).filter(w => w && w.endedAt && !w.discarded).sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
  const fmtSet = (s: AnyDoc) => (s.seconds && !s.reps ? `${s.seconds}s` : `${s.weight}x${s.reps}${s.repsR !== undefined ? `/${s.repsR}` : ''}${s.rpe ? `@${s.rpe}` : ''}`);
  const sessions = ws.map((w, i) => i < fullSessions
    ? { date: w.date, name: w.name, minutes: w.endedAt ? Math.round((new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 60000) : undefined, notes: w.notes || undefined, prs: w.prs?.length ? w.prs : undefined,
        coach_review: w.review || undefined, next_prescription: w.next || undefined,
        formats: formatsOf(w.exercises || []),
        exercises: (w.exercises || []).map((e: AnyDoc) => ({ name: e.name, ...(e.group ? { block: `${e.groupKind || 'superset'} ${e.group}` } : {}), ...(e.style ? { style: e.style } : {}), ...(/assist|counter[- ]?weight/i.test(e.name || '') ? { weight_means: 'assistance (counterweight): less is harder, progress = less assist' } : {}), target: e.targetReps, rest: e.restSec, sets: (e.sets || []).filter((s: AnyDoc) => s.done).map(fmtSet), my_note: e.comment || undefined, plan_cue: e.note || undefined })) }
    : { date: w.date, name: w.name, exercises: (w.exercises || []).map((e: AnyDoc) => `${e.name}: ${(e.sets || []).filter((s: AnyDoc) => s.done).map(fmtSet).join(', ')}${e.comment ? ` ("${e.comment}")` : ''}`) });
  const inProgress = workouts.map(d => d.data).find(w => w && !w.endedAt && !w.discarded);

  // the coach's worked-out numbers: recovery, load per muscle, progress, pain notes (features/workout/trainingState.ts)
  let training_state: unknown;
  try {
    const t = targets[0]?.data as { protein?: number; kcal?: number } | undefined;
    const bw = weights.map(d => d.data?.weight).filter((x: unknown) => typeof x === 'number' && x > 0).pop();
    training_state = trainingState({
      today, units, workouts: longWorkouts.map(d => d.data).filter(Boolean), exercises: [...LIBRARY, ...customEx.map(d => d.data).filter(Boolean)],
      days: sleepDays.map(d => ({ date: d.key, ticks: d.data?.ticks })), meals: meals.map(d => d.data).filter(Boolean) as MealLite[],
      proteinTarget: t?.protein, kcalTarget: t?.kcal, bodyWeight: bw,
    });
  } catch { training_state = undefined; }

  const todayAdjust = cleanAdjust(days.find(d => d.key === today)?.data?.adjust);
  // steps and resting heart rate from the Galaxy Watch (watch/: Health.kt), one doc per calendar day
  const health = await getDocs<AnyDoc>('health', calDate(-14), calDate(0)).catch(() => []);
  return {
    today, weekday: new Date().toLocaleDateString([], { weekday: 'long' }), units,
    now: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    routine: { profile: routine.profile, fast: routine.fast, blocks: blocks(routine).map(b => `${b.label} ${b.at}${b.until ? `–${b.until}` : ''}`),
      // today's plan when it differs from the routine (a sick day, a rest day: set with Arvy)
      ...(todayAdjust ? { today_is_different: { why: todayAdjust.why, changes: adjustWords(todayAdjust), blocks: blocks(routine, todayAdjust).map(b => `${b.label} ${b.at}${b.until ? `–${b.until}` : ''}`) } } : {}) },
    about_me_notes_oldest_first: memory,
    days_recent: days.map(d => ({ date: d.key, ...pick(d.data || {}, ['brief', 'priorities', 'ticks', 'night', 'scores', 'reflection', 'morningRoutine', 'adjust']) })),
    habits: activeHabits.map(h => ({ name: h.name, identity: h.identity || undefined, stack: h.stack || undefined, anchor: h.anchor, auto: h.auto, days: h.days })),
    habit_marks_last_14_days: Object.fromEntries(habitLogs.map(l => [l.key, Object.fromEntries(Object.entries(l.data || {}).map(([id, m]) => [habitNames[id] || id, m]))])),
    meals_recent: meals.map(d => d.data).filter(Boolean).map((m: AnyDoc) => ({ date: m.date, time: m.time, name: m.name, kcal: m.totals?.kcal, protein: m.totals?.protein, note: m.note || undefined })),
    calendar_next_14_days: (() => { const evs = events.map(d => d.data as CalEvent).filter(e => e && e.title); const out: Record<string, string[]> = {}; for (let i = 0; i < 14; i++) { const date = calDate(i); const on = eventsOn(evs, date); if (on.length) out[date] = on.map(e => `${e.time ? e.time + ' ' : 'all day: '}${e.title} (${e.who})`); } return out; })(),
    workout_templates: templates.map(d => d.data).filter(t => t && !t.archived).map((t: AnyDoc) => ({ name: t.name, days: t.days, planned_for_date: t.plannedFor, focus: t.focus, minutes: t.minutes, formats: formatsOf(t.exercises || []), exercises: (t.exercises || []).map((e: AnyDoc) => `${e.group ? `[${e.groupKind || 'superset'} ${e.group}] ` : ''}${e.name} ${e.style && e.repsBySet ? `${e.style} ${e.repsBySet.join('-')}` : `${e.targetSets}x${e.targetReps || e.targetSec + 's'}`}${e.style === 'intervals' ? ` intervals, rest ${e.restSec}s` : ''}`) })),
    workout_in_progress: inProgress ? { name: inProgress.name, started: inProgress.startedAt, exercises: (inProgress.exercises || []).map((e: AnyDoc) => ({ name: e.name, sets: (e.sets || []).map((s: AnyDoc) => `${fmtSet(s)}${s.done ? '' : ' (not done)'}`), my_note: e.comment || undefined })) } : undefined,
    training_state,
    workouts_recent_full_then_condensed: sessions,
    watch_health_recent: health.length ? health.map(d => ({ date: d.key, steps: d.data?.steps, resting_hr: d.data?.restingHr })) : undefined,
    body_weight: weights.map(d => ({ date: d.key, weight: d.data?.weight })).filter(x => x.weight > 0).slice(-12),
    cycle: routine.profile === 'morning' ? { periods_recent: periods.map(d => d.data).slice(-6), logs_recent: cycleLogs.map(d => ({ date: d.key, ...(d.data || {}) })) } : undefined,
  };
}

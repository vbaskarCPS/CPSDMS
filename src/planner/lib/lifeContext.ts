// src/planner/lib/lifeContext.ts — everything Coach Claude can see: the routine, the coach's memory notes,
// recent days (brief, priorities, ticks, review, scores), habits and their marks, meals, workouts with every
// set and note, body weight, and (morning profile) the cycle. Read straight from the docs so any feature's
// AI box can ask for it. Trimmed to stay well inside the function's context cap.
import { dayKey, getDocs } from './docs';
import { loadRoutine, blocks } from './routine';
import { memoryContext } from './memory';

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
const pick = <T extends object, K extends keyof T>(o: T, keys: K[]): Partial<T> => { const out: Partial<T> = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== '' && o[k] !== null) out[k] = o[k]; return out; };

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LifeContext { today: string; weekday: string; units: string; [k: string]: unknown }

export async function lifeContext(units: string, opts: { workoutsDays?: number; fullSessions?: number; daysBack?: number } = {}): Promise<LifeContext> {
  const { workoutsDays = 28, fullSessions = 6, daysBack = 7 } = opts;
  const today = dayKey();
  const routine = await loadRoutine();
  const [memory, days, habits, habitLogs, meals, workouts, templates, weights, periods, cycleLogs] = await Promise.all([
    memoryContext(),
    getDocs<AnyDoc>('day', daysAgo(daysBack), today).catch(() => []),
    getDocs<AnyDoc>('habit').catch(() => []),
    getDocs<AnyDoc>('habitlog', daysAgo(14), today).catch(() => []),
    getDocs<AnyDoc>('meal', `${daysAgo(daysBack)}~`, `${today}~￿`).catch(() => []),
    getDocs<AnyDoc>('workout', daysAgo(workoutsDays), `${today}~￿`).catch(() => []),
    getDocs<AnyDoc>('template').catch(() => []),
    getDocs<AnyDoc>('bodyweight', daysAgo(90)).catch(() => []),
    routine.profile === 'morning' ? getDocs<AnyDoc>('period').catch(() => []) : Promise.resolve([]),
    routine.profile === 'morning' ? getDocs<AnyDoc>('cyclelog', daysAgo(45), today).catch(() => []) : Promise.resolve([]),
  ]);

  const habitNames: Record<string, string> = {};
  const activeHabits = habits.map(d => d.data).filter(h => h && !h.archived);
  for (const h of activeHabits) habitNames[h.id] = h.name;

  const ws = workouts.map(d => d.data).filter(w => w && w.endedAt && !w.discarded).sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
  const fmtSet = (s: AnyDoc) => (s.seconds && !s.reps ? `${s.seconds}s` : `${s.weight}x${s.reps}${s.repsR !== undefined ? `/${s.repsR}` : ''}${s.rpe ? `@${s.rpe}` : ''}`);
  const sessions = ws.map((w, i) => i < fullSessions
    ? { date: w.date, name: w.name, minutes: w.endedAt ? Math.round((new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 60000) : undefined, notes: w.notes || undefined, prs: w.prs?.length ? w.prs : undefined,
        coach_review: w.review || undefined, next_prescription: w.next || undefined,
        exercises: (w.exercises || []).map((e: AnyDoc) => ({ name: e.name, target: e.targetReps, rest: e.restSec, sets: (e.sets || []).filter((s: AnyDoc) => s.done).map(fmtSet), my_note: e.comment || undefined, plan_cue: e.note || undefined })) }
    : { date: w.date, name: w.name, exercises: (w.exercises || []).map((e: AnyDoc) => `${e.name}: ${(e.sets || []).filter((s: AnyDoc) => s.done).map(fmtSet).join(', ')}${e.comment ? ` ("${e.comment}")` : ''}`) });
  const inProgress = workouts.map(d => d.data).find(w => w && !w.endedAt && !w.discarded);

  return {
    today, weekday: new Date().toLocaleDateString([], { weekday: 'long' }), units,
    now: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    routine: { profile: routine.profile, fast: routine.fast, blocks: blocks(routine).map(b => `${b.label} ${b.at}${b.until ? `–${b.until}` : ''}`) },
    about_me_notes_oldest_first: memory,
    days_recent: days.map(d => ({ date: d.key, ...pick(d.data || {}, ['brief', 'priorities', 'ticks', 'night', 'scores', 'reflection', 'morningRoutine']) })),
    habits: activeHabits.map(h => ({ name: h.name, identity: h.identity || undefined, stack: h.stack || undefined, anchor: h.anchor, auto: h.auto, days: h.days })),
    habit_marks_last_14_days: Object.fromEntries(habitLogs.map(l => [l.key, Object.fromEntries(Object.entries(l.data || {}).map(([id, m]) => [habitNames[id] || id, m]))])),
    meals_recent: meals.map(d => d.data).filter(Boolean).map((m: AnyDoc) => ({ date: m.date, time: m.time, name: m.name, kcal: m.totals?.kcal, protein: m.totals?.protein, note: m.note || undefined })),
    workout_templates: templates.map(d => d.data).filter(t => t && !t.archived).map((t: AnyDoc) => ({ name: t.name, days: t.days, exercises: (t.exercises || []).map((e: AnyDoc) => `${e.name} ${e.targetSets}x${e.targetReps || e.targetSec + 's'}`) })),
    workout_in_progress: inProgress ? { name: inProgress.name, started: inProgress.startedAt, exercises: (inProgress.exercises || []).map((e: AnyDoc) => ({ name: e.name, sets: (e.sets || []).map((s: AnyDoc) => `${fmtSet(s)}${s.done ? '' : ' (not done)'}`), my_note: e.comment || undefined })) } : undefined,
    workouts_recent_full_then_condensed: sessions,
    body_weight: weights.map(d => ({ date: d.key, weight: d.data?.weight })).filter(x => x.weight > 0).slice(-12),
    cycle: routine.profile === 'morning' ? { periods_recent: periods.map(d => d.data).slice(-6), logs_recent: cycleLogs.map(d => ({ date: d.key, ...(d.data || {}) })) } : undefined,
  };
}

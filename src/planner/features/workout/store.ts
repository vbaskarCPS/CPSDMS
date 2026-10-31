// src/planner/features/workout/store.ts — reading and writing the workout docs, plus the derived bits.
import { dayKey, getDocs, putDoc, putDocs } from '../../lib/docs';
import { planFromText, type PlanResult } from '../../lib/ai';
import { uid } from '../../ui/primitives';
import { LIBRARY, findExercise, isLower, isTimed } from './library';
import { suggest, type Suggestion } from './progression';
import { e1rm, type BodyWeight, type Exercise, type NextRx, type SetLog, type Template, type TemplateExercise, type Units, type Workout, type WorkoutExercise, workoutKey } from './types';

const DEFAULT_TEMPLATES: Omit<Template, 'id' | 'order'>[] = [
  { name: 'Upper body', days: [1, 4], exercises: [
    { exerciseId: 'bench-press', name: 'Barbell Bench Press', targetSets: 3, targetReps: '6-8', restSec: 150 },
    { exerciseId: 'barbell-row', name: 'Barbell Row', targetSets: 3, targetReps: '6-8', restSec: 150 },
    { exerciseId: 'ohp', name: 'Overhead Press', targetSets: 3, targetReps: '8-10', restSec: 120 },
    { exerciseId: 'lat-pulldown', name: 'Lat Pulldown', targetSets: 3, targetReps: '10-12', restSec: 90 },
    { exerciseId: 'db-curl', name: 'Dumbbell Curl', targetSets: 2, targetReps: '10-12', restSec: 60 },
    { exerciseId: 'pushdown', name: 'Cable Pushdown', targetSets: 2, targetReps: '10-12', restSec: 60 },
  ] },
  { name: 'Lower body', days: [2, 5], exercises: [
    { exerciseId: 'squat', name: 'Barbell Back Squat', targetSets: 3, targetReps: '5-8', restSec: 180 },
    { exerciseId: 'rdl', name: 'Romanian Deadlift', targetSets: 3, targetReps: '8-10', restSec: 150 },
    { exerciseId: 'leg-press', name: 'Leg Press', targetSets: 3, targetReps: '10-12', restSec: 120 },
    { exerciseId: 'leg-curl', name: 'Lying Leg Curl', targetSets: 3, targetReps: '10-12', restSec: 90 },
    { exerciseId: 'standing-calf-raise', name: 'Standing Calf Raise', targetSets: 3, targetReps: '12-15', restSec: 60 },
    { exerciseId: 'plank', name: 'Plank', targetSets: 3, targetReps: '', restSec: 60, mode: 'time', targetSec: 45 },
  ] },
  { name: 'Full body', days: [6], exercises: [
    { exerciseId: 'goblet-squat', name: 'Goblet Squat', targetSets: 3, targetReps: '10-12', restSec: 90 },
    { exerciseId: 'db-bench', name: 'Dumbbell Bench Press', targetSets: 3, targetReps: '8-12', restSec: 90 },
    { exerciseId: 'db-row', name: 'One-arm Dumbbell Row', targetSets: 3, targetReps: '8-12', restSec: 90 },
    { exerciseId: 'db-shoulder-press', name: 'Dumbbell Shoulder Press', targetSets: 3, targetReps: '8-12', restSec: 90 },
    { exerciseId: 'kb-swing', name: 'Kettlebell Swing', targetSets: 3, targetReps: '15', restSec: 60 },
    { exerciseId: 'hanging-knee-raise', name: 'Hanging Knee Raise', targetSets: 3, targetReps: '10-15', restSec: 60 },
  ] },
];

export async function loadTemplates(): Promise<Template[]> {
  const docs = await getDocs<Template>('template');
  let list = docs.map(d => d.data).filter(t => t && t.id);
  if (!list.length) {
    list = DEFAULT_TEMPLATES.map((t, i) => ({ ...t, id: uid(), order: i }));
    await putDocs(list.map(t => ({ kind: 'template', key: t.id, data: t })));
  }
  return list.sort((a, b) => a.order - b.order);
}
export const saveTemplate = (t: Template) => putDoc('template', t.id, t);

export async function loadCustomExercises(): Promise<Exercise[]> {
  return (await getDocs<Exercise>('exercise')).map(d => ({ ...d.data, custom: true }));
}
export const saveCustomExercise = (e: Exercise) => putDoc('exercise', e.id, { ...e, custom: true });

/** Workouts between two days, newest first. */
export async function loadWorkouts(from?: string, to?: string): Promise<Workout[]> {
  const docs = await getDocs<Workout>('workout', from, to ? `${to}~~` : undefined);
  return docs.map(d => d.data).filter(w => w && w.id && !w.discarded).sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1));
}
export const saveWorkout = (w: Workout) => putDoc('workout', workoutKey(w), w);

export async function loadBodyWeights(from?: string): Promise<{ date: string; weight: number }[]> {
  return (await getDocs<BodyWeight>('bodyweight', from)).map(d => ({ date: d.key, weight: d.data.weight })).filter(x => x.weight > 0);
}
export const saveBodyWeight = (date: string, weight: number) => putDoc('bodyweight', date, { weight });

export const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };

/** The done sets of one exercise in each of the last N finished sessions (newest first). */
export function exerciseHistory(workouts: Workout[], exerciseId: string, n = 3): { date: string; sets: SetLog[]; comment?: string }[] {
  const out: { date: string; sets: SetLog[]; comment?: string }[] = [];
  for (const w of workouts) {
    if (!w.endedAt) continue;
    const ex = w.exercises.find(e => e.exerciseId === exerciseId);
    const sets = ex?.sets.filter(s => s.done && (s.reps > 0 || (s.seconds || 0) > 0)) || [];
    if (sets.length || ex?.comment) out.push({ date: w.date, sets, comment: ex?.comment });
    if (out.length >= n) break;
  }
  return out;
}

export function nextTarget(workouts: Workout[], t: { exerciseId: string; targetSets: number; targetReps: string }, units: Units, custom: Exercise[] = []): Suggestion {
  const ex = findExercise(t.exerciseId, custom) || LIBRARY[0];
  return suggest({ history: exerciseHistory(workouts, t.exerciseId), targetReps: t.targetReps, targetSets: t.targetSets, units, lower: isLower(ex), defaultStep: ex.defaultStep });
}

/** The coach's prescription for an exercise from the most recent completed session that has one (within 45 days). */
export function nextRx(workouts: Workout[], exerciseId: string): NextRx | undefined {
  const cutoff = daysAgo(45);
  for (const w of workouts) {
    if (!w.endedAt || w.date < cutoff) continue;
    const rx = w.next?.[exerciseId];
    if (rx) return rx;
    if (w.exercises.some(e => e.exerciseId === exerciseId)) return undefined;   // did it since, with no prescription → don't reach further back
  }
  return undefined;
}

/** Build a session from a template: the coach's prescription from last time when there is one, else the
 *  progression rule's suggestion; last time's numbers alongside. */
export function startFromTemplate(tpl: Template, workouts: Workout[], units: Units, custom: Exercise[] = []): Workout {
  const now = new Date();
  const exercises: WorkoutExercise[] = tpl.exercises.map(t => {
    const mode = t.mode || (isTimed(findExercise(t.exerciseId, custom)) ? 'time' : 'reps');
    const lastComment = exerciseHistory(workouts, t.exerciseId, 1)[0]?.comment?.trim() || undefined;
    const rx = nextRx(workouts, t.exerciseId);
    const n = Math.max(1, rx?.sets || t.targetSets);
    const restSec = rx?.restSec || t.restSec;
    const coachCue = rx?.cue?.trim() || undefined;
    if (mode === 'time') {
      const sec = rx?.seconds || t.targetSec || 60;
      const sets: SetLog[] = Array.from({ length: n }, () => ({ weight: 0, reps: 0, seconds: sec, done: false }));
      return { exerciseId: t.exerciseId, name: t.name, restSec, mode, note: t.note, lastComment, coachCue, sets };
    }
    const sug = nextTarget(workouts, t, units, custom);
    const last = exerciseHistory(workouts, t.exerciseId, 1)[0]?.sets || [];
    const weight = rx?.weight ?? sug.weight, reps = rx?.reps ?? sug.reps;
    const sets: SetLog[] = Array.from({ length: n }, (_, i) => ({
      weight, reps, repsR: rx?.repsR, done: false, prev: last[i] ? { weight: last[i].weight, reps: last[i].reps, repsR: last[i].repsR } : undefined,
    }));
    return { exerciseId: t.exerciseId, name: t.name, restSec, targetReps: rx?.reps ? String(rx.reps) : t.targetReps, note: t.note, lastComment, coachCue, sets };
  });
  return { id: uid(), date: dayKey(now), startedAt: now.toISOString(), templateId: tpl.id, name: tpl.name, exercises };
}

/** A coach's written plan → a template (unsaved). Names the library doesn't know become custom exercises. */
export async function planFromCoach(text: string, units: Units, custom: Exercise[] = []): Promise<{ template: Template; created: Exercise[] }> {
  const all = [...custom, ...LIBRARY];
  const r: PlanResult = await planFromText(text, all.map(e => ({ id: e.id, name: e.name })), units);
  const created: Exercise[] = [];
  const exercises: TemplateExercise[] = r.exercises.map(e => {
    let lib = e.exerciseId ? all.find(x => x.id === e.exerciseId) : undefined;
    if (!lib) lib = all.find(x => x.name.toLowerCase() === e.name.toLowerCase());
    if (!lib) {
      lib = { id: `custom-${uid()}`, name: e.name, muscles: [e.mode === 'time' ? 'cardio' : 'full'], equipment: e.mode === 'time' ? 'cardio' : 'dumbbell', type: e.mode === 'time' ? 'cardio' : 'strength', defaultStep: 5, custom: true, timed: e.mode === 'time' };
      created.push(lib);
    }
    const mode = e.mode === 'time' || (lib.timed && !e.reps) ? 'time' : 'reps';
    return { exerciseId: lib.id, name: lib.name, targetSets: Math.max(1, e.sets || 1), targetReps: mode === 'reps' ? (e.reps || '8-12') : '', restSec: Math.max(0, e.restSec ?? (mode === 'time' ? 0 : 90)), mode, targetSec: mode === 'time' ? Math.max(10, e.seconds || 60) : undefined, note: [e.note, e.weight ? `start ${e.weight} ${units}` : ''].filter(Boolean).join(' · ') || undefined };
  });
  return { template: { id: uid(), name: r.name || 'Coach plan', exercises, order: 99 }, created };
}

export function emptyWorkout(name = 'Workout'): Workout {
  const now = new Date();
  return { id: uid(), date: dayKey(now), startedAt: now.toISOString(), name, exercises: [] };
}

/** Which template is up today: one planned for this weekday, else the one not done for longest. */
export function todaysTemplate(templates: Template[], workouts: Workout[], date = new Date()): Template | null {
  const live = templates.filter(t => !t.archived);
  if (!live.length) return null;
  const dow = date.getDay();
  const planned = live.filter(t => t.days?.includes(dow));
  if (planned.length) return planned[0];
  const lastDone = (t: Template) => workouts.find(w => w.templateId === t.id && w.endedAt)?.startedAt || '';
  return [...live].sort((a, b) => (lastDone(a) < lastDone(b) ? -1 : 1))[0];
}

/** Personal records set in this session: best estimated 1RM per exercise beats all history. */
export function detectPRs(w: Workout, history: Workout[]): string[] {
  const prs: string[] = [];
  for (const ex of w.exercises) {
    const done = ex.sets.filter(s => s.done && s.reps > 0 && s.weight > 0);
    if (!done.length) continue;
    const best = Math.max(...done.map(s => e1rm(s.weight, s.reps)));
    let prev = 0;
    for (const h of history) {
      if (h.id === w.id) continue;
      const he = h.exercises.find(e => e.exerciseId === ex.exerciseId);
      for (const s of he?.sets || []) if (s.done && s.reps > 0) prev = Math.max(prev, e1rm(s.weight, s.reps));
    }
    if (prev > 0 && best > prev) { const top = done.reduce((a, b) => (e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a)); prs.push(`${ex.name}: ${top.weight} × ${top.reps} (e1RM ${best})`); }
  }
  return prs;
}

/** This week's sessions by weekday (Mon..Sun). */
export function weekSessions(workouts: Workout[], now = new Date()): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  for (const w of workouts) {
    if (!w.endedAt) continue;
    const d = new Date(w.startedAt);
    if (d >= monday) out[(d.getDay() + 6) % 7] += 1;
  }
  return out;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDate = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };

// src/planner/features/workout/store.ts — reading and writing the workout docs, plus the derived bits.
import { dayKey, getDocs, putDoc, putDocs } from '../../lib/docs';
import { planFromText, type PlanResult } from '../../lib/ai';
import { uid } from '../../ui/primitives';
import { LIBRARY, findExercise, isLower, isTimed } from './library';
import { suggest, type Suggestion } from './progression';
import { durationMin, e1rm, isAssisted, type BodyWeight, type Equipment, type Exercise, type Format, type Muscle, type NextRx, type SetLog, type Template, type TemplateExercise, type Units, type Workout, type WorkoutExercise, workoutKey } from './types';
import { blocksOf, cleanFormat, hasSides, isNoLoad, settleGroups } from './format';

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
  return suggest({ history: exerciseHistory(workouts, t.exerciseId), targetReps: t.targetReps, targetSets: t.targetSets, units, lower: isLower(ex), defaultStep: ex.defaultStep, assisted: isAssisted(ex) });
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
/** The format fields an exercise carries from the template into the session. */
const formatOf = (t: Format): Format => {
  const f: Format = {};
  for (const k of ['sides', 'noLoad', 'style', 'repsBySet', 'weightBySet', 'group', 'groupKind', 'groupSec'] as const) if (t[k] !== undefined) (f as Record<string, unknown>)[k] = t[k];
  return f;
};

export function startFromTemplate(tpl: Template, workouts: Workout[], units: Units, custom: Exercise[] = []): Workout {
  const now = new Date();
  const clocked = new Set(blocksOf(tpl.exercises).filter(b => b.kind === 'emom' || b.kind === 'amrap').flatMap(b => b.at));
  const exercises: WorkoutExercise[] = tpl.exercises.map((t, ti) => {
    const lib = findExercise(t.exerciseId, custom);
    const mode = t.mode || (isTimed(lib) ? 'time' : 'reps');
    const fmt = formatOf(t);
    const lastComment = exerciseHistory(workouts, t.exerciseId, 1)[0]?.comment?.trim() || undefined;
    const rx = nextRx(workouts, t.exerciseId);
    const coachCue = rx?.cue?.trim() || undefined;
    if (mode === 'time') {
      const n = clocked.has(ti) ? 1 : Math.max(1, t.style === 'intervals' ? t.targetSets : rx?.sets || t.targetSets);
      const sec = (t.style === 'intervals' ? undefined : rx?.seconds) || t.targetSec || 60;
      const sets: SetLog[] = Array.from({ length: n }, () => ({ weight: 0, reps: 0, seconds: sec, done: false }));
      return { exerciseId: t.exerciseId, name: t.name, restSec: (t.style === 'intervals' ? undefined : rx?.restSec) ?? t.restSec, mode, note: t.note, lastComment, coachCue, sets, ...fmt };
    }
    const sug = nextTarget(workouts, t, units, custom);
    const last = exerciseHistory(workouts, t.exerciseId, 1)[0]?.sets || [];
    const prev = (i: number) => (last[i] ? { weight: last[i].weight, reps: last[i].reps, repsR: last[i].repsR } : undefined);
    const sides = hasSides({ ...t, mode }, lib);
    const bare = isNoLoad({ ...t, mode }, lib) && !last.some(s => s.weight > 0);
    // a plan with its own shape (pyramid, countdown, drop set) or a clocked block keeps the plan's numbers: last
    // time's prescription was for straight sets
    const shaped = !!t.repsBySet?.length || !!t.weightBySet?.length || clocked.has(ti);
    // the plan's own weight leads in a session planned for a date (Arvy chose it from the same history) and the first time a move is done
    const planned = t.startWeight && (tpl.plannedFor || !last.length) ? t.startWeight : undefined;
    const base = bare ? 0 : planned ?? (shaped ? undefined : rx?.weight) ?? sug.weight;
    if (t.repsBySet?.length || t.weightBySet?.length) {
      const n = Math.max(t.repsBySet?.length || 0, t.weightBySet?.length || 0);
      const sets: SetLog[] = Array.from({ length: n }, (_, i) => {
        const reps = t.repsBySet?.[i] ?? t.repsBySet?.[t.repsBySet.length - 1] ?? sug.reps;
        return { weight: bare ? 0 : t.weightBySet?.[i] ?? base ?? 0, reps, ...(sides ? { repsR: reps } : {}), done: false, prev: prev(i) };
      });
      return { exerciseId: t.exerciseId, name: t.name, restSec: t.restSec, targetReps: t.repsBySet?.join('-') || t.targetReps, note: t.note, lastComment, coachCue, sets, ...fmt };
    }
    const n = clocked.has(ti) ? 1 : Math.max(1, (shaped ? undefined : rx?.sets) || t.targetSets);   // a clocked block logs its rounds when the clock stops
    const reps = (shaped ? undefined : rx?.reps) ?? sug.reps;
    const sets: SetLog[] = Array.from({ length: n }, (_, i) => ({ weight: base ?? 0, reps, ...(sides ? { repsR: rx?.repsR ?? reps } : rx?.repsR !== undefined ? { repsR: rx.repsR } : {}), done: false, prev: prev(i) }));
    return { exerciseId: t.exerciseId, name: t.name, restSec: (shaped ? undefined : rx?.restSec) || t.restSec, targetReps: !shaped && rx?.reps ? String(rx.reps) : t.targetReps, note: t.note, lastComment, coachCue, sets, ...fmt };
  });
  return { id: uid(), date: dayKey(now), startedAt: now.toISOString(), templateId: tpl.id, name: tpl.name, exercises };
}

/** A coach's written plan → a template (unsaved). Names the library doesn't know become custom exercises. */
export async function planFromCoach(text: string, units: Units, custom: Exercise[] = []): Promise<{ template: Template; created: Exercise[] }> {
  const all = [...custom, ...LIBRARY];
  const r: PlanResult = await planFromText(text, all.map(e => ({ id: e.id, name: e.name })), units);
  return templateFromPlan(r, units, custom);
}
/** A structured plan (from the coach chat or the day plan) → a template (unsaved) + any new custom exercises. */
export function templateFromPlan(r: PlanResult, units: Units, custom: Exercise[] = []): { template: Template; created: Exercise[] } {
  const all = [...custom, ...LIBRARY];
  const created: Exercise[] = [];
  const exercises: TemplateExercise[] = r.exercises.map(e => {
    let lib = e.exerciseId ? all.find(x => x.id === e.exerciseId) : undefined;
    if (!lib) lib = [...all, ...created].find(x => x.name.toLowerCase() === e.name.toLowerCase());
    const timed = e.mode === 'time';
    if (!lib) { lib = newExercise(e.name, { timed, sides: !!e.perSide, noWeight: !!e.noWeight, muscle: e.muscle, equipment: e.equipment }); created.push(lib); }
    const mode = timed || (lib.timed && !e.reps && !e.repsBySet?.length) ? 'time' : 'reps';
    const fmt = cleanFormat({ sides: e.perSide || undefined, noLoad: e.noWeight || undefined, style: e.style, repsBySet: e.repsBySet, weightBySet: e.weightBySet, group: e.group, groupKind: e.groupKind, groupSec: e.groupMinutes ? e.groupMinutes * 60 : undefined }, mode);
    const sets = fmt.repsBySet?.length || fmt.weightBySet?.length || Math.max(1, e.sets || 1);
    return { exerciseId: lib.id, name: lib.name, targetSets: sets, targetReps: mode === 'reps' ? (fmt.repsBySet?.join('-') || e.reps || '8-12') : '', restSec: Math.max(0, e.restSec ?? (mode === 'time' ? 0 : 90)), mode, targetSec: mode === 'time' ? Math.max(5, e.seconds || 60) : undefined,
      note: [e.note, e.weight && !fmt.weightBySet ? `start ${e.weight} ${units}` : ''].filter(Boolean).join(' · ') || undefined, ...(e.weight && mode === 'reps' && !fmt.weightBySet && !fmt.noLoad ? { startWeight: e.weight } : {}), ...fmt };
  });
  return { template: { id: uid(), name: r.name || 'Arvy’s plan', exercises: settleGroups(foldWarmups(exercises)), order: 99 }, created };
}

const MUSCLE_IDS: Muscle[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio', 'full'];
const EQUIPMENT_IDS: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'cardio'];
/** An exercise the library doesn't have, described as well as the plan and its name allow (a kettlebell move is a
 *  kettlebell move, a stretch has no weight, a chop is done one side at a time). */
export function newExercise(name: string, o: { timed?: boolean; sides?: boolean; noWeight?: boolean; muscle?: string; equipment?: string } = {}): Exercise {
  const n = name.toLowerCase();
  const said = EQUIPMENT_IDS.find(x => x === o.equipment);
  const equipment: Equipment = said || (/kettlebell|\bkb\b/.test(n) ? 'kettlebell' : /barbell|ez[- ]bar/.test(n) ? 'barbell' : /dumbbell|\bdb\b/.test(n) ? 'dumbbell' : /cable|pulldown|pushdown/.test(n) ? 'cable' : /\bband/.test(n) ? 'band' : /machine|leg press|smith/.test(n) ? 'machine'
    : /treadmill|bike|rower|row erg|elliptical|run\b|walk|jog|sprint|stair|skip/.test(n) ? 'cardio' : o.noWeight || o.timed || isNoLoad({ name }) ? 'bodyweight' : 'dumbbell');
  const muscle = MUSCLE_IDS.find(x => x === o.muscle) || (equipment === 'cardio' ? 'cardio' : /plank|dead bug|crunch|chop|pallof|hollow|carry|twist|rotation|halo|windmill/.test(n) ? 'core' : 'full');
  return { id: `custom-${uid()}`, name, muscles: [muscle], equipment, type: equipment === 'cardio' ? 'cardio' : 'strength', defaultStep: 5, custom: true, ...(o.timed ? { timed: true } : {}), ...(o.sides || hasSides({ name }) ? { unilateral: true } : {}) };
}

/** A lift's light warm-up set written as its own item ("1 light set of one-arm row") folds into the working sets
 *  of the same lift that follow it: one row in the session, with "1 light set first" as the cue. Two of the same
 *  rows in a plan read as a mistake, and the live session would log them as two exercises. */
export function foldWarmups(list: TemplateExercise[]): TemplateExercise[] {
  const out: TemplateExercise[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    // the same lift coming back soon with working sets (a pull-up or a stretch may sit between)
    const next = list.slice(i + 1, i + 4).find(x => x.exerciseId === e.exerciseId && x.mode !== 'time' && x.targetSets > 1);
    const light = e.mode !== 'time' && e.targetSets === 1 && !e.group && !e.repsBySet && !!next && !next.group;
    if (light && next) {
      if (!/1 light set first/.test(next.note || '')) next.note = ['1 light set first (~50%)', next.note].filter(Boolean).join(' · ');   // said once, however many warm-up lines there were
      continue;
    }
    out.push(e);
  }
  return out;
}

export function emptyWorkout(name = 'Workout'): Workout {
  const now = new Date();
  return { id: uid(), date: dayKey(now), startedAt: now.toISOString(), name, exercises: [] };
}

const laterDay = (key: string, n: number): string => { const [y, m, d] = key.split('-').map(Number); const x = new Date(y, m - 1, d + n, 12); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
/** A day turned into a no-gym day (sick, a rest day): the gym session planned for it waits on the next day that has
 *  nothing planned (within a week). Returns the session as moved, or null when there's none to move. Pure. */
export function holdPlanned(templates: Template[], date: string): Template | null {
  const t = templates.find(x => !x.archived && x.plannedFor === date && !x.home);
  if (!t) return null;
  const taken = new Set(templates.filter(x => !x.archived && x.plannedFor).map(x => x.plannedFor));
  for (let i = 1; i <= 7; i++) { const to = laterDay(date, i); if (!taken.has(to)) return { ...t, plannedFor: to }; }
  return null;
}
/** The day is a gym day again: the session that was held comes back, if it's still where it was put and the day has
 *  no gym session of its own by now (a home session planned for the day is put aside by the caller). Pure. */
export function releaseHeld(templates: Template[], date: string, held?: { id: string; to: string }): Template | null {
  const t = held ? templates.find(x => x.id === held.id && !x.archived && x.plannedFor === held.to) : undefined;
  if (!t || templates.some(x => !x.archived && x.plannedFor === date && !x.home)) return null;
  return { ...t, plannedFor: date };
}

/** Which template is up today: one Arvy planned for this date, else one for this weekday, else the one not done for longest. */
export function todaysTemplate(templates: Template[], workouts: Workout[], date = new Date()): Template | null {
  // one-off sessions planned for another date stay out of the way
  const live = templates.filter(t => !t.archived && (!t.plannedFor || t.plannedFor === dayKey(date)));
  if (!live.length) return null;
  // (a home session and a gym session can sit on the same day once a no-gym day is put back to normal: the gym one is up)
  const onDate = live.filter(t => t.plannedFor === dayKey(date));
  const forDate = onDate.find(t => !t.home) || onDate[0];
  if (forDate) return forDate;
  const dow = date.getDay();
  const planned = live.filter(t => t.days?.includes(dow));
  if (planned.length) return planned[0];
  const lastDone = (t: Template) => workouts.find(w => w.templateId === t.id && w.endedAt)?.startedAt || '';
  return [...live].sort((a, b) => (lastDone(a) < lastDone(b) ? -1 : 1))[0];
}

/** The session to offer on a day. On a day with no gym (sick, a rest day set with Arvy) only what was planned for
 *  that very day is offered, the home session first: never the usual rotation, and not the gym session that waits. */
export function sessionToday(templates: Template[], workouts: Workout[], noGym: boolean, date = new Date()): Template | null {
  if (!noGym) return todaysTemplate(templates, workouts, date);
  const on = templates.filter(t => !t.archived && t.plannedFor === dayKey(date));
  return on.find(t => t.home) || on[0] || null;
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

/** Where today's training stands. The Today card and the Health menu both read it, so they say the same thing. Pure. */
export interface TrainToday { unfinished?: Workout; doneToday?: Workout; last?: Workout; tpl: Template | null; planned: boolean; head: string }
export function trainToday(templates: Template[], workouts: Workout[], noGym: boolean, now = new Date()): TrainToday {
  const today = dayKey(now);
  const unfinished = workouts.find(w => !w.endedAt);
  const doneToday = workouts.find(w => w.endedAt && w.date === today);
  const tpl = sessionToday(templates, workouts, noGym, now);
  // a session set for today's date (Arvy plans them by date) or for this weekday
  const planned = !!tpl && (tpl.plannedFor === today || !!tpl.days?.includes(now.getDay()));
  const head = unfinished ? `${unfinished.name} in progress` : doneToday ? `Done: ${doneToday.name}` : planned && tpl ? tpl.name : 'Rest day';
  return { unfinished, doneToday, last: workouts.find(w => w.endedAt), tpl, planned, head };
}
/** The same in one line, for the Health menu: "Home stretch (easy) · 7 exercises · at home". Pure. */
export function trainLine(t: TrainToday): string {
  if (t.unfinished) return t.head;
  if (t.doneToday) { const m = durationMin(t.doneToday); return m ? `${t.head} · ${m} min` : t.head; }
  if (t.planned && t.tpl) { const n = t.tpl.exercises.length; return `${t.tpl.name} · ${n} exercise${n === 1 ? '' : 's'}${t.tpl.home ? ' · at home' : ''}`; }
  return t.last ? `Rest day · last: ${t.last.name}, ${fmtDate(t.last.date)}` : 'No sessions yet';
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

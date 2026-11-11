// src/planner/features/workout/types.ts — the workout feature's documents (kinds: template, workout, bodyweight, exercise, coachchat).
export type Muscle = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'cardio' | 'full';
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'band' | 'cardio';
export type Units = 'lb' | 'kg';

export interface Exercise { id: string; name: string; muscles: Muscle[]; equipment: Equipment; type: 'strength' | 'cardio'; defaultStep?: number; custom?: boolean; timed?: boolean; unilateral?: boolean; assisted?: boolean }
/** Assisted pull-ups, dips and the like: the "weight" is the machine's counterweight (or the band), so LESS is harder
 *  and progress means taking assistance away. From the flag, else the name. */
export const isAssisted = (e?: { name?: string; assisted?: boolean } | null): boolean => !!e && (e.assisted ?? /assist|band[- ]?(ed|assisted)|counter[- ]?weight/i.test(e.name || ''));
/** One side at a time? From the flag, else the name. */
export const isUnilateral = (e?: { name?: string; unilateral?: boolean } | null): boolean => !!e && (e.unilateral ?? /one[- ]arm|single[- ](arm|leg)|bulgarian|split squat|lunge|step[- ]up|pistol|one[- ]leg|unilateral|per side/i.test(e.name || ''));

/** 'reps' = weight × reps sets; 'time' = a countdown (walks, bike, planks). */
export type SetMode = 'reps' | 'time';

/** How a block of exercises is run together: back to back each round (superset = 2, circuit = 3+), one exercise
 *  at the top of every minute for a set number of minutes (emom), or as many rounds as possible in a set time (amrap). */
export type GroupKind = 'superset' | 'circuit' | 'emom' | 'amrap';
/** The shape of one exercise's sets. The numbers are in repsBySet / weightBySet (or the seconds and rest for intervals). */
export type SetStyle = 'pyramid' | 'countdown' | 'ladder' | 'drop' | 'intervals';
/** What makes a session more than "N sets of M reps", and what its tracker shows. All optional: without them an
 *  exercise is straight sets (format.ts works out sides / noLoad for older sessions from the name and the target). */
export interface Format {
  sides?: boolean;          // one side (or direction) at a time: reps are logged left / right, a timer runs each side in turn
  noLoad?: boolean;         // nothing to load (bodyweight, mobility): no weight box
  style?: SetStyle;
  repsBySet?: number[];     // pyramid / countdown / ladder: the reps of each set, in order
  weightBySet?: number[];   // pyramid / drop set: the weight of each set, in order
  group?: string;           // 'A', 'B'…: neighbours with the same letter are one block
  groupKind?: GroupKind;    // how the block runs (when left out: superset for two, circuit for more)
  groupSec?: number;        // emom / amrap: how long the block runs
}

// startWeight = the weight the plan prescribed: it fills the sets of a one-off planned session, or a first time
export interface TemplateExercise extends Format { exerciseId: string; name: string; targetSets: number; targetReps: string; restSec: number; note?: string; mode?: SetMode; targetSec?: number; startWeight?: number }
// plannedFor = a one-off session Arvy set up for that date (YYYY-MM-DD); it's today's pick on that day
export interface Template { id: string; name: string; days?: number[]; exercises: TemplateExercise[]; order: number; archived?: boolean; plannedFor?: string; focus?: string; minutes?: number }

export interface SetLog { weight: number; reps: number; rpe?: number; done: boolean; prev?: { weight: number; reps: number; repsR?: number }; seconds?: number; repsR?: number }
// Unilateral exercises (one-arm row, split squat…): reps = left side, repsR = right side, one weight.
export interface WorkoutExercise extends Format { exerciseId: string; name: string; restSec: number; targetReps?: string; sets: SetLog[]; mode?: SetMode; note?: string; comment?: string; lastComment?: string; coachCue?: string }
// coachCue = what the coach prescribed for this exercise when the previous session was completed (the numbers are already prefilled)
// note = the plan's cue (from the template / coach); comment = what you wrote after doing it; lastComment = the previous session's comment, shown next time
/** What the coach prescribed for next time, per exercise, when a session was completed. Numbers prefill the next session. */
export interface NextRx { weight?: number; reps?: number; repsR?: number; sets?: number; seconds?: number; restSec?: number; cue?: string }
// review = the coach's paragraph written when the session was completed; next = its per-exercise prescriptions (by exerciseId)
// kind 'home' = the back-on-track challenge done at home after a missed gym day (homeChallenge.ts): it doesn't tick the gym
export interface Workout { id: string; date: string; startedAt: string; endedAt?: string; templateId?: string; name: string; exercises: WorkoutExercise[]; notes?: string; prs?: string[]; discarded?: boolean; review?: string; next?: Record<string, NextRx>; kind?: 'home' }

export interface BodyWeight { weight: number }
export interface CoachChat { messages: { role: 'user' | 'assistant'; content: string; at?: string }[] }

export const workoutKey = (w: { date: string; id: string }) => `${w.date}~${w.id}`;

/** Epley estimated one-rep max. */
export const e1rm = (weight: number, reps: number) => (reps <= 1 ? weight : Math.round(weight * (1 + reps / 30)));
export const volumeOf = (w: Workout) => w.exercises.filter(e => e.mode !== 'time').reduce((s, e) => s + e.sets.filter(x => x.done).reduce((t, x) => t + x.weight * (x.reps + (x.repsR ?? 0)), 0), 0);
export const fmtSec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}`;
export const setsDone = (w: Workout) => w.exercises.reduce((s, e) => s + e.sets.filter(x => x.done).length, 0);
export const durationMin = (w: Workout) => (w.endedAt ? Math.max(1, Math.round((new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 60000)) : null);
export const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

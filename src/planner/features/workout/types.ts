// src/planner/features/workout/types.ts — the workout feature's documents (kinds: template, workout, bodyweight, exercise, coachchat).
export type Muscle = 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'cardio' | 'full';
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'kettlebell' | 'band' | 'cardio';
export type Units = 'lb' | 'kg';

export interface Exercise { id: string; name: string; muscles: Muscle[]; equipment: Equipment; type: 'strength' | 'cardio'; defaultStep?: number; custom?: boolean }

export interface TemplateExercise { exerciseId: string; name: string; targetSets: number; targetReps: string; restSec: number; note?: string }
export interface Template { id: string; name: string; days?: number[]; exercises: TemplateExercise[]; order: number; archived?: boolean }

export interface SetLog { weight: number; reps: number; rpe?: number; done: boolean; prev?: { weight: number; reps: number } }
export interface WorkoutExercise { exerciseId: string; name: string; restSec: number; targetReps?: string; sets: SetLog[] }
export interface Workout { id: string; date: string; startedAt: string; endedAt?: string; templateId?: string; name: string; exercises: WorkoutExercise[]; notes?: string; prs?: string[]; discarded?: boolean }

export interface BodyWeight { weight: number }
export interface CoachChat { messages: { role: 'user' | 'assistant'; content: string; at?: string }[] }

export const workoutKey = (w: { date: string; id: string }) => `${w.date}~${w.id}`;

/** Epley estimated one-rep max. */
export const e1rm = (weight: number, reps: number) => (reps <= 1 ? weight : Math.round(weight * (1 + reps / 30)));
export const volumeOf = (w: Workout) => w.exercises.reduce((s, e) => s + e.sets.filter(x => x.done).reduce((t, x) => t + x.weight * x.reps, 0), 0);
export const setsDone = (w: Workout) => w.exercises.reduce((s, e) => s + e.sets.filter(x => x.done).length, 0);
export const durationMin = (w: Workout) => (w.endedAt ? Math.max(1, Math.round((new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 60000)) : null);
export const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

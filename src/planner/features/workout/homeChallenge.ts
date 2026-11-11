// src/planner/features/workout/homeChallenge.ts — "Did you miss the gym?" and the way back: a 5–10 minute bodyweight
// challenge to do at home (2 rounds of push-ups, squats and the like). Pure, so the rules are tested.
//
// When to ask: the routine has a gym block (the 5 am club), today is a gym day (the gym habit is due, or there's no gym
// habit), nothing says you went (no gym tick, no session today), the question hasn't been answered, and it's late: the
// gym block is over, or you were up well after it started. The answer is kept on the day (Day.gym), so it's asked once
// across devices.
//
// The challenge is saved as a normal session marked kind 'home', so it shows in History and the coach sees it. It isn't
// the gym: finishing it doesn't tick the gym block; it marks the gym habit "mini" (the small version, which keeps the
// streak — "never miss twice").
import { blocks, routineMin, routineMinutes, type DayAdjust, type Routine } from '../../lib/routine';
import { uid } from '../../ui/primitives';
import type { Workout, WorkoutExercise } from './types';
export type { GymAnswer, GymCheck } from '../plan/types';

/** Minutes after the gym block ends before "you missed it" is asked. */
const GRACE = 15;
/** Up this long after the gym's start time = clearly not going this morning. */
const LATE_UP = 30;

export function shouldAskMissedGym(o: {
  routine: Routine; now: Date; ticks: { up?: string; gym?: string }; answered: boolean; workoutToday: boolean; gymDue: boolean;
  adjust?: DayAdjust | null;   // today's changes to the routine: the gym skipped (never asked) or moved (asked after its new time)
}): boolean {
  if (o.answered || o.ticks.gym || o.workoutToday || !o.gymDue) return false;
  const gym = blocks(o.routine, o.adjust).find(b => b.id === 'gym');
  if (!gym) return false;
  const start = routineMin(gym.at);
  const end = gym.until ? routineMin(gym.until) : start + 90;
  if (routineMinutes(o.now) >= end + GRACE) return true;
  return !!o.ticks.up && routineMin(o.ticks.up) >= start + LATE_UP;
}

type Item = { exerciseId: string; name: string; sets: number; reps?: number; seconds?: number };
export interface Challenge { name: string; minutes: number; items: Item[] }

/** Three short circuits, rotated by the date so it isn't the same one every time. 2 rounds, 30 s rest. */
export const CHALLENGES: Challenge[] = [
  { name: 'Back on track · push & squat', minutes: 8, items: [
    { exerciseId: 'push-up', name: 'Push-up', sets: 2, reps: 10 },
    { exerciseId: 'bodyweight-squat', name: 'Bodyweight Squat', sets: 2, reps: 15 },
    { exerciseId: 'glute-bridge', name: 'Glute Bridge', sets: 2, reps: 12 },
    { exerciseId: 'plank', name: 'Plank', sets: 2, seconds: 30 },
  ] },
  { name: 'Back on track · full body', minutes: 8, items: [
    { exerciseId: 'push-up', name: 'Push-up', sets: 2, reps: 10 },
    { exerciseId: 'bodyweight-squat', name: 'Bodyweight Squat', sets: 2, reps: 15 },
    { exerciseId: 'mountain-climber', name: 'Mountain Climber', sets: 2, reps: 20 },
    { exerciseId: 'dead-bug', name: 'Dead Bug', sets: 2, reps: 10 },
  ] },
  { name: 'Back on track · quick burn', minutes: 9, items: [
    { exerciseId: 'jumping-jack', name: 'Jumping Jacks', sets: 2, seconds: 40 },
    { exerciseId: 'push-up', name: 'Push-up', sets: 2, reps: 10 },
    { exerciseId: 'bodyweight-squat', name: 'Bodyweight Squat', sets: 2, reps: 15 },
    { exerciseId: 'plank', name: 'Plank', sets: 2, seconds: 30 },
  ] },
];

/** The challenge for a day (YYYY-MM-DD): the same all day, a different one tomorrow. */
export function challengeFor(day: string): Challenge {
  const [y, m, d] = day.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  return CHALLENGES[((n % CHALLENGES.length) + CHALLENGES.length) % CHALLENGES.length];
}

/** "2 × 10 push-ups · 2 × 15 squats · 2 × 30 s plank" */
export const challengeLine = (c: Challenge) => c.items.map(i => `${i.sets} × ${i.seconds ? `${i.seconds} s` : i.reps} ${i.name.toLowerCase()}`).join(' · ');

/** A session to do it in: the exact sets (no progression), bodyweight, 30 s rest. */
export function startHomeChallenge(day: string, now = new Date()): Workout {
  const c = challengeFor(day);
  const exercises: WorkoutExercise[] = c.items.map(i => (i.seconds
    ? { exerciseId: i.exerciseId, name: i.name, restSec: 30, mode: 'time', sets: Array.from({ length: i.sets }, () => ({ weight: 0, reps: 0, seconds: i.seconds, done: false })) }
    : { exerciseId: i.exerciseId, name: i.name, restSec: 30, targetReps: String(i.reps), sets: Array.from({ length: i.sets }, () => ({ weight: 0, reps: i.reps || 10, done: false })) }));
  return { id: uid(), date: day, startedAt: now.toISOString(), name: c.name, kind: 'home', exercises };
}

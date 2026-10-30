// src/planner/features/workout/index.ts — the workout tracker + coach: routes and the Today card.
import { createElement, type JSX } from 'react';
import { getPass, type PlannerPass } from '../../lib/auth';
import { WorkoutHome, WorkoutTodayCard as TodayCard } from './WorkoutHome';
import { LiveWorkout } from './LiveWorkout';
import { Templates, TemplateEdit } from './Templates';
import { History, ExerciseProgress } from './History';
import { Coach } from './Coach';
import { Body } from './Body';
import './workout.css';

// Routes only render once signed in (App.tsx), so the pass is always there.
function withPass(C: (p: { pass: PlannerPass }) => JSX.Element): JSX.Element {
  const Wrapped = () => { const pass = getPass(); return pass ? createElement(C, { pass }) : null; };
  return createElement(Wrapped);
}

export const workoutRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/workout', element: withPass(WorkoutHome) },
  { path: '/workout/live/:id', element: withPass(LiveWorkout) },
  { path: '/workout/templates', element: createElement(Templates) },
  { path: '/workout/templates/:id', element: createElement(TemplateEdit) },
  { path: '/workout/history', element: withPass(History) },
  { path: '/workout/exercise/:id', element: withPass(ExerciseProgress) },
  { path: '/workout/coach', element: withPass(Coach) },
  { path: '/workout/body', element: withPass(Body) },
];

export function WorkoutTodayCard({ pass }: { pass: PlannerPass }): JSX.Element { return createElement(TodayCard, { pass }); }

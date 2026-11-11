// src/planner/features/workout/index.ts — the workout tracker: routes and the Today card.
// The coach is Arvy (features/arvy): /workout/coach, the old Coach chat, now opens Arvy on the Train screen.
import { createElement, useEffect, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { getPass, type PlannerPass } from '../../lib/auth';
import { WorkoutHome, WorkoutTodayCard as TodayCard } from './WorkoutHome';
import { LiveWorkout } from './LiveWorkout';
import { Templates, TemplateEdit } from './Templates';
import { History, ExerciseProgress } from './History';
import { COACH_ASKS, openArvy } from '../arvy/arvy';
import { Body } from './Body';
import './workout.css';

// Routes only render once signed in (App.tsx), so the pass is always there.
function withPass(C: (p: { pass: PlannerPass }) => JSX.Element): JSX.Element {
  const Wrapped = () => { const pass = getPass(); return pass ? createElement(C, { pass }) : null; };
  return createElement(Wrapped);
}

/** An old link to the Coach chat: go to Train and open Arvy with the coaching questions. */
function AskArvy(): JSX.Element {
  useEffect(() => { const t = setTimeout(() => openArvy({ suggest: COACH_ASKS }), 0); return () => clearTimeout(t); }, []);
  return createElement(Navigate, { to: '/workout', replace: true });
}

export const workoutRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/workout', element: withPass(WorkoutHome) },
  { path: '/workout/live/:id', element: withPass(LiveWorkout) },
  { path: '/workout/templates', element: createElement(Templates) },
  { path: '/workout/templates/:id', element: createElement(TemplateEdit) },
  { path: '/workout/history', element: withPass(History) },
  { path: '/workout/exercise/:id', element: withPass(ExerciseProgress) },
  { path: '/workout/coach', element: createElement(AskArvy) },
  { path: '/workout/body', element: withPass(Body) },
];

export function WorkoutTodayCard({ pass }: { pass: PlannerPass }): JSX.Element { return createElement(TodayCard, { pass }); }
export { MissedGym, GymStatus } from './MissedGym';

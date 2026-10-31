// src/planner/features/plan — the day around Vijay's routine: the Bed Brief (from bed, ≤10 min), the
// daily page, Miracle Night (wind-down, review, lights out), weekly and monthly reviews.
import './plan.css';
import { createElement } from 'react';
import { DayPage } from './DayPage';
import { Brief } from './Brief';
import { Night } from './Night';
import { Morning } from './Morning';
import { MonthReview, WeekReview } from './Reviews';

export { PlanTodayCard } from './TodayCard';
export { wakeStreak, lightsOutStreak, wokeOnTime, lightsOutOnTime, sleepEstimate, addDays, nowHM, streakOf } from './dates';
export { emptyDay, normalizeDay, briefDone, reviewDone, toggleTodo, sortedTodos, todosDone } from './types';
export type { Todo } from './types';
export { TodoList } from './TodoList';
export type { Day } from './types';

export const planRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/plan', element: createElement(DayPage) },
  { path: '/plan/brief', element: createElement(Brief) },
  { path: '/plan/night', element: createElement(Night) },
  { path: '/plan/morning', element: createElement(Morning) },
  { path: '/plan/week', element: createElement(WeekReview) },
  { path: '/plan/month', element: createElement(MonthReview) },
  { path: '/plan/:date', element: createElement(DayPage) },
];

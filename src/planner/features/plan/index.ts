// src/planner/features/plan — the day around the routine: the Brief (≤10 min) → today's list, the daily page,
// the sauna (5 am club: yesterday's review + today's Brief), the evening wind-down (Rosh), weekly and monthly reviews.
import './plan.css';
import { createElement } from 'react';
import { DayPage } from './DayPage';
import { Brief } from './Brief';
import { Night } from './Night';
import { Sauna } from './Sauna';
import { Morning } from './Morning';
import { MonthReview, WeekReview } from './Reviews';

export { PlanTodayCard } from './TodayCard';
export { wakeStreak, lightsOutStreak, wokeOnTime, lightsOutOnTime, sleepEstimate, addDays, nowHM, streakOf } from './dates';
export { emptyDay, normalizeDay, briefDone, reviewDone, toggleTodo, toggleMust, syncPriorities, sortedTodos, todosDone, moveTodo, frequentTodos } from './types';
export { useFrequentTodos } from './useFrequentTodos';
export type { Todo } from './types';
export { TodoList } from './TodoList';
export { MissedBedtime, isMorningHours } from './MissedBedtime';
export type { Day } from './types';

export const planRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/plan', element: createElement(DayPage) },
  { path: '/plan/brief', element: createElement(Brief) },
  { path: '/plan/night', element: createElement(Night) },
  { path: '/plan/sauna', element: createElement(Sauna) },
  { path: '/plan/morning', element: createElement(Morning) },
  { path: '/plan/week', element: createElement(WeekReview) },
  { path: '/plan/month', element: createElement(MonthReview) },
  { path: '/plan/:date', element: createElement(DayPage) },
];

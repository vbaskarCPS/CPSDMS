// src/planner/features/plan — the day around Vijay's routine: the Bed Brief (from bed, ≤10 min), the
// daily page, Miracle Night (wind-down, review, lights out), weekly and monthly reviews.
import './plan.css';
import { createElement } from 'react';
import { DayPage } from './DayPage';
import { Brief } from './Brief';
import { Night } from './Night';
import { MonthReview, WeekReview } from './Reviews';

export { PlanTodayCard } from './TodayCard';
export { wakeStreak, lightsOutStreak, wokeOnTime, lightsOutOnTime, sleepEstimate, addDays, nowHM } from './dates';
export { emptyDay, normalizeDay, briefDone } from './types';
export type { Day } from './types';

export const planRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/plan', element: createElement(DayPage) },
  { path: '/plan/brief', element: createElement(Brief) },
  { path: '/plan/night', element: createElement(Night) },
  { path: '/plan/week', element: createElement(WeekReview) },
  { path: '/plan/month', element: createElement(MonthReview) },
  { path: '/plan/:date', element: createElement(DayPage) },
];

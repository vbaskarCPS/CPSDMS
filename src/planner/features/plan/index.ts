// src/planner/features/plan — the daily page (High Performance Planner), Victory Hour (5 AM Club /
// Miracle Morning), weekly and monthly reviews.
import './plan.css';
import { createElement } from 'react';
import { DayPage } from './DayPage';
import { VictoryHour } from './VictoryHour';
import { MonthReview, WeekReview } from './Reviews';

export { PlanTodayCard } from './TodayCard';
export { wakeStreak } from './dates';
export type { Day } from './types';

export const planRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/plan', element: createElement(DayPage) },
  { path: '/plan/victory', element: createElement(VictoryHour) },
  { path: '/plan/week', element: createElement(WeekReview) },
  { path: '/plan/month', element: createElement(MonthReview) },
  { path: '/plan/:date', element: createElement(DayPage) },
];

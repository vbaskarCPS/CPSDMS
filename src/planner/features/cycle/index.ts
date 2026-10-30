// src/planner/features/cycle/index.ts — the cycle tracker: routes and the Today card.
import { createElement } from 'react';
import './cycle.css';
import { CycleHome } from './CycleHome';
import { DayLog } from './DayLog';
import { History } from './History';
import { CycleSettings } from './CycleSettings';
export { CycleTodayCard } from './TodayCard';
export type { Period, DayLog as CycleDayLog, CyclePrefs } from './types';

export const cycleRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/cycle', element: createElement(CycleHome) },
  { path: '/cycle/log/:date', element: createElement(DayLog) },
  { path: '/cycle/history', element: createElement(History) },
  { path: '/cycle/settings', element: createElement(CycleSettings) },
];

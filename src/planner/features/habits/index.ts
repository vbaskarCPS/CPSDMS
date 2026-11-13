// src/planner/features/habits/index.ts — the habits feature: routes and the Today card.
import { createElement } from 'react';
import './habits.css';
import { HabitsList } from './HabitsList';
import { HabitForm } from './HabitForm';
import { HabitDetail } from './HabitDetail';
export { HabitsTodayCard, useHabitsLine } from './HabitsTodayCard';
export { autoMark, markWake } from './auto';
export { checkProteinGoal } from './proteinGoal';
export { SlotHabits, SlotHabitsProvider } from './SlotHabits';
export { onHabitTicked } from './ticked';

export const habitsRoutes: { path: string; element: JSX.Element }[] = [
  { path: '/habits', element: createElement(HabitsList) },
  { path: '/habits/new', element: createElement(HabitForm) },
  { path: '/habits/:id', element: createElement(HabitDetail) },
  { path: '/habits/:id/edit', element: createElement(HabitForm) },
];

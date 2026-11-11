// src/planner/features/widgets — Today as each person arranges it: the order, size and showing of the planner's own
// blocks, and the widgets they add (a countdown, a note, the mini calendar, the habit tracker).
// widgets.ts is the list and the rules (plain functions, tested); store.ts keeps a person's arrangement;
// TodayWidgets draws Today's blocks in that order (screens/Today.tsx); Arrange is the screen at /settings/widgets.
import './widgets.css';
export { TodayWidgets, useTodayWidgets } from './TodayWidgets';
export { ArrangeToday, ArrangeTile } from './Arrange';
export { foldsAway } from './widgets';
export type { TodayBlockId } from './widgets';

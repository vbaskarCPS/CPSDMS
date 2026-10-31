// src/planner/features/calendar/index.ts — the shared household calendar (route wired in App.tsx) and the Today card.
import './calendar.css';
export { CalendarTodayCard } from './TodayCard';
export { loadEvents } from './store';
export { eventsOn, type CalEvent } from './types';

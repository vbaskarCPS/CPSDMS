// src/planner/features/widgets/Compact.tsx — the one-line size of the planner's own cards on Today (Calendar, Habits,
// Cycle, Food), for someone who picked "Compact" on the Arrange Today screen. Each is a single row like the Shopping
// card: the name, today's headline, tap to go in. The headline is the one the menu pages already show (screens/Hub.tsx),
// from each feature's own hook, so the full card's code is not touched.
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Heart, Repeat, Utensils, type LucideIcon } from 'lucide-react';
import { useCalendarLine } from '../calendar';
import { useCycleLine } from '../cycle';
import { useFoodLine } from '../food';
import { useHabitsLine } from '../habits';
import type { TodayBlockId } from './widgets';

/** `line` = today's headline; null while it loads. */
function Line({ to, Icon, name, line }: { to: string; Icon: LucideIcon; name: string; line: string | null }) {
  return (
    <Link to={to} className="pl-card pl-row wg-line">
      <Icon aria-hidden />
      <div className="pl-grow"><b>{name}</b><small className="pl-muted">{line ?? '…'}</small></div>
      <ChevronRight aria-hidden />
    </Link>
  );
}

// one component each: a card loads only when it is the one being shown
const CalendarLine = () => <Line to="/calendar" Icon={CalendarDays} name="Calendar" line={useCalendarLine()} />;
const HabitsLine = () => <Line to="/habits" Icon={Repeat} name="Habits" line={useHabitsLine()} />;
const CycleLine = () => <Line to="/cycle" Icon={Heart} name="Cycle" line={useCycleLine()} />;
const FoodLine = () => <Line to="/food" Icon={Utensils} name="Food" line={useFoodLine()} />;

/** The blocks that have a one-line size. (The day's plan has a compact size too, but it folds itself: screens/Today.tsx.) */
export const COMPACT: Partial<Record<TodayBlockId, () => JSX.Element>> = { calendar: CalendarLine, habits: HabitsLine, cycle: CycleLine, food: FoodLine };

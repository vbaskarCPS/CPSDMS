// src/planner/screens/Hub.tsx — the menu pages behind the bar's Health and Lifestyle buttons (ui/nav.ts): one big tile
// per section with today's headline on it; tap a tile to go in. Wealth has one section (Money), so its button goes
// straight there and has no menu.
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, ChevronRight, Dumbbell, Heart, Repeat, ShoppingCart, Utensils, type LucideIcon } from 'lucide-react';
import type { PlannerPass } from '../lib/auth';
import { profileOf } from '../lib/app';
import { Header, Page } from '../ui/primitives';
import { useTrainLine } from '../features/workout';
import { useFoodLine } from '../features/food';
import { useCycleLine } from '../features/cycle';
import { usePlanLine } from '../features/plan';
import { useHabitsLine } from '../features/habits';
import { useCalendarLine } from '../features/calendar';
import { useShopLine } from '../features/shop';

/** `line` = today's headline for the section; null while it loads. */
function Tile({ to, Icon, name, line }: { to: string; Icon: LucideIcon; name: string; line: string | null }) {
  return (
    <Link to={to} className="hub-tile">
      <span className="hub-tile__icon"><Icon aria-hidden /></span>
      <span className="hub-tile__text"><b>{name}</b><small>{line ?? '…'}</small></span>
      <ChevronRight aria-hidden className="hub-tile__go" />
    </Link>
  );
}

// one component per tile: each loads its own section, so a slow one doesn't hold the others back
const TrainTile = () => <Tile to="/workout" Icon={Dumbbell} name="Train" line={useTrainLine()} />;
const FoodTile = () => <Tile to="/food" Icon={Utensils} name="Food" line={useFoodLine()} />;
const CycleTile = () => <Tile to="/cycle" Icon={Heart} name="Cycle" line={useCycleLine()} />;
const PlanTile = () => <Tile to="/plan" Icon={BookOpen} name="Plan" line={usePlanLine()} />;
const HabitsTile = () => <Tile to="/habits" Icon={Repeat} name="Habits" line={useHabitsLine()} />;
const CalendarTile = () => <Tile to="/calendar" Icon={CalendarDays} name="Calendar" line={useCalendarLine()} />;
const ShopTile = () => <Tile to="/shop" Icon={ShoppingCart} name="Shopping" line={useShopLine()} />;

/** Health: Train and Food, and the cycle tracker on the morning profile (Rosh). */
export function HealthHub({ pass }: { pass: PlannerPass }) {
  return (
    <Page>
      <Header title="Health" />
      <nav className="hub-tiles" aria-label="Health">
        <TrainTile />
        <FoodTile />
        {profileOf(pass.user.settings) === 'morning' && <CycleTile />}
      </nav>
    </Page>
  );
}

/** Lifestyle: the day's plan, habits, the shared calendar and the shopping list. */
export function LifestyleHub(_: { pass: PlannerPass }) {
  return (
    <Page>
      <Header title="Lifestyle" />
      <nav className="hub-tiles" aria-label="Lifestyle">
        <PlanTile />
        <HabitsTile />
        <CalendarTile />
        <ShopTile />
      </nav>
    </Page>
  );
}

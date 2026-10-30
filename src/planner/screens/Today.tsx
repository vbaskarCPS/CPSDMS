// src/planner/screens/Today.tsx — the home screen: one card per part of the day, in the order the day runs.
import { Link } from 'react-router-dom';
import { Settings as Cog } from 'lucide-react';
import type { PlannerPass } from '../lib/auth';
import { InstallHint } from '../ui/InstallHint';
import { PlanTodayCard } from '../features/plan';
import { HabitsTodayCard } from '../features/habits';
import { WorkoutTodayCard } from '../features/workout';
import { FoodTodayCard } from '../features/food';
import { MoneyTodayCard } from '../features/money';

function greeting(h: number): string {
  if (h < 5) return 'Still night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Today({ pass }: { pass: PlannerPass }) {
  const now = new Date();
  const dateLine = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <main className="pl-page pl-stack pl-fade" style={{ gap: 14 }}>
      <header className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">{dateLine}</p>
          <h1>{greeting(now.getHours())}, {pass.user.display_name}.</h1>
        </div>
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Settings" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><Cog /></Link>
      </header>
      <InstallHint />
      <PlanTodayCard pass={pass} />
      <HabitsTodayCard pass={pass} />
      <WorkoutTodayCard pass={pass} />
      <FoodTodayCard pass={pass} />
      <MoneyTodayCard pass={pass} />
    </main>
  );
}

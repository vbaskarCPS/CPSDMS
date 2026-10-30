// src/planner/screens/Today.tsx — the home screen: greeting, wake target, what's coming, install hint.
// The tiles fill in as the other PRs land (daily page, habits, workout, food).
import { Link } from 'react-router-dom';
import { BookOpen, Repeat, Dumbbell, Utensils, Settings as Cog } from 'lucide-react';
import type { PlannerPass } from '../lib/auth';
import { InstallHint } from '../ui/InstallHint';

function greeting(h: number): string {
  if (h < 5) return 'Still night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function Today({ pass }: { pass: PlannerPass }) {
  const now = new Date();
  const wake = pass.user.settings.wake_time || '05:00';
  const dateLine = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <main className="pl-page pl-stack pl-fade" style={{ gap: 16 }}>
      <header className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">{dateLine}</p>
          <h1>{greeting(now.getHours())}, {pass.user.display_name}.</h1>
        </div>
        <Link to="/settings" className="pl-btn pl-btn--ghost" aria-label="Settings" style={{ minHeight: 40, padding: '0 8px' }}><Cog /></Link>
      </header>

      <InstallHint />

      <section className="pl-card pl-card--accent pl-stack" style={{ gap: 6 }}>
        <p className="pl-eyebrow">Victory hour</p>
        <h2>Wake target {wake}</h2>
        <p className="pl-muted">Move · Reflect · Grow. The morning routine and wake streak arrive with the daily page.</p>
      </section>

      <section className="pl-stack">
        <Link className="pl-tile" to="/plan"><BookOpen aria-hidden /><div><b>Daily page</b><small>Mindset, 3 priorities, evening review</small></div></Link>
        <Link className="pl-tile" to="/habits"><Repeat aria-hidden /><div><b>Habits</b><small>Small, daily, never miss twice</small></div></Link>
        <Link className="pl-tile" to="/workout"><Dumbbell aria-hidden /><div><b>Workout</b><small>Log sets, progress, coach</small></div></Link>
        <Link className="pl-tile" to="/food"><Utensils aria-hidden /><div><b>Food</b><small>Photo → calories → confirm</small></div></Link>
      </section>
    </main>
  );
}

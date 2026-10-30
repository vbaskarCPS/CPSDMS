// src/planner/features/food/sway/SwayMeter.tsx — today's go/ease balance on /food, with a 7-day line.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Progress } from '../../../ui/primitives';
import { addDays, mealsBetween, type Meal } from '../model';
import { swayCounts } from './tag';

export function SwayMeter({ day, meals }: { day: string; meals: Meal[] }) {
  const today = swayCounts(meals.flatMap(m => m.items));
  const [week, setWeek] = useState<{ go: number; ease: number } | null>(null);
  useEffect(() => {
    mealsBetween(addDays(day, -6), day).then(ds => { const c = swayCounts(ds.flatMap(d => d.data.items)); setWeek({ go: c.go, ease: c.ease }); }).catch(() => setWeek(null));
  }, [day, meals]);
  const total = today.go + today.ease;
  return (
    <Card>
      <div className="pl-row" style={{ marginBottom: 8 }}>
        <p className="pl-eyebrow pl-grow">Sway · today</p>
        <Link to="/food/sway" className="pl-chip" style={{ textDecoration: 'none', minHeight: 30 }}>Sway guide</Link>
      </div>
      <Progress value={today.go} max={total || 1} tone={total === 0 ? undefined : today.go >= today.ease ? 'good' : 'amber'} />
      <p style={{ fontSize: 14, marginTop: 8 }}>
        <b>{today.go} go · {today.ease} ease</b>{today.neutral ? <span className="pl-muted"> · {today.neutral} neutral</span> : null}
        {week && (week.go + week.ease) > 0 && <span className="pl-muted"> · last 7 days {Math.round((week.go / (week.go + week.ease)) * 100)}% go</span>}
      </p>
    </Card>
  );
}

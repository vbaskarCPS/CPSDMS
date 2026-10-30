// src/planner/features/habits/HabitsTodayCard.tsx — the Today screen's habits card.
import { Link } from 'react-router-dom';
import { ChevronRight, Repeat, AlertTriangle } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Card, Progress } from '../../ui/primitives';
import { useHabits } from './useHabits';
import { HabitRow } from './HabitRow';
import { counts, isDue, missedLastDue } from './streak';

export function HabitsTodayCard(_: { pass: PlannerPass }): JSX.Element {
  const { today, active, logs, loading, mark } = useHabits();
  const due = active.filter(h => isDue(h, today));
  const done = due.filter(h => counts(logs[today]?.[h.id])).length;
  const missed = due.filter(h => !counts(logs[today]?.[h.id]) && missedLastDue(h, logs, today));

  return (
    <Card className="pl-stack" style={{ gap: 10 }}>
      <Link to="/habits" className="pl-row" style={{ textDecoration: 'none' }}>
        <Repeat style={{ width: 20, height: 20, color: 'var(--accent)' }} aria-hidden />
        <b className="pl-grow">Habits</b>
        <span className="pl-muted pl-num" style={{ fontSize: 13 }}>{due.length ? `${done} / ${due.length}` : ''}</span>
        <ChevronRight style={{ width: 18, height: 18, color: 'var(--ink-2)' }} aria-hidden />
      </Link>
      {due.length > 0 && <Progress value={done} max={due.length} tone={done === due.length ? 'good' : undefined} />}
      {missed.length > 0 && (
        <p className="hb-nudge" style={{ alignSelf: 'flex-start' }}><AlertTriangle aria-hidden /> {missed.length === 1 ? `${missed[0].name} slipped yesterday` : `${missed.length} slipped yesterday`} — don't miss twice.</p>
      )}
      {!loading && active.length === 0 && <p className="pl-muted" style={{ fontSize: 13 }}>No habits yet. <Link to="/habits/new">Start one</Link> that takes under two minutes.</p>}
      {!loading && active.length > 0 && due.length === 0 && <p className="pl-muted" style={{ fontSize: 13 }}>Nothing due today. Rest is part of the plan.</p>}
      {due.length > 0 && (
        <div className="pl-list">
          {due.map(h => <HabitRow key={h.id} h={h} logs={logs} today={today} mark={mark} />)}
        </div>
      )}
    </Card>
  );
}

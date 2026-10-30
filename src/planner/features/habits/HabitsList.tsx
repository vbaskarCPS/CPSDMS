// src/planner/features/habits/HabitsList.tsx — /habits: today's habits, the weekly scorecard, archived.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Repeat } from 'lucide-react';
import { Page, Header, Card, Progress, Empty, Button } from '../../ui/primitives';
import { useHabits } from './useHabits';
import { HabitRow } from './HabitRow';
import { dayState, isDue, lastDays, counts, weekday } from './streak';
import { DAY_LETTER } from './types';

export function HabitsList() {
  const nav = useNavigate();
  const { today, habits, active, logs, loading, error, mark } = useHabits();
  const [showArchived, setShowArchived] = useState(false);

  const due = useMemo(() => active.filter(h => isDue(h, today)), [active, today]);
  const notDue = useMemo(() => active.filter(h => !isDue(h, today)), [active, today]);
  const doneCount = due.filter(h => counts(logs[today]?.[h.id])).length;
  const week = lastDays(today, 7);
  const archived = habits.filter(h => h.archived);

  return (
    <Page>
      <Header eyebrow="Atomic habits" title="Habits" />
      {error && <p className="pl-error">{error}</p>}

      {active.length > 0 && (
        <Card accent>
          <div className="pl-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <b style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>{doneCount} of {due.length} today</b>
            <span className="pl-muted" style={{ fontSize: 13 }}>{doneCount === due.length && due.length ? 'All done. Cast your vote.' : 'Small votes for who you are becoming.'}</span>
          </div>
          <Progress value={doneCount} max={Math.max(1, due.length)} tone={doneCount === due.length && due.length ? 'good' : undefined} />
        </Card>
      )}

      {!loading && active.length === 0 && (
        <Empty icon={<Repeat />} title="No habits yet" blurb="Start with one that takes under two minutes. Make it obvious, attractive, easy and satisfying."
          action={<Button primary onClick={() => nav('/habits/new')}><Plus /> First habit</Button>} />
      )}

      {active.length > 0 && (
        <Card>
          <div className="pl-list">
            {due.map(h => <HabitRow key={h.id} h={h} logs={logs} today={today} mark={mark} />)}
            {notDue.map(h => <HabitRow key={h.id} h={h} logs={logs} today={today} mark={mark} />)}
          </div>
        </Card>
      )}

      {active.length > 0 && (
        <Card>
          <p className="pl-eyebrow" style={{ marginBottom: 10 }}>This week's scorecard</p>
          <div className="hb-score">
            <span />
            {week.map(k => <span key={k} className={`hb-score__head ${k === today ? 'is-today' : ''}`}>{DAY_LETTER[weekday(k)]}</span>)}
            {active.map(h => (
              <HabitScoreRow key={h.id} name={h.name} cells={week.map(k => dayState(h, logs, k, today))} />
            ))}
          </div>
          <p className="pl-muted" style={{ fontSize: 12, marginTop: 10 }}>+ done · − missed · = not due</p>
        </Card>
      )}

      {archived.length > 0 && (
        <div className="pl-stack">
          <button type="button" className="pl-btn pl-btn--ghost pl-btn--small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowArchived(s => !s)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>
          {showArchived && <Card><div className="pl-list">{archived.map(h => <HabitRow key={h.id} h={h} logs={logs} today={today} mark={mark} />)}</div></Card>}
        </div>
      )}

      {active.length > 0 && <button type="button" className="pl-fab" aria-label="New habit" onClick={() => nav('/habits/new')}><Plus /></button>}
    </Page>
  );
}

function HabitScoreRow({ name, cells }: { name: string; cells: ReturnType<typeof dayState>[] }) {
  return (
    <>
      <span className="hb-score__name">{name}</span>
      {cells.map((c, i) => {
        const cls = c === 'done' ? 'is-done' : c === 'mini' ? 'is-mini' : c === 'missed' ? 'is-missed' : '';
        const sym = c === 'done' || c === 'mini' ? '+' : c === 'missed' ? '−' : c === 'future' ? '' : '=';
        return <span key={i} className={`hb-score__cell ${cls}`}>{sym}</span>;
      })}
    </>
  );
}

// src/planner/features/habits/HabitDetail.tsx — /habits/:id: streaks, completion, 12-week heatmap.
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, Flame } from 'lucide-react';
import { Page, Header, Card, Stat, Empty } from '../../ui/primitives';
import { useHabits, LOG_DAYS } from './useHabits';
import { HabitRow } from './HabitRow';
import { bestStreak, completion, currentStreak, dayState, lastDays } from './streak';

function fmtTime(t: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ap = h >= 12 ? 'pm' : 'am', hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

export function HabitDetail() {
  const { id } = useParams();
  const { today, habits, logs, loading, mark } = useHabits();
  const h = habits.find(x => x.id === id);

  // 12 weeks of columns, Sunday→Saturday rows, ending on this week's Saturday
  const grid = useMemo(() => {
    const end = new Date(today + 'T00:00:00'); end.setDate(end.getDate() + (6 - end.getDay()));
    const p = (n: number) => String(n).padStart(2, '0');
    const endKey = `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;
    return lastDays(endKey, LOG_DAYS);
  }, [today]);

  if (loading) return <Page><Header back="/habits" title="Habit" /><p className="pl-muted">Loading…</p></Page>;
  if (!h) return <Page><Header back="/habits" title="Habit" /><Empty title="Not found" blurb="This habit doesn't exist any more." /></Page>;

  const streak = currentStreak(h, logs, today), best = bestStreak(h, logs, today), c = completion(h, logs, today, 30);

  return (
    <Page>
      <Header back="/habits" eyebrow={h.archived ? 'Archived habit' : 'Habit'} title={h.name}
        right={<Link to={`/habits/${h.id}/edit`} className="pl-btn pl-btn--ghost pl-btn--small" aria-label="Edit"><Pencil /> Edit</Link>} />

      <Card><div className="pl-list"><HabitRow h={h} logs={logs} today={today} mark={mark} linkTo={false} /></div></Card>

      <div className="pl-stats">
        <Stat label="Current streak" value={<span className="pl-row" style={{ gap: 4 }}><Flame style={{ width: 20, height: 20, color: 'var(--amber-2)' }} />{streak}</span>} sub={streak === 1 ? 'day' : 'days'} tone={streak ? 'amber' : undefined} />
        <Stat label="Best streak" value={best} sub={best === 1 ? 'day' : 'days'} />
        <Stat label="Last 30 days" value={`${c.pct}%`} sub={`${c.done} of ${c.due} due`} tone={c.pct >= 80 ? 'good' : undefined} />
      </div>

      <Card className="pl-stack">
        <p className="pl-eyebrow">Last 12 weeks</p>
        <div className="hb-heat" role="img" aria-label="Twelve-week habit heatmap">
          {grid.map(k => { const s = dayState(h, logs, k, today); return <span key={k} className={`hb-heat__cell is-${s} ${k === today ? 'is-today' : ''}`} title={`${k}: ${s}`} />; })}
        </div>
        <div className="hb-legend">
          <span><i style={{ background: 'var(--good)' }} />done</span>
          <span><i style={{ background: 'var(--amber)' }} />2-min</span>
          <span><i style={{ background: 'color-mix(in srgb, var(--bad) 35%, transparent)' }} />missed</span>
          <span><i style={{ background: 'color-mix(in srgb, var(--ink) 7%, transparent)' }} />not due</span>
        </div>
      </Card>

      <Card className="pl-stack">
        <p className="pl-eyebrow">The plan</p>
        <p className="hb-sentence">I will <em>{h.name}</em>{h.cue?.time ? <> at <em>{fmtTime(h.cue.time)}</em></> : ''}{h.cue?.place ? <> in <em>{h.cue.place}</em></> : ''}.</p>
        {h.stack && <p className="hb-sentence">After I <em>{h.stack.replace(/^after i\s+/i, '').replace(/[.,]+$/, '')}</em>, I will <em>{h.name}</em>.</p>}
        {h.twoMinute && <p><span className="pl-label">On a bad day: </span>{h.twoMinute}</p>}
        {h.identity && <p><span className="pl-label">Identity: </span>{h.identity}</p>}
        {h.why && <p><span className="pl-label">Why: </span>{h.why}</p>}
      </Card>
    </Page>
  );
}

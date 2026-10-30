// src/planner/features/plan/TodayCard.tsx — a thin "today's brief" card (the Today screen draws the
// timeline itself; this stays for anything that still wants a compact summary).
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Sunrise } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { Card } from '../../ui/primitives';
import { emptyDay, normalizeDay, type Day } from './types';

export function PlanTodayCard(_: { pass: PlannerPass }) {
  const today = dayKey();
  const { data, update, loading } = useDoc<Day>('day', today, emptyDay(), 400);
  const day = useMemo(() => normalizeDay(data), [data]);
  return (
    <Card className="pl-stack" style={{ gap: 10 }}>
      <div className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">Today's brief</p>
          <b className="pl-row" style={{ gap: 6 }}><Sunrise aria-hidden style={{ width: 18, height: 18, color: 'var(--amber-2)' }} />{day.brief.word.trim() || (day.brief.finishedAt ? 'Brief done' : 'Not done yet')}</b>
        </div>
        <Link to={day.brief.finishedAt ? '/plan' : '/plan/brief'} className="pl-btn pl-btn--ghost" aria-label="Open" style={{ minHeight: 40, padding: '0 6px', border: 0 }}><ChevronRight /></Link>
      </div>
      <div>
        {day.priorities.map((p, i) => (
          <div key={i} className={`plan-card-prio ${p.done ? 'is-done' : ''} ${p.text.trim() ? '' : 'is-empty'}`}>
            <button type="button" className={`pl-check ${p.done ? 'is-on' : ''}`} aria-label={p.done ? 'Mark not done' : 'Mark done'} disabled={!p.text.trim()}
              onClick={() => update(d => { const n = normalizeDay(d); return { ...n, priorities: n.priorities.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }; })}><Check /></button>
            <span>{p.text.trim() || (loading ? '…' : `Priority ${i + 1}`)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

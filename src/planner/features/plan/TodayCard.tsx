// src/planner/features/plan/TodayCard.tsx — the day page's card on the Today dashboard.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Flame, Sunrise, Moon, ChevronRight } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { dayKey, getDocs } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { Card } from '../../ui/primitives';
import { addDays, wakeStreak } from './dates';
import { dayAverage, emptyDay, normalizeDay, type Day } from './types';

export function PlanTodayCard({ pass }: { pass: PlannerPass }) {
  const today = dayKey();
  const target = pass.user.settings.wake_time || '05:00';
  const { data, update, loading } = useDoc<Day>('day', today, emptyDay(), 400);
  const day = useMemo(() => normalizeDay(data), [data]);
  const [streak, setStreak] = useState<number | null>(null);
  const hour = new Date().getHours();

  useEffect(() => {
    let on = true;
    getDocs<Day>('day', addDays(today, -60), today).then(docs => {
      if (!on) return;
      const map: Record<string, Day> = {};
      docs.forEach(d => { map[d.key] = normalizeDay(d.data); });
      if (data && !loading) map[today] = day;
      setStreak(wakeStreak(map, target));
    }).catch(() => undefined);
    return () => { on = false; };
  }, [today, target, loading, day.victory.wokeAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const victoryN = [day.victory.move, day.victory.reflect, day.victory.grow].filter(Boolean).length;
  const prios = day.priorities;
  const avg = dayAverage(day.scores);
  const eveningDone = avg !== null || Object.values(day.evening).some(v => v.trim());
  const nudgeEvening = hour >= 19 && !eveningDone;

  return (
    <Card className="pl-stack" style={{ gap: 12 }}>
      <div className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">Daily page</p>
          <div className="pl-row" style={{ gap: 14, marginTop: 4 }}>
            <span className="pl-row" style={{ gap: 5 }} title="Wake streak"><Flame aria-hidden style={{ width: 18, height: 18, color: streak ? 'var(--amber-2)' : 'var(--ink-2)' }} /><b>{streak ?? '–'}</b><span className="pl-muted" style={{ fontSize: 13 }}>day streak</span></span>
            <span className="pl-row" style={{ gap: 5 }} title="Victory hour"><Sunrise aria-hidden style={{ width: 18, height: 18, color: victoryN === 3 ? 'var(--good)' : 'var(--ink-2)' }} /><b>{victoryN}/3</b><span className="pl-muted" style={{ fontSize: 13 }}>{day.victory.wokeAt ? `up ${day.victory.wokeAt}` : 'victory hour'}</span></span>
          </div>
        </div>
        <Link to="/plan" className="pl-btn pl-btn--ghost" aria-label="Open today's page" style={{ minHeight: 40, padding: '0 6px', border: 0 }}><ChevronRight /></Link>
      </div>

      <div>
        {prios.map((p, i) => (
          <div key={i} className={`plan-card-prio ${p.done ? 'is-done' : ''} ${p.text.trim() ? '' : 'is-empty'}`}>
            <button type="button" className={`pl-check ${p.done ? 'is-on' : ''}`} aria-label={p.done ? 'Mark not done' : 'Mark done'} disabled={!p.text.trim()}
              onClick={() => update(d => { const n = normalizeDay(d); return { ...n, priorities: n.priorities.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }; })}><Check /></button>
            <span>{p.text.trim() || (loading ? '…' : `Priority ${i + 1}`)}</span>
          </div>
        ))}
        {!loading && prios.every(p => !p.text.trim()) && <Link to="/plan" className="pl-btn pl-btn--small pl-btn--ghost" style={{ marginTop: 6 }}>Set today's 3 priorities</Link>}
      </div>

      {nudgeEvening && (
        <Link to="/plan" className="pl-tile" style={{ padding: '10px 12px', background: 'color-mix(in srgb, var(--amber) 12%, transparent)', borderColor: 'transparent' }}>
          <Moon aria-hidden style={{ color: 'var(--amber-2)' }} /><div><b>Evening review</b><small>Six questions and the scorecard — five minutes.</small></div>
        </Link>
      )}
      {avg !== null && <p className="pl-muted" style={{ fontSize: 13 }}>Today's scorecard: <b className="pl-num">{avg}</b> / 5</p>}
    </Card>
  );
}

// src/planner/features/food/History.tsx — the last 14 days against the target.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dayKey } from '../../lib/docs';
import { Card, Header, Page, Stat } from '../../ui/primitives';
import { addDays, addTotals, DEFAULT_TARGETS, loadTargets, mealsBetween, prettyDay, round, ZERO, type Meal, type Targets, type Totals } from './model';

export function History() {
  const nav = useNavigate();
  const today = dayKey();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)), [today]);
  const [byDay, setByDay] = useState<Record<string, Totals>>({});
  const [targets, setTargets] = useState<Targets>(DEFAULT_TARGETS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([mealsBetween(days[0], today), loadTargets()]).then(([ms, t]) => {
      const acc: Record<string, Totals> = {};
      for (const d of ms) { const m: Meal = d.data; acc[m.date] = addTotals(acc[m.date] || { ...ZERO }, m.totals); }
      setByDay(acc); if (t) setTargets(t);
    }).finally(() => setLoading(false));
  }, [days, today]);

  const logged = days.filter(d => byDay[d]);
  const avg = (f: (t: Totals) => number) => (logged.length ? Math.round(logged.reduce((s, d) => s + f(byDay[d]), 0) / logged.length) : 0);
  const week = days.slice(7).filter(d => byDay[d]);
  const weekAvg = week.length ? Math.round(week.reduce((s, d) => s + byDay[d].kcal, 0) / week.length) : 0;
  const diff = weekAvg - targets.kcal;
  const max = Math.max(targets.kcal * 1.2, ...days.map(d => byDay[d]?.kcal || 0));
  const best = logged.slice().sort((a, b) => Math.abs(byDay[a].kcal - targets.kcal) - Math.abs(byDay[b].kcal - targets.kcal))[0];
  const worst = logged.slice().sort((a, b) => Math.abs(byDay[b].kcal - targets.kcal) - Math.abs(byDay[a].kcal - targets.kcal))[0];

  return (
    <Page>
      <Header title="Last 14 days" eyebrow="Food history" back="/food" />
      <Card>
        <p className="pl-eyebrow" style={{ marginBottom: 8 }}>Calories · dashed line = {targets.kcal} target</p>
        <div className="fd-target-line" style={{ ['--y' as string]: `${(1 - targets.kcal / max) * 110}px` }}>
          <div className="fd-days">
            {days.map(d => {
              const k = byDay[d]?.kcal || 0;
              return (
                <button key={d} className="fd-day" onClick={() => nav(d === today ? '/food' : `/food?day=${d}`)} aria-label={`${prettyDay(d)}: ${k} kcal`}>
                  <div className={`fd-day__bar ${!k ? 'is-none' : k > targets.kcal ? 'is-over' : ''}`} style={{ height: `${Math.max(2, (k / max) * 92)}px` }} />
                  <small>{d.slice(8).replace(/^0/, '')}</small>
                </button>
              );
            })}
          </div>
        </div>
        {loading && <p className="pl-muted" style={{ fontSize: 12, marginTop: 8 }}>Loading…</p>}
      </Card>
      <div className="pl-stats">
        <Stat label="This week avg" value={weekAvg || '—'} sub={week.length ? `${diff >= 0 ? '+' : ''}${diff} vs target` : 'nothing logged'} tone={!week.length ? undefined : Math.abs(diff) <= targets.kcal * 0.05 ? 'good' : diff > 0 ? 'amber' : undefined} />
        <Stat label="Protein avg" value={logged.length ? `${avg(t => t.protein)} g` : '—'} sub={`target ${targets.protein} g`} tone={logged.length && avg(t => t.protein) >= targets.protein ? 'good' : undefined} />
        <Stat label="Days logged" value={`${logged.length}/14`} />
      </div>
      {best && (
        <Card>
          <div className="pl-stack" style={{ gap: 6 }}>
            <p><b>Closest to target:</b> {prettyDay(best)} — {round(byDay[best]).kcal} kcal</p>
            {worst && worst !== best && <p><b>Furthest:</b> {prettyDay(worst)} — {round(byDay[worst]).kcal} kcal</p>}
          </div>
        </Card>
      )}
      <p className="pl-muted" style={{ fontSize: 12 }}>Photo estimates tend to run 15–30% low on mixed dishes; a week's average is a better guide than any single day.</p>
    </Page>
  );
}

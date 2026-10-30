// The Money card on Today: this month's spending against the budget.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ChevronRight } from 'lucide-react';
import { Card, Progress } from '../../ui/primitives';
import type { PlannerPass } from '../../lib/auth';
import { budgetTotal, daysInMonth, loadBudget, loadMonths, money, monthKey, sumByCategory, totals } from './lib';

export function MoneyTodayCard(_: { pass: PlannerPass }) {
  const m = monthKey();
  const [s, setS] = useState<{ spent: number; budget: number; top?: [string, number]; n: number } | null>(null);
  useEffect(() => {
    let on = true;
    Promise.all([loadMonths(m, m), loadBudget()]).then(([months, b]) => {
      if (!on) return;
      const rows = months[m] || [];
      const cats = Object.entries(sumByCategory(rows)).sort((a, b) => b[1] - a[1]);
      setS({ spent: totals(rows).spent, budget: budgetTotal(b), top: cats[0], n: rows.length });
    }).catch(() => on && setS({ spent: 0, budget: 0, n: 0 }));
    return () => { on = false; };
  }, [m]);
  const left = daysInMonth(m) - new Date().getDate();

  return (
    <Link to={s && s.n === 0 ? '/money/import' : '/money'} style={{ textDecoration: 'none' }}>
      <Card>
        <div className="pl-row">
          <Wallet style={{ color: 'var(--accent)', width: 22, height: 22 }} />
          <div className="pl-grow">
            <p className="pl-eyebrow">Money</p>
            {!s ? <p className="pl-muted">Loading…</p> : s.n === 0 ? <b>Import this month's transactions</b> : (
              <b>{money(s.spent, { whole: true })} spent{s.budget ? ` of ${money(s.budget, { whole: true })}` : ''}</b>
            )}
            {s && s.n > 0 && <p className="pl-muted" style={{ fontSize: 13 }}>{s.top ? `Top: ${s.top[0]} ${money(s.top[1], { whole: true })} · ` : ''}{left} day{left === 1 ? '' : 's'} left</p>}
          </div>
          <ChevronRight style={{ color: 'var(--ink-2)' }} />
        </div>
        {s && s.budget > 0 && <div style={{ marginTop: 10 }}><Progress value={s.spent} max={s.budget} tone={s.spent > s.budget ? 'bad' : s.spent > s.budget * 0.8 ? 'amber' : 'good'} /></div>}
      </Card>
    </Link>
  );
}

// The Today card: cycle day, phase, next period, a two-week strip.
import { Link } from 'react-router-dom';
import { Heart, ChevronRight } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { useCycle } from './useCycle';
import { Strip } from './Calendar';
import { addDays, diffDays, fmtDay } from './dates';
import { PHASE_LABEL } from './predict';

export function CycleTodayCard(_: { pass: PlannerPass }) {
  const c = useCycle();
  const v = c.view;
  const inFertile = v.next ? c.todayKey >= v.next.fertileStart && c.todayKey <= v.next.fertileEnd : false;
  return (
    <section className="pl-card pl-stack" style={{ gap: 10 }}>
      <Link to="/cycle" className="pl-row" style={{ textDecoration: 'none' }}>
        <Heart aria-hidden style={{ color: 'var(--cy-pink)', width: 20, height: 20 }} />
        <div className="pl-grow">
          <p className="pl-eyebrow">Cycle</p>
          {c.loading ? <b>…</b> : !v.lastStart ? <b>Log your first period</b> : (
            <b>Day {v.day} · {v.phase ? PHASE_LABEL[v.phase] : ''}{v.late > 0 ? ` · ${v.late} day${v.late === 1 ? '' : 's'} late` : v.next ? ` · next period in ${diffDays(c.todayKey, v.next.start)} days` : ''}</b>
          )}
          {!c.loading && v.next && !v.inPeriod && <small className="pl-muted">{inFertile ? 'Fertile window — ' : ''}ovulation ~ {fmtDay(v.next.ovulation, { day: 'numeric', month: 'short' })}</small>}
        </div>
        <ChevronRight aria-hidden style={{ color: 'var(--ink-2)' }} />
      </Link>
      {!c.loading && v.lastStart && <Strip marks={c.marks} todayKey={c.todayKey} from={addDays(c.todayKey, -3)} />}
      <div className="pl-row">
        <Link to={`/cycle/log/${c.todayKey}`} className="pl-btn pl-btn--small">{v.inPeriod ? 'Log today' : v.late > 0 || (v.next && c.todayKey >= addDays(v.next.start, -2)) ? 'Log period' : 'Log today'}</Link>
      </div>
    </section>
  );
}

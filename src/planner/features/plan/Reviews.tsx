// src/planner/features/plan/Reviews.tsx — the weekly review (10 life areas, lessons) and the monthly
// review (deadlines, whole-life assessment, 30-day look back, 1- and 3-year goals).
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useDoc, useDocs } from '../../lib/useDoc';
import { Page, Header, Card, Button, Prompt, Score, Input, Bars, Stat } from '../../ui/primitives';
import { clock, hhmm, routineMin, routineNow } from '../../lib/routine';
import { lightsOutOnTime, monthKey, monthRange, shiftMonth, shiftWeek, weekDays, weekKey } from './dates';
import { dayAverage, emptyGoals, emptyMonth, emptyWeek, LIFE_AREAS, normalizeDay, type Day, type Goals, type LifeScores, type Month, type Week } from './types';

function Areas({ value, onChange }: { value: LifeScores; onChange: (v: LifeScores) => void }) {
  const set = Object.values(value).filter(n => typeof n === 'number') as number[];
  const avg = set.length ? Math.round((set.reduce((a, b) => a + b, 0) / set.length) * 10) / 10 : null;
  return (
    <div className="plan-areas">
      <p className="pl-muted" style={{ fontSize: 13 }}>Score each area of life 1–10: how was it this period, honestly?</p>
      {LIFE_AREAS.map(a => <Score key={a} label={a} max={10} value={value[a]} onChange={v => onChange({ ...value, [a]: v })} />)}
      {avg !== null && <div className="plan-avg"><b>{avg}</b><small>/ 10 across {set.length} area{set.length === 1 ? '' : 's'}</small></div>}
    </div>
  );
}

function StringList({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  return (
    <div className="pl-stack" style={{ gap: 8 }}>
      {items.map((s, i) => (
        <div key={i} className="plan-list-item">
          <Input className="pl-grow" placeholder={placeholder} value={s} onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="pl-btn pl-btn--ghost" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}><X /></button>
        </div>
      ))}
      <Button ghost small onClick={() => onChange([...items, ''])}><Plus /> Add</Button>
    </div>
  );
}

function useDayStats(from: string, to: string) {
  const { docs, loading } = useDocs<Day>('day', from, to);
  return useMemo(() => {
    const byKey: Record<string, Day> = {};
    docs.forEach(d => { byKey[d.key] = normalizeDay(d.data); });
    const days = Object.values(byKey);
    const avgs = days.map(d => dayAverage(d.scores)).filter((n): n is number => n !== null);
    const prioritiesDone = days.reduce((n, d) => n + d.priorities.filter(p => p.done).length, 0);
    const prioritiesSet = days.reduce((n, d) => n + d.priorities.filter(p => p.text.trim()).length, 0);
    const briefs = days.filter(d => !!d.brief.finishedAt).length;
    const r = routineNow();
    const lightsOut = days.filter(d => !!d.ticks.lightsOut);
    const lightsOnTime = lightsOut.filter(d => lightsOutOnTime(d, r)).length;
    const avgLightsOut = lightsOut.length ? hhmm(Math.round(lightsOut.reduce((a, d) => a + routineMin(d.ticks.lightsOut!), 0) / lightsOut.length) + 240) : null;
    const overall = avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10 : null;
    return { byKey, loading, overall, prioritiesDone, prioritiesSet, briefs, lightsOnTime, avgLightsOut, logged: days.length };
  }, [docs, loading]);
}

export function WeekReview() {
  const [anchor, setAnchor] = useState(() => new Date());
  const key = weekKey(anchor);
  const days = weekDays(anchor);
  const { data, update, save, loading } = useDoc<Week>('week', key, emptyWeek());
  const week = useMemo(() => ({ ...emptyWeek(), ...data, areas: data?.areas || {} }), [data]);
  const stats = useDayStats(days[0], days[6]);
  const isThisWeek = key === weekKey();
  const bars = days.map(k => dayAverage(stats.byKey[k]?.scores) ?? 0);
  const range = `${new Date(days[0]).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${new Date(days[6]).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;

  return (
    <Page>
      <Header eyebrow="Weekly review" title={isThisWeek ? 'This week' : key} back="/plan" save={save} />
      <div className="plan-strip">
        <button className="pl-btn pl-btn--ghost" aria-label="Previous week" onClick={() => setAnchor(a => shiftWeek(a, -1))}><ChevronLeft /></button>
        <div className="plan-strip__date"><b>{range}</b><small>{key}</small></div>
        <button className="pl-btn pl-btn--ghost" aria-label="Next week" onClick={() => setAnchor(a => shiftWeek(a, 1))}><ChevronRight /></button>
        {!isThisWeek && <Button small ghost onClick={() => setAnchor(new Date())}>Now</Button>}
      </div>

      <Card className="pl-stack">
        <h2>The week in numbers</h2>
        <div className="pl-stats">
          <Stat label="Avg score" value={stats.overall ?? '—'} sub="of 5" />
          <Stat label="Priorities" value={`${stats.prioritiesDone}/${stats.prioritiesSet}`} sub="done" tone={stats.prioritiesSet > 0 && stats.prioritiesDone === stats.prioritiesSet ? 'good' : undefined} />
          <Stat label={routineNow().profile === 'morning' ? 'Morning Briefs' : 'Bed Briefs'} value={`${stats.briefs}/7`} tone={stats.briefs >= 5 ? 'good' : undefined} />
          <Stat label={routineNow().profile === 'morning' ? 'In bed on time' : 'Lights out on time'} value={`${stats.lightsOnTime}/7`} sub={stats.avgLightsOut ? `avg ${clock(stats.avgLightsOut)}` : undefined} tone={stats.lightsOnTime >= 5 ? 'good' : undefined} />
        </div>
        <Bars values={bars} max={5} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} />
        {stats.logged === 0 && !stats.loading && <p className="pl-muted" style={{ fontSize: 13 }}>No day pages this week yet.</p>}
      </Card>

      {loading ? <p className="pl-muted">Loading…</p> : (
        <>
          <Card className="pl-stack"><h2>Life areas</h2><Areas value={week.areas} onChange={v => update({ areas: v })} /></Card>
          <Card className="pl-stack">
            <h2>Lessons</h2>
            <Prompt q="The biggest win this week…" value={week.win} onChange={v => update({ win: v })} />
            <Prompt q="Lessons I learned this week…" value={week.lessons} onChange={v => update({ lessons: v })} rows={3} />
            <Prompt q="What I'll do differently next week…" value={week.differently} onChange={v => update({ differently: v })} rows={3} />
          </Card>
        </>
      )}
    </Page>
  );
}

export function MonthReview() {
  const [anchor, setAnchor] = useState(() => new Date());
  const key = monthKey(anchor);
  const [from, to] = monthRange(anchor);
  const { data, update, save, loading } = useDoc<Month>('month', key, emptyMonth());
  const month = useMemo(() => ({ ...emptyMonth(), ...data, areas: data?.areas || {}, deadlines: Array.isArray(data?.deadlines) ? data.deadlines : [] }), [data]);
  const { data: goalsRaw, update: updateGoals, save: goalsSave } = useDoc<Goals>('prefs', 'goals', emptyGoals());
  const goals = useMemo(() => ({ oneYear: Array.isArray(goalsRaw?.oneYear) ? goalsRaw.oneYear : [], threeYear: Array.isArray(goalsRaw?.threeYear) ? goalsRaw.threeYear : [] }), [goalsRaw]);
  const stats = useDayStats(from, to);
  const isThisMonth = key === monthKey();
  const daysIn = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();

  return (
    <Page>
      <Header eyebrow="Monthly review" title={anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })} back="/plan" save={save === 'idle' ? goalsSave : save} />
      <div className="plan-strip">
        <button className="pl-btn pl-btn--ghost" aria-label="Previous month" onClick={() => setAnchor(a => shiftMonth(a, -1))}><ChevronLeft /></button>
        <div className="plan-strip__date"><b>{key}</b><small>{stats.logged} of {daysIn} days logged</small></div>
        <button className="pl-btn pl-btn--ghost" aria-label="Next month" onClick={() => setAnchor(a => shiftMonth(a, 1))}><ChevronRight /></button>
        {!isThisMonth && <Button small ghost onClick={() => setAnchor(new Date())}>Now</Button>}
      </div>

      <Card className="pl-stack">
        <h2>The month in numbers</h2>
        <div className="pl-stats">
          <Stat label="Avg score" value={stats.overall ?? '—'} sub="of 5" />
          <Stat label="Priorities" value={`${stats.prioritiesDone}/${stats.prioritiesSet}`} sub="done" />
          <Stat label={routineNow().profile === 'morning' ? 'Morning Briefs' : 'Bed Briefs'} value={stats.briefs} sub={`of ${daysIn}`} tone={stats.briefs >= daysIn * 0.7 ? 'good' : undefined} />
          <Stat label={routineNow().profile === 'morning' ? 'In bed on time' : 'Lights out on time'} value={stats.lightsOnTime} sub={stats.avgLightsOut ? `avg ${clock(stats.avgLightsOut)}` : `of ${daysIn}`} tone={stats.lightsOnTime >= daysIn * 0.7 ? 'good' : undefined} />
        </div>
      </Card>

      {loading ? <p className="pl-muted">Loading…</p> : (
        <>
          <Card className="pl-stack">
            <h2>Ahead this month</h2>
            <p className="pl-muted" style={{ fontSize: 13 }}>Major projects, events and deadlines — so nothing sneaks up.</p>
            <StringList items={month.deadlines} onChange={v => update({ deadlines: v })} placeholder="Project, event or deadline" />
          </Card>
          <Card className="pl-stack"><h2>Whole-life assessment</h2><Areas value={month.areas} onChange={v => update({ areas: v })} /></Card>
          <Card className="pl-stack">
            <h2>The last 30 days</h2>
            <Prompt q="What went well…" value={month.wentWell} onChange={v => update({ wentWell: v })} rows={3} />
            <Prompt q="What didn't, and what I'll change…" value={month.didnt} onChange={v => update({ didnt: v })} rows={3} />
          </Card>
          <Card className="pl-stack">
            <h2>Long-term goals</h2>
            <p className="pl-muted" style={{ fontSize: 13 }}>Kept across months. Do this month's projects move these forward?</p>
            <p className="pl-label">1-year goals</p>
            <StringList items={goals.oneYear} onChange={v => updateGoals({ ...goals, oneYear: v })} placeholder="By this time next year…" />
            <p className="pl-label">3-year goals</p>
            <StringList items={goals.threeYear} onChange={v => updateGoals({ ...goals, threeYear: v })} placeholder="In three years…" />
          </Card>
        </>
      )}
    </Page>
  );
}

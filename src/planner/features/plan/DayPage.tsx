// src/planner/features/plan/DayPage.tsx — one day: the Bed Brief summary, the to-do list, and the Miracle
// Night summary. Any date; today links into the brief and the night.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, Sparkles, CalendarDays, CalendarRange, Sunrise, Moon } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { reflect } from '../../lib/ai';
import { clock, routineNow } from '../../lib/routine';
import { Page, Header, Button, Prompt, Score, Input, useToast } from '../../ui/primitives';
import { Section } from './Section';
import { addDays, fmtDate, isValidDay } from './dates';
import { dayAverage, emptyDay, normalizeDay, SCORE_KEYS, type Day } from './types';
import { TodoList } from './TodoList';
import { useFrequentTodos } from './useFrequentTodos';

const filled = (...v: string[]) => v.filter(s => s.trim()).length;

export function DayPage() {
  const { date } = useParams();
  const nav = useNavigate();
  const key = isValidDay(date) ? date : dayKey();
  const morningP = routineNow().profile === 'morning';
  const isToday = key === dayKey();
  const { data, update, loading, loadError, save } = useDoc<Day>('day', key, emptyDay());
  const frequent = useFrequentTodos();
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  const [toast, showToast] = useToast();
  const [thinking, setThinking] = useState(false);

  const avg = dayAverage(day.scores);
  const prioDone = day.priorities.filter(p => p.done).length;
  const prioSet = day.priorities.filter(p => p.text.trim()).length;
  const briefN = filled(day.brief.word, day.brief.aGame, day.brief.stress, day.brief.excited) + (prioSet ? 1 : 0);
  const reviewN = filled(day.night.review.win, day.night.review.drag, day.night.review.tomorrow);
  const t = day.ticks;

  const coachNote = async () => {
    setThinking(true);
    try {
      const reply = await reflect({ date: key, brief: day.brief, priorities: day.priorities, ticks: day.ticks, night: day.night, scores: day.scores, projects: day.projects, people: day.people });
      set(d => ({ ...d, reflection: reply }));
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't reach Coach Claude", 'bad'); }
    finally { setThinking(false); }
  };

  return (
    <Page>
      <Header eyebrow="Daily page" title={isToday ? 'Today' : fmtDate(key, { weekday: 'long' })} save={save}
        right={<div className="pl-row" style={{ gap: 4 }}>
          <Link to="/plan/week" className="pl-btn pl-btn--ghost" aria-label="Week review" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><CalendarDays /></Link>
          <Link to="/plan/month" className="pl-btn pl-btn--ghost" aria-label="Month review" style={{ minHeight: 40, padding: '0 8px', border: 0 }}><CalendarRange /></Link>
        </div>} />

      <div className="plan-strip">
        <button className="pl-btn pl-btn--ghost" aria-label="Previous day" onClick={() => nav(`/plan/${addDays(key, -1)}`)}><ChevronLeft /></button>
        <div className="plan-strip__date">
          <b>{fmtDate(key, { month: 'long', day: 'numeric' })}</b>
          <small>{isToday ? 'Today' : fmtDate(key, { weekday: 'long', year: 'numeric' })}</small>
        </div>
        <button className="pl-btn pl-btn--ghost" aria-label="Next day" onClick={() => nav(`/plan/${addDays(key, 1)}`)}><ChevronRight /></button>
        {!isToday && <Button small ghost onClick={() => nav('/plan')}>Today</Button>}
      </div>

      {loadError && <p className="pl-error" style={{ fontSize: 13 }}>Couldn't load this day — check the connection. Nothing typed is saved until it loads.</p>}
      {loading ? <p className="pl-muted">Loading…</p> : (
        <>
          {/* ── Bed Brief ── */}
          <Section title={<span className="pl-row" style={{ gap: 8 }}><Sunrise aria-hidden style={{ width: 20, height: 20, color: 'var(--amber-2)' }} /> {morningP ? 'Morning Brief' : 'Bed Brief'}</span>}
            meta={day.brief.finishedAt ? `done${day.brief.seconds ? ` in ${Math.round(day.brief.seconds / 60)} min` : ''}` : `${briefN}/5`} done={!!day.brief.finishedAt}>
            {t.up && <p className="pl-muted" style={{ fontSize: 13 }}>Up at {clock(t.up)}{t.daycare ? ` · daycare ${clock(t.daycare)}` : ''}</p>}
            <div className="plan-brief-grid">
              <div><span className="pl-label">One word</span><b className="plan-brief-word">{day.brief.word.trim() || '—'}</b></div>
              <div><span className="pl-label">A-game for</span><p>{day.brief.aGame.trim() || '—'}</p></div>
              <div><span className="pl-label">Might stress me</span><p>{day.brief.stress.trim() || '—'}{day.brief.stressResponse.trim() ? <><br /><span className="pl-muted">→ {day.brief.stressResponse}</span></> : null}</p></div>
              <div><span className="pl-label">Looking forward to</span><p>{day.brief.excited.trim() || '—'}</p></div>
            </div>
            <p className="pl-label" style={{ marginTop: 4 }}>Must get done · {prioSet ? `${prioDone}/${prioSet}` : 'not set'}</p>
            {day.priorities.map((p, i) => (
              <div key={i} className={`plan-priority ${p.done ? 'is-done' : ''}`}>
                <b>{i + 1}</b>
                <Input className="pl-grow" placeholder="Must do" value={p.text} onChange={e => set(d => ({ ...d, priorities: d.priorities.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))} />
                <button type="button" className={`pl-check ${p.done ? 'is-on' : ''}`} aria-label={p.done ? 'Mark not done' : 'Mark done'} onClick={() => set(d => ({ ...d, priorities: d.priorities.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }))}><Check /></button>
              </div>
            ))}
            {isToday && <Link to="/plan/brief" className="pl-btn pl-btn--small">{day.brief.finishedAt ? 'Edit brief' : morningP ? 'Do the Morning Brief' : 'Do the Bed Brief'}</Link>}
          </Section>

          {/* ── Today's list ── */}
          <Section title="The list" meta={day.todos.length ? `${day.todos.filter(t => t.done).length}/${day.todos.length}` : 'from the Brief'} done={day.todos.length > 0 && day.todos.every(t => t.done)}>
            <p className="pl-muted" style={{ fontSize: 13 }}>Brief to dinner, in the order you'll tackle it — move items with the arrows; a time beside one is a reminder. Coach Claude drafts it at the end of the Brief; the three priorities are always on it.</p>
            <TodoList day={day} set={set} suggestions={frequent} />
          </Section>


          {/* ── Miracle Night ── */}
          <Section title={<span className="pl-row" style={{ gap: 8 }}><Moon aria-hidden style={{ width: 20, height: 20, color: 'var(--accent)' }} /> {morningP ? 'Evening' : 'Miracle Night'}</span>}
            meta={t.lightsOut ? `${morningP ? 'in bed' : 'lights out'} ${clock(t.lightsOut)}` : avg !== null ? `avg ${avg}` : `${reviewN}/3`} done={!!t.lightsOut} open={!isToday || new Date().getHours() >= (morningP ? 19 : 21) || new Date().getHours() < 4}>
            <p className="pl-muted" style={{ fontSize: 13 }}>
              {[t.dinner && `dinner ${clock(t.dinner)}`, t.gym && `gym ${clock(t.gym)}`, t.shake && `shake ${clock(t.shake)}`].filter(Boolean).join(' · ') || 'Dinner, gym and shake get ticked on the Today screen.'}
            </p>
            <Prompt q="Win of the day" value={day.night.review.win} onChange={v => set(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, win: v } } }))} rows={1} />
            <Prompt q="What dragged" value={day.night.review.drag} onChange={v => set(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, drag: v } } }))} rows={1} />
            <Prompt q="One change for tomorrow" value={day.night.review.tomorrow} onChange={v => set(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, tomorrow: v } } }))} rows={1} />
            {day.night.tomorrowTop && <p className="pl-muted" style={{ fontSize: 13 }}>Tomorrow's #1: <b>{day.night.tomorrowTop}</b></p>}
            <hr className="pl-divider" />
            <p className="pl-label">Scorecard, 1–5</p>
            {SCORE_KEYS.map(s => (
              <Score key={s.key} label={<span>{s.label} <span className="pl-muted" style={{ fontWeight: 400 }}>— {s.hint}</span></span>} value={day.scores[s.key]} onChange={v => set(d => ({ ...d, scores: { ...d.scores, [s.key]: v } }))} />
            ))}
            {avg !== null && <div className="plan-avg"><b>{avg}</b><small>/ 5</small></div>}
            {day.reflection && <blockquote className="plan-quote">{day.reflection}</blockquote>}
            <div className="pl-row" style={{ flexWrap: 'wrap' }}>
              <Button onClick={coachNote} disabled={thinking}><Sparkles /> {thinking ? 'Thinking…' : day.reflection ? "Another note from Coach Claude" : "Coach Claude on this day"}</Button>
              {isToday && <Link to="/plan/night" className="pl-btn pl-btn--primary">{morningP ? 'Open the evening wind-down' : 'Open Miracle Night'}</Link>}
            </div>
          </Section>
        </>
      )}
      {toast}
    </Page>
  );
}

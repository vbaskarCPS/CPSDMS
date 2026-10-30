// src/planner/features/plan/DayPage.tsx — one day: Victory Hour, morning mindset, projects, people,
// priorities, schedule, evening review and the scorecard (High Performance Planner + 5 AM Club).
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, Plus, X, Dumbbell, Brain, BookOpen, Sparkles, Timer, CalendarDays, CalendarRange } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { reflect } from '../../lib/ai';
import { Page, Header, Button, Prompt, Score, Chip, Input, useToast } from '../../ui/primitives';
import { Section } from './Section';
import { addDays, fmtDate, isValidDay } from './dates';
import { dayAverage, emptyDay, normalizeDay, SCORE_KEYS, type Day, type Savers } from './types';

const MORNING: { key: keyof Day['morning']; q: string }[] = [
  { key: 'excited', q: 'One thing I can get excited about today…' },
  { key: 'word', q: 'If one word could describe the kind of person I want to be today, it would be…' },
  { key: 'aGame', q: 'Someone who needs me on my A-game today…' },
  { key: 'stress', q: 'A situation that might stress me today…' },
  { key: 'stressResponse', q: '…and how my best self would respond to it…' },
  { key: 'appreciate', q: 'Someone I could surprise with a note, gift or sign of appreciation…' },
  { key: 'progress', q: 'One action I could take today to demonstrate excellence or real progress…' },
];
const EVENING: { key: keyof Day['evening']; q: string }[] = [
  { key: 'appreciated', q: 'A moment I really appreciated today…' },
  { key: 'handledWell', q: 'A situation or task I handled well…' },
  { key: 'learned', q: 'Something I realized or learned…' },
  { key: 'better', q: 'I could have made today even better if…' },
  { key: 'connected', q: 'Something that could have helped me feel more connected to others…' },
  { key: 'coachNote', q: "If I was my own high-performance coach, I'd tell myself…" },
];
const SAVERS: { key: keyof Savers; label: string }[] = [
  { key: 'silence', label: 'Silence' }, { key: 'affirmations', label: 'Affirmations' }, { key: 'visualization', label: 'Visualization' },
  { key: 'exercise', label: 'Exercise' }, { key: 'reading', label: 'Reading' }, { key: 'scribing', label: 'Scribing' },
];

const filled = (...v: string[]) => v.filter(s => s.trim()).length;

export function DayPage() {
  const { date } = useParams();
  const nav = useNavigate();
  const key = isValidDay(date) ? date : dayKey();
  const isToday = key === dayKey();
  const hour = new Date().getHours();
  const { data, update, loading, save } = useDoc<Day>('day', key, emptyDay());
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  const [toast, showToast] = useToast();
  const [thinking, setThinking] = useState(false);

  const avg = dayAverage(day.scores);
  const prioDone = day.priorities.filter(p => p.done).length;
  const prioSet = day.priorities.filter(p => p.text.trim()).length;
  const morningN = filled(...MORNING.map(m => day.morning[m.key]));
  const eveningN = filled(...EVENING.map(e => day.evening[e.key]));
  const victoryN = [day.victory.move, day.victory.reflect, day.victory.grow].filter(Boolean).length;
  const isEvening = !isToday || hour >= 17;

  const coachNote = async () => {
    setThinking(true);
    try {
      const reply = await reflect({ date: key, ...day });
      set(d => ({ ...d, reflection: reply }));
    } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't reach the coach", 'bad'); }
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

      {loading ? <p className="pl-muted">Loading…</p> : (
        <>
          {/* ── Victory Hour ── */}
          <Section title="Victory hour" meta={`${victoryN}/3`} done={victoryN === 3} open={!isEvening}>
            <div className="pl-row">
              <label className="pl-field pl-grow"><span className="pl-label">Woke at</span>
                <Input type="time" value={day.victory.wokeAt || ''} onChange={e => set(d => ({ ...d, victory: { ...d.victory, wokeAt: e.target.value || undefined } }))} /></label>
              {isToday && <Link to="/plan/victory" className="pl-btn pl-btn--primary" style={{ alignSelf: 'flex-end', whiteSpace: 'nowrap' }}><Timer /> Start timer</Link>}
            </div>
            <div className="plan-blocks">
              {([['move', 'Move', Dumbbell], ['reflect', 'Reflect', Brain], ['grow', 'Grow', BookOpen]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" className={`plan-block ${day.victory[k] ? 'is-on' : ''}`} aria-pressed={day.victory[k]}
                  onClick={() => set(d => ({ ...d, victory: { ...d.victory, [k]: !d.victory[k] } }))}><Icon aria-hidden />{label}</button>
              ))}
            </div>
            <div>
              <p className="pl-label" style={{ marginBottom: 8 }}>SAVERS</p>
              <div className="pl-chips">
                {SAVERS.map(s => <Chip key={s.key} on={day.victory.savers[s.key]} onClick={() => set(d => ({ ...d, victory: { ...d.victory, savers: { ...d.victory.savers, [s.key]: !d.victory.savers[s.key] } } }))}>{s.label}</Chip>)}
              </div>
            </div>
          </Section>

          {/* ── Morning mindset ── */}
          <Section title="Morning mindset" meta={`${morningN}/${MORNING.length}`} done={morningN === MORNING.length} open={!isEvening}>
            {MORNING.map(m => <Prompt key={m.key} q={m.q} value={day.morning[m.key]} onChange={v => set(d => ({ ...d, morning: { ...d.morning, [m.key]: v } }))} />)}
          </Section>

          {/* ── Projects ── */}
          <Section title="Projects" meta={`${day.projects.filter(p => p.name.trim()).length}/3`} open={!isEvening}>
            <p className="pl-muted" style={{ fontSize: 13 }}>The three projects that matter most right now, and the next three steps on each.</p>
            {day.projects.map((p, i) => (
              <div key={i} className="plan-project">
                <Input className="plan-project__name" placeholder={`Project ${i + 1}`} value={p.name} onChange={e => set(d => { const projects = d.projects.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)); return { ...d, projects }; })} />
                <div className="plan-project__steps">
                  {p.steps.map((s, j) => (
                    <div key={j} className="plan-project__step"><span>{j + 1}</span>
                      <Input placeholder="Next step" value={s} onChange={e => set(d => { const projects = d.projects.map((x, k) => { if (k !== i) return x; const steps = [...x.steps] as [string, string, string]; steps[j] = e.target.value; return { ...x, steps }; }); return { ...d, projects }; })} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Section>

          {/* ── People ── */}
          <Section title="People" meta={filled(day.people.connect, day.people.lead) ? '✓' : undefined} open={!isEvening}>
            <Prompt q="Someone I need to connect with or reach out to today…" value={day.people.connect} onChange={v => set(d => ({ ...d, people: { ...d.people, connect: v } }))} rows={1} />
            <Prompt q="Someone I need to lead or serve well today…" value={day.people.lead} onChange={v => set(d => ({ ...d, people: { ...d.people, lead: v } }))} rows={1} />
          </Section>

          {/* ── Priorities ── */}
          <Section title="Priorities" meta={prioSet ? `${prioDone}/${prioSet} done` : undefined} done={prioSet > 0 && prioDone === prioSet}>
            <p className="pl-muted" style={{ fontSize: 13 }}>Three things that must get done today, no matter what.</p>
            {day.priorities.map((p, i) => (
              <div key={i} className={`plan-priority ${p.done ? 'is-done' : ''}`}>
                <b>{i + 1}</b>
                <Input className="pl-grow" placeholder="Must do" value={p.text} onChange={e => set(d => ({ ...d, priorities: d.priorities.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))} />
                <button type="button" className={`pl-check ${p.done ? 'is-on' : ''}`} aria-label={p.done ? 'Mark not done' : 'Mark done'} onClick={() => set(d => ({ ...d, priorities: d.priorities.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }))}><Check /></button>
              </div>
            ))}
          </Section>

          {/* ── Schedule ── */}
          <Section title="Schedule" meta={day.schedule.length ? `${day.schedule.length} blocks` : undefined} open={false}>
            {day.schedule.length === 0 && <p className="pl-muted" style={{ fontSize: 13 }}>Block the day: when will the priorities happen?</p>}
            {day.schedule.map((s, i) => (
              <div key={i} className="plan-slot">
                <Input type="time" value={s.time} onChange={e => set(d => ({ ...d, schedule: d.schedule.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)).sort((a, b) => a.time.localeCompare(b.time)) }))} />
                <Input className="pl-grow" placeholder="What" value={s.text} onChange={e => set(d => ({ ...d, schedule: d.schedule.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))} />
                <button type="button" className="pl-btn pl-btn--ghost" aria-label="Remove" onClick={() => set(d => ({ ...d, schedule: d.schedule.filter((_, j) => j !== i) }))}><X /></button>
              </div>
            ))}
            <Button ghost onClick={() => set(d => { const last = d.schedule[d.schedule.length - 1]; const [h] = (last?.time || '08:00').split(':').map(Number); const time = `${String(Math.min(23, (h || 8) + 1)).padStart(2, '0')}:00`; return { ...d, schedule: [...d.schedule, { time, text: '' }] }; })}><Plus /> Add block</Button>
          </Section>

          {/* ── Evening review ── */}
          <Section title="Evening review" meta={`${eveningN}/${EVENING.length}`} done={eveningN === EVENING.length} open={isEvening}>
            {EVENING.map(e => <Prompt key={e.key} q={e.q} value={day.evening[e.key]} onChange={v => set(d => ({ ...d, evening: { ...d.evening, [e.key]: v } }))} />)}
          </Section>

          {/* ── Scorecard ── */}
          <Section title="Scorecard" meta={avg !== null ? `avg ${avg}` : undefined} done={avg !== null && Object.keys(day.scores).length === 6} open={isEvening}>
            <p className="pl-muted" style={{ fontSize: 13 }}>Rate the six high-performance habits, 1–5.</p>
            {SCORE_KEYS.map(s => (
              <Score key={s.key} label={<span>{s.label} <span className="pl-muted" style={{ fontWeight: 400 }}>— {s.hint}</span></span>} value={day.scores[s.key]} onChange={v => set(d => ({ ...d, scores: { ...d.scores, [s.key]: v } }))} />
            ))}
            {avg !== null && <div className="plan-avg"><b>{avg}</b><small>/ 5 today</small></div>}
            <hr className="pl-divider" />
            {day.reflection && <blockquote className="plan-quote">{day.reflection}</blockquote>}
            <Button onClick={coachNote} disabled={thinking}><Sparkles /> {thinking ? 'Thinking…' : day.reflection ? "Another coach's note" : "Coach's note on today"}</Button>
          </Section>
        </>
      )}
      {toast}
    </Page>
  );
}

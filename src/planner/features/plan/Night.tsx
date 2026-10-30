// src/planner/features/plan/Night.tsx — Miracle Night: shake → unwind (capped) → quick review and
// scorecard → tomorrow's #1 → lights out. A countdown to lights out sits at the top. Nothing blocks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Moon, Gamepad2, Sparkles, Play, Square, CupSoda } from 'lucide-react';
import { dayKey, getDoc, putDoc } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { reflect } from '../../lib/ai';
import { clock, loadRoutine, routineMin, routineMinutes, routineNow, type Routine } from '../../lib/routine';
import { Page, Header, Card, Button, Prompt, Score, Input, useToast } from '../../ui/primitives';
import { addDays, nowHM, sleepEstimate } from './dates';
import { beep } from './sound';
import { dayAverage, emptyDay, normalizeDay, SCORE_KEYS, type Day } from './types';

const fmtLeft = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`);
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Night() {
  const today = dayKey();
  const { data, update, loading, save, flush } = useDoc<Day>('day', today, emptyDay(), 500);
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [now, setNow] = useState(() => Date.now());
  const [thinking, setThinking] = useState(false);
  const [toast, say] = useToast();
  const capHit = useRef(false);

  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  // countdown to lights out, on the routine scale (so 1:00 am is "later" than 11 pm)
  const left = routineMin(routine.lightsOut) - routineMinutes(new Date(now));
  const unwinding = !!day.night.unwindStart && !day.night.unwindEnd;
  const unwindSec = day.night.unwindStart ? Math.floor(((day.night.unwindEnd ? new Date(day.night.unwindEnd).getTime() : now) - new Date(day.night.unwindStart).getTime()) / 1000) : 0;
  const capSec = routine.unwindCap * 60;
  const overCap = capSec > 0 && unwindSec >= capSec;
  useEffect(() => {
    if (unwinding && overCap && !capHit.current) { capHit.current = true; beep(); }
    if (!unwinding) capHit.current = false;
  }, [unwinding, overCap]);

  const avg = dayAverage(day.scores);
  const reviewN = Object.values(day.night.review).filter(v => v.trim()).length;
  const prioDone = day.priorities.filter(p => p.done).length;
  const prioSet = day.priorities.filter(p => p.text.trim()).length;

  const coachNote = async () => {
    setThinking(true);
    try {
      const reply = await reflect({ date: today, brief: day.brief, priorities: day.priorities, ticks: day.ticks, night: day.night, scores: day.scores, routine });
      set(d => ({ ...d, reflection: reply }));
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't reach the coach", 'bad'); }
    finally { setThinking(false); }
  };

  const saveTomorrowTop = async (text: string) => {
    set(d => ({ ...d, night: { ...d.night, tomorrowTop: text } }));
    const tKey = addDays(today, 1);
    try {
      const t = normalizeDay(await getDoc<Day>('day', tKey));
      if (!t.priorities[0].text.trim() || t.priorities[0].text === day.night.tomorrowTop) {
        t.priorities[0] = { text, done: false };
        await putDoc('day', tKey, t);
      }
    } catch { /* tomorrow's page can be set by hand */ }
  };

  const lightsOut = async () => {
    set(d => ({ ...d, ticks: { ...d.ticks, lightsOut: nowHM() } }));
    await flush();
  };

  const done = !!day.ticks.lightsOut;

  return (
    <Page>
      <Header eyebrow="Miracle Night" title={done ? 'Good night.' : 'Wind down'} back="/" save={save} />

      <Card accent className="night-top">
        <Moon aria-hidden />
        <div>
          <p className="pl-eyebrow">Lights out {clock(routine.lightsOut)}</p>
          <b className="night-top__big">{done ? `In bed ${clock(day.ticks.lightsOut!)}` : left > 0 ? `${fmtLeft(left)} left` : `${fmtLeft(-left)} past`}</b>
          <small>{done ? `≈ ${sleepEstimate(day.ticks.lightsOut!, routine.wake)} until ${clock(routine.wake)}` : 'shake · unwind · review · tomorrow\'s #1'}</small>
        </div>
      </Card>

      {loading ? <p className="pl-muted">Loading…</p> : (
        <>
          {/* 1 · shake */}
          <Card className={`night-stage ${day.ticks.shake ? 'is-done' : ''}`}>
            <button type="button" className={`pl-check ${day.ticks.shake ? 'is-on' : ''}`} aria-label="Shake done" onClick={() => set(d => ({ ...d, ticks: { ...d.ticks, shake: d.ticks.shake ? undefined : nowHM() } }))}><Check /></button>
            <div className="pl-grow"><b><CupSoda aria-hidden /> Protein shake</b><small>{day.ticks.shake ? `${clock(day.ticks.shake)} · eating window closed` : 'closes the eating window'}</small></div>
            <Link to="/food/add" className="pl-btn pl-btn--small pl-btn--ghost">Log</Link>
          </Card>

          {/* 2 · unwind */}
          <Card className={`night-stage night-stage--col ${day.night.unwindEnd ? 'is-done' : ''}`}>
            <div className="pl-row">
              <div className="pl-grow"><b><Gamepad2 aria-hidden /> Unwind</b><small>{routine.unwindCap ? `games, show, whatever — ${routine.unwindCap} min, then the review` : 'games, show, whatever — then the review'}</small></div>
              {!day.night.unwindStart && <Button small primary onClick={() => set(d => ({ ...d, night: { ...d.night, unwindStart: new Date().toISOString() } }))}><Play /> Start</Button>}
              {unwinding && <Button small onClick={() => set(d => ({ ...d, night: { ...d.night, unwindEnd: new Date().toISOString() } }))}><Square /> Done</Button>}
            </div>
            {day.night.unwindStart && (
              <div className={`night-unwind ${overCap ? 'is-over' : ''}`}>
                <span className="night-unwind__time">{fmtSec(unwindSec)}</span>
                <span className="pl-muted">{capSec ? (overCap ? `${fmtSec(unwindSec - capSec)} over the ${routine.unwindCap} min` : `of ${routine.unwindCap} min`) : 'no cap'}{day.night.unwindEnd ? ' · done' : ''}</span>
              </div>
            )}
          </Card>

          {/* 3 · review */}
          <Card className={`pl-stack ${reviewN === 3 && avg !== null ? 'night-done' : ''}`}>
            <h2>Review <span className="pl-muted" style={{ fontSize: 13, fontWeight: 500 }}>{reviewN}/3 · {prioSet ? `${prioDone}/${prioSet} priorities done` : 'no priorities set'}</span></h2>
            <Prompt q="Win of the day" value={day.night.review.win} onChange={v => set(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, win: v } } }))} rows={1} />
            <Prompt q="What dragged" value={day.night.review.drag} onChange={v => set(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, drag: v } } }))} rows={1} />
            <Prompt q="One change for tomorrow" value={day.night.review.tomorrow} onChange={v => set(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, tomorrow: v } } }))} rows={1} />
            <hr className="pl-divider" />
            <p className="pl-label">Scorecard, 1–5</p>
            {SCORE_KEYS.map(s => (
              <Score key={s.key} label={<span>{s.label} <span className="pl-muted" style={{ fontWeight: 400 }}>— {s.hint}</span></span>} value={day.scores[s.key]} onChange={v => set(d => ({ ...d, scores: { ...d.scores, [s.key]: v } }))} />
            ))}
            {avg !== null && <div className="plan-avg"><b>{avg}</b><small>/ 5 today</small></div>}
            {day.reflection && <blockquote className="plan-quote">{day.reflection}</blockquote>}
            <Button onClick={coachNote} disabled={thinking}><Sparkles /> {thinking ? 'Thinking…' : day.reflection ? "Another coach's note" : "Coach's note on today"}</Button>
          </Card>

          {/* 4 · tomorrow */}
          <Card className="pl-stack">
            <h2>Tomorrow's #1</h2>
            <p className="pl-muted" style={{ fontSize: 13 }}>The one thing that makes tomorrow a win. It'll be waiting in tomorrow's Bed Brief.</p>
            <Input placeholder="Tomorrow I will…" value={day.night.tomorrowTop || ''} onChange={e => set(d => ({ ...d, night: { ...d.night, tomorrowTop: e.target.value } }))} onBlur={e => { if (e.target.value.trim()) void saveTomorrowTop(e.target.value.trim()); }} />
          </Card>

          {/* 5 · lights out */}
          {!done
            ? <Button primary block onClick={lightsOut} style={{ minHeight: 60, fontSize: 18 }}><Moon /> Lights out</Button>
            : <Card className="night-goodnight"><Moon aria-hidden /><div><b>Good night.</b><small>Lights out {clock(day.ticks.lightsOut!)} · up {clock(routine.wake)} with Kiaan · ≈ {sleepEstimate(day.ticks.lightsOut!, routine.wake)} sleep</small></div>
                <Button small ghost onClick={() => set(d => ({ ...d, ticks: { ...d.ticks, lightsOut: undefined } }))}>Undo</Button></Card>}
        </>
      )}
      {toast}
    </Page>
  );
}

// src/planner/features/plan/Night.tsx — Miracle Night (night profile): sauna → day review and scorecard →
// tomorrow's #1 → unwind (capped) → lights out. The shake is ticked from Today / logged in Food. Morning profile: unwind → review → #1 → in bed. A countdown to lights out sits at the top. Nothing blocks.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Moon, Gamepad2, Sparkles, Play, Square, Flame } from 'lucide-react';
import { dayKey, getDoc, putDoc } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { reflect } from '../../lib/ai';
import { clock, loadRoutine, routineMin, routineMinutes, routineNow, type Routine } from '../../lib/routine';
import { Page, Header, Card, Button, Prompt, Score, Input, useToast } from '../../ui/primitives';
import { addDays, nowHM, sleepEstimate } from './dates';
import { beep } from './sound';
import { autoMark } from '../habits/auto';
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
  const done = !!day.ticks.lightsOut;
  const morningP = routine.profile === 'morning';
  // night profile: a hard stop for the unwind, with an alarm when it lands (the push reminder covers a closed app)
  const stopIn = routineMin(routine.windDown) - routineMinutes(new Date(now));
  const stopHit = useRef(false);
  useEffect(() => { if (!morningP && !done && stopIn <= 0 && stopIn > -5 && !stopHit.current) { stopHit.current = true; beep(); window.setTimeout(beep, 1500); window.setTimeout(beep, 3000); } }, [stopIn, morningP, done]);
  const saunaLeft = day.night.saunaStart ? routine.saunaMin * 60 - Math.floor((now - new Date(day.night.saunaStart).getTime()) / 1000) : 0;
  const saunaHit = useRef(false);
  useEffect(() => { if (day.night.saunaStart && !day.ticks.sauna && saunaLeft <= 0 && !saunaHit.current) { saunaHit.current = true; beep(); } }, [saunaLeft, day.night.saunaStart, day.ticks.sauna]);
  const overCap = capSec > 0 && unwindSec >= capSec;
  useEffect(() => {
    if (unwinding && overCap && !capHit.current) { capHit.current = true; beep(); }
    if (!unwinding) capHit.current = false;
  }, [unwinding, overCap]);

  const avg = dayAverage(day.scores);
  const reviewN = Object.values(day.night.review).filter(v => v.trim()).length;
  const reviewWas = useRef<boolean | null>(null);
  useEffect(() => { if (loading) return; const full = reviewN === 3; if (reviewWas.current !== null && reviewWas.current !== full) void autoMark('review', full); reviewWas.current = full; }, [reviewN, loading]);
  const prioDone = day.priorities.filter(p => p.done).length;
  const prioSet = day.priorities.filter(p => p.text.trim()).length;

  const coachNote = async () => {
    setThinking(true);
    try {
      const reply = await reflect({ date: today, brief: day.brief, priorities: day.priorities, ticks: day.ticks, night: day.night, scores: day.scores, routine });
      set(d => ({ ...d, reflection: reply }));
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't reach Coach Claude", 'bad'); }
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
    void autoMark('lightsOut', true);
    await flush();
  };

  const bedWord = morningP ? 'In bed' : 'Lights out';

  return (
    <Page>
      <Header eyebrow={morningP ? 'Evening wind-down' : 'Miracle Night'} title={done ? 'Good night.' : 'Wind down'} back="/" save={save} />

      <Card accent className="night-top">
        <Moon aria-hidden />
        <div>
          <p className="pl-eyebrow">{bedWord} {clock(routine.lightsOut)}</p>
          <b className="night-top__big">{done ? `In bed ${clock(day.ticks.lightsOut!)}` : left > 0 ? `${fmtLeft(left)} left` : `${fmtLeft(-left)} past`}</b>
          <small>{done ? `≈ ${sleepEstimate(day.ticks.lightsOut!, routine.wake)} until ${clock(routine.wake)}` : morningP ? 'unwind · review · tomorrow\'s #1 · bed with Kiaan' : 'sauna · day review · unwind'}</small>
        </div>
      </Card>

      {loading ? <p className="pl-muted">Loading…</p> : (
        <>
          {morningP ? (<>
          {/* morning: unwind → review → tomorrow's #1 → in bed */}

          <Card className={`night-stage night-stage--col ${day.night.unwindEnd ? 'is-done' : ''}`}>
            <div className="pl-row">
              <div className="pl-grow"><b><Gamepad2 aria-hidden /> Unwind</b><small>{routine.unwindCap ? `games, show, whatever — ${routine.unwindCap} min${morningP ? ', then the review' : ', then lights out'}` : morningP ? 'games, show, whatever — then the review' : 'games, show, whatever — then lights out'}</small></div>
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
            <Button onClick={coachNote} disabled={thinking}><Sparkles /> {thinking ? 'Thinking…' : day.reflection ? "Another note from Coach Claude" : "Coach Claude on today"}</Button>
          </Card>

          <Card className="pl-stack">
            <h2>Tomorrow's #1</h2>
            <p className="pl-muted" style={{ fontSize: 13 }}>The one thing that makes tomorrow a win. It'll be waiting in tomorrow's {morningP ? 'Morning' : 'Bed'} Brief.</p>
            <Input placeholder="Tomorrow I will…" value={day.night.tomorrowTop || ''} onChange={e => set(d => ({ ...d, night: { ...d.night, tomorrowTop: e.target.value } }))} onBlur={e => { if (e.target.value.trim()) void saveTomorrowTop(e.target.value.trim()); }} />
          </Card>

          {!done
            ? <Button primary block onClick={lightsOut} style={{ minHeight: 60, fontSize: 18 }}><Moon /> {morningP ? 'In bed with Kiaan' : 'Lights out'}</Button>
            : <Card className="night-goodnight"><Moon aria-hidden /><div><b>Good night.</b><small>{bedWord} {clock(day.ticks.lightsOut!)} · up {clock(routine.wake)}{morningP ? '' : ' with Kiaan'} · ≈ {sleepEstimate(day.ticks.lightsOut!, routine.wake)} sleep</small></div>
                <Button small ghost onClick={() => { set(d => ({ ...d, ticks: { ...d.ticks, lightsOut: undefined } })); void autoMark('lightsOut', false); }}>Undo</Button></Card>}
          </>) : (<>
          {/* night: sauna → day review → tomorrow's #1 → unwind → lights out (the shake lives on Today) */}

          {routine.saunaMin > 0 && (
          <Card className={`night-stage night-stage--col ${day.ticks.sauna ? 'is-done' : ''}`}>
            <div className="pl-row">
              <button type="button" className={`pl-check ${day.ticks.sauna ? 'is-on' : ''}`} aria-label="Sauna done" onClick={() => set(d => ({ ...d, ticks: { ...d.ticks, sauna: d.ticks.sauna ? undefined : nowHM() } }))}><Check /></button>
              <div className="pl-grow"><b><Flame aria-hidden /> Sauna</b><small>{day.ticks.sauna ? `${clock(day.ticks.sauna)} · done` : `${routine.saunaMin} min after the gym · think the day over, then the review`}</small></div>
              {!day.night.saunaStart && !day.ticks.sauna && <Button small primary onClick={() => set(d => ({ ...d, night: { ...d.night, saunaStart: new Date().toISOString() } }))}><Play /> Start</Button>}
            </div>
            {day.night.saunaStart && !day.ticks.sauna && (
              <div className={`night-unwind ${saunaLeft <= 0 ? 'is-over' : ''}`}>
                <span className="night-unwind__time">{saunaLeft > 0 ? fmtSec(saunaLeft) : fmtSec(-saunaLeft)}</span>
                <span className="pl-muted">{saunaLeft > 0 ? 'left' : 'over — out you get'}</span>
              </div>
            )}
          </Card>
          )}

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
            <Button onClick={coachNote} disabled={thinking}><Sparkles /> {thinking ? 'Thinking…' : day.reflection ? "Another note from Coach Claude" : "Coach Claude on today"}</Button>
          </Card>

          <Card className="pl-stack">
            <h2>Tomorrow's #1</h2>
            <p className="pl-muted" style={{ fontSize: 13 }}>The one thing that makes tomorrow a win. It'll be waiting in tomorrow's {morningP ? 'Morning' : 'Bed'} Brief.</p>
            <Input placeholder="Tomorrow I will…" value={day.night.tomorrowTop || ''} onChange={e => set(d => ({ ...d, night: { ...d.night, tomorrowTop: e.target.value } }))} onBlur={e => { if (e.target.value.trim()) void saveTomorrowTop(e.target.value.trim()); }} />
          </Card>

          <Card className={`night-stage night-stage--col ${stopIn <= 0 && !done ? 'night-stop' : ''}`}>
            <div className="pl-row">
              <div className="pl-grow"><b><Gamepad2 aria-hidden /> {done ? 'Unwind' : stopIn > 0 ? (day.ticks.shake ? 'Good day. Go have fun.' : 'Unwind') : 'Time for bed.'}</b>
                <small>
                  {done ? 'done for tonight'
                    : stopIn > 0
                      ? (day.ticks.shake ? `Shake's down, day's done — ${reviewN === 3 ? 'review in' : 'nothing left but'} games, a show, whatever. ` : 'Games, a show, whatever — nothing to track here. ')
                        + `I'll buzz you at ${clock(routine.windDown)} (in ${fmtLeft(stopIn)}) to start getting ready for bed.`
                      : `${clock(routine.windDown)} was the hard stop, ${fmtLeft(-stopIn)} ago — teeth, face, phone on charge, lights out ${clock(routine.lightsOut)}.`}
                </small>
              </div>
            </div>
          </Card>

          {!done
            ? <Button primary block onClick={lightsOut} style={{ minHeight: 60, fontSize: 18 }}><Moon /> {morningP ? 'In bed with Kiaan' : 'Lights out'}</Button>
            : <Card className="night-goodnight"><Moon aria-hidden /><div><b>Good night.</b><small>{bedWord} {clock(day.ticks.lightsOut!)} · up {clock(routine.wake)}{morningP ? '' : ' with Kiaan'} · ≈ {sleepEstimate(day.ticks.lightsOut!, routine.wake)} sleep</small></div>
                <Button small ghost onClick={() => set(d => ({ ...d, ticks: { ...d.ticks, lightsOut: undefined } }))}>Undo</Button></Card>}
          </>)}
        </>
      )}
      {toast}
    </Page>
  );
}

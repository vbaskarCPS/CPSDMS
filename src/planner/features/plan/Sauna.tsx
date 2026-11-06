// src/planner/features/plan/Sauna.tsx — the 5 am club's sauna (night profile): a timer, then yesterday looked back
// (3 lines and the scorecard, saved on yesterday's page), the protein road (2 meals + shakes to the goal, before the
// kitchen closes), then today's Brief → the to-do list. Nothing happens at
// night any more; this is where the reflecting and planning live.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Flame, Play, Sparkles, Sunrise } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { reflect } from '../../lib/ai';
import { clock, loadRoutine, routineNow, type Routine } from '../../lib/routine';
import { Page, Header, Card, Button, Prompt, Score, useToast } from '../../ui/primitives';
import { addDays, nowHM } from './dates';
import { beep } from './sound';
import { autoMark } from '../habits/auto';
import { ProteinRoad } from '../food/ProteinRoad';
import { dayAverage, emptyDay, normalizeDay, SCORE_KEYS, type Day } from './types';

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Sauna() {
  const today = dayKey();
  const yKey = addDays(today, -1);
  const t = useDoc<Day>('day', today, emptyDay(), 500);
  const y = useDoc<Day>('day', yKey, emptyDay(), 500);
  const day = useMemo(() => normalizeDay(t.data), [t.data]);
  const yday = useMemo(() => normalizeDay(y.data), [y.data]);
  const setDay = (fn: (d: Day) => Day) => t.update(d => fn(normalizeDay(d)));
  const setY = (fn: (d: Day) => Day) => y.update(d => fn(normalizeDay(d)));
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [now, setNow] = useState(() => Date.now());
  const [thinking, setThinking] = useState(false);
  const [toast, say] = useToast();

  useEffect(() => { void loadRoutine().then(setRoutine); }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  // the timer
  const saunaLeft = day.night.saunaStart ? routine.saunaMin * 60 - Math.floor((now - new Date(day.night.saunaStart).getTime()) / 1000) : 0;
  const hit = useRef(false);
  useEffect(() => { if (day.night.saunaStart && !day.ticks.sauna && saunaLeft <= 0 && !hit.current) { hit.current = true; beep(); window.setTimeout(beep, 1200); } }, [saunaLeft, day.night.saunaStart, day.ticks.sauna]);
  const saunaDone = (on: boolean) => { setDay(d => ({ ...d, ticks: { ...d.ticks, sauna: on ? nowHM() : undefined } })); void autoMark('sauna', on); };

  // yesterday looked back (the review habit counts for today, the day it's done)
  const reviewN = Object.values(yday.night.review).filter(v => v.trim()).length;
  const reviewWas = useRef<boolean | null>(null);
  useEffect(() => { if (y.loading) return; const full = reviewN === 3; if (reviewWas.current !== null && reviewWas.current !== full) void autoMark('review', full); reviewWas.current = full; }, [reviewN, y.loading]);
  const avg = dayAverage(yday.scores);
  const prioDone = yday.priorities.filter(p => p.done).length;
  const prioSet = yday.priorities.filter(p => p.text.trim()).length;
  const review = (k: keyof Day['night']['review'], v: string) => setY(d => ({ ...d, night: { ...d.night, review: { ...d.night.review, [k]: v } } }));

  const coachNote = async () => {
    setThinking(true);
    try {
      const reply = await reflect({ date: yKey, brief: yday.brief, priorities: yday.priorities, ticks: yday.ticks, night: yday.night, scores: yday.scores, routine });
      setY(d => ({ ...d, reflection: reply }));
    } catch (e) { say(e instanceof Error ? e.message : "Couldn't reach Coach Claude", 'bad'); }
    finally { setThinking(false); }
  };

  const yName = new Date(`${yKey}T12:00:00`).toLocaleDateString([], { weekday: 'long' });
  const briefDone = !!day.brief.finishedAt;

  return (
    <Page>
      <Header eyebrow="5 am club" title="Sauna" back="/" save={y.save} />
      {(t.loadError || y.loadError) && <p className="pl-error" style={{ fontSize: 13 }}>Couldn't load — check the connection. Nothing typed is saved until it loads.</p>}

      {routine.saunaMin > 0 && (
        <Card className={`night-stage night-stage--col ${day.ticks.sauna ? 'is-done' : ''}`}>
          <div className="pl-row">
            <button type="button" className={`pl-check ${day.ticks.sauna ? 'is-on' : ''}`} aria-label="Sauna done" onClick={() => saunaDone(!day.ticks.sauna)}><Check /></button>
            <div className="pl-grow"><b><Flame aria-hidden /> Sauna</b><small>{day.ticks.sauna ? `${clock(day.ticks.sauna)} · done` : `${routine.saunaMin} min · look back at ${yName}, plan the protein, then today's Brief`}</small></div>
            {!day.night.saunaStart && !day.ticks.sauna && <Button small primary onClick={() => setDay(d => ({ ...d, night: { ...d.night, saunaStart: new Date().toISOString() } }))}><Play /> Start</Button>}
          </div>
          {day.night.saunaStart && !day.ticks.sauna && (
            <div className={`night-unwind ${saunaLeft <= 0 ? 'is-over' : ''}`}>
              <span className="night-unwind__time">{fmtSec(Math.abs(saunaLeft))}</span>
              <span className="pl-muted">{saunaLeft > 0 ? 'left' : 'over — out you get'}</span>
            </div>
          )}
        </Card>
      )}

      {y.loading ? <p className="pl-muted">Loading…</p> : (
        <Card className={`pl-stack ${reviewN === 3 && avg !== null ? 'night-done' : ''}`}>
          <h2>{yName}, looked back <span className="pl-muted" style={{ fontSize: 13, fontWeight: 500 }}>{reviewN}/3 · {prioSet ? `${prioDone}/${prioSet} priorities done` : 'no priorities set'}</span></h2>
          <Prompt q={`Win of ${yName}`} value={yday.night.review.win} onChange={v => review('win', v)} rows={1} />
          <Prompt q="What dragged" value={yday.night.review.drag} onChange={v => review('drag', v)} rows={1} />
          <Prompt q="One change for today" value={yday.night.review.tomorrow} onChange={v => review('tomorrow', v)} rows={1} />
          <hr className="pl-divider" />
          <p className="pl-label">{yName}'s scorecard, 1–5</p>
          {SCORE_KEYS.map(s => (
            <Score key={s.key} label={<span>{s.label} <span className="pl-muted" style={{ fontWeight: 400 }}>— {s.hint}</span></span>} value={yday.scores[s.key]} onChange={v => setY(d => ({ ...d, scores: { ...d.scores, [s.key]: v } }))} />
          ))}
          {avg !== null && <div className="plan-avg"><b>{avg}</b><small>/ 5 {yName}</small></div>}
          {yday.reflection && <blockquote className="plan-quote">{yday.reflection}</blockquote>}
          <Button onClick={coachNote} disabled={thinking}><Sparkles /> {thinking ? 'Thinking…' : yday.reflection ? 'Another note from Coach Claude' : `Coach Claude on ${yName}`}</Button>
        </Card>
      )}

      {!t.loading && <ProteinRoad plan={day.protein} yesterday={yday.protein} routine={routine} onChange={p => setDay(d => ({ ...d, protein: p }))} />}

      <Card className={`pl-stack ${briefDone ? 'night-done' : ''}`}>
        <h2><Sunrise aria-hidden style={{ width: 20, height: 20, color: 'var(--amber-2)', verticalAlign: '-3px' }} /> Today's Brief</h2>
        <p className="pl-muted" style={{ fontSize: 13 }}>{briefDone
          ? `Done ${new Date(day.brief.finishedAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${day.todos.length} on today's list.`
          : 'One word for the day, the three must-dos, who needs your A-game — and it turns into today\'s to-do list.'}</p>
        <Link to="/plan/brief" className={`pl-btn ${briefDone ? 'pl-btn--ghost' : 'pl-btn--primary'}`}>{briefDone ? 'Edit the Brief' : 'Start today\'s Brief'} <ChevronRight /></Link>
        {briefDone && <Link to="/plan" className="pl-btn pl-btn--ghost">Today's list <ChevronRight /></Link>}
      </Card>

      {!day.ticks.sauna && routine.saunaMin > 0 && <Button block onClick={() => saunaDone(true)}><Check /> Out of the sauna</Button>}
      {toast}
    </Page>
  );
}

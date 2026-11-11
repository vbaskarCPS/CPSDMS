// src/planner/features/plan/Sauna.tsx — the 5 am club's sauna (night profile): a timer, the day's meal plan (the
// protein road: 2 meals + shakes to the goal, before the kitchen closes), then today's Brief → the to-do list.
// (Yesterday's look-back and scorecard were dropped at Vijay's request; the morning profile keeps its own review.)
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Flame, Play, Sunrise } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { clock } from '../../lib/routine';
import { useTodayRoutine } from '../../lib/useTodayRoutine';
import { Page, Header, Card, Button } from '../../ui/primitives';
import { addDays, nowHM } from './dates';
import { beep } from './sound';
import { autoMark } from '../habits/auto';
import { ProteinRoad } from '../food/ProteinRoad';
import { emptyDay, normalizeDay, type Day } from './types';

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Sauna() {
  const today = dayKey();
  const yKey = addDays(today, -1);
  const t = useDoc<Day>('day', today, emptyDay(), 500);
  const y = useDoc<Day>('day', yKey, emptyDay(), 500);
  const day = useMemo(() => normalizeDay(t.data), [t.data]);
  const yday = useMemo(() => normalizeDay(y.data), [y.data]);
  const setDay = (fn: (d: Day) => Day) => t.update(d => fn(normalizeDay(d)));
  const { r: routine } = useTodayRoutine();   // today's sauna: none when it's skipped for the day
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  // the timer
  const saunaLeft = day.night.saunaStart ? routine.saunaMin * 60 - Math.floor((now - new Date(day.night.saunaStart).getTime()) / 1000) : 0;
  const hit = useRef(false);
  useEffect(() => { if (day.night.saunaStart && !day.ticks.sauna && saunaLeft <= 0 && !hit.current) { hit.current = true; beep(); window.setTimeout(beep, 1200); } }, [saunaLeft, day.night.saunaStart, day.ticks.sauna]);
  const saunaDone = (on: boolean) => { setDay(d => ({ ...d, ticks: { ...d.ticks, sauna: on ? nowHM() : undefined } })); void autoMark('sauna', on); };

  const briefDone = !!day.brief.finishedAt;

  return (
    <Page>
      <Header eyebrow="5 am club" title="Sauna" back="/" save={t.save} />
      {(t.loadError || y.loadError) && <p className="pl-error" style={{ fontSize: 13 }}>Couldn't load — check the connection. Nothing typed is saved until it loads.</p>}

      {routine.saunaMin > 0 && (
        <Card className={`night-stage night-stage--col ${day.ticks.sauna ? 'is-done' : ''}`}>
          <div className="pl-row">
            <button type="button" className={`pl-check ${day.ticks.sauna ? 'is-on' : ''}`} aria-label="Sauna done" onClick={() => saunaDone(!day.ticks.sauna)}><Check /></button>
            <div className="pl-grow"><b><Flame aria-hidden /> Sauna</b><small>{day.ticks.sauna ? `${clock(day.ticks.sauna)} · done` : `${routine.saunaMin} min · plan today's meals, then today's Brief`}</small></div>
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
    </Page>
  );
}

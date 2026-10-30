// src/planner/features/plan/Morning.tsx — the Miracle Morning (morning profile): stretch → meditate →
// light workout, each on a countdown, before the house wakes. Ends by handing over to the Morning Brief.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, SkipForward, Check, Sunrise } from 'lucide-react';
import { dayKey } from '../../lib/docs';
import { useDoc } from '../../lib/useDoc';
import { clock, loadRoutine, routineNow, type Routine } from '../../lib/routine';
import { Page, Header, Card, Button, useToast } from '../../ui/primitives';
import { nowHM } from './dates';
import { beep } from './sound';
import { emptyDay, normalizeDay, type Day, type MorningRoutine } from './types';

type StageId = 'stretch' | 'meditate' | 'workout';
const STAGES: { id: StageId; label: string; prompts: string[] }[] = [
  { id: 'stretch', label: 'Stretch', prompts: ['Neck rolls, slow', 'Hip openers', 'Hamstrings, then calves', 'Breathe into each one'] },
  { id: 'meditate', label: 'Meditate', prompts: ['Sit tall, eyes soft', '4 in · 7 hold · 8 out', 'Or just sit and notice', 'Thoughts come, thoughts go'] },
  { id: 'workout', label: 'Move', prompts: ['Light: a walk, a flow, a circuit', 'Squats · push-ups · plank', 'Yoga flow if the body asks', 'Finish warm, not wrecked'] },
];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Morning() {
  const nav = useNavigate();
  const today = dayKey();
  const { data, update, loading, save, flush } = useDoc<Day>('day', today, emptyDay(), 500);
  const day = useMemo(() => normalizeDay(data), [data]);
  const set = (fn: (d: Day) => Day) => update(d => fn(normalizeDay(d)));
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [toast, say] = useToast();
  useEffect(() => { void loadRoutine().then(setRoutine); }, []);

  const minutes: Record<StageId, number> = { stretch: routine.stretchMin, meditate: routine.meditateMin, workout: routine.workoutMin };
  const stages = STAGES.filter(s => minutes[s.id] > 0);
  const firstOpen = stages.findIndex(s => !day.morningRoutine[s.id]);
  const [idx, setIdx] = useState<number | null>(null);
  const cur = idx ?? (firstOpen < 0 ? stages.length : firstOpen);
  const stage = stages[cur];

  const [left, setLeft] = useState(0);
  const [running, setRunning] = useState(false);
  const endAt = useRef<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lock = useRef<{ release(): Promise<void> } | null>(null);

  useEffect(() => { if (stage) { setLeft(minutes[stage.id] * 60); setRunning(false); endAt.current = null; } }, [cur, routine]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDone = (s: StageId, fn?: (m: MorningRoutine) => MorningRoutine) => set(d => ({ ...d, morningRoutine: { ...(fn ? fn(d.morningRoutine) : d.morningRoutine), [s]: true } }));

  const complete = (s: StageId) => {
    markDone(s);
    const next = cur + 1;
    if (next >= stages.length) {
      set(d => ({ ...d, morningRoutine: { ...d.morningRoutine, [s]: true, finishedAt: new Date().toISOString() } }));
      void flush().then(() => { say('Morning routine done — now the Brief', 'good'); window.setTimeout(() => nav('/plan/brief'), 700); });
    } else setIdx(next);
  };

  useEffect(() => {
    if (!running) { window.clearInterval(timer.current); return; }
    timer.current = window.setInterval(() => {
      const s = Math.max(0, Math.round(((endAt.current ?? Date.now()) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0 && stage) { window.clearInterval(timer.current); setRunning(false); beep(); complete(stage.id); }
    }, 250);
    return () => window.clearInterval(timer.current);
  }, [running, stage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        if (running && !lock.current && 'wakeLock' in navigator) lock.current = await (navigator as unknown as { wakeLock: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
        if (!running && lock.current) { await lock.current.release(); lock.current = null; }
      } catch { /* no wake lock */ }
    })();
    return () => { if (lock.current) { void lock.current.release(); lock.current = null; } };
  }, [running]);

  const start = () => {
    if (!stage) return;
    set(d => ({ ...d, ticks: { ...d.ticks, up: d.ticks.up || nowHM() }, morningRoutine: { ...d.morningRoutine, startedAt: d.morningRoutine.startedAt || new Date().toISOString() } }));
    endAt.current = Date.now() + left * 1000; setRunning(true);
  };
  const pause = () => { setRunning(false); };
  const skip = () => { if (!stage) return; setRunning(false); complete(stage.id); };

  const allDone = !!day.morningRoutine.finishedAt || (stages.length > 0 && stages.every(s => day.morningRoutine[s.id]));
  const total = stages.reduce((a, s) => a + minutes[s.id], 0);

  return (
    <Page>
      <Header eyebrow="Miracle Morning" title={allDone ? 'Done for today.' : stage ? stage.label : 'Morning'} back="/" save={save} />
      <Card accent className="night-top">
        <Sunrise aria-hidden />
        <div>
          <p className="pl-eyebrow">Up {clock(routine.wake)} · {total} min</p>
          <b className="night-top__big">{stages.map(s => `${s.label} ${minutes[s.id]}`).join(' · ') || 'No stages set'}</b>
          <small>{allDone ? 'Then the Morning Brief, then Kiaan.' : 'Quiet house. You first.'}</small>
        </div>
      </Card>

      {loading ? <p className="pl-muted">Loading…</p> : allDone ? (
        <Card className="pl-stack">
          <p>Routine done{day.morningRoutine.startedAt ? ` · started ${new Date(day.morningRoutine.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.</p>
          <Button primary block onClick={() => nav('/plan/brief')}>{day.brief.finishedAt ? 'Open the Morning Brief' : 'Now the Morning Brief'}</Button>
        </Card>
      ) : stage && (
        <>
          <div className="pl-row" style={{ justifyContent: 'center', gap: 8 }}>
            {stages.map((s, i) => <span key={s.id} className={`pl-chip ${i === cur ? 'is-on' : ''}`} onClick={() => { setRunning(false); setIdx(i); }}>{day.morningRoutine[s.id] ? '✓ ' : ''}{s.label}</span>)}
          </div>
          <Card className="pl-stack" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div className="pl-bigtimer">{fmt(left)}</div>
            <p className="pl-muted">{stage.prompts[Math.min(stage.prompts.length - 1, Math.floor(((minutes[stage.id] * 60 - left) / Math.max(1, minutes[stage.id] * 60)) * stage.prompts.length))]}</p>
            <div className="pl-row" style={{ justifyContent: 'center' }}>
              {!running ? <Button primary onClick={start}><Play /> {left < minutes[stage.id] * 60 ? 'Resume' : 'Start'}</Button> : <Button onClick={pause}><Pause /> Pause</Button>}
              <Button ghost onClick={skip}><SkipForward /> {cur + 1 < stages.length ? 'Next' : 'Finish'}</Button>
            </div>
          </Card>
          <Button block ghost onClick={() => complete(stage.id)}><Check /> Mark {stage.label.toLowerCase()} done</Button>
        </>
      )}
      {toast}
    </Page>
  );
}

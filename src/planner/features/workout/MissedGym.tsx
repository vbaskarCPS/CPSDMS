// src/planner/features/workout/MissedGym.tsx — "Did you miss the gym?" on the Today screen when you open the planner
// after the gym block without a session logged (rules in homeChallenge.ts). Three answers:
//   Yes, I missed it   → "Let's get back on track": today's 5–10 minute home challenge, one tap to start it
//   I went, not logged → ticks the gym block (and the gym habit), with a link to log the session
//   Rest day           → kept as a planned rest: the gym habit's streak isn't touched
// The answer is saved on the day (Day.gym), so it's asked once, on any device.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dumbbell, Home } from 'lucide-react';
import { getDocs } from '../../lib/docs';
import { type Routine } from '../../lib/routine';
import { Button, Card } from '../../ui/primitives';
import { autoMark } from '../habits/auto';
import { isDue } from '../habits/streak';
import type { Habit } from '../habits/types';
import { nowHM } from '../plan/dates';
import type { Day, GymAnswer } from '../plan/types';
import { challengeFor, shouldAskMissedGym, startHomeChallenge } from './homeChallenge';
import { loadWorkouts, saveWorkout } from './store';

type SetDay = (fn: (d: Day) => Day) => void;

/** Start today's home challenge: a session marked kind 'home', noted on the day, then the live screen. */
export function useStartChallenge(today: string, set: SetDay): { start: () => Promise<void>; busy: boolean } {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const w = startHomeChallenge(today);
      await saveWorkout(w);
      set(d => ({ ...d, gym: { answer: 'missed', at: d.gym?.at || new Date().toISOString(), challenge: { id: w.id } } }));
      nav(`/workout/live/${w.id}`);
    } finally { setBusy(false); }
  };
  return { start, busy };
}

export function MissedGym({ routine, day, set, today, loading }: { routine: Routine; day: Day; set: SetDay; today: string; loading: boolean }) {
  const [facts, setFacts] = useState<{ workoutToday: boolean; gymDue: boolean } | null>(null);
  const [step, setStep] = useState<'ask' | 'challenge' | 'went' | 'rest' | null>(null);
  const { start, busy } = useStartChallenge(today, set);
  const challenge = challengeFor(today);

  useEffect(() => {
    let on = true;
    void (async () => {
      const [ws, habits] = await Promise.all([
        loadWorkouts(today, today).catch(() => []),
        getDocs<Habit>('habit').then(ds => ds.map(d => d.data)).catch(() => [] as Habit[]),
      ]);
      const gymHabits = habits.filter(h => h && !h.archived && h.auto === 'gym');
      if (on) setFacts({ workoutToday: ws.some(w => !w.discarded), gymDue: !gymHabits.length || gymHabits.some(h => isDue(h, today)) });
    })();
    return () => { on = false; };
  }, [today]);

  const ask = !loading && !!facts && shouldAskMissedGym({ routine, now: new Date(), ticks: day.ticks, answered: !!day.gym, workoutToday: facts.workoutToday, gymDue: facts.gymDue });
  useEffect(() => { if (ask && step === null) setStep('ask'); }, [ask, step]);

  const answer = (a: GymAnswer) => {
    const at = new Date().toISOString();
    if (a === 'went') {
      set(d => ({ ...d, gym: { answer: 'went', at }, ticks: { ...d.ticks, gym: d.ticks.gym || nowHM() } }));
      void autoMark('gym', true, today);
    } else if (a === 'rest') {
      set(d => ({ ...d, gym: { answer: 'rest', at } }));
      void autoMark('gym', true, today, 'skip');
    } else {
      set(d => ({ ...d, gym: { answer: 'missed', at } }));
    }
    setStep(a === 'missed' ? 'challenge' : a);
  };

  if (step === null) return null;
  if (step === 'went') return (
    <Card className="bed-missed"><Dumbbell aria-hidden /><div className="pl-grow"><b>Gym ticked.</b><small className="pl-muted">Log what you did so the coach can plan the next one.</small>
      <div className="bed-missed__row"><Link to="/workout" className="pl-btn pl-btn--small pl-btn--primary">Log the session</Link><Button small ghost onClick={() => setStep(null)}>Done</Button></div></div></Card>
  );
  if (step === 'rest') return (
    <Card className="bed-missed"><Dumbbell aria-hidden /><div className="pl-grow"><b>Rest day.</b><small className="pl-muted">Planned rest doesn't count against your gym streak. Back at it tomorrow.</small>
      <div className="bed-missed__row"><Button small ghost onClick={() => setStep(null)}>OK</Button></div></div></Card>
  );
  if (step === 'challenge') return (
    <Card accent className="bed-missed back-on-track">
      <Home aria-hidden />
      <div className="pl-grow">
        <b>Let's get back on track</b>
        <small className="pl-muted">{challenge.minutes} minutes at home, no equipment. It keeps your gym streak going; tomorrow's the real session.</small>
        <ul className="back-on-track__list">
          {challenge.items.map(i => <li key={i.exerciseId}><span>{i.name}</span><b>{i.sets} × {i.seconds ? `${i.seconds} s` : i.reps}</b></li>)}
        </ul>
        <div className="bed-missed__row">
          <Button small primary disabled={busy} onClick={() => void start()}>{busy ? 'Starting…' : 'Start it'}</Button>
          <Button small ghost onClick={() => setStep(null)}>Later</Button>
        </div>
      </div>
    </Card>
  );
  return (
    <Card accent className="bed-missed">
      <Dumbbell aria-hidden />
      <div className="pl-grow">
        <b>Did you miss the gym today?</b>
        <small className="pl-muted">There's no session logged and the gym block has passed.</small>
        <div className="bed-missed__row">
          <Button small primary onClick={() => answer('missed')}>Yes, I missed it</Button>
          <Button small onClick={() => answer('went')}>I went</Button>
          <Button small ghost onClick={() => answer('rest')}>Rest day</Button>
        </div>
      </div>
    </Card>
  );
}

/** The gym block's line on Today once the question is answered: what happened, and the challenge if it's still to do. */
export function GymStatus({ day, set, today }: { day: Day; set: SetDay; today: string }) {
  const { start, busy } = useStartChallenge(today, set);
  const g = day.gym;
  if (!g || g.answer === 'went') return null;
  if (g.answer === 'rest') return <small className="today-gym-status">Rest day</small>;
  if (g.challenge?.doneAt) return <small className="today-gym-status is-good">Missed · home challenge done ✓</small>;
  return (
    <div className="today-gym-status">
      <small>Missed today</small>
      {g.challenge
        ? <Link to={`/workout/live/${g.challenge.id}`} className="pl-btn pl-btn--small pl-btn--primary">Finish the home challenge</Link>
        : <button type="button" className="pl-btn pl-btn--small pl-btn--primary" disabled={busy} onClick={() => void start()}>Home challenge · {challengeFor(today).minutes} min</button>}
    </div>
  );
}


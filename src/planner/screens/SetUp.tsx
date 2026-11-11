// src/planner/screens/SetUp.tsx — the first-open set-up for the morning profile (Rosh's planner).
// A few short screens in Arvy's voice: her day's times → her habits → her last period → reminders on this phone →
// her day, and then the chat opens with Arvy looking at it. Each screen saves as she moves on, so leaving half-way
// loses nothing; it comes back on the next open until the last screen is done (lib/setup.ts decides who gets it).
// Settings › "Set up my day again" runs it again (`again`). The full-screen page stands in for the planner: no
// bottom bar until it's done or put off.
import { useEffect, useMemo, useState } from 'react';
import { Bell, Check, Sparkles } from 'lucide-react';
import type { PlannerPass } from '../lib/auth';
import { docsChanged, getDocs, putDocs } from '../lib/docs';
import { blocks, clock, loadRoutine, routineNow, saveRoutine, type Routine } from '../lib/routine';
import { enablePush, pushState, type PushState } from '../lib/push';
import { answersFrom, answersProblem, applyAnswers, finishSetup, habitChoices, habitSaves, type DayAnswers, type HabitChoice } from '../lib/setup';
import { Button, Segmented, uid } from '../ui/primitives';
import { reminderTimes } from '../ui/PushCard';
import type { Habit } from '../features/habits/types';
import { useCycle } from '../features/cycle/useCycle';
import { LastPeriod } from '../features/cycle/LastPeriod';
import { fmtDay } from '../features/cycle/dates';

type Step = 'hello' | 'day' | 'habits' | 'period' | 'reminders' | 'done';
const ORDER: Step[] = ['hello', 'day', 'habits', 'period', 'reminders', 'done'];
const NUMBERED: Step[] = ['day', 'habits', 'period', 'reminders'];

/** Her day as a short list: what the Today screen will show. */
function DayPreview({ routine }: { routine: Routine }) {
  return (
    <div className="setup-day">
      {blocks(routine).map(b => <div key={b.id}><span className="pl-num">{clock(b.at)}</span><b>{b.label}</b></div>)}
    </div>
  );
}

export function SetUp({ pass, again, onDone, onLater }: { pass: PlannerPass; again?: boolean; onDone: () => void; onLater: () => void }) {
  const name = pass.user.display_name.split(/\s+/)[0];
  const [step, setStep] = useState<Step>('hello');
  const [routine, setRoutine] = useState<Routine>(routineNow());
  const [a, setA] = useState<DayAnswers>(() => answersFrom(routineNow()));
  const [rows, setRows] = useState<HabitChoice[] | null>(null);
  const [push, setPush] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cycle = useCycle();

  useEffect(() => { void loadRoutine().then(r => { setRoutine(r); setA(answersFrom(r)); }); void pushState().then(setPush); }, []);
  useEffect(() => { window.scrollTo(0, 0); setError(null); }, [step]);

  const day = useMemo(() => applyAnswers(routine, a), [routine, a]);   // her routine as the answers stand
  const go = (by: 1 | -1) => setStep(s => ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(s) + by))]);
  const set = <K extends keyof DayAnswers>(k: K, v: DayAnswers[K]) => setA(x => ({ ...x, [k]: v }));
  const num = (k: 'stretchMin' | 'meditateMin' | 'workoutMin', label: string, max: number) => (
    <label className="pl-field"><span className="pl-label">{label}</span>
      <input className="pl-input" type="number" inputMode="numeric" min={0} max={max} value={a[k]} onChange={e => set(k, Math.max(0, Math.min(max, Number(e.target.value) || 0)))} /></label>
  );
  /** Run a screen's save, then move on. A failed save stays on the screen and says so. */
  const save = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); go(1); }
    catch { setError('That didn’t save. Check your connection and try again.'); }
    finally { setBusy(false); }
  };

  const saveDay = () => save(async () => {
    await saveRoutine(day);
    setRoutine(day);
    const habits = (await getDocs<Habit>('habit')).map(d => d.data).filter(Boolean);
    setRows(habitChoices(habits, day, uid));
  });
  const saveHabits = () => save(async () => {
    const docs = habitSaves(rows || []);
    if (docs.length) { await putDocs(docs); docsChanged(['habit']); }
  });
  const finish = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await finishSetup(pass.user); onDone(); }   // the planner takes over from here
    catch { setError('That didn’t save. Check your connection and try again.'); setBusy(false); }
  };
  const turnOn = async () => {
    setBusy(true); setError(null);
    try { await enablePush(); } catch (e) { setError(e instanceof Error ? e.message : 'That didn’t work.'); }
    finally { setBusy(false); void pushState().then(setPush); }
  };

  const dayProblem = answersProblem(a);
  const last = cycle.view.lastStart && !cycle.view.stale ? cycle.periods[cycle.periods.length - 1] : null;
  const n = NUMBERED.indexOf(step);

  return (
    <main className="pl-page pl-page--bare pl-stack pl-fade setup" style={{ gap: 16 }}>
      {n >= 0 && (
        <header className="pl-row">
          <p className="pl-eyebrow pl-grow">Step {n + 1} of {NUMBERED.length}</p>
          <div className="setup-dots" aria-hidden>{NUMBERED.map((s, i) => <i key={s} className={i <= n ? 'is-on' : ''} />)}</div>
        </header>
      )}

      {step === 'hello' && (
        <>
          <div className="setup-hello">
            <i className="setup-face"><Sparkles aria-hidden /></i>
            <h1>{again ? `Let’s go through your day again, ${name}.` : `Hi ${name}, I’m Arvy.`}</h1>
            <p>{again ? 'The same four short steps, with what you have now filled in.' : 'Let’s set up your day. Four short steps, about two minutes.'}</p>
            <p className="pl-muted">Your day’s times, your habits, your last period, and reminders on this phone. Anything can be changed later in Settings, or just by telling me.</p>
          </div>
          <div className="pl-stack" style={{ gap: 8 }}>
            <Button primary block onClick={() => go(1)}>Let’s go</Button>
            <Button ghost block onClick={onLater}>{again ? 'Close' : 'Not now'}</Button>
          </div>
        </>
      )}

      {step === 'day' && (
        <>
          <Says>First, the shape of your day. I’ve filled in what you have now: change what’s off.</Says>
          <section className="pl-card pl-stack">
            <label className="pl-field"><span className="pl-label">When do you get up?</span><input className="pl-input" type="time" value={a.wake} onChange={e => set('wake', e.target.value)} /></label>
            <div className="pl-field">
              <span className="pl-label">A morning routine before the day starts?</span>
              <Segmented value={a.routine ? 'yes' : 'no'} onChange={v => set('routine', v === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'Not for now' }]} />
              {a.routine
                ? <><div className="setup-mins">{num('stretchMin', 'Stretch (min)', 60)}{num('meditateMin', 'Meditate (min)', 60)}{num('workoutMin', 'Move (min)', 90)}</div><span className="pl-hint">It starts when you get up. 0 leaves a part out.</span></>
                : <span className="pl-hint">Your day then starts with the Morning Brief: one word, three must-dos, your list.</span>}
            </div>
            <label className="pl-field"><span className="pl-label">When is Kiaan up?</span><input className="pl-input" type="time" value={a.kiaanUp} onChange={e => set('kiaanUp', e.target.value)} /></label>
            <label className="pl-field"><span className="pl-label">Dinner</span><input className="pl-input" type="time" value={a.dinner} onChange={e => set('dinner', e.target.value)} /></label>
            <label className="pl-field"><span className="pl-label">Bedtime</span><input className="pl-input" type="time" value={a.bed} onChange={e => set('bed', e.target.value)} /></label>
          </section>
          {!dayProblem && <section className="pl-card pl-stack" style={{ gap: 8 }}><p className="pl-eyebrow">Your day</p><DayPreview routine={day} /></section>}
          {dayProblem && <p className="pl-muted" style={{ fontSize: 13 }}>{dayProblem}</p>}
          <Foot error={error} back={() => go(-1)} next={() => void saveDay()} disabled={busy || !!dayProblem} busy={busy} />
        </>
      )}

      {step === 'habits' && (
        <>
          <Says>{rows?.some(r => r.was || (r.has && !r.on))
            ? 'Now your habits. The starter ones were written for Vijay’s routine, so I’ve fitted them to your day. Keep what you want, add what fits.'
            : 'Now your habits. Keep the ones you want, and add any that fit.'}</Says>
          <section className="pl-card setup-habits">
            {(rows || []).map((r, i) => (
              <label key={r.key} className="setup-habit">
                <input type="checkbox" checked={r.on} onChange={e => setRows(cur => (cur || []).map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                <span><b>{r.title}</b>{!r.has && <em>new</em>}{r.note && <small>{r.note}</small>}</span>
              </label>
            ))}
            {rows && !rows.length && <p className="pl-muted">No habits yet. You can add your own on the Habits page.</p>}
          </section>
          <p className="pl-muted" style={{ fontSize: 13 }}>Unticked ones you already have are paused, not deleted: their history stays and you can bring them back on the Habits page.</p>
          <Foot error={error} back={() => go(-1)} next={() => void saveHabits()} disabled={busy || !rows} busy={busy} />
        </>
      )}

      {step === 'period' && (
        <>
          <Says>{cycle.loading ? 'One for the cycle tracker.' : last
            ? `One for the cycle tracker. The last period I have started ${fmtDay(last.start, { weekday: 'long', day: 'numeric', month: 'long' })}. If that’s your latest, just carry on.`
            : 'One for the cycle tracker: it has nothing recent to count from. When did your last period start?'}</Says>
          {!cycle.loading && (
            <section className="pl-card pl-stack">
              <LastPeriod todayKey={cycle.todayKey} periodDays={cycle.stats.periodLength} logged={cycle.periods} onSave={cycle.savePeriod}
                label={last ? 'Had one since? The day it started' : 'The day your last period started'} />
            </section>
          )}
          <p className="pl-muted" style={{ fontSize: 13 }}>To correct a period that’s already there, open that day on the Cycle page.</p>
          <Foot error={error} back={() => go(-1)} next={() => go(1)} label={last ? 'Next' : 'Skip for now'} />
        </>
      )}

      {step === 'reminders' && (
        <>
          <Says>Last one: want a nudge on this phone at the right moments? A reminder is skipped once you’ve ticked that step off.</Says>
          <section className="pl-card pl-stack">
            <div className="setup-day">{reminderTimes(day).map(x => <div key={x.what}><span className="pl-num">{clock(x.at)}</span><b>{x.what}</b></div>)}</div>
            {push === 'on' ? <p className="pl-row" style={{ color: 'var(--good)', fontWeight: 600 }}><Check aria-hidden /> Reminders are on for this phone.</p>
              : push === 'off' ? <Button primary block disabled={busy} onClick={() => void turnOn()}><Bell aria-hidden /> {busy ? 'Turning on…' : 'Turn on reminders'}</Button>
              : <p className="pl-muted" style={{ fontSize: 14 }}>{push === 'loading' ? 'Checking…'
                : push === 'denied' ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then turn them on in Settings.'
                : push === 'ios-install' ? 'On iPhone, add the planner to your Home Screen first (Safari, Share, Add to Home Screen). Then turn reminders on in Settings.'
                : 'This browser can’t show notifications. Open the planner on your phone to turn them on in Settings.'}</p>}
          </section>
          <Foot error={error} back={() => go(-1)} next={() => go(1)} label={push === 'on' ? 'Next' : 'Skip for now'} />
        </>
      )}

      {step === 'done' && (
        <>
          <div className="setup-hello">
            <i className="setup-face"><Sparkles aria-hidden /></i>
            <h1>That’s it, {name}. You’re set.</h1>
            <p>Here’s your day. I’ll open the chat next: tell me if anything else should change, typed or spoken.</p>
          </div>
          <section className="pl-card pl-stack" style={{ gap: 8 }}><p className="pl-eyebrow">Your day</p><DayPreview routine={day} /></section>
          <Foot error={error} back={() => go(-1)} next={() => void finish()} disabled={busy} busy={busy} label="Open my day" />
        </>
      )}
    </main>
  );
}

/** A line from Arvy at the top of a step. */
function Says({ children }: { children: React.ReactNode }) {
  return <div className="setup-says"><i className="setup-face"><Sparkles aria-hidden /></i><p>{children}</p></div>;
}
/** Back and Next at the bottom of a step. */
function Foot({ back, next, label = 'Next', disabled, busy, error }: { back: () => void; next: () => void; label?: string; disabled?: boolean; busy?: boolean; error?: string | null }) {
  return (
    <footer className="pl-stack" style={{ gap: 8 }}>
      {error && <p className="pl-error">{error}</p>}
      <div className="setup-foot">
        <Button ghost onClick={back} disabled={busy}>Back</Button>
        <Button primary onClick={next} disabled={disabled}>{busy ? 'Saving…' : label}</Button>
      </div>
    </footer>
  );
}

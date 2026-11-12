// src/planner/features/workout/WorkoutHome.tsx — /workout: today's session, this week, recent sessions, links.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, ClipboardList, MessageCircle, Scale, History, Dumbbell, Shuffle } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { clock, routineMin, routineMinutes } from '../../lib/routine';
import { useTodayRoutine } from '../../lib/useTodayRoutine';
import { Page, Header, Card, Button, Bars, Stat, Empty } from '../../ui/primitives';
import { daysAgo, emptyWorkout, fmtDate, loadCustomExercises, loadTemplates, loadWorkouts, nextTarget, saveWorkout, sessionToday, startFromTemplate, trainLine, trainToday, weekSessions } from './store';
import { durationMin, fmtNum, fmtSec, volumeOf, workoutKey, type Exercise, type Template, type Units, type Workout } from './types';
import { blocksOf, blockTitle, isNoLoad, targetLine } from './format';
import { findExercise } from './library';
import { DonePanel } from './DonePanel';
import { COACH_ASKS, openArvy } from '../arvy/arvy';
import { useDocsChanged } from '../../lib/useDocsChanged';
import { ExerciseSheet } from './ExerciseSheet';
import { markGymStart } from '../habits/auto';

export function useUnits(pass: PlannerPass): Units { return pass.user.settings.units === 'kg' ? 'kg' : 'lb'; }

export function useWorkoutData(days = 90) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [custom, setCustom] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useDocsChanged(['template', 'workout', 'exercise'], () => setTick(t => t + 1));   // Arvy planned or started a session
  useEffect(() => {
    let on = true;
    Promise.all([loadTemplates(), loadWorkouts(daysAgo(days)), loadCustomExercises()])
      .then(([t, w, c]) => { if (on) { setTemplates(t); setWorkouts(w); setCustom(c); } })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [days, tick]);
  return { templates, workouts, custom, loading, setTemplates, setWorkouts, setCustom };
}

export function WorkoutHome({ pass }: { pass: PlannerPass }) {
  const nav = useNavigate();
  const units = useUnits(pass);
  const { templates, workouts, custom, loading, setTemplates } = useWorkoutData();
  const [starting, setStarting] = useState(false);
  const [howTo, setHowTo] = useState<{ id: string; name: string; note?: string } | null>(null);

  const unfinished = workouts.find(w => !w.endedAt);
  // on a day with no gym (Arvy changed the day: sick, a rest day) only what's planned for today is offered
  const { adjust } = useTodayRoutine();
  const noGym = !!adjust?.skip?.includes('gym');
  const tpl = useMemo(() => sessionToday(templates, workouts, noGym), [templates, workouts, noGym]);
  const waiting = noGym && adjust?.held ? templates.find(t => t.id === adjust.held!.id && !t.archived && t.plannedFor === adjust.held!.to) : undefined;
  const targets = useMemo(() => (tpl ? tpl.exercises.map(e => ({ e, s: nextTarget(workouts, e, units, custom) })) : []), [tpl, workouts, units, custom]);
  const week = weekSessions(workouts);
  const finished = workouts.filter(w => w.endedAt);
  const doneToday = finished.find(w => w.date === daysAgo(0));
  const gymLine = useGymLine(!!doneToday, !!unfinished);

  const start = async (t?: Template) => {
    if (starting) return;
    setStarting(true);
    const w = t ? startFromTemplate(t, workouts, units, custom) : emptyWorkout();
    await saveWorkout(w);
    void markGymStart(w);   // a habit set to tick itself when Start workout is pressed (in time)
    nav(`/workout/live/${w.id}`, { state: { key: workoutKey(w) } });
  };

  return (
    <Page>
      <Header eyebrow="Train" title="Workout" />
      {unfinished ? (
        <Card accent>
          <p className="pl-eyebrow">In progress</p>
          <h2>{unfinished.name}</h2>
          <p className="pl-muted">Started {new Date(unfinished.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
          <Button block primary style={{ marginTop: 12, background: 'var(--accent-ink)', color: 'var(--accent)' }} onClick={() => nav(`/workout/live/${unfinished.id}`)}><Play size={18} /> Continue</Button>
        </Card>
      ) : doneToday ? (
        <DonePanel done={doneToday} units={units} custom={custom} templates={templates} workouts={workouts} onTemplate={t => setTemplates(ts => (ts.some(x => x.id === t.id) ? ts.map(x => (x.id === t.id ? t : x)) : [t, ...ts]))} />
      ) : tpl ? (
        <Card accent>
          <p className="pl-eyebrow">{doneToday ? 'Another one?' : gymLine}</p>
          <h2>{tpl.name}</h2>
          <div className="wo-hero__list">
            {blocksOf(tpl.exercises).map((b, bi) => (
              <div key={bi} style={{ display: 'contents' }}>
                {b.kind !== 'single' && <div className="wo-hero__fmt">{blockTitle(b, tpl.exercises)}</div>}
                {b.at.map(i => { const { e, s } = targets[i]; const lib = findExercise(e.exerciseId, custom); const shaped = !!e.style || e.mode === 'time' || isNoLoad(e, lib) || b.kind === 'emom' || b.kind === 'amrap';
                  return <div className={`wo-hero__row${b.kind !== 'single' ? ' wo-hero__row--in' : ''}`} key={`${e.exerciseId}-${i}`}><button type="button" className="wo-ex__howto" onClick={() => setHowTo({ id: e.exerciseId, name: e.name, note: e.note })}>{e.name}</button><span>{b.kind === 'emom' || b.kind === 'amrap' ? (e.mode === 'time' ? fmtSec(e.targetSec || 30) : `${e.targetReps} reps`) : targetLine(e, lib)}{!shaped && s.weight > 0 ? ` @ ${s.weight} ${units}` : ''}</span></div>; })}
              </div>
            ))}
          </div>
          <Button block style={{ background: 'var(--accent-ink)', color: 'var(--accent)', border: 0 }} disabled={starting} onClick={() => void start(tpl)}><Play size={18} /> Start {tpl.name.toLowerCase()}</Button>
          <div className="pl-row" style={{ gap: 8, marginTop: 8 }}>
            <Button ghost className="pl-grow" style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} disabled={starting} onClick={() => openArvy({ ask: `Shake up today's session (${tpl.name}): keep the focus, change the format.` })}><Shuffle size={16} /> Shake it up</Button>
            <Button ghost className="pl-grow" style={{ color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} disabled={starting} onClick={() => void start()}>Blank session</Button>
          </div>
        </Card>
      ) : noGym && !loading ? (
        <Card accent>
          <p className="pl-eyebrow">{gymLine}</p>
          <h2>Rest up</h2>
          <p style={{ margin: '6px 0 12px' }}>Nothing planned for today.{waiting ? ` “${waiting.name}” is waiting for ${waiting.plannedFor === daysAgo(-1) ? 'tomorrow' : new Date(`${waiting.plannedFor}T12:00:00`).toLocaleDateString([], { weekday: 'long' })}.` : ''}</p>
          <Button block style={{ background: 'var(--accent-ink)', color: 'var(--accent)', border: 0 }} onClick={() => openArvy({ ask: 'Plan me an easy session I can do at home today.' })}>Ask Arvy for something easy at home</Button>
          <Button ghost block style={{ marginTop: 8, color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} disabled={starting} onClick={() => void start()}>Blank session</Button>
        </Card>
      ) : !loading ? (
        <Card><Empty icon={<Dumbbell />} title="No templates yet" blurb="Make one and it'll show up here." action={<Link className="pl-btn pl-btn--primary" to="/workout/templates">Templates</Link>} /></Card>
      ) : null}

      <Card>
        <div className="pl-row" style={{ marginBottom: 8 }}><h3 className="pl-grow">This week</h3><span className="pl-muted" style={{ fontSize: 13 }}>{week.reduce((a, b) => a + b, 0)} session{week.reduce((a, b) => a + b, 0) === 1 ? '' : 's'}</span></div>
        <Bars values={week} labels={['M', 'T', 'W', 'T', 'F', 'S', 'S']} max={Math.max(1, ...week)} height={48} tone="good" />
      </Card>

      <div className="pl-stats">
        <Stat label="Last 30 days" value={finished.filter(w => w.date >= daysAgo(30)).length} sub="sessions" />
        <Stat label="Volume (30d)" value={fmtNum(finished.filter(w => w.date >= daysAgo(30)).reduce((s, w) => s + volumeOf(w), 0) / 1000) + 'k'} sub={units} />
      </div>

      <div className="pl-grid-2">
        <Link className="pl-tile" to="/workout/templates"><ClipboardList aria-hidden /><div><b>Templates</b><small>{templates.filter(t => !t.archived).length} plans</small></div></Link>
        <button type="button" className="pl-tile" onClick={() => openArvy({ suggest: COACH_ASKS })}><MessageCircle aria-hidden /><div><b>Ask Arvy</b><small>Plan or change a session</small></div></button>
        <Link className="pl-tile" to="/workout/body"><Scale aria-hidden /><div><b>Body weight</b><small>Log &amp; trend</small></div></Link>
        <Link className="pl-tile" to="/workout/history"><History aria-hidden /><div><b>History</b><small>{finished.length} sessions</small></div></Link>
      </div>

      <ExerciseSheet exerciseId={howTo?.id ?? null} name={howTo?.name || ''} note={howTo?.note} custom={custom} onClose={() => setHowTo(null)} />
      {finished.length > 0 && (
        <Card>
          <h3 style={{ marginBottom: 6 }}>Recent</h3>
          <div className="pl-list">
            {finished.slice(0, 5).map(w => (
              <Link key={w.id} className="pl-item" to={`/workout/live/${w.id}`} state={{ key: workoutKey(w) }}>
                <div className="pl-grow"><b>{w.name}</b><small>{fmtDate(w.date)} · {durationMin(w)} min · {fmtNum(volumeOf(w))} {units}{w.prs?.length ? ` · ${w.prs.length} PR` : ''}</small></div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
}

/** "Gym · 5:15 am", or "Late start — still counts" once it's 30 min past and nothing's logged. On a day whose plan
 *  has no gym (sick, a rest day set with Arvy): "No gym today". A gym moved for the day shows its new time. */
function useGymLine(doneToday: boolean, unfinished: boolean): string {
  const { r, adjust } = useTodayRoutine();
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick(n => n + 1), 60_000); return () => window.clearInterval(id); }, []);
  if (adjust?.skip?.includes('gym')) return `No gym today${adjust.why ? ` · ${adjust.why}` : ''}`;
  if (doneToday || unfinished) return `Gym · ${clock(r.gym)}`;
  return routineMinutes() > routineMin(r.gym) + 30 ? 'Late start — still counts' : `Gym · ${clock(r.gym)}`;
}

/** Today's training in one line, for the Health menu: "Home stretch (easy) · 7 exercises · at home". null while it loads. */
export function useTrainLine(): string | null {
  const { templates, workouts, loading } = useWorkoutData(30);
  const { adjust } = useTodayRoutine();
  return loading ? null : trainLine(trainToday(templates, workouts, !!adjust?.skip?.includes('gym')));
}

/** The card on the Today screen. */
export function WorkoutTodayCard({ pass }: { pass: PlannerPass }) {
  const nav = useNavigate();
  const units = useUnits(pass);
  const { templates, workouts, custom, loading } = useWorkoutData(30);
  const { adjust } = useTodayRoutine();
  const { unfinished, doneToday, last, tpl, planned, head } = useMemo(() => trainToday(templates, workouts, !!adjust?.skip?.includes('gym')), [templates, workouts, adjust]);
  const week = weekSessions(workouts).reduce((a, b) => a + b, 0);
  const cardGymLine = useGymLine(!!doneToday, !!unfinished);
  if (loading) return <Card><p className="pl-eyebrow">Train</p><p className="pl-muted">Loading…</p></Card>;

  const start = async () => {
    if (!tpl) { nav('/workout'); return; }
    const w = startFromTemplate(tpl, workouts, units, custom);
    await saveWorkout(w);
    void markGymStart(w);
    nav(`/workout/live/${w.id}`);
  };

  return (
    <Card>
      <div className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">{cardGymLine} · {week} this week</p>
          <h3>{head}</h3>
          <p className="pl-muted" style={{ fontSize: 13 }}>
            {unfinished ? 'Pick up where you left off.'
              : doneToday ? `${durationMin(doneToday)} min · ${fmtNum(volumeOf(doneToday))} ${units}${doneToday.prs?.length ? ` · ${doneToday.prs.length} PR` : ''}`
              : planned && tpl ? `${tpl.exercises.length} exercises` + (tpl.exercises[0] ? ` · ${tpl.exercises.map(e => e.name.split(' ')[0]).slice(0, 3).join(', ')}` : '')
              : last ? `Last: ${last.name}, ${fmtDate(last.date)}` : 'No sessions yet.'}
          </p>
        </div>
        {unfinished ? <Button small primary onClick={() => nav(`/workout/live/${unfinished.id}`)}>Continue</Button>
          : !doneToday && tpl ? <Button small primary onClick={() => void start()}><Play size={16} /> Start</Button>
          : <Link className="pl-btn pl-btn--small" to="/workout">Open</Link>}
      </div>
    </Card>
  );
}

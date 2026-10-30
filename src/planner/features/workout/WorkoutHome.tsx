// src/planner/features/workout/WorkoutHome.tsx — /workout: today's session, this week, recent sessions, links.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Play, ClipboardList, MessageCircle, Scale, History, Dumbbell } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Page, Header, Card, Button, Bars, Stat, Empty } from '../../ui/primitives';
import { daysAgo, emptyWorkout, fmtDate, loadCustomExercises, loadTemplates, loadWorkouts, nextTarget, saveWorkout, startFromTemplate, todaysTemplate, weekSessions } from './store';
import { durationMin, fmtNum, volumeOf, workoutKey, type Exercise, type Template, type Units, type Workout } from './types';

export function useUnits(pass: PlannerPass): Units { return pass.user.settings.units === 'kg' ? 'kg' : 'lb'; }

export function useWorkoutData(days = 90) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [custom, setCustom] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    Promise.all([loadTemplates(), loadWorkouts(daysAgo(days)), loadCustomExercises()])
      .then(([t, w, c]) => { if (on) { setTemplates(t); setWorkouts(w); setCustom(c); } })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [days]);
  return { templates, workouts, custom, loading, setTemplates, setWorkouts, setCustom };
}

export function WorkoutHome({ pass }: { pass: PlannerPass }) {
  const nav = useNavigate();
  const units = useUnits(pass);
  const { templates, workouts, custom, loading } = useWorkoutData();
  const [starting, setStarting] = useState(false);

  const unfinished = workouts.find(w => !w.endedAt);
  const tpl = useMemo(() => todaysTemplate(templates, workouts), [templates, workouts]);
  const targets = useMemo(() => (tpl ? tpl.exercises.map(e => ({ e, s: nextTarget(workouts, e, units, custom) })) : []), [tpl, workouts, units, custom]);
  const week = weekSessions(workouts);
  const finished = workouts.filter(w => w.endedAt);
  const doneToday = finished.find(w => w.date === daysAgo(0));

  const start = async (t?: Template) => {
    if (starting) return;
    setStarting(true);
    const w = t ? startFromTemplate(t, workouts, units, custom) : emptyWorkout();
    await saveWorkout(w);
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
      ) : tpl ? (
        <Card accent>
          <p className="pl-eyebrow">{doneToday ? 'Another one?' : 'Today'}</p>
          <h2>{tpl.name}</h2>
          <div className="wo-hero__list">
            {targets.map(({ e, s }) => (
              <div className="wo-hero__row" key={e.exerciseId}><span>{e.name}</span><span>{e.targetSets} × {e.targetReps}{s.weight > 0 ? ` @ ${s.weight} ${units}` : ''}</span></div>
            ))}
          </div>
          <Button block style={{ background: 'var(--accent-ink)', color: 'var(--accent)', border: 0 }} disabled={starting} onClick={() => void start(tpl)}><Play size={18} /> Start {tpl.name.toLowerCase()}</Button>
          <Button block ghost style={{ marginTop: 8, color: 'inherit', borderColor: 'color-mix(in srgb, var(--accent-ink) 35%, transparent)' }} disabled={starting} onClick={() => void start()}>Blank session</Button>
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
        <Link className="pl-tile" to="/workout/coach"><MessageCircle aria-hidden /><div><b>Coach</b><small>Ask anything</small></div></Link>
        <Link className="pl-tile" to="/workout/body"><Scale aria-hidden /><div><b>Body weight</b><small>Log &amp; trend</small></div></Link>
        <Link className="pl-tile" to="/workout/history"><History aria-hidden /><div><b>History</b><small>{finished.length} sessions</small></div></Link>
      </div>

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

/** The card on the Today screen. */
export function WorkoutTodayCard({ pass }: { pass: PlannerPass }) {
  const nav = useNavigate();
  const units = useUnits(pass);
  const { templates, workouts, custom, loading } = useWorkoutData(30);
  const unfinished = workouts.find(w => !w.endedAt);
  const tpl = useMemo(() => todaysTemplate(templates, workouts), [templates, workouts]);
  const week = weekSessions(workouts).reduce((a, b) => a + b, 0);
  const doneToday = workouts.find(w => w.endedAt && w.date === daysAgo(0));
  const last = workouts.find(w => w.endedAt);
  const planned = tpl?.days?.includes(new Date().getDay());
  if (loading) return <Card><p className="pl-eyebrow">Train</p><p className="pl-muted">Loading…</p></Card>;

  const start = async () => {
    if (!tpl) { nav('/workout'); return; }
    const w = startFromTemplate(tpl, workouts, units, custom);
    await saveWorkout(w);
    nav(`/workout/live/${w.id}`);
  };

  return (
    <Card>
      <div className="pl-row">
        <div className="pl-grow">
          <p className="pl-eyebrow">Train · {week} this week</p>
          {unfinished ? <h3>{unfinished.name} in progress</h3>
            : doneToday ? <h3>Done: {doneToday.name}</h3>
            : planned && tpl ? <h3>{tpl.name}</h3>
            : <h3>Rest day</h3>}
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

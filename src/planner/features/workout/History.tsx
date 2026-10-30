// src/planner/features/workout/History.tsx — /workout/history and /workout/exercise/:id.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Page, Header, Card, Empty, Line, Bars, Stat } from '../../ui/primitives';
import { findExercise } from './library';
import { daysAgo, fmtDate, loadCustomExercises, loadWorkouts } from './store';
import { durationMin, e1rm, fmtNum, volumeOf, workoutKey, type Exercise, type Workout } from './types';
import { useUnits } from './WorkoutHome';

export function History({ pass }: { pass: PlannerPass }) {
  const units = useUnits(pass);
  const [list, setList] = useState<Workout[] | null>(null);
  useEffect(() => { void loadWorkouts(daysAgo(365)).then(ws => setList(ws.filter(w => w.endedAt))); }, []);

  const exercises = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const w of list || []) for (const e of w.exercises) { const x = m.get(e.exerciseId) || { name: e.name, n: 0 }; x.n += 1; m.set(e.exerciseId, x); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [list]);

  const byMonth = useMemo(() => {
    const g = new Map<string, Workout[]>();
    for (const w of list || []) { const k = w.date.slice(0, 7); if (!g.has(k)) g.set(k, []); g.get(k)!.push(w); }
    return [...g.entries()];
  }, [list]);

  return (
    <Page>
      <Header back="/workout" eyebrow="Train" title="History" />
      {list && !list.length && <Card><Empty title="Nothing logged yet" blurb="Finish a session and it shows up here." /></Card>}
      {exercises.length > 0 && (
        <Card>
          <h3 style={{ marginBottom: 6 }}>Exercises</h3>
          <div className="pl-chips">{exercises.slice(0, 12).map(([id, x]) => <Link key={id} className="pl-chip" to={`/workout/exercise/${id}`}>{x.name} <span className="pl-muted">{x.n}</span></Link>)}</div>
        </Card>
      )}
      {byMonth.map(([k, ws]) => (
        <Card key={k}>
          <h3 style={{ marginBottom: 6 }}>{new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' })} <span className="pl-muted" style={{ fontWeight: 400, fontSize: 13 }}>· {ws.length}</span></h3>
          <div className="pl-list">
            {ws.map(w => (
              <Link key={w.id} className="pl-item" to={`/workout/live/${w.id}`} state={{ key: workoutKey(w) }}>
                <div className="pl-grow"><b>{w.name}</b><small>{fmtDate(w.date)} · {durationMin(w)} min · {w.exercises.length} ex · {fmtNum(volumeOf(w))} {units}</small></div>
                {w.prs?.length ? <Trophy size={16} style={{ color: 'var(--amber-2)' }} /> : null}
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </Page>
  );
}

export function ExerciseProgress({ pass }: { pass: PlannerPass }) {
  const { id = '' } = useParams();
  const units = useUnits(pass);
  const [list, setList] = useState<Workout[]>([]);
  const [custom, setCustom] = useState<Exercise[]>([]);
  useEffect(() => { void loadWorkouts(daysAgo(365)).then(ws => setList(ws.filter(w => w.endedAt))); void loadCustomExercises().then(setCustom); }, []);

  const sessions = useMemo(() => list
    .map(w => { const e = w.exercises.find(x => x.exerciseId === id); const sets = e?.sets.filter(s => s.done && s.reps > 0) || []; return { w, sets }; })
    .filter(x => x.sets.length), [list, id]);
  const name = findExercise(id, custom)?.name || sessions[0]?.w.exercises.find(x => x.exerciseId === id)?.name || 'Exercise';
  const points = useMemo(() => [...sessions].reverse().map(s => Math.max(...s.sets.map(x => e1rm(x.weight, x.reps)))), [sessions]);
  const bestSet = useMemo(() => sessions.flatMap(s => s.sets).reduce<{ weight: number; reps: number } | null>((a, b) => (!a || e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a), null), [sessions]);
  const heaviest = Math.max(0, ...sessions.flatMap(s => s.sets.map(x => x.weight)));
  const weekVol = useMemo(() => {
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    const now = Date.now();
    for (const s of sessions) { const wk = Math.floor((now - new Date(s.w.startedAt).getTime()) / (7 * 864e5)); if (wk < 8) out[7 - wk] += s.sets.reduce((t, x) => t + x.weight * x.reps, 0); }
    return out;
  }, [sessions]);

  return (
    <Page>
      <Header back="/workout/history" eyebrow="Progress" title={name} />
      {!sessions.length ? <Card><Empty title="No sets logged" /></Card> : (
        <>
          <div className="pl-stats">
            <Stat label="Best e1RM" value={bestSet ? e1rm(bestSet.weight, bestSet.reps) : '–'} sub={bestSet ? `${bestSet.weight} × ${bestSet.reps}` : ''} tone="good" />
            <Stat label="Heaviest" value={heaviest} sub={units} />
            <Stat label="Sessions" value={sessions.length} sub="last year" />
          </div>
          <Card><h3 style={{ marginBottom: 6 }}>Top-set e1RM</h3><Line values={points} height={80} /><p className="pl-muted" style={{ fontSize: 12, marginTop: 4 }}>{fmtDate(sessions[sessions.length - 1].w.date)} → {fmtDate(sessions[0].w.date)}</p></Card>
          <Card><h3 style={{ marginBottom: 6 }}>Volume, last 8 weeks</h3><Bars values={weekVol} height={56} labels={['-7', '-6', '-5', '-4', '-3', '-2', '-1', 'now']} /></Card>
          <Card>
            <h3 style={{ marginBottom: 6 }}>Last 10 sessions</h3>
            <table className="wo-table"><thead><tr><th>Date</th><th>Top set</th><th>Sets</th><th>Volume</th></tr></thead><tbody>
              {sessions.slice(0, 10).map(s => { const top = s.sets.reduce((a, b) => (e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a)); return (
                <tr key={s.w.id}><td>{fmtDate(s.w.date)}</td><td>{top.weight} × {top.reps}</td><td>{s.sets.length}</td><td>{fmtNum(s.sets.reduce((t, x) => t + x.weight * x.reps, 0))}</td></tr>); })}
            </tbody></table>
          </Card>
        </>
      )}
    </Page>
  );
}

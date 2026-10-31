// src/planner/features/workout/LiveWorkout.tsx — /workout/live/:id: log sets one thumb at a time. Finished sessions open read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Trophy, Trash2, Repeat2, Clock } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Page, Header, Card, Button, Sheet, Stat, TextArea, useToast } from '../../ui/primitives';
import { LIBRARY, findExercise, isLower, isTimed } from './library';
import { stepFor } from './progression';
import { daysAgo, detectPRs, exerciseHistory, loadCustomExercises, loadWorkouts, saveWorkout } from './store';
import { durationMin, fmtNum, fmtSec, setsDone, volumeOf, type Exercise, type SetLog, type Workout, type WorkoutExercise } from './types';
import { CheckBig, ExercisePicker, RestTimer, Stepper, TimedSet } from './parts';
import { useUnits } from './WorkoutHome';

const RPES = [7, 8, 9, 10];
const RESTS = [60, 90, 120, 180];

export function LiveWorkout({ pass }: { pass: PlannerPass }) {
  const { id } = useParams();
  const nav = useNavigate();
  const units = useUnits(pass);
  const [w, setW] = useState<Workout | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [custom, setCustom] = useState<Exercise[]>([]);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(0);
  const [picker, setPicker] = useState<null | { mode: 'add' } | { mode: 'swap'; index: number }>(null);
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Workout | null>(null);
  const [toast, say] = useToast();
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<Workout | null>(null);

  useEffect(() => {
    let on = true;
    Promise.all([loadWorkouts(daysAgo(365)), loadCustomExercises()]).then(([all, c]) => {
      if (!on) return;
      const found = all.find(x => x.id === id) || null;
      setW(found); latest.current = found; setHistory(all.filter(x => x.id !== id)); setCustom(c);
      if (!found) setMissing(true);
      else { const i = found.exercises.findIndex(e => e.sets.some(s => !s.done)); setOpen(i < 0 ? 0 : i); }
    });
    return () => { on = false; };
  }, [id]);

  const readOnly = !!w?.endedAt;

  const persist = useCallback((next: Workout, now = false) => {
    latest.current = next; setW(next);
    window.clearTimeout(timer.current);
    if (now) void saveWorkout(next).catch(() => say("Couldn't save", 'bad'));
    else timer.current = window.setTimeout(() => { void saveWorkout(next).catch(() => say("Couldn't save", 'bad')); }, 1000);
  }, [say]);
  useEffect(() => () => { window.clearTimeout(timer.current); if (latest.current) void saveWorkout(latest.current); }, []);

  const patchSet = (ei: number, si: number, p: Partial<SetLog>) => {
    if (!w) return;
    const exercises = w.exercises.map((e, i) => i !== ei ? e : { ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...p } : s)) });
    persist({ ...w, exercises });
  };
  const afterSet = (ei: number, si: number) => {
    if (!w) return;
    const restSec = w.exercises[ei].mode === 'time' ? (w.exercises[ei].restSec || 0) : (w.exercises[ei].restSec || 90);
    if (restSec > 0) setRest({ endsAt: Date.now() + restSec * 1000, total: restSec });
    const ex = w.exercises[ei];
    if (ex.sets.every((x, j) => (j === si ? true : x.done)) && ei < w.exercises.length - 1) window.setTimeout(() => setOpen(ei + 1), 400);
  };
  const timedDone = (ei: number, si: number, seconds: number) => { patchSet(ei, si, { done: true, seconds }); afterSet(ei, si); };
  const setRestSec = (ei: number, restSec: number) => { if (!w) return; persist({ ...w, exercises: w.exercises.map((e, i) => (i === ei ? { ...e, restSec } : e)) }); };
  const toggleDone = (ei: number, si: number) => {
    if (!w) return;
    const s = w.exercises[ei].sets[si];
    const done = !s.done;
    patchSet(ei, si, { done });
    if (done) {
      const restSec = w.exercises[ei].restSec || 90;
      setRest({ endsAt: Date.now() + restSec * 1000, total: restSec });
      // move on when the exercise is complete
      const ex = w.exercises[ei];
      if (ex.sets.every((x, j) => (j === si ? true : x.done)) && ei < w.exercises.length - 1) window.setTimeout(() => setOpen(ei + 1), 400);
    }
  };
  const addSet = (ei: number) => {
    if (!w) return;
    const ex = w.exercises[ei]; const lastSet = ex.sets[ex.sets.length - 1];
    const sets = [...ex.sets, ex.mode === 'time' ? { weight: 0, reps: 0, seconds: lastSet?.seconds ?? 60, done: false } : { weight: lastSet?.weight ?? 0, reps: lastSet?.reps ?? 8, done: false }];
    persist({ ...w, exercises: w.exercises.map((e, i) => (i === ei ? { ...e, sets } : e)) });
  };
  const removeSet = (ei: number, si: number) => {
    if (!w) return;
    persist({ ...w, exercises: w.exercises.map((e, i) => (i === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)) });
  };
  const removeExercise = (ei: number) => { if (!w) return; persist({ ...w, exercises: w.exercises.filter((_, i) => i !== ei) }); setOpen(Math.max(0, ei - 1)); };

  const exerciseFrom = (e: Exercise, prevEx?: WorkoutExercise): WorkoutExercise => {
    if (isTimed(e)) {
      const n = prevEx?.sets.length || 1;
      const sec = prevEx?.sets[0]?.seconds || (e.muscles[0] === 'core' || e.equipment === 'bodyweight' ? 45 : 300);
      return { exerciseId: e.id, name: e.name, mode: 'time', restSec: prevEx?.restSec ?? 0, sets: Array.from({ length: n }, () => ({ weight: 0, reps: 0, seconds: sec, done: false })) };
    }
    const last = exerciseHistory(history, e.id, 1)[0]?.sets || [];
    const n = prevEx?.sets.length || 3;
    const sets: SetLog[] = Array.from({ length: n }, (_, i) => ({ weight: last[i]?.weight ?? last[0]?.weight ?? 0, reps: last[i]?.reps ?? 8, done: false, prev: last[i] ? { weight: last[i].weight, reps: last[i].reps } : undefined }));
    return { exerciseId: e.id, name: e.name, restSec: prevEx?.restSec || (isLower(e) ? 150 : 90), targetReps: prevEx?.targetReps, sets };
  };
  const onPick = (e: Exercise) => {
    if (!w || !picker) return;
    if (picker.mode === 'add') { persist({ ...w, exercises: [...w.exercises, exerciseFrom(e)] }); setOpen(w.exercises.length); }
    else persist({ ...w, exercises: w.exercises.map((x, i) => (i === picker.index ? exerciseFrom(e, x) : x)) });
    setPicker(null);
  };

  const finish = () => {
    if (!w) return;
    const done: Workout = { ...w, endedAt: new Date().toISOString(), exercises: w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length) };
    setRest(null);
    done.prs = detectPRs(done, history);
    persist(done, true); setRest(null); setSummary(done);
  };
  const discard = () => {
    if (!w || !confirm('Discard this session?')) return;
    window.clearTimeout(timer.current); latest.current = null;
    void saveWorkout({ ...w, endedAt: w.startedAt, discarded: true }).then(() => nav('/workout', { replace: true }));
  };

  const elapsed = useMemo(() => (w ? Math.round((Date.now() - new Date(w.startedAt).getTime()) / 60000) : 0), [w]);

  if (missing) return <Page><Header back="/workout" title="Not found" /><p className="pl-muted">That session isn't here.</p></Page>;
  if (!w) return <Page><Header back="/workout" title="Loading…" /></Page>;

  return (
    <Page className={rest ? 'wo-has-rest' : ''}>
      <Header back="/workout" eyebrow={readOnly ? `${new Date(w.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${durationMin(w)} min` : <span className="pl-row" style={{ gap: 4 }}><Clock size={12} /> {elapsed} min · {setsDone(w)} sets</span>}
        title={w.name} right={!readOnly && <Button small primary onClick={finish} disabled={setsDone(w) === 0}>Finish</Button>} />

      {readOnly && w.prs && w.prs.length > 0 && <Card accent><div className="pl-row"><Trophy /><div><b>{w.prs.length} personal record{w.prs.length > 1 ? 's' : ''}</b><p className="pl-muted" style={{ fontSize: 13 }}>{w.prs.join(' · ')}</p></div></div></Card>}

      {w.exercises.map((ex, ei) => {
        const lib = findExercise(ex.exerciseId, custom) || LIBRARY[0];
        const step = stepFor({ units, lower: isLower(lib), defaultStep: lib.defaultStep });
        const isOpen = open === ei || readOnly;
        const doneN = ex.sets.filter(s => s.done).length;
        return (
          <Card key={`${ex.exerciseId}-${ei}`} className="wo-ex">
            <div className="wo-ex__head" onClick={() => setOpen(isOpen && !readOnly ? -1 : ei)}>
              <div className="pl-grow"><b>{ex.name}</b><small>{doneN}/{ex.sets.length} {ex.mode === 'time' ? 'rounds' : 'sets'}{ex.targetReps ? ` · ${ex.targetReps} reps` : ''}{ex.mode === 'time' && ex.sets[0]?.seconds ? ` · ${fmtSec(ex.sets[0].seconds)}` : ''} · rest {ex.restSec}s{ex.note ? ` · ${ex.note}` : ''}</small></div>
              {!readOnly && (isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />)}
            </div>
            {isOpen && (
              <div className="wo-ex__body">
                {!readOnly && <div className="wo-restchips">rest {RESTS.map(r => <button key={r} type="button" className={ex.restSec === r ? 'is-on' : ''} onClick={() => setRestSec(ei, r)}>{r}s</button>)}{ex.mode === 'time' && <button type="button" className={ex.restSec === 0 ? 'is-on' : ''} onClick={() => setRestSec(ei, 0)}>none</button>}</div>}
                {ex.mode === 'time' ? ex.sets.map((s, si) => (
                  <div key={si} className={`wo-set ${s.done ? 'is-done' : ''}`}>
                    <div className="wo-set__n">{si + 1}</div>
                    <TimedSet target={s.seconds || 60} done={s.done} disabled={readOnly} onTarget={sec => patchSet(ei, si, { seconds: sec })} onDone={sec => timedDone(ei, si, sec)} />
                    {!readOnly && ex.sets.length > 1 && <div className="wo-set__prev"><button type="button" onClick={() => removeSet(ei, si)} style={{ border: 0, background: 'none', color: 'var(--ink-2)', padding: 0, marginLeft: 'auto' }} aria-label="Remove round"><Trash2 size={14} /></button></div>}
                  </div>
                )) : ex.sets.map((s, si) => (
                  <div key={si} className={`wo-set ${s.done ? 'is-done' : ''}`}>
                    <div className="wo-set__n">{si + 1}</div>
                    <Stepper value={s.weight} step={step} onChange={v => patchSet(ei, si, { weight: v })} disabled={readOnly} />
                    <Stepper value={s.reps} step={1} onChange={v => patchSet(ei, si, { reps: Math.round(v) })} disabled={readOnly} />
                    <CheckBig on={s.done} onClick={() => toggleDone(ei, si)} disabled={readOnly} />
                    <div className="wo-set__prev">
                      <span>{units} × reps</span>
                      {s.prev && <span>last: {s.prev.weight} × {s.prev.reps}</span>}
                      {!readOnly && ex.sets.length > 1 && <button type="button" onClick={() => removeSet(ei, si)} style={{ border: 0, background: 'none', color: 'var(--ink-2)', padding: 0, marginLeft: 'auto' }} aria-label="Remove set"><Trash2 size={14} /></button>}
                    </div>
                    {(!readOnly || s.rpe) && (
                      <div className="wo-rpe">RPE {RPES.map(r => <button key={r} type="button" className={s.rpe === r ? 'is-on' : ''} disabled={readOnly} onClick={() => patchSet(ei, si, { rpe: s.rpe === r ? undefined : r })}>{r}</button>)}</div>
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <div className="wo-ex__actions">
                    <Button small onClick={() => addSet(ei)}><Plus size={16} /> {ex.mode === 'time' ? 'Round' : 'Set'}</Button>
                    <Button small ghost onClick={() => setPicker({ mode: 'swap', index: ei })}><Repeat2 size={16} /> Swap</Button>
                    <Button small ghost danger onClick={() => removeExercise(ei)}><Trash2 size={16} /></Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {!readOnly && <Button block onClick={() => setPicker({ mode: 'add' })}><Plus size={18} /> Add exercise</Button>}

      <Card>
        <h3 style={{ marginBottom: 6 }}>Notes</h3>
        <TextArea value={w.notes || ''} readOnly={readOnly} placeholder="How did it go? Sleep, energy, tweaks…" onChange={e => persist({ ...w, notes: e.target.value })} />
      </Card>

      {!readOnly && <Button block ghost danger onClick={discard}>Discard session</Button>}
      {rest && <div style={{ height: 64 }} />}

      <ExercisePicker open={!!picker} onClose={() => setPicker(null)} onPick={onPick} custom={custom} onCustomAdded={e => setCustom(c => [...c, e])} />
      <RestTimer endsAt={rest?.endsAt ?? null} total={rest?.total ?? 0} onDone={() => setRest(null)} onExtend={() => setRest(r => (r ? { endsAt: r.endsAt + 30000, total: r.total + 30 } : r))} onSkip={() => setRest(null)} />

      <Sheet open={!!summary} onClose={() => nav('/workout', { replace: true })} title="Session done">
        {summary && (
          <>
            <div className="pl-stats">
              <Stat label="Time" value={`${durationMin(summary)} min`} />
              <Stat label="Sets" value={setsDone(summary)} />
              <Stat label="Volume" value={fmtNum(volumeOf(summary))} sub={units} />
            </div>
            {summary.prs && summary.prs.length > 0 ? (
              <Card accent><div className="pl-row"><Trophy /><div><b>New PR{summary.prs.length > 1 ? 's' : ''}!</b>{summary.prs.map(p => <p key={p} style={{ fontSize: 14 }}>{p}</p>)}</div></div></Card>
            ) : <p className="pl-muted">Good work. Consistency is the PR.</p>}
            <Button block primary onClick={() => nav('/workout', { replace: true })}>Done</Button>
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}

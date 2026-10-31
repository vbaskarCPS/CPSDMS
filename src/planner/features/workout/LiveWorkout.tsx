// src/planner/features/workout/LiveWorkout.tsx — /workout/live/:id: log sets one thumb at a time. Finished sessions open read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Trophy, Trash2, Repeat2, Clock, Sparkles } from 'lucide-react';
import type { PlannerPass } from '../../lib/auth';
import { Page, Header, Card, Button, Sheet, Stat, TextArea, useToast } from '../../ui/primitives';
import { LIBRARY, findExercise, isLower, isTimed } from './library';
import { stepFor } from './progression';
import { coach } from '../../lib/ai';
import { daysAgo, detectPRs, exerciseHistory, loadCustomExercises, loadWorkouts, saveWorkout } from './store';

/** Sessions started before timed sets existed: a library-timed exercise with no mode becomes a timed one. */
function normalizeModes(w: Workout): Workout {
  let changed = false;
  const exercises = w.exercises.map(ex => {
    if (ex.mode || !isTimed(findExercise(ex.exerciseId))) return ex;
    changed = true;
    const sec = ex.sets[0]?.seconds || (/plank|hang|wall/.test(ex.exerciseId) ? 45 : 300);
    return { ...ex, mode: 'time' as const, restSec: 0, sets: ex.sets.map(s => ({ weight: 0, reps: 0, seconds: s.seconds || sec, done: s.done })) };
  });
  return changed ? { ...w, exercises } : w;
}
import { durationMin, fmtNum, fmtSec, isUnilateral, setsDone, volumeOf, type Exercise, type SetLog, type Workout, type WorkoutExercise } from './types';
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
      const raw = all.find(x => x.id === id) || null;
      const found = raw ? normalizeModes(raw) : null;
      setW(found); latest.current = found; setHistory(all.filter(x => x.id !== id)); setCustom(c);
      if (!found) setMissing(true);
      else { const i = found.exercises.findIndex(e => e.sets.some(s => !s.done)); setOpen(i < 0 ? 0 : i); }
    });
    return () => { on = false; };
  }, [id]);

  const readOnly = !!w?.endedAt;
  // coaching for the next set: an instant local line, then the coach's own line when it arrives
  const [tip, setTip] = useState<{ ei: number; si: number; text: string; ai: boolean } | null>(null);
  const tipSeq = useRef(0);
  const coachSet = (next: Workout, ei: number, si: number) => {
    const ex = next.exercises[ei];
    if (ex.mode === 'time') { setTip(null); return; }
    const seq = ++tipSeq.current;
    setTip({ ei, si, text: 'Coach is looking at that set…', ai: false });
    const s = ex.sets[si];
    const last = exerciseHistory(history, ex.exerciseId, 1)[0];
    const fmt = (x: SetLog) => `${x.weight} ${units} × ${x.reps}${x.repsR !== undefined ? ` L / ${x.repsR} R` : ''}${x.rpe ? ` @RPE ${x.rpe}` : ''}`;
    const msg = `I just finished set ${si + 1} of ${ex.sets.length} of ${ex.name}: ${fmt(s)}. Target ${ex.sets.length} × ${ex.targetReps || '8-12'}, rest ${ex.restSec}s.` +
      (si > 0 ? ` Earlier sets today: ${ex.sets.slice(0, si).filter(x => x.done).map(fmt).join(', ')}.` : '') +
      (last ? ` Last session: ${last.sets.map(fmt).join(', ')}${last.comment ? ` (my note: "${last.comment}")` : ''}.` : '') +
      (ex.note ? ` Plan cue: ${ex.note}.` : '') +
      ` Coach me for the ${si + 1 >= ex.sets.length ? 'next exercise / next session' : 'next set'} in ONE sentence, max 25 words: weight, reps and one form or effort cue.`;
    coach([{ role: 'user', content: msg }], { units, exercise: ex.name }).then(reply => {
      if (seq === tipSeq.current && reply) setTip({ ei, si, text: reply.replace(/\s+/g, ' ').trim(), ai: true });
    }).catch(() => { if (seq === tipSeq.current) setTip(null); });
  };

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
  const timedDone = (ei: number, si: number, seconds: number) => { patchSet(ei, si, { done: true, seconds }); afterSet(ei, si); if (w) coachSet({ ...w, exercises: w.exercises.map((e, i) => i !== ei ? e : { ...e, sets: e.sets.map((x, j) => (j === si ? { ...x, done: true, seconds } : x)) }) }, ei, si); };
  const setRestSec = (ei: number, restSec: number) => { if (!w) return; persist({ ...w, exercises: w.exercises.map((e, i) => (i === ei ? { ...e, restSec } : e)) }); };
  const setComment = (ei: number, comment: string) => { if (!w) return; persist({ ...w, exercises: w.exercises.map((e, i) => (i === ei ? { ...e, comment } : e)) }); };
  const toggleDone = (ei: number, si: number) => {
    if (!w) return;
    const s = w.exercises[ei].sets[si];
    const done = !s.done;
    patchSet(ei, si, { done });
    if (done) {
      coachSet({ ...w, exercises: w.exercises.map((e, i) => i !== ei ? e : { ...e, sets: e.sets.map((x, j) => (j === si ? { ...x, done: true } : x)) }) }, ei, si);
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

  // the coach's paragraph about the session and the next one, written from every set and note
  const [reviewing, setReviewing] = useState(false);
  const reviewSession = (done: Workout) => {
    const fmt = (x: SetLog) => (x.seconds && !x.reps ? fmtSec(x.seconds) : `${x.weight}×${x.reps}${x.repsR !== undefined ? `/${x.repsR}` : ''}${x.rpe ? `@${x.rpe}` : ''}`);
    const session = {
      name: done.name, minutes: durationMin(done), units, prs: done.prs, overall_note: done.notes || undefined,
      exercises: done.exercises.map(e => {
        const last = exerciseHistory(history, e.exerciseId, 1)[0];
        return { name: e.name, plan_cue: e.note, target: e.mode === 'time' ? `${e.sets.length} × ${fmtSec(e.sets[0]?.seconds || 0)}` : `${e.sets.length} × ${e.targetReps || '8-12'}`, sets: e.sets.map(fmt), my_note: e.comment?.trim() || undefined, last_session: last ? { sets: last.sets.map(fmt), note: last.comment || undefined } : undefined };
      }),
    };
    const ask = 'I just completed this workout. Read every set, my note on each exercise and the overall note, then write ONE paragraph (90-130 words, no headings, no lists) reviewing the session and telling me exactly what to do next workout: which exercises to go up on (and by how much), which to hold or fix form on, anything my notes flag (pain, fatigue, too easy), and one thing to focus on. Speak to me directly. Session (JSON):\n' + JSON.stringify(session);
    setReviewing(true);
    coach([{ role: 'user', content: ask }], { units }).then(reply => {
      const review = reply.replace(/\s+/g, ' ').trim();
      if (!review) return;
      const cur = latest.current && latest.current.id === done.id ? latest.current : done;
      const next = { ...cur, review };
      persist(next, true); setSummary(s => (s ? { ...s, review } : s));
    }).catch(() => undefined).finally(() => setReviewing(false));
  };
  const finish = () => {
    if (!w) return;
    const done: Workout = { ...w, endedAt: new Date().toISOString(), exercises: w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length) };
    setRest(null);
    done.prs = detectPRs(done, history);
    persist(done, true); setSummary(done);
    reviewSession(done);
  };
  // last session's review, shown while training (same template first, else the latest one)
  const lastReview = useMemo(() => {
    if (!w || readOnly) return null;
    const fin = history.filter(x => x.endedAt && !x.discarded && x.review).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return fin.find(x => x.templateId && x.templateId === w.templateId) || fin[0] || null;
  }, [w, history, readOnly]);
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
      {readOnly && w.review && <div className="wo-review"><Sparkles size={16} aria-hidden /><div><b>Coach's review</b><p>{w.review}</p></div></div>}
      {lastReview && <div className="wo-review"><Sparkles size={16} aria-hidden /><div><b>From your last session ({new Date(lastReview.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })})</b><p>{lastReview.review}</p></div></div>}

      {w.exercises.map((ex, ei) => {
        const lib = findExercise(ex.exerciseId, custom) || LIBRARY[0];
        const step = stepFor({ units, lower: isLower(lib), defaultStep: lib.defaultStep });
        const uni = isUnilateral(lib) || isUnilateral(ex);
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
                {ex.lastComment && <p className="wo-lastnote">Last time: {ex.lastComment}</p>}
                {tip && tip.ei === ei && tip.text && <div className={`wo-tip ${tip.ai ? 'is-ai' : ''}`}><Sparkles size={14} aria-hidden /> <span>{tip.text}</span></div>}
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
                    {uni
                      ? <div className="wo-sides"><Stepper value={s.reps} step={1} onChange={v => patchSet(ei, si, { reps: Math.round(v) })} disabled={readOnly} /><Stepper value={s.repsR ?? s.reps} step={1} onChange={v => patchSet(ei, si, { repsR: Math.round(v) })} disabled={readOnly} /></div>
                      : <Stepper value={s.reps} step={1} onChange={v => patchSet(ei, si, { reps: Math.round(v) })} disabled={readOnly} />}
                    <CheckBig on={s.done} onClick={() => toggleDone(ei, si)} disabled={readOnly} />
                    <div className="wo-set__prev">
                      <span>{units} × {uni ? 'L / R reps' : 'reps'}</span>
                      {s.prev && <span>last: {s.prev.weight} × {s.prev.reps}{uni && s.prev.repsR !== undefined ? ` / ${s.prev.repsR}` : ''}</span>}
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
                {readOnly
                  ? (ex.comment ? <p className="wo-lastnote">Note: {ex.comment}</p> : null)
                  : <TextArea rows={1} className="wo-comment" placeholder="Note for next time (felt easy, go up 5 lb; left shoulder pinched…)" value={ex.comment || ''} onChange={e => setComment(ei, e.target.value)} />}
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

      {!readOnly && <Button block primary onClick={finish} disabled={setsDone(w) === 0}><Sparkles size={18} /> Complete workout</Button>}
      {!readOnly && <p className="pl-muted" style={{ fontSize: 13, textAlign: 'center', margin: '-6px 0 0' }}>The coach reads every set and note and writes your plan for next time.</p>}
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
            {(reviewing || summary.review) && (
              <div className={`wo-review ${reviewing && !summary.review ? 'is-waiting' : ''}`}><Sparkles size={16} aria-hidden /><div><b>Coach's review</b><p>{summary.review || 'Reading your sets and notes…'}</p></div></div>
            )}
            <Button block primary onClick={() => nav('/workout', { replace: true })}>Done</Button>
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}

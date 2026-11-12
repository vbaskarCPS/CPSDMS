// src/planner/features/workout/LiveWorkout.tsx — /workout/live/:id: log sets one thumb at a time. Finished sessions open read-only.
// The session is shown as blocks (format.ts): an exercise on its own, a superset or circuit logged round by round,
// or an EMOM / AMRAP run against a clock. Each exercise gets the tracker that fits it: weight × reps, reps only,
// left / right, a countdown (each side in turn when it's a per-side hold), or intervals that run themselves.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Plus, Trophy, Trash2, Repeat2, Clock, Sparkles, Flame, PlayCircle, Check, RotateCcw } from 'lucide-react';
import { ExerciseSheet } from './ExerciseSheet';
import type { PlannerPass } from '../../lib/auth';
import { Page, Header, Card, Button, Sheet, Stat, TextArea, useToast } from '../../ui/primitives';
import { LIBRARY, findExercise, isLower, isTimed } from './library';
import { stepFor } from './progression';
import { coach } from '../../lib/ai';
import { daysAgo, detectPRs, exerciseHistory, loadCustomExercises, loadWorkouts, saveWorkout } from './store';
import { dayKey, getDoc, putDoc } from '../../lib/docs';
import { normalizeDay, nowHM, type Day } from '../plan';
import { routineNow } from '../../lib/routine';
import { autoMark } from '../habits/auto';

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

/** The coach's PLAN JSON → prescriptions keyed by exerciseId (names matched to this session's exercises). */
function parsePlan(jsonText: string, w: Workout): Record<string, NextRx> | undefined {
  try {
    const arr = JSON.parse(jsonText) as Record<string, unknown>[];
    if (!Array.isArray(arr)) return undefined;
    const out: Record<string, NextRx> = {};
    const n = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const it of arr) {
      const name = norm(String(it.name || ''));
      const ex = w.exercises.find(e => norm(e.name) === name) || w.exercises.find(e => norm(e.name).includes(name) || name.includes(norm(e.name)));
      if (!ex || !name) continue;
      const rx: NextRx = { weight: n(it.weight), reps: n(it.reps) ? Math.round(n(it.reps)!) : undefined, repsR: n(it.repsR) ? Math.round(n(it.repsR)!) : undefined, sets: n(it.sets) ? Math.min(8, Math.max(1, Math.round(n(it.sets)!))) : undefined, seconds: ex.mode === 'time' ? n(it.seconds) : undefined, restSec: n(it.rest) ? Math.round(n(it.rest)!) : undefined, cue: typeof it.cue === 'string' ? it.cue.trim().slice(0, 160) : undefined };
      if (ex.mode === 'time') { rx.weight = undefined; rx.reps = undefined; rx.repsR = undefined; }
      out[ex.exerciseId] = rx;
    }
    return Object.keys(out).length ? out : undefined;
  } catch { return undefined; }
}
import { durationMin, fmtNum, fmtSec, isAssisted, setsDone, volumeOf, type Exercise, type NextRx, type SetLog, type Workout, type WorkoutExercise } from './types';
import { BlockClock, CheckBig, ExercisePicker, IntervalRunner, RestTimer, Stepper, TimedSet } from './parts';
import { blockHow, blocksOf, blockTitle, hasSides, isIntervals, isNoLoad, repsTarget, styleLabel, targetLine, type Block } from './format';
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
  const [howTo, setHowTo] = useState<{ id: string; name: string; note?: string } | null>(null);
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
      else { const i = found.exercises.findIndex(e => e.sets.some(s => !s.done)); setOpen(i < 0 ? 0 : Math.max(0, blocksOf(found.exercises).findIndex(b => b.at.includes(i)))); }
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
    setTip({ ei, si, text: 'Arvy is looking at that set…', ai: false });
    const s = ex.sets[si];
    const last = exerciseHistory(history, ex.exerciseId, 1)[0];
    const assisted = isAssisted(ex) || isAssisted(findExercise(ex.exerciseId, custom));
    const fmt = (x: SetLog) => `${x.weight} ${units}${assisted ? ' assist' : ''} × ${x.reps}${x.repsR !== undefined ? ` L / ${x.repsR} R` : ''}${x.rpe ? ` @RPE ${x.rpe}` : ''}`;
    const msg = `I just finished set ${si + 1} of ${ex.sets.length} of ${ex.name}: ${fmt(s)}.${assisted ? ' (This is an assisted move: the weight is the counterweight, so less assist is harder and progress means taking assist away.)' : ''} Target ${ex.sets.length} × ${ex.targetReps || '8-12'}, rest ${ex.restSec}s.` +
      (ex.style ? ` The sets are a ${ex.style} (${styleLabel(ex)}), so the reps change set to set on purpose.` : '') +
      (ex.group ? ` It is one move of a ${ex.groupKind || 'superset'}: no rest between its exercises, rest after the round.` : '') +
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

  // every change starts from the newest copy (a clock that runs on its own reports rounds between renders)
  const patchEx = (ei: number, fn: (e: WorkoutExercise) => WorkoutExercise): Workout | null => {
    const cur = latest.current; if (!cur) return null;
    const next = { ...cur, exercises: cur.exercises.map((e, i) => (i === ei ? fn(e) : e)) };
    persist(next); return next;
  };
  const patchSet = (ei: number, si: number, p: Partial<SetLog>) => patchEx(ei, e => ({ ...e, sets: e.sets.map((s, j) => (j === si ? { ...s, ...p } : s)) }));
  /** After a set is done: the rest clock, and on to the next block when this one is finished. In a superset or
   *  circuit the rest comes after the round (one set of each), not between its exercises. */
  const afterDone = (next: Workout, ei: number, si: number, rest = true) => {
    const bs = blocksOf(next.exercises); const bi = bs.findIndex(b => b.at.includes(ei)); const b = bs[bi]; if (!b) return;
    const ex = next.exercises[ei];
    if (rest) {
      if (b.kind === 'single') { const sec = ex.mode === 'time' ? (ex.restSec || 0) : (ex.restSec || 90); if (sec > 0) setRest({ endsAt: Date.now() + sec * 1000, total: sec }); }
      else if (b.at.every(i => !next.exercises[i].sets[si] || next.exercises[i].sets[si].done)) {
        const sec = Math.max(0, ...b.at.map(i => next.exercises[i].restSec || 0));
        if (sec > 0) setRest({ endsAt: Date.now() + sec * 1000, total: sec });
      }
    }
    if (b.at.every(i => next.exercises[i].sets.every(x => x.done)) && bi < bs.length - 1) window.setTimeout(() => setOpen(bi + 1), 400);
  };
  // doneAt: the moment a set is done, for the race timer on Today (features/widgets/race.ts)
  const timedDone = (ei: number, si: number, seconds: number) => { const next = patchSet(ei, si, { done: true, doneAt: new Date().toISOString(), seconds }); if (next) { afterDone(next, ei, si); coachSet(next, ei, si); } };
  /** A round of self-running intervals just ended (the runner keeps its own rest). */
  const intervalRound = (ei: number, si: number, seconds: number) => { const next = patchSet(ei, si, { done: true, doneAt: new Date().toISOString(), seconds }); if (next) afterDone(next, ei, si, false); };
  const setRestSec = (ei: number, restSec: number) => { patchEx(ei, e => ({ ...e, restSec })); };
  const setComment = (ei: number, comment: string) => { patchEx(ei, e => ({ ...e, comment })); };
  const toggleDone = (ei: number, si: number) => {
    const s = latest.current?.exercises[ei]?.sets[si]; if (!s) return;
    const done = !s.done;
    const next = patchSet(ei, si, { done, doneAt: done ? new Date().toISOString() : undefined });
    if (done && next) { coachSet(next, ei, si); afterDone(next, ei, si); }
  };
  const blankSet = (ex: WorkoutExercise): SetLog => {
    const lastSet = ex.sets[ex.sets.length - 1];
    return ex.mode === 'time' ? { weight: 0, reps: 0, seconds: lastSet?.seconds ?? 60, done: false } : { weight: lastSet?.weight ?? 0, reps: lastSet?.reps ?? 8, ...(lastSet?.repsR !== undefined ? { repsR: lastSet.repsR } : {}), done: false };
  };
  const addSet = (ei: number) => { patchEx(ei, e => ({ ...e, sets: [...e.sets, blankSet(e)] })); };
  /** One more round of a superset or circuit: a set of each. */
  const addRound = (b: Block) => { const cur = latest.current; if (!cur) return; persist({ ...cur, exercises: cur.exercises.map((e, i) => (b.at.includes(i) ? { ...e, sets: [...e.sets, blankSet(e)] } : e)) }); };
  const removeRound = (b: Block, si: number) => { const cur = latest.current; if (!cur) return; persist({ ...cur, exercises: cur.exercises.map((e, i) => (b.at.includes(i) ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)) }); };
  const removeSet = (ei: number, si: number) => { patchEx(ei, e => ({ ...e, sets: e.sets.filter((_, j) => j !== si) })); };
  const removeExercise = (ei: number) => { const cur = latest.current; if (!cur) return; persist({ ...cur, exercises: cur.exercises.filter((_, i) => i !== ei) }); };
  /** The clock of an EMOM or AMRAP stopped: log what was done as sets (so volume, history and the review count it).
   *  AMRAP: every exercise did `count` rounds. EMOM: the minutes go round the exercises in turn. */
  const clockDone = (b: Block, count: number) => {
    const cur = latest.current; if (!cur || count <= 0) return;
    const doneAt = new Date().toISOString();
    const exercises = cur.exercises.map((e, i) => {
      const k = b.at.indexOf(i); if (k < 0) return e;
      const n = b.kind === 'emom' ? Math.ceil((count - k) / b.at.length) : count;
      if (n <= 0) return e;
      const first = e.sets[0] || blankSet(e);
      return { ...e, sets: Array.from({ length: Math.min(n, 60) }, () => ({ ...first, done: true, doneAt })) };
    });
    const next = { ...cur, exercises }; persist(next, true);
    afterDone(next, b.at[0], 0, false);
  };
  /** Run a clocked block again: back to its one set-up row. */
  const clockRedo = (b: Block) => { const cur = latest.current; if (!cur) return; persist({ ...cur, exercises: cur.exercises.map((e, i) => (b.at.includes(i) ? { ...e, sets: [{ ...(e.sets[0] || blankSet(e)), done: false, doneAt: undefined }] } : e)) }); };

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
  /** A swapped-in exercise takes the old one's place in its block (same letter, same clock). */
  const inPlace = (e: WorkoutExercise, old: WorkoutExercise): WorkoutExercise => ({ ...e, ...(old.group ? { group: old.group, groupKind: old.groupKind, groupSec: old.groupSec } : {}) });
  const onPick = (e: Exercise) => {
    if (!w || !picker) return;
    if (picker.mode === 'add') { persist({ ...w, exercises: [...w.exercises, exerciseFrom(e)] }); setOpen(blocksOf(w.exercises).length); }
    else persist({ ...w, exercises: w.exercises.map((x, i) => (i === picker.index ? inPlace(exerciseFrom(e, x), x) : x)) });
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
        const fmtOf = [e.group ? `${e.groupKind || 'superset'} ${e.group}` : '', hasSides(e, findExercise(e.exerciseId, custom)) ? 'per side' : ''].filter(Boolean).join(', ');
        return { name: e.name, plan_cue: e.note, target: targetLine(e, findExercise(e.exerciseId, custom)), format: fmtOf || undefined, sets: e.sets.map(fmt), my_note: e.comment?.trim() || undefined, last_session: last ? { sets: last.sets.map(fmt), note: last.comment || undefined } : undefined };
      }),
    };
    const ask = 'I just completed this workout. Read every set, my note on each exercise and the overall note. Reply in two parts.\n' +
      'PART 1: ONE paragraph (90-130 words, no headings, no lists) reviewing the session and telling me what to do next workout: which exercises to go up on (and by how much), which to hold or fix form on, anything my notes flag (pain, fatigue, too easy), and one thing to focus on. Speak to me directly.\n' +
      'PART 2: on its own line write PLAN: followed by a JSON array, one object per exercise, exactly these keys: {"name": the exercise name as given, "weight": number in ' + units + ' (0 for bodyweight/timed), "reps": number per set (left side for one-arm moves; omit for timed), "repsR": number (one-arm moves only), "sets": number, "seconds": number (timed moves only), "rest": seconds, "cue": one short sentence}. Respect my notes: if I said something hurt, lower or hold it; if I said it was easy, go up by a sensible step (' + (units === 'kg' ? '2.5 kg dumbbells, 5 kg barbell' : '5 lb dumbbells, 10 lb barbell') + '). No text after the JSON.\nSession (JSON):\n' + JSON.stringify(session);
    setReviewing(true);
    coach([{ role: 'user', content: ask }], { units }, true).then(reply => {
      const m = reply.match(/PLAN:\s*(\[[\s\S]*\])/i);
      const review = (m ? reply.slice(0, m.index) : reply).replace(/PART 1:?/i, '').replace(/\s+/g, ' ').trim();
      const next = m ? parsePlan(m[1], done) : undefined;
      if (!review) return;
      const cur = latest.current && latest.current.id === done.id ? latest.current : done;
      const saved = { ...cur, review, next };
      persist(saved, true); setSummary(s => (s ? { ...s, review, next } : s));
    }).catch(() => undefined).finally(() => setReviewing(false));
  };
  const finish = () => {
    if (!w) return;
    const done: Workout = { ...w, endedAt: new Date().toISOString(), exercises: w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length) };
    setRest(null);
    done.prs = detectPRs(done, history);
    persist(done, true); setSummary(done);
    reviewSession(done);
    // the routine's gym block is done — or, for the home challenge after a missed gym day, the small version of it:
    // the gym stays unticked, the gym habit gets a 'mini' (keeps the streak) and the day notes the challenge was done
    void (async () => {
      try {
        const k = done.date || dayKey();
        const d = normalizeDay(await getDoc<Day>('day', k));
        if (done.kind === 'home') {
          const at = new Date().toISOString();
          await putDoc('day', k, { ...d, gym: { answer: 'missed', at: d.gym?.at || at, challenge: { id: done.id, doneAt: at } } });
          void autoMark('gym', true, k, 'mini');
          return;
        }
        // a day with no gym (sick, a rest day set with Arvy): what was done instead is the day's session block, and the
        // gym habit gets the small version, like the home challenge
        if (d.adjust?.skip?.includes('gym')) {
          const added = d.adjust.added?.map(x => (x.session && !x.done ? { ...x, done: nowHM() } : x));
          await putDoc('day', k, { ...d, adjust: { ...d.adjust, ...(added ? { added } : {}) } });
          void autoMark('gym', true, k, 'mini');
          return;
        }
        if (!d.ticks.gym) await putDoc('day', k, { ...d, ticks: { ...d.ticks, gym: nowHM() } });
        void autoMark('gym', true, k);
      } catch { /* the Today screen can be ticked by hand */ }
    })();
  };
  const night = routineNow().profile === 'night';
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

  const blocks = blocksOf(w.exercises);
  const libOf = (ex: WorkoutExercise) => findExercise(ex.exerciseId, custom);
  const howToBtn = (ex: WorkoutExercise, label?: ReactNode) => (
    <button type="button" className="wo-ex__howto" aria-label={`How to do ${ex.name}`} onClick={e => { e.stopPropagation(); setHowTo({ id: ex.exerciseId, name: ex.name, note: ex.note }); }}>{label}{ex.name} <PlayCircle size={15} /></button>);
  const cues = (ex: WorkoutExercise) => (<>
    {ex.coachCue && <p className="wo-lastnote wo-lastnote--coach"><Sparkles size={12} aria-hidden /> Arvy: {ex.coachCue}</p>}
    {ex.lastComment && <p className="wo-lastnote">Last time: {ex.lastComment}</p>}
  </>);
  const noteBox = (ex: WorkoutExercise, ei: number, named = false) => (readOnly
    ? (ex.comment ? <p className="wo-lastnote" key={`n${ei}`}>{named ? `${ex.name}: ` : 'Note: '}{ex.comment}</p> : null)
    : <TextArea key={`n${ei}`} rows={1} className="wo-comment" placeholder={named ? `Note on ${ex.name}…` : 'Note for next time (felt easy, go up 5 lb; left shoulder pinched…)'} value={ex.comment || ''} onChange={e => setComment(ei, e.target.value)} />);

  /** One set of one exercise, with the tracker that fits it. `tag` replaces the set number (A1, B2…) inside a block. */
  const setRow = (ex: WorkoutExercise, ei: number, si: number, o: { tag?: string; onRemove?: () => void; rpe?: boolean } = {}) => {
    const s = ex.sets[si]; if (!s) return null;
    const lib = libOf(ex);
    const uni = hasSides(ex, lib);
    const remove = !readOnly && o.onRemove && <button type="button" onClick={o.onRemove} style={{ border: 0, background: 'none', color: 'var(--ink-2)', padding: 0, marginLeft: 'auto' }} aria-label="Remove"><Trash2 size={14} /></button>;
    if (ex.mode === 'time') {
      return (
        <div key={`${ei}-${si}`} className={`wo-set ${s.done ? 'is-done' : ''}`}>
          <div className="wo-set__n">{o.tag ?? si + 1}</div>
          <TimedSet target={s.seconds || 60} done={s.done} disabled={readOnly} sides={uni} onTarget={sec => patchSet(ei, si, { seconds: sec })} onDone={sec => timedDone(ei, si, sec)} />
          {remove && <div className="wo-set__prev">{remove}</div>}
        </div>
      );
    }
    const bare = isNoLoad(ex, lib);
    const assisted = isAssisted(lib) || isAssisted(ex);   // the weight is the counterweight: less is harder
    const step = stepFor({ units, lower: isLower(lib || LIBRARY[0]), defaultStep: lib?.defaultStep });
    const aim = repsTarget(ex, si);
    return (
      <div key={`${ei}-${si}`} className={`wo-set ${bare ? 'wo-set--bare' : ''} ${s.done ? 'is-done' : ''}`}>
        <div className="wo-set__n">{o.tag ?? si + 1}</div>
        {!bare && <Stepper value={s.weight} step={step} onChange={v => patchSet(ei, si, { weight: v })} disabled={readOnly} />}
        {uni
          ? <div className="wo-sides"><Stepper value={s.reps} step={1} onChange={v => patchSet(ei, si, { reps: Math.round(v) })} disabled={readOnly} /><Stepper value={s.repsR ?? s.reps} step={1} onChange={v => patchSet(ei, si, { repsR: Math.round(v) })} disabled={readOnly} /></div>
          : <Stepper value={s.reps} step={1} onChange={v => patchSet(ei, si, { reps: Math.round(v) })} disabled={readOnly} />}
        <CheckBig on={s.done} onClick={() => toggleDone(ei, si)} disabled={readOnly} />
        <div className="wo-set__prev">
          <span>{bare ? '' : `${assisted ? `${units} assist` : units} × `}{uni ? 'left / right reps' : 'reps'}{aim ? ` · aim ${aim}` : ''}</span>
          {s.prev && <span>last: {bare ? '' : `${s.prev.weight} × `}{s.prev.reps}{uni && s.prev.repsR !== undefined ? ` / ${s.prev.repsR}` : ''}</span>}
          {bare && !readOnly && si === 0 && <button type="button" className="wo-addload" onClick={() => patchEx(ei, e => ({ ...e, noLoad: false }))}>+ weight</button>}
          {remove}
        </div>
        {o.rpe !== false && (!readOnly || s.rpe) && (
          <div className="wo-rpe">RPE {RPES.map(r => <button key={r} type="button" className={s.rpe === r ? 'is-on' : ''} disabled={readOnly} onClick={() => patchSet(ei, si, { rpe: s.rpe === r ? undefined : r })}>{r}</button>)}</div>
        )}
      </div>
    );
  };
  const tipFor = (at: number[]) => (tip && at.includes(tip.ei) && tip.text ? <div className={`wo-tip ${tip.ai ? 'is-ai' : ''}`}><Sparkles size={14} aria-hidden /> <span>{tip.text}</span></div> : null);
  const head = (bi: number, isOpen: boolean, inner: ReactNode) => (
    <div className="wo-ex__head" onClick={() => setOpen(isOpen && !readOnly ? -1 : bi)}>
      <div className="pl-grow">{inner}</div>
      {!readOnly && (isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />)}
    </div>);

  /** An exercise on its own. */
  const singleCard = (ei: number, bi: number) => {
    const ex = w.exercises[ei]; const lib = libOf(ex);
    const isOpen = open === bi || readOnly;
    const doneN = ex.sets.filter(s => s.done).length;
    const auto = isIntervals(ex, lib);
    const style = styleLabel(ex, lib);
    const uni = hasSides(ex, lib);
    return (
      <Card key={`${ex.exerciseId}-${ei}`} className="wo-ex">
        {head(bi, isOpen, <>
          <b className="wo-ex__name">{howToBtn(ex)}</b>
          <small>{doneN}/{ex.sets.length} {ex.mode === 'time' ? 'rounds' : 'sets'}{style ? ` · ${style}` : `${ex.targetReps ? ` · ${ex.targetReps}${/[a-z]/i.test(ex.targetReps) ? '' : ' reps'}` : ''}${ex.mode === 'time' && ex.sets[0]?.seconds ? ` · ${fmtSec(ex.sets[0].seconds)}` : ''}`}{uni && !/side|direction|way|leg|arm/i.test(ex.targetReps || '') ? ' · each side' : ''}{auto ? '' : ` · rest ${ex.restSec}s`}{ex.note ? ` · ${ex.note}` : ''}</small>
        </>)}
        {isOpen && (
          <div className="wo-ex__body">
            {cues(ex)}
            {tipFor([ei])}
            {!readOnly && !auto && <div className="wo-restchips">rest {RESTS.map(r => <button key={r} type="button" className={ex.restSec === r ? 'is-on' : ''} onClick={() => setRestSec(ei, r)}>{r}s</button>)}{ex.mode === 'time' && <button type="button" className={ex.restSec === 0 ? 'is-on' : ''} onClick={() => setRestSec(ei, 0)}>none</button>}</div>}
            {auto
              ? <IntervalRunner rounds={ex.sets.length} work={ex.sets[0]?.seconds || 20} rest={ex.restSec || 0} doneCount={doneN} disabled={readOnly} onRound={(i, sec) => intervalRound(ei, i, sec)} />
              : ex.sets.map((_, si) => setRow(ex, ei, si, { onRemove: ex.sets.length > 1 ? () => removeSet(ei, si) : undefined }))}
            {!readOnly && (
              <div className="wo-ex__actions">
                <Button small onClick={() => addSet(ei)}><Plus size={16} /> {ex.mode === 'time' ? 'Round' : 'Set'}</Button>
                <Button small ghost onClick={() => setPicker({ mode: 'swap', index: ei })}><Repeat2 size={16} /> Swap</Button>
                <Button small ghost danger onClick={() => { removeExercise(ei); setOpen(Math.max(0, bi - 1)); }}><Trash2 size={16} /></Button>
              </div>
            )}
            {noteBox(ex, ei)}
          </div>
        )}
      </Card>
    );
  };

  /** The exercises of a block, listed with their targets and cues (and Swap / remove while training). */
  const lineup = (b: Block, tags: string[]) => b.at.map((ei, k) => {
    const ex = w.exercises[ei];
    return (
      <div key={ei} className="wo-lineup">
        <div className="pl-grow"><b>{howToBtn(ex, <span className="wo-tag">{tags[k]}</span>)}</b><small>{b.kind === 'emom' || b.kind === 'amrap' ? (ex.mode === 'time' ? fmtSec(ex.sets[0]?.seconds || 30) : `${ex.sets[0]?.reps ?? ex.targetReps} reps${hasSides(ex, libOf(ex)) ? ' each side' : ''} ${b.kind === 'emom' ? 'a minute' : 'a round'}`) : targetLine(ex, libOf(ex))}{ex.note ? ` · ${ex.note}` : ''}</small>{cues(ex)}</div>
        {!readOnly && <button type="button" aria-label={`Swap ${ex.name}`} onClick={() => setPicker({ mode: 'swap', index: ei })}><Repeat2 size={16} /></button>}
        {!readOnly && <button type="button" aria-label={`Remove ${ex.name}`} onClick={() => removeExercise(ei)}><Trash2 size={16} /></button>}
      </div>
    );
  });

  /** A superset or circuit: logged round by round, one set of each, rest after the round. */
  const roundsCard = (b: Block & { letter: string }, bi: number) => {
    const exs = b.at.map(i => w.exercises[i]);
    const isOpen = open === bi || readOnly;
    const rounds = Math.max(0, ...exs.map(e => e.sets.length));
    const doneRounds = Array.from({ length: rounds }, (_, r) => exs.every(e => !e.sets[r] || e.sets[r].done)).filter(Boolean).length;
    const tags = b.at.map((_, k) => `${b.letter}${k + 1}`);
    return (
      <Card key={`block-${b.letter}-${b.at[0]}`} className="wo-ex wo-block">
        {head(bi, isOpen, <>
          <span className="wo-chip">{blockTitle(b, w.exercises)}</span>
          <b className="wo-ex__name">{exs.map(e => e.name).join(' + ')}</b>
          <small>{doneRounds}/{rounds} rounds · {blockHow(b, w.exercises)}</small>
        </>)}
        {isOpen && (
          <div className="wo-ex__body">
            {lineup(b, tags)}
            {tipFor(b.at)}
            {Array.from({ length: rounds }, (_, r) => (
              <div key={r} className="wo-round">
                <div className="wo-round__n">Round {r + 1}{!readOnly && rounds > 1 && <button type="button" onClick={() => removeRound(b, r)} aria-label={`Remove round ${r + 1}`}><Trash2 size={13} /></button>}</div>
                {b.at.map((ei, k) => setRow(w.exercises[ei], ei, r, { tag: tags[k], rpe: false }))}
              </div>
            ))}
            {!readOnly && <div className="wo-ex__actions"><Button small onClick={() => addRound(b)}><Plus size={16} /> Round</Button></div>}
            {b.at.map(ei => noteBox(w.exercises[ei], ei, true))}
          </div>
        )}
      </Card>
    );
  };

  /** An EMOM or AMRAP: set the weights, start the clock, and the rounds are logged when it stops. */
  const clockCard = (b: Block & { letter: string }, bi: number) => {
    const exs = b.at.map(i => w.exercises[i]);
    const isOpen = open === bi || readOnly;
    const finished = exs.every(e => e.sets.length > 0 && e.sets.every(s => s.done));
    const total = exs[0]?.groupSec || (b.kind === 'emom' ? 600 : 480);
    const tags = b.at.map((_, k) => String(k + 1));
    const what = (e: WorkoutExercise) => { const s = e.sets[0]; const uni = hasSides(e, libOf(e)); return e.mode === 'time' ? `${fmtSec(s?.seconds || 30)} ${e.name}` : `${s?.reps ?? e.targetReps ?? ''}${uni ? ' each side' : ''} ${e.name}`; };
    return (
      <Card key={`block-${b.letter}-${b.at[0]}`} className="wo-ex wo-block">
        {head(bi, isOpen, <>
          <span className="wo-chip">{blockTitle(b, w.exercises)}</span>
          <b className="wo-ex__name">{exs.map(e => e.name).join(' + ')}</b>
          <small>{finished ? `${Math.max(...exs.map(e => e.sets.length))} round${Math.max(...exs.map(e => e.sets.length)) === 1 ? '' : 's'} logged` : blockHow(b, w.exercises)}</small>
        </>)}
        {isOpen && (
          <div className="wo-ex__body">
            {lineup(b, tags)}
            {finished
              ? <>
                  {exs.map((e, k) => <p key={k} className="wo-logged"><Check size={15} aria-hidden /> {e.name}: {e.sets.length} × {e.mode === 'time' ? fmtSec(e.sets[0]?.seconds || 0) : `${e.sets[0]?.reps}${e.sets[0]?.weight ? ` at ${e.sets[0].weight} ${units}` : ''}`}</p>)}
                  {!readOnly && <div className="wo-ex__actions"><Button small ghost onClick={() => clockRedo(b)}><RotateCcw size={15} /> Go again</Button></div>}
                </>
              : <>
                  <p className="pl-muted" style={{ fontSize: 13, margin: 0 }}>Set what you’ll use, then start the clock.</p>
                  {b.at.map((ei, k) => { const e = w.exercises[ei]; const bare = isNoLoad(e, libOf(e)) || e.mode === 'time'; const s = e.sets[0]; if (!s) return null;
                    return (
                      <div key={ei} className={`wo-set wo-set--setup ${bare ? 'wo-set--bare' : ''}`}>
                        <div className="wo-set__n">{tags[k]}</div>
                        {!bare && <Stepper value={s.weight} onChange={v => patchSet(ei, 0, { weight: v })} disabled={readOnly} />}
                        {e.mode === 'time' ? <Stepper value={s.seconds || 30} suffix="s" onChange={v => patchSet(ei, 0, { seconds: Math.round(v) })} disabled={readOnly} /> : <Stepper value={s.reps} onChange={v => patchSet(ei, 0, { reps: Math.round(v), ...(s.repsR !== undefined ? { repsR: Math.round(v) } : {}) })} disabled={readOnly} />}
                        <div className="wo-set__prev"><span>{e.name}: {bare ? '' : `${units} × `}{e.mode === 'time' ? 'seconds' : hasSides(e, libOf(e)) ? 'reps each side' : 'reps'}</span></div>
                      </div>); })}
                  <BlockClock kind={b.kind === 'emom' ? 'emom' : 'amrap'} totalSec={total} moves={exs.map(what)} disabled={readOnly} onFinish={n => clockDone(b, n)} />
                </>}
            {b.at.map(ei => noteBox(w.exercises[ei], ei, true))}
          </div>
        )}
      </Card>
    );
  };

  return (
    <Page className={rest ? 'wo-has-rest' : ''}>
      <Header back="/workout" eyebrow={readOnly ? `${new Date(w.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${durationMin(w)} min` : <span className="pl-row" style={{ gap: 4 }}><Clock size={12} /> {elapsed} min · {setsDone(w)} sets</span>}
        title={w.name} right={!readOnly && <Button small primary onClick={finish} disabled={setsDone(w) === 0}>Finish</Button>} />

      {readOnly && w.prs && w.prs.length > 0 && <Card accent><div className="pl-row"><Trophy /><div><b>{w.prs.length} personal record{w.prs.length > 1 ? 's' : ''}</b><p className="pl-muted" style={{ fontSize: 13 }}>{w.prs.join(' · ')}</p></div></div></Card>}
      {readOnly && w.review && <div className="wo-review"><Sparkles size={16} aria-hidden /><div><b>Arvy's review</b><p>{w.review}</p></div></div>}
      {lastReview && <div className="wo-review"><Sparkles size={16} aria-hidden /><div><b>From your last session ({new Date(lastReview.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })})</b><p>{lastReview.review}</p></div></div>}

      {blocks.map((b, bi) => (b.kind === 'single' ? singleCard(b.at[0], bi) : b.kind === 'emom' || b.kind === 'amrap' ? clockCard(b, bi) : roundsCard(b, bi)))}

      {!readOnly && <Button block onClick={() => setPicker({ mode: 'add' })}><Plus size={18} /> Add exercise</Button>}

      <Card>
        <h3 style={{ marginBottom: 6 }}>Notes</h3>
        <TextArea value={w.notes || ''} readOnly={readOnly} placeholder="How did it go? Sleep, energy, tweaks…" onChange={e => persist({ ...w, notes: e.target.value })} />
      </Card>

      {!readOnly && <Button block primary onClick={finish} disabled={setsDone(w) === 0}><Sparkles size={18} /> Complete workout</Button>}
      {!readOnly && <p className="pl-muted" style={{ fontSize: 13, textAlign: 'center', margin: '-6px 0 0' }}>Arvy reads every set and note and writes your plan for next time.</p>}
      {!readOnly && <Button block ghost danger onClick={discard}>Discard session</Button>}
      {rest && <div style={{ height: 64 }} />}

      <ExerciseSheet exerciseId={howTo?.id ?? null} name={howTo?.name || ''} note={howTo?.note} custom={custom} onClose={() => setHowTo(null)} />
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
              <div className={`wo-review ${reviewing && !summary.review ? 'is-waiting' : ''}`}><Sparkles size={16} aria-hidden /><div><b>Arvy's review</b><p>{summary.review || 'Reading your sets and notes…'}</p></div></div>
            )}
            {summary.next && Object.keys(summary.next).length > 0 && <p className="pl-muted" style={{ fontSize: 13 }}>Next session is set up from this: {Object.keys(summary.next).length} exercise{Object.keys(summary.next).length > 1 ? 's' : ''} prefilled with the coach's numbers.</p>}
            {night
              ? <><Button block primary onClick={() => nav('/plan/sauna', { replace: true })}><Flame size={18} /> Sauna → plan the day</Button><Button block ghost onClick={() => nav('/workout', { replace: true })}>Done</Button></>
              : <Button block primary onClick={() => nav('/workout', { replace: true })}>Done</Button>}
          </>
        )}
      </Sheet>
      {toast}
    </Page>
  );
}

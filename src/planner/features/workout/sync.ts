// src/planner/features/workout/sync.ts — the phone and the watch log the same session at the same time. Neither side is
// told when the other writes (the docs can't be watched live), so while the session screen is open and in view the
// phone reads the session every 2 s, and every save reads it fresh and changes only what was done here: one set, the
// rest timer, a set or an exercise added or taken away. A set done on the session is never undone by a save that hadn't
// seen it (only Undo does that), and the heart rate on a set is the watch's: the phone keeps it as it is. The rules are
// plain functions, tested in sync.test.ts; the watch follows the same ones (watch/…/Sync.kt).
import { getDocs, putDoc } from '../../lib/docs';
import type { RestRun, SetLog, Workout, WorkoutExercise } from './types';

/** One change made on the phone. It is applied to the phone's copy straight away, and again to the newest copy of the
 *  session when it is saved, so whatever the watch did in between stays. */
export type Change = (w: Workout) => Workout;

/** Several changes as one. */
export const all = (...cs: Change[]): Change => w => cs.reduce((x, c) => c(x), w);

/** Where an exercise is now: at its old place if it's still the same move there, else the same move elsewhere
 *  (an exercise above it was taken out on the other side), or -1 when it's gone. */
export function exAt(w: Workout, ei: number, exerciseId: string): number {
  if (w.exercises[ei]?.exerciseId === exerciseId) return ei;
  return w.exercises.findIndex(e => e.exerciseId === exerciseId);
}

/** Change one exercise (found by exAt); nothing happens if it's gone. */
export const onExercise = (ei: number, exerciseId: string, fn: (e: WorkoutExercise) => WorkoutExercise): Change => w => {
  const i = exAt(w, ei, exerciseId);
  return i < 0 ? w : { ...w, exercises: w.exercises.map((e, j) => (j === i ? fn(e) : e)) };
};

/** Change one set's fields. A set that is already done stays done, with the moment it was first ticked, unless this is
 *  an Undo; and the heart rate the watch measured is never touched. */
export const patchSet = (ei: number, exerciseId: string, si: number, p: Partial<SetLog>, undo = false): Change => onExercise(ei, exerciseId, e => {
  const s = e.sets[si]; if (!s) return e;
  const q: Partial<SetLog> = { ...p };
  delete q.hr;
  if (undo) { q.done = false; q.doneAt = undefined; }
  else if (s.done) { delete q.done; delete q.doneAt; }
  return { ...e, sets: e.sets.map((x, j) => (j === si ? { ...x, ...q } : x)) };
});

/** One more set on an exercise (made from the newest copy of it, so it follows the last set there). */
export const addSet = (ei: number, exerciseId: string, blank: (e: WorkoutExercise) => SetLog): Change =>
  onExercise(ei, exerciseId, e => ({ ...e, sets: [...e.sets, blank(e)] }));

/** Take a set away. A set the watch has ticked since the phone last looked isn't thrown away with it. */
export const removeSet = (ei: number, exerciseId: string, si: number, wasDone: boolean): Change => onExercise(ei, exerciseId, e => {
  if (!e.sets[si] || (e.sets[si].done && !wasDone)) return e;
  return { ...e, sets: e.sets.filter((_, j) => j !== si) };
});

export const addExercise = (ex: WorkoutExercise): Change => w => ({ ...w, exercises: [...w.exercises, ex] });
export const removeExercise = (ei: number, exerciseId: string): Change => w => {
  const i = exAt(w, ei, exerciseId);
  return i < 0 ? w : { ...w, exercises: w.exercises.filter((_, j) => j !== i) };
};

/** Session-wide fields (the notes, the coach's review). */
export const patchSession = (p: Partial<Omit<Workout, 'exercises'>>): Change => w => ({ ...w, ...p });

const sameSet = (a?: { ei: number; si: number }, b?: { ei: number; si: number }) => !!a && !!b && a.ei === b.ei && a.si === b.si;

/** A rest starts after set si of exercise ei. If the watch already started the rest after that same set (it was ticked
 *  there first), its clock is kept rather than started again. */
export const startRest = (sec: number, after: { ei: number; si: number }, now = Date.now()): Change => w => {
  const cur = w.rest;
  if (cur && Date.parse(cur.endsAt) > now && sameSet(cur.after, after)) return w;
  return { ...w, rest: { endsAt: new Date(now + sec * 1000).toISOString(), total: sec, after, by: 'phone' } };
};

/** +30 s on the rest that's running (on the newest copy: if the watch skipped it meanwhile, there's nothing to add to). */
export const addRest = (sec = 30): Change => w => (w.rest
  ? { ...w, rest: { ...w.rest, endsAt: new Date(Date.parse(w.rest.endsAt) + sec * 1000).toISOString(), total: w.rest.total + sec } }
  : w);

/** The rest is over. With `endsAt` (the phone's timer ran out) only that rest is cleared, not a newer one the watch
 *  started meanwhile; without it (Skip) whatever is running stops. */
export const endRest = (endsAt?: string): Change => w => (!w.rest || endsAt === undefined || Date.parse(w.rest.endsAt) <= Date.parse(endsAt) ? { ...w, rest: null } : w);

/** A set was ticked: the rest before it is over, unless it's the rest after this very set (ticked on the watch first). */
export const setStarted = (ei: number, si: number): Change => w => (w.rest && !sameSet(w.rest.after, { ei, si }) ? { ...w, rest: null } : w);

/** The rest to show: one still running, or the one already on screen until its timer has beeped (`onScreen` = its end).
 *  A rest that ran out while nobody was looking isn't shown, so there's no late beep for it. */
export function restView(rest: RestRun | null | undefined, now: number, onScreen?: number | null): { endsAt: number; total: number } | null {
  if (!rest) return null;
  const end = Date.parse(rest.endsAt);
  if (!isFinite(end)) return null;
  return end > now || end === onScreen ? { endsAt: end, total: rest.total } : null;
}

// ── saving and looking for the watch's changes ──

export interface SessionIO { read: () => Promise<{ w: Workout; at: string } | null>; write: (w: Workout) => Promise<void> }
/** The session doc in the database (`workout` / `<date>~<id>`); `at` is when it was last written. */
export const sessionIO = (key: string): SessionIO => ({
  read: async () => { const d = (await getDocs<Workout>('workout', key, key)).find(x => x.key === key); return d?.data ? { w: d.data, at: d.updated_at } : null; },
  write: w => putDoc('workout', key, w),
});

export interface SessionSync {
  /** Apply a change when saving: now (a tick, the rest, a set added) or after a second of quiet (typing a weight, a note). */
  change: (c: Change, now?: boolean) => Promise<void>;
  /** Save what's waiting. */
  flush: () => Promise<void>;
  /** Read the session; calls onRemote when it was written since the last look and nothing here is waiting to be saved. */
  poll: () => Promise<void>;
  /** Forget what's waiting (the session is being thrown away). */
  drop: () => void;
}

export function sessionSync(io: SessionIO, o: { base: () => Workout | null; onRemote: (w: Workout) => void; onError?: () => void; quietMs?: number; now?: () => number }): SessionSync {
  const now = o.now || Date.now;
  let pending: Change[] = [];
  let flying: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seen: string | null = null;   // updated_at of the copy last looked at
  let writes = 0;                   // so a read that started before a save doesn't bring back the older copy
  let polling = false;
  let failing = false;

  const flush = async (): Promise<void> => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (flying) { await flying; return pending.length ? flush() : undefined; }
    if (!pending.length) return;
    const batch = pending; pending = [];
    flying = (async () => {
      try {
        const fresh = await io.read();
        const base = fresh?.w ?? o.base();
        if (!base) return;
        const next = batch.reduce((w, c) => c(w), base);
        writes++;
        await io.write({ ...next, syncAt: new Date(now()).toISOString() });
        failing = false;
      } catch {
        pending = [...batch, ...pending];   // tried again on the next change or look
        if (!failing) o.onError?.();
        failing = true;
      }
    })();
    try { await flying; } finally { flying = null; }
  };

  const change = (c: Change, soon = false): Promise<void> => {
    pending.push(c);
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (soon) return flush();
    timer = setTimeout(() => { void flush(); }, o.quietMs ?? 1000);
    return Promise.resolve();
  };

  const poll = async (): Promise<void> => {
    if (flying || polling) return;
    if (pending.length) { if (timer === undefined) await flush(); return; }   // a save that failed: try it again
    polling = true;
    const before = writes;
    try {
      const fresh = await io.read();
      // something was changed or saved here while reading: that wins, and the next look sees the result
      if (!fresh || flying || pending.length || writes !== before) return;
      if (fresh.at === seen) return;
      seen = fresh.at;
      o.onRemote(fresh.w);
    } catch { /* offline: the next look tries again */ } finally { polling = false; }
  };

  return { change, flush, poll, drop: () => { pending = []; if (timer !== undefined) { clearTimeout(timer); timer = undefined; } } };
}

/** Look every `everyMs` while the page is in view and `active()` says so (the session is open and not finished), and
 *  straight away when the phone comes back to it. Returns the stop. */
export function pollWhileOpen(poll: () => void, active: () => boolean, everyMs = 2000): () => void {
  const tick = () => { if (document.visibilityState === 'visible' && active()) poll(); };
  const id = window.setInterval(tick, everyMs);
  document.addEventListener('visibilitychange', tick);
  return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
}

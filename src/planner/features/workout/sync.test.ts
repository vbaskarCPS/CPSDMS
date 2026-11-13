// The phone and the watch logging one session at the same time: what each save keeps of the other's changes, the rest
// timer on the session, and the look every 2 s that brings the watch's changes in.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/docs', () => ({ getDocs: vi.fn(async () => []), putDoc: vi.fn() }));
import { addRest, addSet, all, endRest, patchSet, removeExercise, removeSet, restView, sessionSync, setStarted, startRest, type SessionIO } from './sync';
import type { SetLog, Workout } from './types';

const set = (o: Partial<SetLog> = {}): SetLog => ({ weight: 100, reps: 8, done: false, ...o });
const session = (): Workout => ({
  id: 's1', date: '2026-11-13', startedAt: '2026-11-13T18:00:00Z', name: 'Upper',
  exercises: [
    { exerciseId: 'bench-press', name: 'Bench', restSec: 120, sets: [set(), set(), set()] },
    { exerciseId: 'barbell-row', name: 'Row', restSec: 90, sets: [set(), set()] },
  ],
});
const T0 = Date.parse('2026-11-13T18:10:00Z');

describe('a save keeps what the other side did', () => {
  it('a set done on the watch is not undone by a phone save that had not seen it', () => {
    const doc = session();
    doc.exercises[0].sets[0] = set({ done: true, doneAt: '2026-11-13T18:05:00Z', hr: { avg: 140, max: 156, n: 30 } });
    const out = patchSet(0, 'bench-press', 0, { done: false, doneAt: undefined, weight: 105 })(doc);
    expect(out.exercises[0].sets[0]).toMatchObject({ done: true, doneAt: '2026-11-13T18:05:00Z', weight: 105, hr: { avg: 140, max: 156 } });
  });
  it('only Undo takes a done set back', () => {
    const doc = session();
    doc.exercises[0].sets[1] = set({ done: true, doneAt: '2026-11-13T18:07:00Z', hr: { avg: 138, max: 150 } });
    const out = patchSet(0, 'bench-press', 1, {}, true)(doc);
    expect(out.exercises[0].sets[1].done).toBe(false);
    expect(out.exercises[0].sets[1].doneAt).toBeUndefined();
    expect(out.exercises[0].sets[1].hr).toEqual({ avg: 138, max: 150 });   // the watch's numbers stay
  });
  it('ticked on both: the first tick keeps its moment', () => {
    const doc = session();
    doc.exercises[1].sets[0] = set({ done: true, doneAt: '2026-11-13T18:08:00Z' });
    const out = patchSet(1, 'barbell-row', 0, { done: true, doneAt: '2026-11-13T18:08:02Z' })(doc);
    expect(out.exercises[1].sets[0].doneAt).toBe('2026-11-13T18:08:00Z');
  });
  it('the phone never writes heart rate', () => {
    const doc = session();
    doc.exercises[0].sets[2] = set({ hr: { avg: 120, max: 130 } });
    const out = patchSet(0, 'bench-press', 2, { hr: { avg: 1, max: 1 }, reps: 6 })(doc);
    expect(out.exercises[0].sets[2]).toMatchObject({ reps: 6, hr: { avg: 120, max: 130 } });
  });
  it('edits to different sets on the two sides both stay', () => {
    // the watch ticked row set 1 while the phone changed bench set 3's weight
    const doc = session();
    doc.exercises[1].sets[0] = set({ done: true, doneAt: '2026-11-13T18:09:00Z', reps: 10 });
    const out = patchSet(0, 'bench-press', 2, { weight: 95 })(doc);
    expect(out.exercises[1].sets[0]).toMatchObject({ done: true, reps: 10 });
    expect(out.exercises[0].sets[2].weight).toBe(95);
  });
  it('a set taken away on the phone stays if the watch ticked it meanwhile', () => {
    const doc = session();
    doc.exercises[1].sets[1] = set({ done: true });
    expect(removeSet(1, 'barbell-row', 1, false)(doc).exercises[1].sets).toHaveLength(2);
    expect(removeSet(1, 'barbell-row', 1, true)(doc).exercises[1].sets).toHaveLength(1);
  });
  it('a change finds its exercise when one above it was taken out', () => {
    const doc = removeExercise(0, 'bench-press')(session());
    const out = all(patchSet(1, 'barbell-row', 0, { reps: 12 }), addSet(1, 'barbell-row', e => set({ weight: e.sets[e.sets.length - 1].weight })))(doc);
    expect(out.exercises[0].sets[0].reps).toBe(12);
    expect(out.exercises[0].sets).toHaveLength(3);
    expect(patchSet(0, 'bench-press', 0, { reps: 1 })(doc)).toEqual(doc);   // gone: nothing happens
  });
});

describe('the rest timer on the session', () => {
  it('starting, +30 s and skipping', () => {
    let w = startRest(90, { ei: 0, si: 0 }, T0)(session());
    expect(w.rest).toEqual({ endsAt: new Date(T0 + 90000).toISOString(), total: 90, after: { ei: 0, si: 0 }, by: 'phone' });
    w = addRest(30)(w);
    expect(w.rest).toMatchObject({ endsAt: new Date(T0 + 120000).toISOString(), total: 120 });
    expect(endRest()(w).rest).toBeNull();
  });
  it('the same set ticked on the watch first: its rest clock is kept', () => {
    const doc = { ...session(), rest: { endsAt: new Date(T0 + 60000).toISOString(), total: 90, after: { ei: 0, si: 0 }, by: 'watch' as const } };
    expect(startRest(120, { ei: 0, si: 0 }, T0)(doc).rest).toBe(doc.rest);
    expect(startRest(120, { ei: 0, si: 1 }, T0)(doc).rest).toMatchObject({ by: 'phone', total: 120 });
  });
  it('+30 s after the watch skipped it adds nothing', () => {
    expect(addRest(30)({ ...session(), rest: null }).rest).toBeNull();
  });
  it('the phone\'s timer running out clears that rest, not a newer one from the watch', () => {
    const doc = { ...session(), rest: { endsAt: new Date(T0 + 90000).toISOString(), total: 90, by: 'watch' as const } };
    expect(endRest(new Date(T0).toISOString())(doc).rest).toBe(doc.rest);
    expect(endRest(new Date(T0 + 90000).toISOString())(doc).rest).toBeNull();
  });
  it('ticking the next set ends the rest before it', () => {
    const doc = { ...session(), rest: { endsAt: new Date(T0 + 60000).toISOString(), total: 90, after: { ei: 0, si: 0 }, by: 'watch' as const } };
    expect(setStarted(0, 1)(doc).rest).toBeNull();
    expect(setStarted(0, 0)(doc).rest).toBe(doc.rest);
  });
  it('shows a rest that is running, and not one that ran out unseen', () => {
    const rest = { endsAt: new Date(T0 + 45000).toISOString(), total: 90, by: 'watch' as const };
    expect(restView(rest, T0)).toEqual({ endsAt: T0 + 45000, total: 90 });
    expect(restView(rest, T0 + 50000)).toBeNull();
    expect(restView(rest, T0 + 50000, T0 + 45000)).toEqual({ endsAt: T0 + 45000, total: 90 });   // on screen: kept till it beeps
    expect(restView(null, T0)).toBeNull();
  });
});

/** A pretend database holding the one session, written by the phone (through sessionSync) and by "the watch". */
function db(start: Workout) {
  let doc = start, at = 1;
  const io: SessionIO = { read: async () => ({ w: structuredClone(doc), at: String(at) }), write: async w => { doc = structuredClone(w); at++; } };
  return { io, get: () => doc, watch: (fn: (w: Workout) => Workout) => { doc = fn(structuredClone(doc)); at++; } };
}

describe('saving and looking', () => {
  it('a phone save goes onto the newest copy', async () => {
    const d = db(session());
    const s = sessionSync(d.io, { base: () => null, onRemote: () => undefined, now: () => T0 });
    d.watch(w => patchSet(0, 'bench-press', 0, { done: true, doneAt: 'x', hr: undefined })({ ...w, rest: { endsAt: new Date(T0 + 90000).toISOString(), total: 90, after: { ei: 0, si: 0 }, by: 'watch' } }));
    await s.change(patchSet(1, 'barbell-row', 0, { weight: 80 }), true);
    expect(d.get().exercises[0].sets[0].done).toBe(true);
    expect(d.get().rest?.by).toBe('watch');
    expect(d.get().exercises[1].sets[0].weight).toBe(80);
    expect(d.get().syncAt).toBe(new Date(T0).toISOString());
  });
  it('a look brings the watch\'s change, once', async () => {
    const d = db(session());
    const seen: Workout[] = [];
    const s = sessionSync(d.io, { base: () => null, onRemote: w => seen.push(w) });
    await s.poll();
    d.watch(patchSet(0, 'bench-press', 1, { done: true }));
    await s.poll(); await s.poll();
    expect(seen).toHaveLength(2);
    expect(seen[1].exercises[0].sets[1].done).toBe(true);
  });
  it('a look waits while a change here is waiting to be saved', async () => {
    vi.useFakeTimers();
    try {
      const d = db(session());
      const seen: Workout[] = [];
      const s = sessionSync(d.io, { base: () => null, onRemote: w => seen.push(w), quietMs: 1000 });
      void s.change(patchSet(0, 'bench-press', 2, { weight: 110 }));   // typing
      d.watch(patchSet(1, 'barbell-row', 0, { done: true }));
      await s.poll();
      expect(seen).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1100);
      expect(d.get().exercises[0].sets[2].weight).toBe(110);
      expect(d.get().exercises[1].sets[0].done).toBe(true);
      await s.poll();
      expect(seen).toHaveLength(1);
      expect(seen[0].exercises[0].sets[2].weight).toBe(110);
    } finally { vi.useRealTimers(); }
  });
  it('a save that fails is tried again, and said once', async () => {
    const d = db(session());
    let down = true; const errors: number[] = [];
    const io: SessionIO = { read: d.io.read, write: async w => { if (down) throw new Error('offline'); await d.io.write(w); } };
    const s = sessionSync(io, { base: () => null, onRemote: () => undefined, onError: () => errors.push(1) });
    await s.change(patchSet(0, 'bench-press', 0, { done: true }), true);
    await s.poll();
    expect(errors).toHaveLength(1);
    down = false;
    await s.poll();
    expect(d.get().exercises[0].sets[0].done).toBe(true);
  });
});

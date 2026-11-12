// The race timer's sums (race.ts): where "Up to first set" starts and finishes, the approximate fallback for sessions
// from an older app, a finish before the start, a race past midnight and the planner day that starts at 4 am, a start
// with no finish, the best, the average and the streak, the live clock, and what gets kept day by day.
import { describe, expect, it } from 'vitest';
import type { Workout } from '../workout/types';
import { board, clockOf, cleanResult, firstSet, isNewBest, lapOf, liveView, momentOf, raceOn, resultOf, settle, upMoment, wordsOf, type Lap, type RaceDay } from './race';

const at = (day: string, hm: string, s = 0) => { const [y, m, d] = day.split('-').map(Number); const [h, mi] = hm.split(':').map(Number); return new Date(y, m - 1, d, h, mi, s).getTime(); };
const iso = (ms: number) => new Date(ms).toISOString();
/** A made-up gym session: each set's done moment (null = ticked by an app that didn't write it down). */
const session = (date: string, startedAt: number, sets: (number | null | 'open')[], extra: Partial<Workout> = {}): Workout => ({
  id: `w${startedAt}`, date, startedAt: iso(startedAt), name: 'Push', ...extra,
  exercises: [{ exerciseId: 'bench', name: 'Bench', restSec: 90, sets: sets.map(t => (t === 'open' ? { weight: 100, reps: 8, done: false } : { weight: 100, reps: 8, done: true, ...(t !== null ? { doneAt: iso(t) } : {}) })) }],
});
const D = '2026-11-11';

describe('when "Up to first set" starts', () => {
  it('at the exact moment Up was ticked, when it was written down', () => {
    const up = at(D, '05:04', 37);
    expect(upMoment({ key: D, ticks: { up: '05:04', upAt: iso(up) } })).toEqual({ at: up });
  });
  it('at the minute on the tick for a day ticked before the moment was kept', () => {
    expect(upMoment({ key: D, ticks: { up: '05:04' } })).toEqual({ at: at(D, '05:04') });
  });
  it('a tick in the small hours belongs to the day that is ending (the planner day starts at 4 am)', () => {
    expect(momentOf(D, '01:30')).toBe(at('2026-11-12', '01:30'));
    expect(momentOf(D, '03:59')).toBe(at('2026-11-12', '03:59'));
    expect(momentOf(D, '04:00')).toBe(at(D, '04:00'));
  });
  it('no Up ticked, or something odd written there: no start', () => {
    expect(upMoment({ key: D, ticks: {} })).toBeNull();
    expect(upMoment({ key: D, ticks: { up: '5am' } })).toBeNull();
    expect(upMoment({ key: D, ticks: { up: '05:04', upAt: 'yesterday' } })).toEqual({ at: at(D, '05:04') });
  });
  it('an exact moment from another day (copied over by mistake) is not used', () => {
    expect(upMoment({ key: D, ticks: { up: '05:04', upAt: iso(at('2026-11-09', '05:00')) } })).toEqual({ at: at(D, '05:04') });
  });
});

describe('when it finishes: the first set ticked done', () => {
  const up = at(D, '05:04');
  it('the earliest set done, in any session that day', () => {
    const day: RaceDay = { key: D, workouts: [session(D, at(D, '05:20'), [at(D, '05:31'), at(D, '05:28'), 'open']), session(D, at(D, '05:22'), [at(D, '05:40')])] };
    expect(firstSet(day, up)).toEqual({ at: at(D, '05:28') });
  });
  it('a session from an older app (no moments on its sets): its start, marked approximate', () => {
    expect(firstSet({ key: D, workouts: [session(D, at(D, '05:26'), [null, null])] }, up)).toEqual({ at: at(D, '05:26'), approx: true });
  });
  it('a set done before the start is ignored (yesterday’s session left open, a set ticked before Up)', () => {
    expect(firstSet({ key: D, workouts: [session(D, at(D, '04:50'), [at(D, '04:58'), at(D, '05:30')])] }, up)).toEqual({ at: at(D, '05:30') });
    expect(firstSet({ key: D, workouts: [session(D, at(D, '04:50'), [at(D, '04:58')])] }, up)).toBeNull();
    expect(firstSet({ key: D, workouts: [session(D, at(D, '04:50'), [null])] }, up)).toBeNull();
  });
  it('a session started but nothing ticked yet, a home session, a thrown-away one: no finish', () => {
    expect(firstSet({ key: D, workouts: [session(D, at(D, '05:20'), ['open', 'open'])] }, up)).toBeNull();
    expect(firstSet({ key: D, workouts: [session(D, at(D, '05:20'), [at(D, '05:25')], { kind: 'home' })] }, up)).toBeNull();
    expect(firstSet({ key: D, workouts: [session(D, at(D, '05:20'), [at(D, '05:25')], { discarded: true })] }, up)).toBeNull();
    expect(firstSet({ key: D }, up)).toBeNull();
  });
  it('a race across midnight: up late, first set after twelve, still that planner day', () => {
    const day: RaceDay = { key: D, ticks: { up: '23:40' }, workouts: [session(D, at('2026-11-12', '00:05'), [at('2026-11-12', '00:12')])] };
    const r = raceOn('gym', day);
    expect(r.start).toEqual({ at: at(D, '23:40') });
    expect(lapOf(D, resultOf(r.start!, r.finish))!.ms).toBe(32 * 60_000);
  });
  it('a start with no finish (no gym that day) is not a race', () => {
    const r = raceOn('gym', { key: D, ticks: { up: '05:04' }, workouts: [] });
    expect(r.start).not.toBeNull();
    expect(r.finish).toBeNull();
    expect(lapOf(D, resultOf(r.start!, r.finish))).toBeNull();
  });
  it('one started and stopped by hand reads nothing from the day', () => {
    expect(raceOn('manual', { key: D, ticks: { up: '05:04', upAt: iso(up) }, workouts: [session(D, up, [up + 60_000])] })).toEqual({ start: null, finish: null });
  });
});

describe('what is kept for a day', () => {
  it('the start and finish as moments, approximate when either was', () => {
    expect(resultOf({ at: at(D, '05:04') }, { at: at(D, '05:28'), approx: true })).toEqual({ v: 1, start: iso(at(D, '05:04')), finish: iso(at(D, '05:28')), approx: true });
  });
  it('reads back safely: broken or odd shapes become nothing, a finish before the start is dropped', () => {
    expect(cleanResult(null)).toBeNull();
    expect(cleanResult('fast')).toBeNull();
    expect(cleanResult({ finish: iso(at(D, '05:28')) })).toBeNull();
    expect(cleanResult({ v: 1, start: iso(at(D, '05:30')), finish: iso(at(D, '05:28')) })).toEqual({ v: 1, start: iso(at(D, '05:30')) });
    expect(cleanResult({ removed: true, start: 'x' })).toEqual({ v: 1, removed: true });
    expect(cleanResult({ v: 1, start: iso(at(D, '05:00')), finish: iso(at(D, '05:20')), extra: 1, approx: 'yes' })).toEqual({ v: 1, start: iso(at(D, '05:00')), finish: iso(at(D, '05:20')) });
  });
});

const lap = (day: string, min: number, approx?: boolean): Lap => ({ day, ms: min * 60_000, ...(approx ? { approx } : {}) });
describe('the best, the average and the streak', () => {
  it('nothing raced yet: nothing to show', () => {
    expect(board([])).toEqual({ best: null, average: null, streak: 0, count: 0 });
  });
  it('the best is the fastest day, the average is over the days raced', () => {
    const b = board([lap('2026-11-02', 30), lap('2026-11-03', 20), lap('2026-11-05', 25)]);
    expect(b.best?.day).toBe('2026-11-03');
    expect(b.average).toBe(25 * 60_000);
    expect(b.count).toBe(3);
  });
  it('the streak: days in a row, newest first, each faster than the average of the days before it', () => {
    // before the 5th: 30, 30, 30 → 25 is faster; before the 6th: avg 28.75 → 24 faster; before the 7th: avg 27.8 → 29 isn't
    expect(board([lap('2026-11-01', 30), lap('2026-11-02', 30), lap('2026-11-03', 30), lap('2026-11-05', 25), lap('2026-11-06', 24)]).streak).toBe(2);
    expect(board([lap('2026-11-01', 30), lap('2026-11-02', 30), lap('2026-11-03', 30), lap('2026-11-05', 25), lap('2026-11-06', 24), lap('2026-11-07', 29)]).streak).toBe(0);
  });
  it('a day with no gym in between neither counts nor breaks it; the first three days set the pace', () => {
    expect(board([lap('2026-11-01', 30), lap('2026-11-02', 30), lap('2026-11-03', 30), lap('2026-11-08', 20)]).streak).toBe(1);
    expect(board([lap('2026-11-01', 40), lap('2026-11-02', 30), lap('2026-11-03', 20)]).streak).toBe(0);
  });
  it('"New best!" only when today beats every day before it, and never on the very first race', () => {
    const laps = [lap('2026-11-09', 30), lap('2026-11-10', 26), lap(D, 25)];
    expect(isNewBest(laps, D)).toBe(true);
    expect(isNewBest([lap('2026-11-10', 25), lap(D, 25)], D)).toBe(false);
    expect(isNewBest([lap(D, 25)], D)).toBe(false);
    expect(isNewBest(laps, '2026-11-12')).toBe(false);
  });
});

describe('the clock while a race is on', () => {
  it('reads minutes and seconds, hours when it gets there', () => {
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(23 * 60_000 + 40_000)).toBe('23:40');
    expect(clockOf(3_729_000)).toBe('1:02:09');
    expect(clockOf(-5)).toBe('0:00');
    expect(wordsOf(23 * 60_000 + 40_000)).toBe('23 min 40 s');
    expect(wordsOf(3_720_000)).toBe('1 h 2 min');
  });
  it('is worked out from the stored start, so a phone that slept shows the right time when it wakes', () => {
    const start = at(D, '05:04');
    expect(liveView(start, start + 17 * 60_000 + 5_000, null)).toMatchObject({ text: '17:05', ahead: null, word: '' });
  });
  it('says how far ahead of the best or behind it, and how much of the best is used up', () => {
    const start = at(D, '05:04'), best = 23 * 60_000 + 40_000;
    expect(liveView(start, start + 22 * 60_000 + 28_000, best)).toMatchObject({ word: '1:12 ahead', fill: (22 * 60 + 28) / (23 * 60 + 40) });
    expect(liveView(start, start + 25 * 60_000 + 45_000, best)).toMatchObject({ word: '2:05 behind', fill: 1 });
  });
});

describe('what gets kept, day by day', () => {
  const day = (key: string, up: string, first: string | null, approx = false): RaceDay => ({
    key, ticks: { up }, workouts: first ? [session(key, at(key, first) - 60_000, [approx ? null : at(key, first)])] : [],
  });
  it('the days gone by are filled in the first time, so the board isn’t empty the day the widget is added', () => {
    const { writes, results } = settle('gym', D, {}, [day('2026-11-09', '05:00', '05:30'), day('2026-11-10', '05:00', null), day(D, '05:02', '05:25')]);
    expect(writes.map(w => w.day)).toEqual(['2026-11-09', D]);
    expect(Object.keys(results).sort()).toEqual(['2026-11-09', D]);
  });
  it('a day gone by that is already kept is left as it is; a day taken off stays off', () => {
    const kept = { '2026-11-09': resultOf({ at: at('2026-11-09', '05:00') }, { at: at('2026-11-09', '05:40') }), '2026-11-10': { v: 1 as const, removed: true as const } };
    const { writes, results } = settle('gym', D, kept, [day('2026-11-09', '05:00', '05:30'), day('2026-11-10', '05:00', '05:10')]);
    expect(writes).toEqual([]);
    expect(lapOf('2026-11-09', results['2026-11-09'])!.ms).toBe(40 * 60_000);
    expect(lapOf('2026-11-10', results['2026-11-10'])).toBeNull();
  });
  it('today follows the day: kept when it finishes, gone again when the tick is undone', () => {
    const done = settle('gym', D, {}, [day(D, '05:02', '05:25')]);
    expect(done.writes).toHaveLength(1);
    const kept = { [D]: done.writes[0].data };
    expect(settle('gym', D, kept, [day(D, '05:02', '05:25')]).writes).toEqual([]);
    expect(settle('gym', D, kept, [{ key: D, ticks: {}, workouts: [] }]).writes).toEqual([{ day: D, data: null }]);
  });
  it('an older session’s day is kept as approximate', () => {
    expect(settle('gym', D, {}, [day('2026-11-09', '05:00', '05:30', true)]).writes[0].data).toMatchObject({ approx: true });
  });
  it('one by hand is only what was kept: nothing is worked out or written', () => {
    const kept = { [D]: { v: 1 as const, start: iso(at(D, '19:00')) } };
    expect(settle('manual', D, kept, [day(D, '05:02', '05:25')])).toEqual({ results: kept, writes: [] });
  });
});

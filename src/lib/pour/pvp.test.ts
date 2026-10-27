import { describe, expect, it } from 'vitest';
import { CUTOFF_MS, ROUND_MAX_MS, clock, headToHead, scoreMatch, scoreRound, type Match, type RoundEntry } from './pvp';
import { makeDeal, makeLevel, levelSize, solve } from './engine';

const e = (finished_ms: number | null, moves: number, penalty_ms = 0, gave_up = false): RoundEntry =>
  ({ sorted: 0, total: 5, moves, penalty_ms, finished_ms, gave_up });

describe('points for a round', () => {
  it('faster +3, fewer moves +2, finishing +1', () => {
    const [a, b] = scoreRound(e(30_000, 14), e(40_000, 20));
    expect(a.points).toBe(6); expect(b.points).toBe(1);
    expect(a.faster && a.fewer).toBe(true);
  });
  it('splits the points when one is faster and the other uses fewer moves', () => {
    const [a, b] = scoreRound(e(30_000, 20), e(40_000, 14));
    expect([a.points, b.points]).toEqual([4, 3]);
  });
  it('counts helper time: a hint can cost you the speed points', () => {
    const [a, b] = scoreRound(e(30_000, 14, 5000 + 10_000), e(40_000, 14));
    expect(a.time).toBe(45_000);
    expect(a.faster).toBe(false); expect(b.faster).toBe(true);
    expect([a.points, b.points]).toEqual([2, 5]);   // same moves: +1 each
  });
  it('gives everything to the only finisher, nothing to someone who gave up or ran out', () => {
    const [a, b] = scoreRound(e(50_000, 30), e(null, 3, 0, true));
    expect([a.points, b.points]).toEqual([6, 0]);
    expect(b.gaveUp).toBe(true);
    const [c, d] = scoreRound(undefined, undefined);
    expect([c.points, d.points]).toEqual([0, 0]);
  });
});

describe('the match', () => {
  const m = (board: Match['board']) => ({ board, levels: [8, 12, 16] });
  it('adds up the rounds and picks the leader', () => {
    const s = scoreMatch(m({ v: { 0: e(30_000, 14), 1: e(60_000, 20), 2: e(null, 5, 0, true) }, r: { 0: e(35_000, 16), 1: e(50_000, 25), 2: e(90_000, 40) } }), 'v', 'r');
    expect(s.points).toEqual([6 + 3, 1 + 4 + 6]);
    expect(s.leader).toBe(1);
  });
  it('breaks a tie on points with the total time (a missed round counts until it closed)', () => {
    const s = scoreMatch(m({ v: { 0: e(30_000, 14) }, r: { 0: e(null, 3, 2000, true), 1: e(20_000, 10) } }), 'v', 'r', 2);
    expect(s.points).toEqual([6, 6]);
    expect(s.time).toEqual([30_000 + 20_000 + CUTOFF_MS, 30_000 + CUTOFF_MS + 2000 + 20_000]);
    expect(s.leader).toBe(0);
    // nobody finished: the round counts the full 5 minutes for both
    expect(scoreMatch(m({}), 'v', 'r', 1).time).toEqual([ROUND_MAX_MS, ROUND_MAX_MS]);
  });
  it('keeps a head-to-head record per opponent', () => {
    const base = { code: 'ABCD', levels: [8], seeds: [1], round: 0, round_start: null, round_end: null, left_by: null, next_match: null, finished_at: '', now: '' };
    const V = { id: 'v', name: 'Vijay' }, R = { id: 'r', name: 'Rosh' };
    const hist = [
      { ...base, id: '1', status: 'done', host: V, guest: R, board: { v: { 0: e(1, 1) }, r: { 0: e(2, 2) } } },
      { ...base, id: '2', status: 'done', host: R, guest: V, board: { v: { 0: e(3, 3) }, r: { 0: e(2, 2) } } },
      { ...base, id: '3', status: 'done', host: R, guest: V, board: { v: { 0: e(1, 1) }, r: { 0: e(2, 2) } } },
      { ...base, id: '4', status: 'left', host: R, guest: V, board: {} },
    ] as Match[];
    expect(headToHead(hist, 'v')).toEqual([{ id: 'r', name: 'Rosh', won: 2, lost: 1, drawn: 0 }]);
    expect(headToHead(hist, 'r')[0]).toMatchObject({ name: 'Vijay', won: 1, lost: 2 });
  });
  it('shows times as m:ss.s', () => {
    expect(clock(67_400)).toBe('1:07.4');
    expect(clock(5_049)).toBe('0:05.0');
  });
});

describe('head-to-head puzzles', () => {
  it('deal the same puzzle for the same seed, a different one for another, the size of the level, and solvable', () => {
    expect(makeDeal(12, 4242)).toEqual(makeDeal(12, 4242));
    expect(makeDeal(12, 4242)).not.toEqual(makeDeal(12, 4243));
    expect(makeDeal(12, 4242).length).toBe(levelSize(12).colours + levelSize(12).empties);
    expect(solve(makeDeal(16, 99))).not.toBeNull();
  });
  it('leave the solo levels exactly as they were', () => {
    expect(makeLevel(7)).toEqual(makeDeal(7, 7 * 7919 + 17));
  });
});

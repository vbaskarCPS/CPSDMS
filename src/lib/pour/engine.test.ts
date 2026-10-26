import { describe, expect, it } from 'vitest';
import { CAP, canPour, hint, isDone, isWon, levelSize, longestRun, makeLevel, pour, solve, topRun, type Bottle } from './engine';

describe('pouring', () => {
  it('pours the whole top run onto the same colour or an empty bottle', () => {
    const b: Bottle[] = [[0, 1, 1], [1], []];
    expect(canPour(b, 0, 1)).toBe(true);
    expect(pour(b, 0, 1)).toEqual([[0], [1, 1, 1], []]);
    expect(pour(b, 0, 2)).toEqual([[0], [1], [1, 1]]);
  });
  it('only pours what fits', () => {
    expect(pour([[2, 2, 2], [1, 2, 2]], 0, 1)).toEqual([[2, 2], [1, 2, 2, 2]]);
  });
  it('refuses onto a different colour, into a full bottle, from empty, or onto itself', () => {
    expect(canPour([[0], [1]], 0, 1)).toBe(false);
    expect(canPour([[0], [0, 0, 0, 0]], 0, 1)).toBe(false);
    expect(canPour([[], [0]], 0, 1)).toBe(false);
    expect(canPour([[0], []], 0, 0)).toBe(false);
  });
  it('does not change the bottles it was given', () => {
    const b: Bottle[] = [[0, 1], []];
    pour(b, 0, 1);
    expect(b).toEqual([[0, 1], []]);
  });
  it('knows a finished bottle and a won level', () => {
    expect(topRun([3, 1, 1])).toBe(2);
    expect(longestRun([1, 1, 1, 3])).toBe(3);
    expect(isDone([1, 1, 1, 1])).toBe(true);
    expect(isDone([1, 1, 1])).toBe(false);
    expect(isWon([[1, 1, 1, 1], [], [2, 2, 2, 2]])).toBe(true);
    expect(isWon([[1, 1, 1], [1]])).toBe(false);
  });
});

describe('levels', () => {
  it('start with 3 colours and add one every three levels, up to 12', () => {
    expect(levelSize(1)).toEqual({ colours: 3, empties: 2 });
    expect(levelSize(3).colours).toBe(3);
    expect(levelSize(4).colours).toBe(4);
    expect(levelSize(28).colours).toBe(12);
    expect(levelSize(500).colours).toBe(12);
  });
  it('are the same puzzle every time for the same level number', () => {
    expect(makeLevel(37)).toEqual(makeLevel(37));
    expect(makeLevel(5)).not.toEqual(makeLevel(6));
  });
  it('have four of each colour, two empties, and no bottle already mostly sorted', () => {
    for (const lvl of [1, 10, 30]) {
      const b = makeLevel(lvl);
      const { colours } = levelSize(lvl);
      expect(b.length).toBe(colours + 2);
      expect(b.filter(x => !x.length).length).toBe(2);
      const count = new Map<number, number>();
      b.flat().forEach(c => count.set(c, (count.get(c) || 0) + 1));
      expect([...count.values()].every(n => n === CAP)).toBe(true);
      expect(b.every(x => longestRun(x) < 3)).toBe(true);
    }
  });
  it('can always be solved, and the solution really finishes the level', () => {
    for (const lvl of [1, 2, 7, 15, 22, 28, 40, 60]) {
      let b = makeLevel(lvl);
      const moves = solve(b);
      expect(moves).not.toBeNull();
      for (const m of moves!) { expect(canPour(b, m.from, m.to)).toBe(true); b = pour(b, m.from, m.to); }
      expect(isWon(b)).toBe(true);
    }
  }, 60_000);
});

describe('hints', () => {
  it('give a legal move that keeps the level solvable', () => {
    const b = makeLevel(12);
    const m = hint(b)!;
    expect(canPour(b, m.from, m.to)).toBe(true);
    expect(solve(pour(b, m.from, m.to))).not.toBeNull();
  });
  it('say so when there is no way out', () => {
    expect(hint([[0, 1, 0, 1], [1, 0, 1, 0]])).toBeNull();
  });
});

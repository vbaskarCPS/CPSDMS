import { describe, expect, it } from 'vitest';
import { FLEET, SEAS, accuracy, anchor, battleRecord, cellsOf, fits, fleetOk, randomFleet, toShips, type BattleHistory, type Fleet } from './fleet';
import { THEMES } from '../memory/themes';
import { rng } from '../pour/engine';

describe('placing ships', () => {
  it('knows the cells a ship covers, and not past the edge', () => {
    expect(cellsOf({ start: 0, across: true }, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(cellsOf({ start: 7, across: false }, 3)).toEqual([7, 17, 27]);
    expect(cellsOf({ start: 7, across: true }, 4)).toBeNull();   // would wrap to the next row
    expect(cellsOf({ start: 85, across: false }, 2)).toEqual([85, 95]);
    expect(cellsOf({ start: 85, across: false }, 3)).toBeNull();
  });
  it('stops ships overlapping', () => {
    const f: Fleet = [{ start: 0, across: true }, null, null, null, null];
    expect(fits(f, 1, { start: 2, across: false })).toBe(false);
    expect(fits(f, 1, { start: 10, across: true })).toBe(true);
    expect(fits(f, 0, { start: 1, across: true })).toBe(true);   // moving a ship over its own old spot is fine
  });
  it('turns the finger position into where the ship starts', () => {
    expect(anchor(23, 2, true)).toBe(21);
    expect(anchor(43, 2, false)).toBe(23);
  });
  it('makes random fleets the server accepts, every time', () => {
    const r = rng(42);
    for (let k = 0; k < 300; k++) expect(fleetOk(toShips(randomFleet(r)))).toBe(true);
  });
  it('checks fleets like the server does', () => {
    expect(fleetOk([[0, 1, 2, 3, 4], [10, 11, 12, 13], [20, 21, 22], [30, 31, 32], [40, 41]])).toBe(true);
    expect(fleetOk([[8, 9, 10, 11, 12], [20, 21, 22, 23], [40, 41, 42], [60, 61, 62], [80, 81]])).toBe(false);
    expect(fleetOk([[0, 1, 2, 3, 4], [1, 11, 21, 31], [20, 21, 22], [30, 31, 32], [40, 41]])).toBe(false);
    expect(fleetOk([[0, 11, 22, 33, 44], [50, 51, 52, 53], [60, 61, 62], [70, 71, 72], [80, 81]])).toBe(false);
    expect(toShips([{ start: 0, across: true }, null, null, null, null])).toBeNull();
    expect(FLEET.map(s => s.len)).toEqual([5, 4, 3, 3, 2]);
  });
});

describe('the record and the look', () => {
  it('counts wins and losses per opponent, and accuracy', () => {
    const V = { id: 'v', name: 'Vijay' }, R = { id: 'r', name: 'Rosh' };
    const h: BattleHistory = [
      { id: '1', host: V, guest: R, winner: 'v', host_shots: 40, guest_shots: 38, finished_at: '' },
      { id: '2', host: R, guest: V, winner: 'r', host_shots: 30, guest_shots: 31, finished_at: '' },
      { id: '3', host: R, guest: V, winner: 'v', host_shots: 50, guest_shots: 44, finished_at: '' },
    ];
    expect(battleRecord(h, 'v')).toEqual([{ id: 'r', name: 'Rosh', won: 2, lost: 1 }]);
    expect(accuracy([{ c: 1, hit: true }, { c: 2, hit: false }, { c: 3, hit: false }, { c: 4, hit: true }])).toEqual({ shots: 4, hits: 2, pct: 50 });
  });
  it('has a sea for every holiday theme', () => {
    expect(Object.keys(SEAS).sort()).toEqual(Object.keys(THEMES).sort());
  });
});

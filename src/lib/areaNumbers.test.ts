import { describe, expect, it } from 'vitest';
import { baseName, checkPrefix, firstFree, mapsLabel, ownedNumbers, runsLabel, takenNumbers, type AreaSpan, type Drawn } from './areaNumbers';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const AN: AreaSpan[] = [
  { area_name: 'AJAX NORTH #1', prefix: 'AN', route_start: 1, route_count: 22 },
  { area_name: 'AJAX NORTH #2', prefix: 'AN', route_start: 23, route_count: 19 },
  { area_name: 'AJAX NORTH #3', prefix: 'AN', route_start: 42, route_count: 24 },
  { area_name: 'AJAX NORTH #4', prefix: 'AN', route_start: 66, route_count: 21 },
  { area_name: 'ACTON', prefix: 'ACN', route_start: 1, route_count: 13 },
];
const drawn: Drawn = new Map([
  ['AJAX NORTH #1', new Set(range(1, 22))], ['AJAX NORTH #2', new Set(range(23, 41))],
  ['AJAX NORTH #3', new Set(range(42, 65))], ['AJAX NORTH #4', new Set(range(66, 80))],   // #4 hasn't drawn 81–86 yet
  ['ACTON', new Set(range(1, 13))],
]);

describe('names', () => {
  it('drops the # to find the run a map belongs to', () => {
    expect(baseName('ajax north #12')).toBe('AJAX NORTH');
    expect(baseName('ACTON')).toBe('ACTON');
    expect(baseName('BOWMANVILLE #1`')).toBe('BOWMANVILLE');
    expect(baseName('LINDSAY 2')).toBe('LINDSAY');
    expect(baseName('RIVERSIDE  SOUTH #2')).toBe('RIVERSIDE SOUTH');
    expect(mapsLabel(['AJAX NORTH #1', 'AJAX NORTH #2', 'AJAX NORTH #4'])).toBe('AJAX NORTH #1–#4');
    expect(mapsLabel(['ACTON'])).toBe('ACTON');
  });
  it('writes number runs', () => {
    expect(runsLabel('an', [3, 1, 2, 5, 9, 10])).toBe('AN01–AN03 · AN05 · AN09–AN10');
    expect(runsLabel('AN', [])).toBe('');
  });
});

describe('checkPrefix', () => {
  it('a new prefix starts at 01', () => {
    expect(checkPrefix('BRAND NEW', 'bnw', AN, drawn)).toEqual({ kind: 'new', start: 1 });
    expect(checkPrefix('X', '', AN, drawn)).toEqual({ kind: 'empty' });
  });
  it('a #5 continues the run after the last number anyone holds', () => {
    const c = checkPrefix('AJAX NORTH #5', 'AN', AN, drawn);
    expect(c).toMatchObject({ kind: 'continue', start: 87, label: 'AN01–AN86' });
  });
  it('another name on a used prefix is a clash, with the next # suggested', () => {
    const c = checkPrefix('ANCASTER', 'AN', AN, drawn);
    expect(c).toMatchObject({ kind: 'clash', suggest: 'AJAX NORTH #5' });
    expect(checkPrefix('ACTON NORTH', 'ACN', AN, drawn)).toMatchObject({ kind: 'clash', suggest: 'ACTON #2' });
  });
  it('names written without # or with stray spaces still continue', () => {
    const lin: AreaSpan[] = [{ area_name: 'LINDSAY 1', prefix: 'LIN', route_start: 1, route_count: 10 }, { area_name: 'LINDSAY 2', prefix: 'LIN', route_start: 11, route_count: 10 }];
    expect(checkPrefix('LINDSAY 3', 'LIN', lin, new Map())).toMatchObject({ kind: 'continue', start: 21 });
    expect(checkPrefix('LINDSAY #3', 'LIN', lin, new Map())).toMatchObject({ kind: 'continue', start: 21 });
    expect(checkPrefix('LINDSAY', 'LIN', lin, new Map())).toMatchObject({ kind: 'clash', suggest: 'LINDSAY #3' });
  });
  it("editing a map doesn't clash with itself", () => {
    expect(checkPrefix('ACTON', 'ACN', AN, drawn, 'ACTON')).toEqual({ kind: 'new', start: 1 });
  });
});

describe('growing a map past its neighbours', () => {
  it('takes the first free number, and keeps out of the maps it jumped over', () => {
    const taken = takenNumbers('AN', AN, drawn, 'AJAX NORTH #1');
    const next = firstFree(taken, 23);
    expect(next).toBe(87);
    // #1 now spans 1–87
    const grown = AN.map(a => a.area_name === 'AJAX NORTH #1' ? { ...a, route_count: 87 } : a);
    const d2: Drawn = new Map(drawn); d2.set('AJAX NORTH #1', new Set([...range(1, 22), 87]));
    expect(runsLabel('AN', ownedNumbers(grown[0], grown, d2))).toBe('AN01–AN22 · AN87');
    // #4's undrawn 81–86 stay #4's
    expect(runsLabel('AN', ownedNumbers(grown[3], grown, d2))).toBe('AN66–AN86');
    // and the next #5 starts after 87
    expect(checkPrefix('AJAX NORTH #5', 'AN', grown, d2)).toMatchObject({ kind: 'continue', start: 88 });
  });
  it('a plain map owns its span', () => {
    expect(ownedNumbers(AN[4], AN, drawn)).toEqual(range(1, 13));
  });
});

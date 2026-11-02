// Splitting a city's main roads between reps.
import { describe, expect, it } from 'vitest';
import { hilbert, shareName, splitRoads, type RoadPiece } from './msSplit';

// a 10 × 10 grid of 100 m road pieces, west–east roads named by row
const grid: RoadPiece[] = [];
for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
  const x = -79.7 + c * 0.0013, y = 43.45 + r * 0.0013;
  grid.push({ id: r * 10 + c, name: `Row ${r} Street`, m: 100, coords: [[x, y], [x + 0.0012, y]] });
}

describe('hilbert', () => {
  it('visits every cell once', () => {
    const seen = new Set<number>();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(hilbert(3, x, y));
    expect(seen.size).toBe(64);
  });
});

describe('splitRoads', () => {
  it('cuts the roads into equal shares, every piece used once', () => {
    const s = splitRoads(grid, 4);
    expect(s).toHaveLength(4);
    expect(s.map(x => x.m)).toEqual([2500, 2500, 2500, 2500]);
    expect(new Set(s.flatMap(x => x.pieces.map(p => p.id))).size).toBe(100);
  });
  it('keeps each share together on the map', () => {
    for (const sh of splitRoads(grid, 4)) {
      const xs = sh.pieces.map(p => p.coords[0][0]), ys = sh.pieces.map(p => p.coords[0][1]);
      // a quarter of a 10 × 10 grid fits in about 5 × 5 cells
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.0013 * 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.0013 * 6);
    }
  });
  it('never makes more shares than pieces, and handles nothing', () => {
    expect(splitRoads(grid.slice(0, 3), 8)).toHaveLength(3);
    expect(splitRoads([], 3)).toEqual([]);
  });
});

describe('shareName', () => {
  it('names a share by its two longest roads, shortened', () => {
    expect(shareName(['Trafalgar Road', 'Dundas Street East', 'Third Line'])).toBe('Trafalgar Rd & Dundas St E');
    expect(shareName([])).toBe('Main roads');
  });
});

import { describe, expect, it } from 'vitest';
import { normStreet, routeStreetGaps, sameStreet, streetKey } from './mapLogsheetService';

describe('numbered roads', () => {
  it('treats No. 2 Road and Number 2 Road as one street', () => {
    expect(streetKey(normStreet('No. 2 Road'))).toBe(normStreet('Number 2 Road'));
    expect(sameStreet(normStreet('No 2 Rd'), normStreet('Number 2 Road'))).toBe(true);
    expect(sameStreet(normStreet('No 3 Rd'), normStreet('Number 2 Road'))).toBe(false);
  });
});

describe('routeStreetGaps', () => {
  // ~330 m of street running north
  const line: [number, number][] = [[-123.16, 49.13], [-123.16, 49.133]];
  const rm = { route_code: 'R1', segments: [{ name: 'Pintail Drive', coordinates: line }] } as never;
  const h = (n: number) => ({ routeCode: 'R1', streetNorm: 'pintail dr', civicNo: n }) as never;
  it('a long street with one house is still a gap', () => {
    expect(routeStreetGaps(rm, [h(1)]).map(g => g.norm)).toEqual(['pintail dr']);
  });
  it('a street with houses along it is not', () => {
    expect(routeStreetGaps(rm, [1, 2, 3, 4, 5].map(h))).toEqual([]);
  });
});

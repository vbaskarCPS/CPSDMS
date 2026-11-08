import { describe, expect, it } from 'vitest';
import { tidyGaps, type TidyLine } from './tidyGaps';
import type { LngLat } from './autoRoutes';

// a street grid about 100 m a block: avenues run east–west (y), streets north–south (x)
const X = (i: number) => -122.3 + i * 0.00137;   // ~100 m of longitude at 49°
const Y = (j: number) => 49.05 + j * 0.0009;     // ~100 m of latitude
let nextId = 1;
const ew = (j: number, i0: number, i1: number): TidyLine[] => Array.from({ length: i1 - i0 }, (_, k) => ({ id: nextId++, name: `Avenue ${j}`, geometry: [[X(i0 + k), Y(j)], [X(i0 + k + 1), Y(j)]] as LngLat[] }));
const ns = (i: number, j0: number, j1: number): TidyLine[] => Array.from({ length: j1 - j0 }, (_, k) => ({ id: nextId++, name: `Street ${i}`, geometry: [[X(i), Y(j0 + k)], [X(i), Y(j0 + k + 1)]] as LngLat[] }));
const lines = (ls: TidyLine[]) => ls.map(l => l.geometry);

describe('tidyGaps', () => {
  it('puts every gap street on a route, joins a small patch to the own route it touches, cuts a big patch into whole routes', () => {
    // the map's own route: a block in the west
    const own = [...ew(0, 0, 4), ...ew(4, 0, 4), ...ns(0, 0, 4), ...ns(4, 0, 4)];
    // a cul-de-sac off it (small patch, 200 m)
    const cul = ew(2, 4, 6);
    // a big patch off to the east (a 10 × 6 block grid, well apart from the own route)
    const big: TidyLine[] = [];
    for (let j = 0; j <= 6; j++) big.push(...ew(j, 20, 30));
    for (let i = 20; i <= 30; i++) big.push(...ns(i, 0, 6));
    const out = tidyGaps({ originals: [{ num: 1, lines: lines(own) }], gaps: [...cul, ...big] });

    const ids = new Set(out.flatMap(g => g.pieces.map(p => p.wayId)));
    for (const l of [...cul, ...big]) expect(ids.has(l.id)).toBe(true);

    const joined = out.filter(g => g.joinTo != null);
    expect(joined).toHaveLength(1);
    expect(joined[0].joinTo).toBe(1);
    expect(new Set(joined[0].pieces.map(p => p.wayId))).toEqual(new Set(cul.map(l => l.id)));

    const routes = out.filter(g => g.joinTo == null);
    expect(routes.length).toBeGreaterThanOrEqual(3);
    // each route in one piece: its pieces connect through shared corners
    for (const r of routes) {
      const key = (p: LngLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
      const seen = new Set<number>([0]); let grew = true;
      while (grew) {
        grew = false;
        r.pieces.forEach((p, k) => {
          if (seen.has(k)) return;
          const ends = new Set(p.geometry.map(key));
          if ([...seen].some(s => r.pieces[s].geometry.some(q => ends.has(key(q))))) { seen.add(k); grew = true; }
        });
      }
      expect(seen.size).toBe(r.pieces.length);
    }
  });

  it('a patch that touches no own route and is under a route long stays a route of its own', () => {
    const own = ew(0, 0, 4);
    const far = [...ew(20, 40, 52)];   // 1.2 km, far from the own route
    const out = tidyGaps({ originals: [{ num: 7, lines: lines(own) }], gaps: far });
    expect(out).toHaveLength(1);
    expect(out[0].joinTo).toBeUndefined();
    expect(out[0].pieces).toHaveLength(far.length);
  });
});

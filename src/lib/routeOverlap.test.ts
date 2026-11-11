import { describe, expect, it } from 'vitest';
import { leftOut, savedSegKey, segKey, sharedLabel, sharedWays, trimsLabel, withoutTrimmed, type Trim, type WayLike } from './routeOverlap';

const way = (id: number, name: string, geometry: [number, number][], rootId?: number): WayLike => ({ id, name, geometry, rootId });
const W1 = way(1, '158 Street', [[-122.786, 49.181], [-122.786, 49.183]]);
const W2 = way(2, '94 Avenue', [[-122.79, 49.18], [-122.788, 49.18], [-122.785, 49.18]]);
const W3 = way(900001, '95 Avenue', [[-122.78, 49.185], [-122.779557, 49.185]], 35488001);   // a piece split off road 35488001
const route = (num: number, ids: number[], status = 'approved') => ({ num, status, selectedWayIds: new Set(ids) });
const code = (n: number) => `NSR${String(n).padStart(2, '0')}`;

describe('segKey', () => {
  it('is the key the database gives the saved piece: the road (or the road it was split from), its ends, its point count', () => {
    expect(segKey(W2)).toBe('2|-122.79,49.18|-122.785,49.18|3');
    expect(segKey(W3)).toBe('35488001|-122.78,49.185|-122.779557,49.185|2');
    expect(segKey(W3)).toBe(savedSegKey({ osmId: 35488001, coordinates: W3.geometry }));
  });
});

describe('sharedWays', () => {
  it('finds a road on two approved routes of the map', () => {
    const s = sharedWays([route(42, [1, 2]), route(70, [1]), route(43, [3])], [W1, W2, W3]);
    expect(s).toEqual([{ wayId: 1, name: '158 Street', nums: [42, 70] }]);
  });
  it('ignores routes that are not approved (a flagged copy, a pending draft)', () => {
    expect(sharedWays([route(42, [1]), route(70, [1], 'flagged'), route(71, [1], 'pending')], [W1])).toEqual([]);
  });
  it('says which street and which routes, one line', () => {
    const s = sharedWays([route(42, [1, 2]), route(70, [1, 2]), route(41, [2])], [W1, W2]);
    expect(sharedLabel(s, code)).toBe('158 Street (NSR42 and NSR70); 94 Avenue (NSR41, NSR42, and NSR70)');
  });
});

describe('leftOut', () => {
  it('is what was sent and did not come back', () => {
    const sent = [W1, W2].map(w => ({ osmId: w.id, name: w.name, coordinates: w.geometry }));
    const t = leftOut('NSR70', 70, sent, [sent[0]]);
    expect(t).toEqual([{ route_code: 'NSR70', route_number: 70, seg_key: segKey(W2), street: '94 Avenue', meters: null, kept_by: null }]);
    expect(leftOut('NSR70', 70, sent, sent)).toEqual([]);
  });
});

describe('withoutTrimmed', () => {
  it('takes the left-out pieces off their route only, so the tab matches what was saved', () => {
    const routes = [route(70, [1, 2]), route(42, [2])];
    const trims: Trim[] = [{ route_code: 'NSR70', route_number: 70, seg_key: segKey(W2), street: '94 Avenue', meters: 95, kept_by: ['NSR42'] }];
    const out = withoutTrimmed(routes, [W1, W2], trims);
    expect([...out[0].selectedWayIds]).toEqual([1]);
    expect(out[1]).toBe(routes[1]);
  });
});

describe('trimsLabel', () => {
  it('says which streets were left out and which routes have them', () => {
    const trims: Trim[] = [
      { route_code: 'NSR70', route_number: 70, seg_key: 'a', street: '94 Avenue', meters: 95, kept_by: ['NSR42'] },
      { route_code: 'NSR70', route_number: 70, seg_key: 'b', street: '94 Avenue', meters: 80, kept_by: ['NSR42'] },
      { route_code: 'NSR71', route_number: 71, seg_key: 'c', street: '', meters: 40, kept_by: null },
    ];
    expect(trimsLabel(trims)).toBe('Left out 3 street pieces already on other maps: 94 Avenue (on NSR42), an unnamed road. To move a street here, take it off the other map first.');
    expect(trimsLabel([])).toBe('');
  });
});

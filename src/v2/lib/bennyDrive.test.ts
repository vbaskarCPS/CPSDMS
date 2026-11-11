// An order put in driving order: the ordering itself, and what happens when the roads can't be read.
import { describe, it, expect, vi } from 'vitest';
vi.mock('./client', () => ({ db: {}, must: (x: unknown) => x }));
import { bestOrder, byRoad, orderCost, orderInWords, withOrder } from './bennyDrive';
import type { StopsCheck } from './bennyActions';
import type { BennyMap } from './benny';

const stop = (n: number, who: string, lat: number, lng: number) => ({ n, label: `Pickup ${n} · ${who}`, who, lat, lng, by: 'route' as const, route: 'R' + n });
const plan = (start = true): StopsCheck => ({ ok: true, kind: 'pickup', date: '2026-11-10', manager: 'rm_x', km: 9, ...(start ? { start: { lat: 0, lng: 0 } } : {}),
  stops: [stop(1, 'Ann', 0, 1), stop(2, 'Bo', 0, 2), stop(3, 'Cy', 0, 3)] });
/** Points on a line, where a "river" makes Bo (2) slow to reach from the west and quick from the east. */
const river = [
  // from: start  Ann   Bo    Cy
  [0, 60, 900, 180],     // start
  [60, 0, 900, 120],     // Ann
  [900, 900, 0, 60],     // Bo
  [180, 120, 60, 0],     // Cy
];
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('driving order', () => {
  it('the best order by time goes round the river, not along the line', () => {
    expect(bestOrder(river, [1, 2, 3], 0)).toEqual([1, 3, 2]);            // Ann, Cy, then Bo: 60 + 120 + 60 = 240 s (in line: 60 + 900 + 60)
    expect(orderCost(river, [1, 3, 2], 0)).toBe(240);
    expect(orderCost(river, [1, 2, 3], 0)).toBe(1020);
    expect(bestOrder(river, [1, 2, 3], null)).toEqual([1, 3, 2]);         // no start: begin where the whole drive is shortest
    expect(bestOrder(river, [2], 0)).toEqual([2]);
    expect(bestOrder(river, [], 0)).toEqual([]);
  });
  it('more than 8 stops: still never worse than visiting them as given', () => {
    const n = 12; const pts = Array.from({ length: n + 1 }, (_, i) => [Math.sin(i * 2.1) * 10, Math.cos(i * 1.3) * 10]);
    const cost = pts.map(a => pts.map(b => Math.hypot(a[0] - b[0], a[1] - b[1])));
    const stops = Array.from({ length: n }, (_, i) => i + 1);
    const best = bestOrder(cost, stops, 0);
    expect([...best].sort((a, b) => a - b)).toEqual(stops);                // every stop once
    expect(orderCost(cost, best, 0)).toBeLessThanOrEqual(orderCost(cost, stops, 0));
    // one-way costs are respected too
    const oneWay = cost.map((row, i) => row.map((v, j) => (j < i ? v * 3 : v)));
    expect(orderCost(oneWay, bestOrder(oneWay, stops, 0), 0)).toBeLessThanOrEqual(orderCost(oneWay, stops, 0));
  });
  it('re-orders the plan by the road, renumbers the pins and keeps the road line', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => { calls.push(url);
      return url.includes('directions-matrix') ? ok({ code: 'Ok', durations: river, distances: river.map(r => r.map(v => v * 10)) })
        : ok({ code: 'Ok', routes: [{ duration: 250, distance: 2600, geometry: { coordinates: [[0, 0], [1, 0], [3, 0], [2, 0]] } }] }); }) as unknown as typeof fetch;
    const r = (await byRoad(plan(), fetcher, 'pk.real'))!;
    expect(r.check.stops.map(s => [s.n, s.who, s.label])).toEqual([[1, 'Ann', 'Pickup 1 · Ann'], [2, 'Cy', 'Pickup 2 · Cy'], [3, 'Bo', 'Pickup 3 · Bo']]);
    expect(r.check).toMatchObject({ by_road: true, minutes: 4, km: 2.6 });
    expect(r.line).toEqual([[0, 0], [1, 0], [3, 0], [2, 0]]);
    expect(calls[0]).toContain('/mapbox/driving/0.000000,0.000000;1.000000,0.000000;2.000000,0.000000;3.000000,0.000000?annotations=duration,distance');
    expect(calls[1]).toContain('/directions/v5/mapbox/driving/0.000000,0.000000;1.000000,0.000000;3.000000,0.000000;2.000000,0.000000?');   // the new order's road
    expect(orderInWords(r.check)).toBe('Ann, then Cy, then Bo: about 4 min of driving (2.6 km).');
  });
  it('keeps the straight-line plan when the roads can’t be read', async () => {
    const down = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const throws = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const noRoad = (async () => ok({ code: 'Ok', durations: [[0, null, 5, 5], [null, 0, null, null], [5, null, 0, 5], [5, null, 5, 0]] })) as unknown as typeof fetch;
    expect(await byRoad(plan(), down, 'pk.real')).toBeNull();
    expect(await byRoad(plan(), throws, 'pk.real')).toBeNull();
    expect(await byRoad(plan(), noRoad, 'pk.real')).toBeNull();                       // a stop no road reaches
    expect(await byRoad(plan(), down, '')).toBeNull();                                // no map token
    expect(await byRoad({ ...plan(), stops: Array.from({ length: 30 }, (_, i) => stop(i + 1, 'W' + i, 0, i)) }, down, 'pk.real')).toBeNull();   // too many for one request
    expect(orderInWords(plan())).toBe('Ann, then Bo, then Cy: about 9 km in a straight line.');
  });
  it('the answer carries the order as it will be dropped: in words, on the map, on the card', () => {
    const map: BennyMap = { maps: ['M'], highlight: ['R1'], pins: [], title: 'Pickup order' };
    const straight = withOrder({ reply: '3 stops. Tap Drop the pins to do it.', map }, plan(), null);
    expect(straight.reply).toBe('3 stops. Tap Drop the pins to do it.\n\n**Order:** Ann, then Bo, then Cy: about 9 km in a straight line.');
    expect(straight.map!.pins.map(p => p.n)).toEqual([1, 2, 3]); expect(straight.map).not.toHaveProperty('path');
    const check = { ...plan(), by_road: true, minutes: 4, km: 2.6, stops: [stop(1, 'Ann', 0, 1), stop(2, 'Cy', 0, 3), stop(3, 'Bo', 0, 2)] };
    const road = withOrder({ reply: '3 stops.', map }, plan(), { check, line: [[0, 0], [1, 0]] });
    expect(road.proposal.check.stops.map(s => s.who)).toEqual(['Ann', 'Cy', 'Bo']);
    expect(road.map!.pins.map(p => p.label)).toEqual(['Pickup 1 · Ann', 'Pickup 2 · Cy', 'Pickup 3 · Bo']); expect(road.map!.path).toEqual([[0, 0], [1, 0]]);
    expect(withOrder({ reply: 'x', map: null }, plan(), null).map).toBeNull();
  });
});

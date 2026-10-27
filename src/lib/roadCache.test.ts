import { describe, expect, it, vi } from 'vitest';
import { cellsBox, cellsFor, fetchRoadsCached, mergeWays, saveWays, type CachedWay, type RoadCacheDeps } from './roadCache';

const way = (id: number, name = 'Elm Rd'): CachedWay => ({ id, name, geometry: [[-79.79, 43.45], [-79.78, 43.45]] });

describe('road cache · cells', () => {
  it('covers the box with 0.02° cells', () => {
    expect(cellsFor({ s: 43.441, w: -79.799, n: 43.459, e: -79.781 })).toEqual(['2172:-3990']);
    expect(cellsFor({ s: 43.44, w: -79.80, n: 43.461, e: -79.78 })).toHaveLength(4);
  });
  it('turns cells back into the box that covers them exactly', () => {
    expect(cellsBox(['2172:-3990', '2173:-3989'])).toEqual({ s: 43.44, w: -79.8, n: 43.48, e: -79.76 });
  });
  it('keeps each road once, newer copy winning', () => {
    expect(mergeWays([way(1, 'Old'), way(2)], [way(1, 'New')]).map(w => w.name)).toEqual(['New', 'Elm Rd']);
  });
});

const deps = (have: string[], cached: CachedWay[], fresh: CachedWay[]) => {
  const d = {
    get: vi.fn(async (_c: string[], _b: unknown) => ({ have, ways: cached.map(w => ({ id: w.id, name: w.name, g: w.geometry })) })),
    overpass: vi.fn(async (_b: string) => fresh),
    put: vi.fn(async (_c: string[] | null, _w: unknown[]) => 1),
  };
  return d as typeof d & RoadCacheDeps;
};
const bbox = '43.441,-79.819,43.459,-79.781';   // two cells side by side: 2172:-3991, 2172:-3990

describe('road cache · loading', () => {
  it('reads loaded ground without asking Overpass', async () => {
    const d = deps(['2172:-3991', '2172:-3990'], [way(1)], []);
    expect((await fetchRoadsCached(bbox, d)).map(w => w.id)).toEqual([1]);
    expect(d.overpass).not.toHaveBeenCalled();
  });
  it('asks Overpass only for the cells not loaded, then saves them', async () => {
    const d = deps(['2172:-3991'], [way(1)], [way(2)]);
    const got = await fetchRoadsCached(bbox, d);
    expect(got.map(w => w.id).sort()).toEqual([1, 2]);
    expect(d.overpass).toHaveBeenCalledWith('43.44,-79.8,43.46,-79.78');
    await Promise.resolve();
    expect(d.put).toHaveBeenCalledWith(['2172:-3990'], [{ id: 2, name: 'Elm Rd', unnamed: false, g: way(2).geometry }]);
  });
  it('does not mark cells loaded when Overpass sends nothing', async () => {
    const d = deps([], [], []);
    await fetchRoadsCached(bbox, d);
    expect(d.put).not.toHaveBeenCalled();
  });
  it('falls back to Overpass as before when the cache cannot be reached', async () => {
    const d = deps([], [], [way(3)]);
    d.get.mockImplementation(async () => { throw new Error('Not allowed'); });
    expect((await fetchRoadsCached(bbox, d)).map(w => w.id)).toEqual([3]);
    expect(d.overpass).toHaveBeenCalledWith(bbox);
  });
  it('saves big loads in batches, marking cells only with the last', async () => {
    const d = deps([], [], []);
    const many = Array.from({ length: 3200 }, (_, i) => way(i + 1));
    await saveWays(d, ['1:1'], many);
    expect(d.put.mock.calls.map(c => [c[0], (c[1] as unknown[]).length])).toEqual([[null, 1500], [null, 1500], [['1:1'], 200]]);
  });
});

// MainstreetAI › building a city from the published OpenStreetMap tiles (msFromTiles), not the road servers.
import { afterEach, describe, expect, it, vi } from 'vitest';

const tile = {
  lines: [
    { id: 1, kind: 'arterial', name: 'Main St', c: [[-79.90, 43.25], [-79.80, 43.26]] },
    { id: 2, kind: 'highway', name: 'QEW', c: [[-79.10, 43.30], [-79.05, 43.31]] },   // outside the box
  ],
  plazas: [
    { id: 7, t: 'w', name: 'Plaza', kind: 'retail', c: [[-79.86, 43.24], [-79.85, 43.24], [-79.85, 43.25], [-79.86, 43.24]] },
    { id: 7, t: 'r', name: 'Park', kind: 'industrial', c: [[-79.84, 43.24], [-79.83, 43.24], [-79.83, 43.25], [-79.84, 43.24]] },
  ],
};

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('city build from the published tiles', () => {
  it('reads the tiles over the box, keeps what touches it, and tells way and relation land apart', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/index.json')) return new Response(JSON.stringify({ ms: ['172_-320'] }));
      if (url.endsWith('/ms/172_-320.json')) return new Response(JSON.stringify(tile));
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { msFromTiles } = await import('./msCity');
    const r = await msFromTiles({ s: 43.20, w: -79.95, n: 43.30, e: -79.76 });
    expect(r!.lines.map(l => l.osm_id)).toEqual([1]);
    expect(r!.plazas.map(p => [p.osm_id, p.kind]).sort()).toEqual([[-7, 'industrial'], [7, 'retail']]);
    // only tiles the index has are asked for
    expect(fetchMock.mock.calls.map(c => String(c[0]).split('/osm-data/')[1]).sort()).toEqual(['index.json', 'ms/172_-320.json']);
  });
  it('says so (null) when the published data cannot be reached, so the road servers are asked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { msFromTiles } = await import('./msCity');
    expect(await msFromTiles({ s: 43.2, w: -79.95, n: 43.3, e: -79.76 })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db: Record<string, any[]> = {};
function q(table: string) {
  const f: ((r: any) => boolean)[] = []; let head = false;
  const api: any = {
    select: (_c: string, o?: { head?: boolean }) => { head = !!o?.head; return api; },
    eq: (c: string, v: any) => { f.push(r => r[c] === v); return api; },
    in: (c: string, vs: any[]) => { f.push(r => vs.includes(r[c])); return api; },
    order: () => api,
    then: (res: any) => { const rows = (db[table] || []).filter(r => f.every(x => x(r))); return Promise.resolve(head ? { count: rows.length, data: null } : { data: rows, error: null }).then(res); },
  };
  return api;
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: (t: string) => q(t) } }));
const built: string[] = [];
vi.mock('../../lib/mapLogsheetService', () => ({
  fetchRouteMaps: async (codes: string[]) => codes.map(c => ({ route_code: c })),
  ensureRouteHouses: async (rm: any, p: (m: string) => void) => { p('placing'); if (rm.route_code === 'BRID03') throw new Error('Mapbox busy'); built.push(rm.route_code); return []; },
}));

beforeEach(() => {
  built.length = 0;
  db.route_maps = ['BRID01', 'BRID02', 'BRID03', 'BRID04', 'BRID09'].map((c, i) => ({ route_code: c, area_name: 'BRIDLEWOOD', status: 'approved', route_number: i + 1 }));
  db.route_house_builds = [
    { route_code: 'BRID02', geocoded_at: '2026-10-01' },   // built and placed
    { route_code: 'BRID04', geocoded_at: null },          // built, not placed
    { route_code: 'BRID09', geocoded_at: null },          // tried, OpenStreetMap found nothing
  ];
  db.route_houses = [{ id: 1, route_code: 'BRID04' }, { id: 2, route_code: 'BRID02' }];
});

describe('preparing the demo map', () => {
  it('builds only what is missing, once', async () => {
    const { routesToBuild } = await import('./prepareMap');
    expect(await routesToBuild()).toEqual(['BRID01', 'BRID03', 'BRID04']);
  });
  it('goes on past a route that fails and reports progress', async () => {
    const { prepareDemoMap } = await import('./prepareMap');
    const msgs: string[] = [];
    expect(await prepareDemoMap(m => msgs.push(m))).toBe(2);
    expect(built).toEqual(['BRID01', 'BRID04']);
    expect(msgs[0]).toBe('Preparing the demo map, first time only: route 1 of 3…');
  });
  it('does nothing once everything is built', async () => {
    db.route_house_builds = db.route_maps.map(r => ({ route_code: r.route_code, geocoded_at: '2026-10-01' }));
    const { prepareDemoMap } = await import('./prepareMap');
    expect(await prepareDemoMap(() => {})).toBe(0);
  });
});

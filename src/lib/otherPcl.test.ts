// The other service's past clients: aeration PCLs in a sealing session (lime green), sealing PCLs
// in an aeration session (sky blue). They're PCLs, never "done this season"; the session's own
// service wins where a house is both; they get their own outreach list.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { buildHouseViews, houseColor, HOUSE_COLORS, indexHistorical, indexPcl, OTHER_PCL_COLORS, seasonJobsAsHistorical, type HouseDisposition, type RouteHouse } from './mapLogsheetService';
import type { PCLClientGroup } from './pclCacheService';
import { pclOutreachClients } from '../pages/MapLogsheet/PclOutreachSheet';

const house = (civicNo: number): RouteHouse => ({
  routeCode: 'BS41', houseKey: `${civicNo}|elm rd`, civicNo, civicSuffix: null, streetName: 'Elm Rd', streetNorm: 'elm rd', unitCount: 1,
  lat: 0, lng: 0, footprint: null, source: 'nar', geoSource: null, geoTriedAt: null,
} as RouteHouse);
const client = (houseNum: string, first: string, phone: string, history: PCLClientGroup['history']): PCLClientGroup =>
  ({ firstName: first, lastName: 'Lee', houseNum, streetName: 'Elm Rd', phone, history } as PCLClientGroup);
const knock = (civic: number, status: HouseDisposition['status']): [string, HouseDisposition] =>
  [`BS41::${civic}|elm rd`, { routeCode: 'BS41', houseKey: `${civic}|elm rd`, status, note: null, firstName: null, commandCenterId: null, workerId: 'I1', sessionId: null, updatedAt: '2026-10-10T12:00:00Z' } as HouseDisposition];

describe('aeration PCLs in a sealing session', () => {
  const houses = [10, 12, 14, 16, 18].map(house);
  // sealing list: 10 (done in 2026), 12 (past)
  const sealing = new Map([['BS41', [
    client('10', 'Ann', '9055550101', [{ year: 2026, price: '$219.00', serviceType: 'SS', contractor: '', date: '2026-10-03' }]),
    client('12', 'Bo', '9055550102', [{ year: 2025, price: '$199.00', serviceType: 'SS', contractor: '' }]),
  ]]]);
  // aeration list: 12 (also sealing → sealing wins), 14 (aerated in 2026 — still just a PCL), 16 (2024), 18 (no phone)
  const aeration = new Map([['BS41', [
    client('12', 'Bo', '9055550102', [{ year: 2026, price: '$70.00', serviceType: 'AER', contractor: '' }]),
    client('14', 'Cy', '9055550104', [{ year: 2026, price: '$70.00', serviceType: 'AER', contractor: '' }]),
    client('16', 'Di', '9055550106', [{ year: 2024, price: '$65.00', serviceType: 'AER', contractor: '' }]),
    client('18', 'Ed', '', [{ year: 2025, price: '$65.00', serviceType: 'AER', contractor: '' }]),
  ]]]);
  const views = (dispos: [string, HouseDisposition][] = []) => buildHouseViews(houses, new Map(dispos), new Map(), new Map(), new Map(),
    indexPcl(sealing, houses), indexHistorical(seasonJobsAsHistorical(sealing, 2026), houses),
    { line: 'aeration', byHouse: indexPcl(aeration, houses) });

  it('only the session’s own service makes a house done this season', () => {
    const [h10, , h14] = views();
    expect(h10.isHistorical).toBe(true);
    expect(houseColor(h10)).toBe(HOUSE_COLORS.historical);
    expect(h14.isHistorical).toBe(false);            // aerated in 2026: an aeration PCL, not historical
    expect(h14.state).toBe('none');
    expect(houseColor(h14)).toBe(OTHER_PCL_COLORS.aeration.pcl);
  });

  it('sealing wins where a house is both', () => {
    const h12 = views()[1];
    expect(h12.isPcl).toBe(true);
    expect(h12.otherPcl).toBeNull();
    expect(houseColor(h12)).toBe(HOUSE_COLORS.pcl);
  });

  it('pale lime when not home; knock colours otherwise', () => {
    const v = views([knock(14, 'not_home'), knock(16, 'no')]);
    expect(houseColor(v[2])).toBe(OTHER_PCL_COLORS.aeration.notHome);
    expect(houseColor(v[3])).toBe(HOUSE_COLORS.no);
    expect(v[2].mapLabel).toContain('Cy L');
  });

  it('a separate outreach list for the other service', () => {
    const v = views();
    expect(pclOutreachClients(v).map(c => c.houseNum)).toEqual(['12']);              // sealing PCLs (10 is done)
    expect(pclOutreachClients(v, new Set(), 'other').map(c => c.houseNum)).toEqual(['14', '16']);   // 18 has no phone
  });

  it('mirrors in an aeration session: sealing PCLs sky blue', () => {
    const v = buildHouseViews(houses, new Map(), new Map(), new Map(), new Map(), indexPcl(aeration, houses), new Map(),
      { line: 'sealing', byHouse: indexPcl(sealing, houses) });
    expect(houseColor(v[0])).toBe(OTHER_PCL_COLORS.sealing.pcl);   // 10: sealing only
    expect(houseColor(v[1])).toBe(HOUSE_COLORS.pcl);               // 12: aeration wins in aeration season
  });
});

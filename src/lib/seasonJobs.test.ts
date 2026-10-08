// This season's jobs on the PCL list become done houses on the crew map: purple, Invalid, out of outreach.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { buildHouseViews, indexHistorical, indexPcl, seasonJobsAsHistorical, type RouteHouse } from './mapLogsheetService';
import type { PCLClientGroup } from './pclCacheService';

const house = (civicNo: number, streetName: string, streetNorm: string): RouteHouse => ({
  routeCode: 'BS41', houseKey: `${civicNo}|${streetNorm}`, civicNo, civicSuffix: null, streetName, streetNorm, unitCount: 1,
  lat: 0, lng: 0, footprint: null, source: 'nar', geoSource: null, geoTriedAt: null,
} as RouteHouse);

const pcl = (houseNum: string, history: PCLClientGroup['history']): PCLClientGroup =>
  ({ firstName: 'Ann', lastName: 'Lee', houseNum, streetName: 'Elm Rd', phone: '9055550101', history } as PCLClientGroup);

describe('season jobs on the map', () => {
  const byRoute = new Map([['BS41', [
    pcl('10', [{ year: 2026, price: '$219.00', serviceType: 'SS', contractor: 'Sam Abara', date: '2026-10-03' }, { year: 2025, price: '$199.00', serviceType: 'SS', contractor: '' }]),
    pcl('12', [{ year: 2025, price: '$189.00', serviceType: 'SS', contractor: '' }]),
  ]]]);

  it('turns only this year’s jobs into done rows, with the day', () => {
    const rows = seasonJobsAsHistorical(byRoute, 2026);
    expect(rows).toEqual([{ routeCode: 'BS41', address: '10 Elm Rd', customerName: 'Ann Lee', phone: '9055550101', propertyType: 'SS',
      price: '$219.00', contractorName: 'Sam Abara', notes: 'Done Oct 3' }]);
  });

  it('marks the house previously serviced and Invalid, unless something happened today', () => {
    const houses = [house(10, 'Elm Rd', 'elm rd'), house(12, 'Elm Rd', 'elm rd')];
    const views = buildHouseViews(houses, new Map(), new Map(), new Map(), new Map(), indexPcl(byRoute, houses),
      indexHistorical(seasonJobsAsHistorical(byRoute, 2026), houses));
    const [done, past] = views;
    expect(done.isHistorical).toBe(true);
    expect(done.state).toBe('invalid');
    expect(done.mapLabel).toContain('$219.00');
    expect(past.isHistorical).toBe(false);
    expect(past.state).toBe('none');
  });
});

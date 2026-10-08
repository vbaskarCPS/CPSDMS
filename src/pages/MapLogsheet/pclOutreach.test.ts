// PCL Outreach list: PCLs on a mapped house, and PCLs whose number the map is missing.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { pclOutreachClients } from './PclOutreachSheet';
import type { HouseView, RouteHouse } from '../../lib/mapLogsheetService';

const house = (routeCode: string, civicNo: number, streetName: string, streetNorm: string): RouteHouse => ({
  routeCode, houseKey: `${civicNo}|${streetNorm}`, civicNo, civicSuffix: null, streetName, streetNorm, unitCount: 1,
  lat: 0, lng: 0, footprint: null, source: 'nar', geoSource: null, geoTriedAt: null,
} as RouteHouse);

const pcl = (houseNum: string, streetName: string, phone = '905 555 0101', year = 2025) =>
  ({ firstName: 'A', lastName: 'B', houseNum, streetName, phone, history: [{ year, price: '$199.00', serviceType: 'SS' }] }) as any;

const view = (h: RouteHouse, p: any, state = 'none', isHistorical = false) =>
  ({ house: h, pcl: p, state, isHistorical }) as unknown as HouseView;

describe('pclOutreachClients', () => {
  const h1 = house('BS41', 4300, 'Chamberlain Road', 'chamberlain rd');
  const h2 = house('BS41', 4310, 'Chamberlain Road', 'chamberlain rd');
  const onMap = pcl('4300', 'Chamberlain Road');
  const knocked = pcl('4310', 'Chamberlain Road', '905 555 0102');
  const missingNumber = pcl('4351', 'Chamberlain Road', '289 555 0103');
  const otherStreet = pcl('440', 'Spruce Avenue', '905 555 0104');
  const noPhone = pcl('4352', 'Chamberlain Road', '');
  const histPhone = pcl('4353', 'Chamberlain Road', '(905) 555-0199');
  const views = [view(h1, onMap), view(h2, knocked, 'no')];
  const pclByRoute = new Map([['BS41', [onMap, knocked, missingNumber, otherStreet, noPhone, histPhone]]]);

  it('lists only mapped houses without the route data (old behaviour)', () => {
    expect(pclOutreachClients(views).map(c => c.houseNum)).toEqual(['4300']);
  });

  it('adds PCLs on the route’s streets that the map has no house for', () => {
    const list = pclOutreachClients(views, new Set(['9055550199']), { pclByRoute, houses: [h1, h2] });
    expect(list.map(c => [c.houseNum, !!c.notOnMap])).toEqual([['4300', false], ['4351', true]]);
    expect(list[1].key).toBe('BS41|4351 chamberlain road');
  });

  it('never re-adds a PCL whose house was knocked No today', () => {
    const list = pclOutreachClients(views, new Set(), { pclByRoute, houses: [h1, h2] });
    expect(list.find(c => c.houseNum === '4310')).toBeUndefined();
  });

  it('waits for the route’s houses before adding anything', () => {
    expect(pclOutreachClients([], new Set(), { pclByRoute, houses: [] })).toEqual([]);
  });
});

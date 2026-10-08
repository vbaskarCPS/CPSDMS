// PCL Outreach list: one row per phone; a client whose phone owner is unknown is greeted "there".
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import { pclOutreachClients } from './PclOutreachSheet';
import type { HouseView } from '../../lib/mapLogsheetService';

const view = (routeCode: string, houseNum: string, streetName: string, phone: string, year: number, extra: object = {}) =>
  ({
    house: { routeCode, houseKey: `${houseNum}|x` }, state: 'none', isHistorical: false,
    pcl: { firstName: 'A', lastName: 'B', houseNum, streetName, phone, history: [{ year, price: '$199.00', serviceType: 'SS' }], ...extra },
  }) as unknown as HouseView;

describe('pclOutreachClients', () => {
  it('lists a phone once, for its most recent customer', () => {
    const list = pclOutreachClients([
      view('BS46', '588', 'Wilene Drive', '905 555 3660', 2022),
      view('BS46', '596', 'Wilene Drive', '(905) 555-3660', 2025),
      view('BS46', '599', 'Wilene Drive', '905 555 8336', 2024),
    ]);
    expect(list.map(c => c.houseNum)).toEqual(['596', '599']);
  });
  it('carries the "name unsure" flag through', () => {
    const [c] = pclOutreachClients([view('BS46', '588', 'Wilene Drive', '905 555 8080', 2024, { nameUnsure: true })]);
    expect(c.nameUnsure).toBe(true);
  });
});

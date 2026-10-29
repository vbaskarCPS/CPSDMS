import { describe, expect, it, vi } from 'vitest';
vi.mock('./client', () => ({ db: {}, must: (r: { data: unknown }) => r.data }));
vi.mock('./clients', () => ({ geocode: async () => null }));
import { callBookHeader, isSkippedTab, logsheetHeader, looksWest, mergeRows, parseCallBookTab, parseLogsheets, parseServiceHistory, toImportRow } from './westPcl';
import { mergeLawnLists } from '../../lib/pclCacheService';
import { pclYearsLine } from '../../lib/mapLogsheetService';

const BOOK = [
  ['ID', 'First Name', 'Last Name', 'RC', 'House', 'Street', 'Phone Number', 'Email', 'FO', 'Service History', 'Cutoff Date', 'CPS REP', 'AER'],
  ['T24L4', 'Ann', 'Lee', 'ABB25', '1234', 'Elm Rd', '16045550101', 'Ann@x.ca', 'FO', '45.0pp (A-25), 425.0 (DFSL-23)', '', 'ABOL', 'x'],
  ['Q99Q9', 'Bo', 'Ng', 'NVN24', '15', 'Oak St', '', '', 'FP', '52.5 (21), 60 (A-??)', '', '', ''],
  ['', '', '', 'ABB25', '', '', '', '', '', '', '', '', ''],
];
const LOGS = [
  ['f', 'First Name', 'Last Name', 'Street #', 'Street Name', 'Phone Number', 'Email Address', 'Client Type', 'Property Type', 'Notes', 'Price', 'Payment Type', 'Contractor Name', ''],
  ['ABB25', 'Ann', 'Lee', '1234', 'Elm Rd', '', '', 'Existing', 'FP', 'side yard (ADFSL)', '$420.00', 'Prepaid', 'Sam T', ''],
  ['ABB25', 'Ann', 'Lee', '1234', 'Elm Rd', '', '', 'SP PRO', 'FP', '', '$600.00', 'Credit Card', 'Sam T', ''],
  ['CHL20', 'Cy', 'Do', '9', 'Pine Pl', '', '', 'New', 'FO', 'nice lawn', '$63.00', 'Cash', 'Jo', ''],
  ['CHL20', 'Di', 'Ek', '11', 'Pine Pl', '', '', 'New', 'FO', '', '$63.00', 'Cash', 'Jo', 'CANCELLED'],
];

describe('the call book', () => {
  it('reads Service History into past jobs', () => {
    expect(parseServiceHistory('45.0pp (A-25), 425.0 (DFSL-23), 52.5 (21), 60 (A-??)')).toEqual([
      { year: 2025, line: 'aeration', service: 'A', price: '45.0', payment: 'Prepaid' },
      { year: 2023, line: 'lawn_rejuv', service: 'DFSL', price: '425.0', payment: undefined },
      { year: 2021, line: 'aeration', service: 'A', price: '52.5', payment: undefined },
      { year: null, line: 'aeration', service: 'A', price: '60', payment: undefined },
    ]);
  });
  it('is recognised, and CCD is never a tab to read', () => {
    expect(callBookHeader(BOOK)).toBe(0);
    expect(isSkippedTab('CCD')).toBe(true);
    expect(isSkippedTab('CCDETF')).toBe(true);
    expect(isSkippedTab('TOR')).toBe(false);
    expect(looksWest(['ABB25', 'NVN24', 'WHR123'])).toBe(true);
    expect(looksWest(['MV12', 'BNW44', 'OSW03'])).toBe(false);
  });
  it('turns rows into customers with the town from the route', () => {
    const r = parseCallBookTab('TOR', BOOK);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ city: 'Abbotsford', sheet_route: 'ABB25', house_no: '1234', phones: ['16045550101'], emails: ['ann@x.ca'] });
    expect(r[1].city).toBe('North Vancouver');
  });
});

describe('the 2026 Logsheets', () => {
  it('visits are spring jobs; upsells are sales; cancelled rows are left out', () => {
    expect(logsheetHeader(LOGS)).toBe(0);
    const r = parseLogsheets(LOGS);
    expect(r).toHaveLength(3);
    expect(r[0].history).toEqual([{ year: 2026, part: 'spring', line: 'lawn_rejuv', service: 'ADFSL', price: '420.00', payment: 'Prepaid', contractor: 'Sam T' }]);
    expect(r[1]).toMatchObject({ history: [], tags: ['Sold 2026: SP PRO'] });
    expect(r[2].history[0]).toMatchObject({ line: 'aeration', service: 'A', part: 'spring' });
  });
});

describe('doubles', () => {
  it('merge into one customer with every job', () => {
    const all = [...parseCallBookTab('TOR', BOOK), ...parseLogsheets(LOGS)];
    const m = mergeRows(all);
    const ann = m.find(c => c.house_no === '1234')!;
    expect(ann.rows).toHaveLength(3);
    expect(ann.history.map(h => `${h.year}${h.service}`)).toEqual(['2025A', '2023DFSL', '2026ADFSL']);
    expect(ann.tags).toEqual(['Sold 2026: SP PRO']);
  });
  it('become import rows: waiting with a point and no route', () => {
    const [ann] = mergeRows(parseCallBookTab('TOR', BOOK));
    expect(toImportRow(ann, { lat: 49, lng: -122 }, null)).toMatchObject({ match_how: 'waiting', route_code: null, sheet_route: 'ABB25', province: 'BC', street_name: 'Elm Rd' });
    expect(toImportRow(ann, { lat: 49, lng: -122 }, 'ABB25').match_how).toBe('map');
    expect(toImportRow(ann, null, null).match_how).toBe('no_location');
  });
});

describe('one lawn list in the West', () => {
  it('merges the aeration and rejuv lists by customer', () => {
    const a = new Map([['ABB25', [{ cid: 'c1', houseNum: '1234', streetName: 'Elm Rd', firstName: 'Ann', lastName: 'Lee', history: [{ year: 2025, serviceType: 'A' }] }]]]) as never;
    const b = new Map([['ABB25', [{ cid: 'c1', houseNum: '1234', streetName: 'Elm Rd', firstName: 'Ann', lastName: 'Lee', history: [{ year: 2023, serviceType: 'DFSL' }] }]]]) as never;
    const m = mergeLawnLists(a, b);
    expect(m.get('ABB25')).toHaveLength(1);
    expect(pclYearsLine(m.get('ABB25')![0])).toBe('(23 DFSL, 25 A)');
  });
  it('labels show the year alone for anything that isn’t a lawn code', () => {
    expect(pclYearsLine({ history: [{ year: 2024, serviceType: 'FO' }, { year: 2025, serviceType: 'SS' }] } as never)).toBe('(24, 25)');
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyMapping, cleanPhone, fingerprint, findHeaderRow, guessMapping, parseFullAddress, parseStreetAddress,
  sanitizeMapping, sheetCsvUrl, splitNames, titleCase,
} from './clientImport';

describe('cleaning', () => {
  it('reads addresses in the usual shapes', () => {
    expect(parseStreetAddress('2403 Alstep Way')).toEqual({ house_no: '2403', street: 'Alstep Way', unit: '' });
    expect(parseStreetAddress('12a Main St')).toEqual({ house_no: '12A', street: 'Main St', unit: '' });
    expect(parseStreetAddress('4-123 Main St')).toEqual({ house_no: '123', street: 'Main St', unit: '4' });
    expect(parseStreetAddress('123 Main St Unit 7')).toEqual({ house_no: '123', street: 'Main St', unit: '7' });
    expect(parseStreetAddress('Main St')).toBeNull();
    expect(parseFullAddress('2280 Baronwood Dr, Oakville, ON L6M 0K2')).toEqual(
      { house_no: '2280', street: 'Baronwood Dr', unit: '', city: 'Oakville', province: 'ON', postal_code: 'L6M 0K2' });
    expect(parseFullAddress('15 Elm Rd, CALGARY AB, Canada')?.city).toBe('Calgary');
  });
  it('cleans names and phones', () => {
    expect(titleCase('MARY-ANNE MCDONALD')).toBe('Mary-Anne McDonald');
    expect(titleCase('van Dyke')).toBe('van Dyke');
    expect(splitNames('Lee, Ann & Bob')).toEqual([{ first: 'Ann', last: 'Lee' }, { first: 'Bob', last: 'Lee' }]);
    expect(splitNames('JOHN SMITH')).toEqual([{ first: 'John', last: 'Smith' }]);
    expect(cleanPhone('(905) 555-1234 / 1-416-555-9999')).toEqual(['9055551234', '4165559999']);
    expect(cleanPhone('555-1234')).toEqual([]);
  });
});

describe('a callbook', () => {
  const rows = [
    ['2026 CALGARY AERATION CALLBOOK'],
    ['ROUTE CODE', 'FIRST NAME', 'LAST NAME', 'HOUSE #', 'STREET NAME', 'PHONE', 'YEAR', 'FO', 'PREVIOUS PRICE', 'CONTRACTOR NAME', 'DNC', 'NO SP'],
    ['CA01', 'ANN', 'LEE', '12.0', 'elm rd', '403 555 1234', 2024, 'X', '$65', 'bo smith', '', ''],
    ['CA01', 'Ann', 'Lee', '12', 'Elm Road', '4035551234', 2025, '', '70', 'Bo Smith', '', 'x'],
    ['CA01', 'Bob', 'Ng', '', '', '4035550000', 2025, '', '70', '', 'yes', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  it('finds the header row and guesses the columns', () => {
    expect(findHeaderRow(rows)).toBe(1);
    const m = guessMapping(rows);
    expect(m.columns['0'].field).toBe('route_code');
    expect(m.columns['3'].field).toBe('house_no');
    expect(m.columns['6'].field).toBe('year');
    expect(m.columns['8'].field).toBe('price');
    expect(m.columns['10'].field).toBe('do_not_call');
  });
  it('makes one client per address with every year', () => {
    const m = guessMapping(rows);
    m.columns['7'] = { field: 'service' };
    m.columns['11'] = { field: 'tag', tag: 'NO SP' };
    const out = applyMapping(rows, { ...m, defaultService: 'AER' });
    expect(out.rowsRead).toBe(3);
    expect(out.skipped).toEqual([{ row: 5, reason: 'No address', text: '' }]);
    expect(out.clients).toHaveLength(1);
    const c = out.clients[0];
    expect(c).toMatchObject({ house_no: '12', street_name: 'Elm Rd', route_given: 'CA01', phones: ['4035551234'], tags: ['NO SP'], rows: [3, 4] });
    expect(c.people).toEqual([{ first: 'Ann', last: 'Lee' }]);
    expect(c.history).toEqual([
      { year: 2025, service: 'AER', price: '70', contractor: 'Bo Smith', payment: '' },
      { year: 2024, service: 'X', price: '65', contractor: 'Bo Smith', payment: '' },
    ]);
  });
  it('handles one column per year', () => {
    const wide = [
      ['Name', 'Address', 'City', '2024', '2025', '2026', 'Email'],
      ['Ann Lee', '4-123 Main St', 'oakville', 'yes', '', 'AER', 'ANN@X.COM'],
    ];
    const m = sanitizeMapping({ headerRow: 0, columns: { 0: { field: 'full_name' }, 1: { field: 'street_address' }, 2: { field: 'city' },
      3: { field: 'serviced', year: 2024 }, 4: { field: 'serviced', year: 2025 }, 5: { field: 'serviced', year: 2026 }, 6: { field: 'email' }, 9: { field: 'bogus' } },
      defaultService: 'SS', defaultProvince: 'ontario' }, 7);
    expect(m.defaultProvince).toBe('ON');
    const c = applyMapping(wide, m).clients[0];
    expect(c).toMatchObject({ house_no: '123', unit: '4', street_name: 'Main St', city: 'Oakville', province: 'ON', emails: ['ann@x.com'] });
    expect(c.history.map(h => `${h.year}:${h.service}`)).toEqual(['2026:AER', '2024:SS']);
  });
});

describe('recipes and links', () => {
  it('fingerprints by column titles only', () => {
    expect(fingerprint(['First Name', 'Phone #'])).toBe(fingerprint(['FIRST  NAME', 'phone #']));
    expect(fingerprint(['First Name', 'Phone'])).not.toBe(fingerprint(['Phone', 'First Name']));
  });
  it('turns a sheet link into its CSV export', () => {
    expect(sheetCsvUrl('https://docs.google.com/spreadsheets/d/abc_123/edit#gid=456')).toBe('https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=456');
    expect(sheetCsvUrl('https://example.com')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { applyChatActions, openingMessage } from './bennyChat';
import { applyMapping, cleanDate, clientTypeSource, guessMapping, profileColumns, type Mapping } from './clientImport';

const headers = ['Route #', 'First Name', 'Last Name', 'Street #', 'Street Name', 'Phone Number', 'Client Type', 'Property Type', 'Price', 'Payment Type', 'Contractor Name', 'Date'];
const rows: unknown[][] = [
  headers,
  ['BS41', 'Ann', 'Lee', '10', 'Elm Rd', '905-555-0101', 'New', 'SS', '219', 'Cash', 'Sam Abara', '10/03/2026'],
  ['BS41', 'Ann', 'Lee', '10', 'Elm Rd', '', 'RAMP', 'Ramp', '339', 'Billed', 'Sam Abara', 'Oct 3, 2026'],
  ['BS41', 'Bo', 'Ng', '22', 'Oak St', '905-555-0102', 'Existing', 'SSP', '249', 'E-Transfer', 'Lee Tran', '2026-10-04'],
  ['TEST', 'Test', 'Row', '1', 'Test Ave', '', 'New', 'SS', '1', 'Cash', 'H01', ''],
];

describe('Logsheets-style lists', () => {
  it('reads dates and client types', () => {
    expect(cleanDate('10/03/2026')).toBe('2026-10-03');
    expect(cleanDate('Oct 3, 2026')).toBe('2026-10-03');
    expect(cleanDate('2026-10-04 13:20')).toBe('2026-10-04');
    expect(cleanDate('soon')).toBe('');
    expect(clientTypeSource('New')).toEqual({ source: 'Door sale' });
    expect(clientTypeSource('existing')).toEqual({ source: 'Prebooked' });
    expect(clientTypeSource('sp pro')).toEqual({ source: 'Upsell', product: 'SP PRO' });
  });

  it('guesses the Logsheets columns and keeps each job, with its source and day', () => {
    const m = guessMapping(rows, 0);
    expect(m.columns['6'].field).toBe('client_type');
    expect(m.columns['7'].field).toBe('service');
    expect(m.columns['11'].field).toBe('job_date');
    const out = applyMapping(rows, { ...m, serviceLine: 'sealing', skipRows: [5] });
    expect(out.skipped).toEqual([{ row: 5, reason: 'Left out', text: 'TEST · Test · Row · 1 · Test Ave · New' }]);
    const ann = out.clients.find(c => c.house_no === '10')!;
    expect(ann.history).toEqual([
      { year: 2026, service: 'SS', price: '219', contractor: 'Sam Abara', payment: 'Cash', line: 'sealing', source: 'Door sale', date: '2026-10-03' },
      { year: 2026, service: 'RAMP', price: '339', contractor: 'Sam Abara', payment: 'Billed', line: 'sealing', source: 'Upsell', product: 'RAMP', date: '2026-10-03' },
    ]);
    expect(out.clients.find(c => c.house_no === '22')!.history[0]).toMatchObject({ source: 'Prebooked', date: '2026-10-04', year: 2026 });
  });

  it('profiles every column over the whole file', () => {
    const p = profileColumns(rows, 0);
    expect(p[5]).toMatchObject({ header: 'Phone Number', filled: 2, distinct: 2, looks: ['phone'] });
    expect(p[6].top[0]).toEqual(['New', 2]);
    expect(p[11].looks).toContain('date');
  });
});

describe('the upload chat', () => {
  const base: Mapping = { headerRow: 0, columns: { 0: { field: 'route_code' }, 8: { field: 'ignore' } } };
  it('applies the changes it is allowed to make, and says what changed', () => {
    const { mapping, changes } = applyChatActions(base, [
      { tool: 'set_columns', input: { changes: [{ index: 8, field: 'price', year: 2025 }, { index: 99, field: 'price' }, { index: 1, field: 'drop_table' }] } },
      { tool: 'set_list_settings', input: { defaultYear: 2026, serviceLine: 'sealing', defaultProvince: 'Ontario', headerRow: 1 } },
      { tool: 'skip_rows', input: { rows: [5, 6], skip: true, reason: 'test rows' } },
    ], headers);
    expect(mapping.columns['8']).toEqual({ field: 'price', year: 2025 });
    expect(mapping.columns['1']).toBeUndefined();
    expect(mapping).toMatchObject({ defaultYear: 2026, serviceLine: 'sealing', defaultProvince: 'ON', headerRow: 0, skipRows: [5, 6] });
    expect(changes).toEqual(['“Price” → Price (2025)', 'Titles are on row 1', 'Year when the list has none: 2026', 'Past clients of Sealing',
      'Province: ON', 'Left out rows 5, 6 (test rows)']);
    const back = applyChatActions(mapping, [{ tool: 'skip_rows', input: { rows: [5], skip: false, reason: '' } }], headers);
    expect(back.mapping.skipRows).toEqual([6]);
  });
  it('opens with its questions', () => {
    expect(openingMessage(['Which year is this list from?'], false)).toBe('I’ve read the file. One thing I couldn’t tell from it:\n1. Which year is this list from?');
  });
});

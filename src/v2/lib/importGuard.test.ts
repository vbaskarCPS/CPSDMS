// The import guard: the checks that would have stopped the 2001 sealing years and the 2025
// aeration pile-up, the privacy guard, and The Benny's double-check sample.
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('./client', () => ({ db: {}, must: (x: unknown) => x }));

import { applyMapping, guessMapping, importChecks, type Applied, type Mapping } from './clientImport';
import { readWorkbook } from './clients';
import {
  auditSample, guardChecks, hasCardNumber, hasStop, importSummary, lockSensitive, luhnOk, maskRows, sensitiveColumns, sourceCells,
} from './importGuard';

const stopTexts = (c: { level: string; text: string }[]) => c.filter(x => x.level === 'stop').map(x => x.text);

describe('reading a real workbook', () => {
  // a callbook the way the office types it: dates with no year ("27-May"), the year in its own column
  const book = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['HOUSE #', 'STREET NAME', 'CITY', 'DATE', 'YEAR', 'PRICE'],
      ['10', 'Elm Rd', 'Oakville', '27-May', 2023, 219],
      ['12', 'Elm Rd', 'Oakville', 'August 9th', 2022, 199],
      ['14', 'Elm Rd', 'Oakville', new Date(2024, 5, 3), 2024, 249],
    ], { cellDates: true });
    ws.D4.z = 'd-mmm';     // a real date shown without its year
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Callbook');
    return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'sealing callbook.xlsx');
  };

  it('never makes up a year: YEAR decides, yearless dates are left off', async () => {
    const [sheet] = await readWorkbook(book());
    expect(sheet.rows[3][3]).toBe('2024-06-03');                  // the real date keeps its year
    const m: Mapping = { ...guessMapping(sheet.rows), serviceLine: 'sealing' };
    const a = applyMapping(sheet.rows, m);
    const years = a.clients.map(c => c.history.map(h => h.year)).flat();
    expect(years.sort()).toEqual([2022, 2023, 2024]);
    expect(years).not.toContain(2001);
    expect(a.clients.find(c => c.house_no === '14')!.history[0].date).toBe('2024-06-03');
    expect(a.clients.find(c => c.house_no === '10')!.history[0].date).toBeUndefined();
    expect(a.notes!.yearlessDates.map(d => d.row)).toEqual([2, 3]);
    const checks = [...importChecks(a, m), ...guardChecks({ rows: sheet.rows, mapping: m, applied: a, sensitive: [] })];
    expect(hasStop(checks)).toBe(false);
  });
});

describe('the checks that stop an import', () => {
  const rows = [
    ['HOUSE', 'STREET', 'DATE', 'YEAR', 'PRICE'],
    ['10', 'Elm Rd', '2021-05-04', '2023', '70'],     // the DATE is from another year: YEAR wins
    ['12', 'Elm Rd', '2024-05-05', '2024', '70'],
  ];
  const m: Mapping = { headerRow: 0, serviceLine: 'aeration', columns: {
    0: { field: 'house_no' }, 1: { field: 'street' }, 2: { field: 'job_date' }, 3: { field: 'year' }, 4: { field: 'price' } } };

  it('a DATE column before the YEAR column doesn’t win', () => {
    const a = applyMapping(rows, m);
    const ten = a.clients.find(c => c.house_no === '10')!;
    expect(ten.history[0].year).toBe(2023);
    expect(ten.history[0].date).toBeUndefined();
    expect(a.notes!.datesDropped).toEqual([{ row: 2, date: '2021-05-04', year: 2023 }]);
    expect(hasStop(guardChecks({ rows, mapping: m, applied: a, sensitive: [] }))).toBe(false);
  });

  it('stops when a row is saved without its YEAR (the aeration pile-up)', () => {
    const a = applyMapping(rows, m);
    const broken: Applied = { ...a, clients: a.clients.map(c => ({ ...c, history: c.history.map(h => ({ ...h, year: 2025 })) })) };
    expect(stopTexts(guardChecks({ rows, mapping: m, applied: broken, sensitive: [] })).join(' ')).toMatch(/without the year in their YEAR cell/);
  });

  it('stops on a year before the company’s first season (the 2001 sealing years)', () => {
    const a = applyMapping(rows, m);
    const broken: Applied = { ...a, clients: a.clients.map(c => ({ ...c, history: c.history.map(h => ({ ...h, year: 2001 })) })) };
    expect(stopTexts(importChecks(broken, m)).join(' ')).toMatch(/can't be a service year \(2001/);
  });

  it('stops without a service, and when rows go missing', () => {
    const a = applyMapping(rows, m);
    expect(stopTexts(guardChecks({ rows, mapping: { ...m, serviceLine: null }, applied: a, sensitive: [] })).join(' ')).toMatch(/Pick which service/);
    expect(stopTexts(guardChecks({ rows, mapping: m, applied: { ...a, rowsRead: a.rowsRead + 3 }, sensitive: [] })).join(' ')).toMatch(/can't be accounted for/);
  });
});

describe('warnings', () => {
  const mk = (dates: string[], prices: string[], line: 'aeration' | 'sealing') => {
    const rows = [['HOUSE', 'STREET', 'DATE', 'YEAR', 'PRICE'], ...dates.map((d, i) => [String(10 + i), 'Elm Rd', d, d.slice(0, 4), prices[i]])];
    const m: Mapping = { headerRow: 0, serviceLine: line, columns: { 0: { field: 'house_no' }, 1: { field: 'street' }, 2: { field: 'job_date' }, 3: { field: 'year' }, 4: { field: 'price' } } };
    return { rows, m, a: applyMapping(rows, m) };
  };
  it('aeration dated in the summer, at sealing prices', () => {
    const { rows, m, a } = mk(['2025-07-02', '2025-07-03', '2025-07-04', '2025-05-01'], ['600', '650', '700', '70'], 'aeration');
    const t = guardChecks({ rows, mapping: m, applied: a, sensitive: [] }).map(c => c.text).join(' ');
    expect(t).toMatch(/outside the aeration season/);
    expect(t).toMatch(/aeration prices are outside/);
  });
  it('compares with the last file of the same layout, and spots the same file twice', () => {
    const { rows, m, a } = mk(['2025-05-02', '2025-05-03', '2025-05-04'], ['70', '70', '70'], 'aeration');
    const baseline = { at: '2026-09-01T12:00:00Z', summary: { rows: 900, lines: { sealing: { 2022: 300, 2023: 300, 2024: 300 } }, price: { sealing: 219 } } };
    const t = guardChecks({ rows, mapping: m, applied: a, sensitive: [], baseline, sameFile: [{ file_name: 'x.xlsx', created_at: '2026-10-10T12:00:00Z' }] }).map(c => c.text).join(' ');
    expect(t).toMatch(/had 900 rows/);
    expect(t).toMatch(/was sealing; this one reads as aeration/);
    expect(t).toMatch(/exact file was imported before/);
    expect(importSummary(a)).toEqual({ rows: 3, lines: { aeration: { 2025: 3 } }, price: { aeration: 70 } });
  });
  it('The Benny’s double-check: running, problems, all right', () => {
    const { rows, m, a } = mk(['2025-05-02'], ['70'], 'aeration');
    const g = (audit: Parameters<typeof guardChecks>[0]['audit']) => guardChecks({ rows, mapping: m, applied: a, sensitive: [], audit }).map(c => `${c.level}:${c.text}`).join(' ');
    expect(g({ state: 'running' })).toMatch(/info:The Benny is double-checking/);
    expect(g({ state: 'done', checked: 1, problems: [{ row: 2, what: 'YEAR says 2023 but saved as 2025' }] })).toMatch(/warn:The Benny's double-check, row 2/);
    expect(g({ state: 'done', checked: 1, problems: [] })).toMatch(/read right/);
  });
});

describe('the privacy guard', () => {
  const rows = [
    ['NAME', 'PHONE', 'Card Number', 'EXTRA', 'SIN', 'NOTES', 'HOUSE', 'STREET'],
    ['Ann Lee', '905-555-0101', '4111 1111 1111 1111', '5500 0000 0000 0004', '046 454 286', 'paid $219', '10', 'Elm Rd'],
    ['Bo Ng', '9055550102', '4012888888881881', '', '', 'call first', '12', 'Elm Rd'],
  ];
  it('finds card numbers and SINs by title or by what the cells hold, never phones', () => {
    expect(luhnOk('4111111111111111')).toBe(true);
    expect(hasCardNumber('9055550101 9055550102')).toBe(false);
    const s = sensitiveColumns(rows, 0);
    expect(s.map(x => [x.i, x.why])).toEqual([[2, 'card numbers'], [3, 'card numbers'], [4, 'SIN numbers']]);
  });
  it('forces them to Ignore, blanks them for The Benny, keeps them out of the saved sheet cells', () => {
    const s = sensitiveColumns(rows, 0);
    const m: Mapping = { headerRow: 0, serviceLine: 'sealing', columns: { 0: { field: 'full_name' }, 1: { field: 'phone' }, 2: { field: 'notes' }, 3: { field: 'notes' }, 4: { field: 'notes' }, 5: { field: 'notes' }, 6: { field: 'house_no' }, 7: { field: 'street' } } };
    const safe = lockSensitive(m, s);
    expect([2, 3, 4].map(i => safe.columns[i].field)).toEqual(['ignore', 'ignore', 'ignore']);
    expect(maskRows(rows, s, 0)[1].slice(2, 5)).toEqual(['[hidden]', '[hidden]', '[hidden]']);
    expect(maskRows(rows, s, 0)[0][2]).toBe('Card Number');
    const a = applyMapping(rows, safe);
    expect(JSON.stringify(a.clients)).not.toMatch(/4111|5500|046 454/);
    expect(JSON.stringify(sourceCells(rows, m, [2, 3], s))).not.toMatch(/4111|5500|4012|046 454/);
    expect(JSON.stringify(auditSample(rows, m, a, s))).not.toMatch(/4111|5500|4012|046 454/);
  });
  it('samples at most 25 rows spread over the file', () => {
    const many = [['HOUSE', 'STREET', 'YEAR'], ...Array.from({ length: 300 }, (_, i) => [String(i + 1), 'Elm Rd', '2024'])];
    const m: Mapping = { headerRow: 0, serviceLine: 'sealing', columns: { 0: { field: 'house_no' }, 1: { field: 'street' }, 2: { field: 'year' } } };
    const sample = auditSample(many, m, applyMapping(many, m), []);
    expect(sample).toHaveLength(25);
    expect(sample[0].row).toBeLessThan(20);
    expect(sample[24].row).toBeGreaterThan(280);
    expect(sample[0].sheet).toEqual({ HOUSE: String(sample[0].row - 1), STREET: 'Elm Rd', YEAR: '2024' });
  });
});

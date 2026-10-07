import { describe, it, expect } from 'vitest';
import { parseContractorSheet, monthCells, summarize } from './workerbook';

// Shaped like the Workerbook Contractors tab: a title row, the header on row 2, data from row 3.
const GRID: unknown[][] = [
  ['Ontario Road Trip — Contractors', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', 'Shuttle', 'CN#', 'First', 'Last', 'Cell', 'Alm Inc', 'Slv Inc', 'Manager', 'Team', 'Conf', 'Show', 'Next Day', 'Status', 'A/R', 'Days', 'NS', 'Alt Phone', 'Email', 'SIN', 'SE'],
  ['', '1', 'e3002', 'Devon', 'Clarke', '905-555-0101', '$0.25', '0.50', 'Cheryl', '1', 'x', 'x', 'Oct09', '', 'A', 31, 1, '', 'Devon@Example.com', '123 456 789', 3],
  ['', '2', 'E3040', 'Amira', 'Haddad', '905-555-0187', '', '', 'Chad', '', '', '', '', 'WL', 'R', 0, 0, '289-555-0100', '', '987654321', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', 'NoCN', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];

describe('reading the Workerbook Contractors tab', () => {
  const out = parseContractorSheet(GRID);

  it('finds the header row and keeps only known columns', () => {
    expect(out.headerRow).toBe(1);
    expect(out.columns).toEqual(expect.arrayContaining(['Shuttle', 'CN#', 'First', 'Last', 'Cell', 'Alm Inc', 'Slv Inc', 'Status', 'A/R', 'Days', 'NS', 'Alt Phone', 'Email', 'SE']));
  });

  it('never reads ID numbers', () => {
    expect(out.ignored).toContain('SIN');
    expect(JSON.stringify(out.rows)).not.toContain('123 456 789');
    expect(JSON.stringify(out.rows)).not.toContain('987654321');
  });

  it('maps a row', () => {
    expect(out.rows[0]).toEqual({
      cn: 'E3002', first: 'Devon', last: 'Clarke', cell: '905-555-0101', shuttle: '1', status: '', alm: 0.25, slv: 0.5,
      returning: true, days: 31, ns: 1, alt: '', email: 'Devon@Example.com', hats: { SE: 3 },
    });
    expect(out.rows[1]).toMatchObject({ cn: 'E3040', status: 'WL', returning: false, days: 0, alt: '289-555-0100' });
  });

  it('skips blank rows but keeps rows missing a CN # for the import to report', () => {
    expect(out.rows).toHaveLength(3);
    expect(out.rows[2]).toMatchObject({ cn: '', first: 'NoCN' });
  });

  it('refuses a sheet without a CN # column', () => {
    expect(() => parseContractorSheet([['Name', 'Phone'], ['A', '1']])).toThrow(/CN #/);
  });
});

describe('days calendar', () => {
  it('starts October 2026 on a Thursday (4 blanks, Sunday-first)', () => {
    const cells = monthCells(2026, 9);
    expect(cells.slice(0, 4)).toEqual([null, null, null, null]);
    expect(cells[4]).toBe('2026-10-01');
    expect(cells[cells.length - 1]).toBe('2026-10-31');
  });

  it('counts a roster', () => {
    const s = summarize('2026-10-08', 'planned', [
      { confirmed_at: '2026-10-07T12:00:00Z', attendance: null, firstDay: false },
      { confirmed_at: null, attendance: null, firstDay: true },
      { confirmed_at: '2026-10-07T12:00:00Z', attendance: 'showed', firstDay: false },
      { confirmed_at: null, attendance: 'no_show', firstDay: false },
    ]);
    expect(s).toEqual({ day: '2026-10-08', state: 'planned', booked: 4, confirmed: 2, showed: 1, noShow: 1, firstDay: 1 });
  });
});

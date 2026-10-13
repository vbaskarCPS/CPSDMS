// What the Map Builder's delete confirmation says, from the database's answer.
import { describe, expect, it } from 'vitest';
import { describeShift } from './routeShift';

describe('deleting a route number', () => {
  it('lists the maps that move and what goes with them', () => {
    const d = describeShift({
      ok: true, preview: true, code: 'BSW62', area: 'BRAMPTON SOUTH WEST #4',
      maps: [{ area: 'BRAMPTON SOUTH WEST #4', start: 61, first: 'BSW63', last: 'BSW76', first_to: 'BSW62', last_to: 'BSW75', count: 14 },
             { area: 'BRAMPTON SOUTH WEST #5', start: 77, first: 'BSW77', last: 'BSW77', first_to: 'BSW76', last_to: 'BSW76', count: 1 }],
      data: { routes_drawn: 15, clients: 1, houses: 0, knocks: 2, visits: 0, bookings: 0, sales: 0 },
    }, 'BSW62');
    expect(d.blocked).toBeNull();
    expect(d.moves).toEqual(['BRAMPTON SOUTH WEST #4: BSW63–BSW76 → BSW62–BSW75', 'BRAMPTON SOUTH WEST #5: BSW77 → BSW76']);
    expect(d.carried).toBe('Moving with them: 15 drawn routes, 1 client, 2 knocks.');
  });
  it('says why a route in use can’t be deleted', () => {
    const d = describeShift({ ok: false, reason: 'in_use', in_use: { clients: 40, knocks: 12, job_history: 1 } }, 'MLT65');
    expect(d.blocked).toBe('MLT65 can’t be deleted: it has 40 clients, 12 knocks, 1 past job. Those can’t move anywhere, so move them to another route first.'.replace(/’/g, "'"));
  });
  it('waits for the live day to close', () => {
    expect(describeShift({ ok: false, reason: 'live_today', live: ['MLT66', 'MLT67'] }, 'MLT65').blocked)
      .toBe("MLT66, MLT67 are on today's live day. Delete after the day is closed.");
  });
  it('nothing after it: nothing moves', () => {
    const d = describeShift({ ok: true, code: 'BSW76', maps: [], data: { routes_drawn: 0, clients: 0 } }, 'BSW76');
    expect(d.moves).toEqual([]);
    expect(d.carried).toBeNull();
  });
});

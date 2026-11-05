// What the Map Builder's delete confirmation says, from the database's answer.
import { describe, expect, it } from 'vitest';
import { describeMove, describeShift } from './routeShift';

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

describe('describeMove', () => {
  it('lists the maps that shift and what moves with them', () => {
    const d = describeMove({ ok: true, preview: true, moves: [
      { area: 'WHITE ROCK #4', start: 60, first: 'WHR60', last: 'WHR68', first_to: 'WHR61', last_to: 'WHR69', count: 9 },
      { area: 'WHITE ROCK #5', start: 69, first: 'WHR69', last: 'WHR87', first_to: 'WHR70', last_to: 'WHR88', count: 19 },
    ], data: { clients: 96, bookings: 1 } }, 'WHR147');
    expect(d.blocked).toBeNull();
    expect(d.moves).toEqual(['WHITE ROCK #4: WHR60–WHR68 → WHR61–WHR69', 'WHITE ROCK #5: WHR69–WHR87 → WHR70–WHR88']);
    expect(d.carried).toBe('Moving with them: 96 clients, 1 booking.');
  });
  it('says which numbers the route can take', () => {
    const d = describeMove({ ok: false, reason: 'outside_map', area: 'WHITE ROCK #4', first: 'WHR53', last: 'WHR70' }, 'WHR147');
    expect(d.blocked).toBe('WHR147 stays on WHITE ROCK #4, so pick a number from WHR53 to WHR70.');
  });
});

import { describe, expect, it } from 'vitest';
import {
  clientLayerOf, daysLabel, heatColor, parseAreaView, parseRound, parseSeason, pctOf, seasonKey, shownRound, startingSeason,
  type ClientLayer, type MapCard,
} from './masterBookings';

describe('season and round picker', () => {
  it('reads and writes the season', () => {
    expect(parseSeason('sealing-2026')).toEqual({ service: 'sealing', season: 2026 });
    expect(parseSeason('aeration-2027')).toEqual({ service: 'aeration', season: 2027 });
    expect(parseSeason('lawn-2026')).toBeNull();
    expect(parseSeason(null)).toBeNull();
    expect(seasonKey({ service: 'sealing', season: 2026 })).toBe('sealing-2026');
  });
  it('reads the round: a number, else current', () => {
    expect(parseRound('2')).toBe(2);
    expect(parseRound('current')).toBe('current');
    expect(parseRound('0')).toBe('current');
    expect(parseRound('x')).toBe('current');
    expect(parseRound(null)).toBe('current');
  });
  it('opens on the URL, else the center default, else this year of the center service', () => {
    const def = { service: 'aeration' as const, season: 2027, round: null, done_pct: 50 };
    expect(startingSeason({ service: 'sealing', season: 2025 }, def, ['sealing'], 2026)).toEqual({ service: 'sealing', season: 2025 });
    expect(startingSeason(null, def, ['sealing'], 2026)).toEqual({ service: 'aeration', season: 2027 });
    expect(startingSeason(null, { ...def, service: null }, ['lawn', 'sealing'], 2026)).toEqual({ service: 'sealing', season: 2026 });
    expect(startingSeason(null, null, [], 2026)).toEqual({ service: 'sealing', season: 2026 });
  });
});

describe('heat colour', () => {
  it('is green at 10% or less and red at 70% or more', () => {
    expect(heatColor(0)).toBe('#16a34a');
    expect(heatColor(10)).toBe('#16a34a');
    expect(heatColor(40)).toBe('#f59e0b');
    expect(heatColor(70)).toBe('#dc2626');
    expect(heatColor(100)).toBe('#dc2626');
  });
  it('percentages round and never divide by zero', () => {
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(5, 0)).toBe(0);
  });
});

describe('customer layers', () => {
  const all = new Set<ClientLayer>(['prev_aeration', 'prev_sealing', 'done_aeration', 'done_sealing']);
  it('shows this season’s job before past clients, the season’s own service first', () => {
    expect(clientLayerOf(2 | 8, all, 'sealing')).toBe('done_sealing');
    expect(clientLayerOf(1 | 2, all, 'sealing')).toBe('prev_sealing');
    expect(clientLayerOf(1 | 2, all, 'aeration')).toBe('prev_aeration');
    expect(clientLayerOf(4 | 2, all, 'sealing')).toBe('done_aeration');
  });
  it('only uses the layers switched on', () => {
    expect(clientLayerOf(2 | 8, new Set<ClientLayer>(['prev_sealing']), 'sealing')).toBe('prev_sealing');
    expect(clientLayerOf(1, new Set<ClientLayer>(['prev_sealing']), 'sealing')).toBeNull();
    expect(clientLayerOf(0, all, 'sealing')).toBeNull();
  });
});

describe('words', () => {
  it('lists days compactly', () => {
    expect(daysLabel(['2026-10-12', '2026-10-05', '2026-10-06'])).toBe('Oct 5, 6, 12');
    expect(daysLabel(['2026-09-30', '2026-10-01'])).toBe('Sep 30, Oct 1');
    expect(daysLabel([])).toBe('');
  });
  it('a card shows the round the picker asked for', () => {
    const card = { shown: 2, rounds: [{ no: 1 }, { no: 2 }] } as unknown as MapCard;
    expect(shownRound(card)?.no).toBe(2);
    expect(shownRound({ ...card, shown: null })).toBeNull();
  });
});

describe('level 2 data', () => {
  it('reads the compact rows', () => {
    const v = parseAreaView({
      maps: [{ area: 'A', round: 1, open: true, started: 'x', ended: null }],
      streets: [['MLT01', 'elm rd', 10, 4, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }]],
      knocks: [[43.5, -79.8, 'no', 'MLT01', true], ['bad', 1, 'no', 'MLT01', false]],
      clients: [['id1', 43.5, -79.8, 'MLT01', 3, '1 Elm Rd', null]],
      bookings: 0, done_pct: 60,
    });
    expect(v.streets[0]).toMatchObject({ route: 'MLT01', street: 'elm rd', doors: 10, knocked: 4 });
    expect(v.knocks).toEqual([{ lat: 43.5, lng: -79.8, status: 'no', route: 'MLT01', fast: true }]);
    expect(v.clients[0]).toMatchObject({ id: 'id1', flags: 3, address: '1 Elm Rd', name: null });
    expect(v.done_pct).toBe(60);
    expect(parseAreaView({}).routes).toEqual([]);
  });
});

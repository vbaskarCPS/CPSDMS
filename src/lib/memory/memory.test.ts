import { describe, expect, it } from 'vitest';
import { THEMES, easter, themeFor, thanksgiving, torontoDate, currentTheme } from './themes';
import { memRecord, pairsNow, standing, type MemHistory } from './match';

describe('holiday themes', () => {
  it('know when Easter and Thanksgiving are', () => {
    expect(easter(2026)).toEqual([4, 5]);
    expect(easter(2027)).toEqual([3, 28]);
    expect(easter(2025)).toEqual([4, 20]);
    expect(thanksgiving(2026)).toBe(12);
    expect(thanksgiving(2025)).toBe(13);
    expect(thanksgiving(2027)).toBe(11);
  });
  it('dress up for the next big holiday', () => {
    const t = (m: number, d: number, y = 2026) => themeFor(y, m, d).id;
    expect(t(10, 13)).toBe('halloween');     // the day after Thanksgiving 2026
    expect(t(10, 12)).toBe('thanksgiving');
    expect(t(10, 26)).toBe('halloween');
    expect(t(10, 31)).toBe('halloween');
    expect(t(11, 1)).toBe('christmas');
    expect(t(12, 26)).toBe('christmas');
    expect(t(12, 27)).toBe('newyear');
    expect(t(1, 6)).toBe('newyear');
    expect(t(1, 7)).toBe('valentines');
    expect(t(2, 14)).toBe('valentines');
    expect(t(2, 15)).toBe('stpatricks');
    expect(t(3, 17)).toBe('stpatricks');
    expect(t(3, 18)).toBe('easter');
    expect(t(4, 6)).toBe('easter');           // Easter Monday 2026
    expect(t(4, 7)).toBe('canada');
    expect(t(7, 1)).toBe('canada');
    expect(t(7, 2)).toBe('thanksgiving');
    expect(t(3, 29, 2027)).toBe('easter');    // Easter Monday 2027
    expect(t(3, 30, 2027)).toBe('canada');
  });
  it('use the Toronto date, not the phone’s', () => {
    expect(torontoDate(new Date('2026-11-01T03:30:00Z'))).toEqual([2026, 10, 31]);   // still Halloween night in Toronto
    expect(currentTheme(new Date('2026-11-01T03:30:00Z')).id).toBe('halloween');
    expect(currentTheme(new Date('2026-11-01T05:00:00Z')).id).toBe('christmas');
  });
  it('have 18 different pictures each', () => {
    for (const th of Object.values(THEMES)) {
      expect(th.pics.length).toBe(18);
      expect(new Set(th.pics).size).toBe(18);
    }
  });
});

describe('who wins', () => {
  it('counts pairs on the board', () => {
    expect(pairsNow([{ face: 1, owner: 1 }, { face: 1, owner: 1 }, { face: null, owner: 0 }, { face: 2, owner: 2 }, { face: 2, owner: 2 }, { face: null, owner: 0 }])).toEqual([1, 1]);
  });
  it('best of 3 boards; a tie board is nobody’s; then total pairs', () => {
    expect(standing([{ host: 5, guest: 3 }, { host: 4, guest: 8 }, { host: 9, guest: 6 }])).toEqual({ wins: [2, 1], pairs: [18, 17], leader: 0 });
    expect(standing([{ host: 4, guest: 4 }, { host: 5, guest: 7 }, { host: 8, guest: 7 }])).toMatchObject({ wins: [1, 1], pairs: [17, 18], leader: 1 });   // level on boards: more pairs
    expect(standing([{ host: 4, guest: 4 }, { host: 6, guest: 6 }, { host: 8, guest: 7 }]).leader).toBe(0);
    expect(standing([{ host: 4, guest: 4 }]).leader).toBe(null);
  });
  it('keeps a record per opponent', () => {
    const V = { id: 'v', name: 'Vijay' }, R = { id: 'r', name: 'Rosh' };
    const h: MemHistory = [
      { id: '1', host: V, guest: R, boards: [{ host: 8, guest: 0 }, { host: 7, guest: 5 }], finished_at: '' },
      { id: '2', host: R, guest: V, boards: [{ host: 8, guest: 0 }, { host: 7, guest: 5 }], finished_at: '' },
      { id: '3', host: R, guest: V, boards: [{ host: 4, guest: 4 }], finished_at: '' },
    ];
    expect(memRecord(h, 'v')).toEqual([{ id: 'r', name: 'Rosh', won: 1, lost: 1, drawn: 1 }]);
  });
});

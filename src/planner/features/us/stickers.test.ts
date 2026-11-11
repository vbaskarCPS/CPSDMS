// Which occasion is coming up (occasions.ts), and the drawings of things that stand for an ordinary emoji
// (stickers.tsx). The packs they belong to, with the smileys, are tested in emoji.test.ts.
import { describe, expect, it } from 'vitest';
import { birthdaysFrom, countdown, easter, upcoming } from './occasions';
import { STICKERS, stickerOf } from './stickers';

const names = (today: string, b = [] as { name: string; day: string }[]) => upcoming(today, b).map(o => `${o.name} ${o.date || '?'}`);

describe('the occasion coming up', () => {
  it('on 11 November 2026: Christmas is next, Diwali has just gone and comes round again in 2027', () => {
    expect(names('2026-11-11')).toEqual(['Christmas 2026-12-25', 'New Year 2027-01-01', 'Valentine’s Day 2027-02-14', 'Easter 2027-03-28', 'Diwali 2027-10-29', 'Halloween 2027-10-31', 'Birthdays ?']);
    expect(upcoming('2026-11-11')[0]).toMatchObject({ id: 'christmas', days: 44 });
    expect(countdown(upcoming('2026-11-11')[0])).toBe('in 44 days');
  });
  it('the day itself still counts, and the day after it moves to next year', () => {
    expect(upcoming('2026-12-25')[0]).toMatchObject({ id: 'christmas', days: 0 });
    expect(countdown(upcoming('2026-12-25')[0])).toBe('today!');
    expect(countdown(upcoming('2026-12-31')[0])).toBe('tomorrow');
    expect(upcoming('2026-12-26').find(o => o.id === 'christmas')?.date).toBe('2027-12-25');
    expect(upcoming('2026-11-08')[0]).toMatchObject({ id: 'diwali', days: 0 });
  });
  it('Easter moves: worked out for each year', () => {
    expect([2024, 2025, 2026, 2027, 2028, 2030].map(easter)).toEqual(['03-31', '04-20', '04-05', '03-28', '04-16', '04-21']);
    expect(upcoming('2027-03-29').find(o => o.id === 'easter')?.date).toBe('2028-04-16');
  });
  it('past the years Diwali is known for, its stickers stay and only the countdown goes', () => {
    const d = upcoming('2033-01-01').find(o => o.id === 'diwali')!;
    expect(d.date).toBe('');
    expect(countdown(d)).toBe('');
    expect(upcoming('2033-01-01').slice(-2).some(o => o.id === 'diwali')).toBe(true);   // after everything with a date
  });
  it('birthdays come off the calendar: yearly events with "birthday" in the title', () => {
    const b = birthdaysFrom([
      { title: 'Rosh’s birthday', date: '2026-03-03', repeat: 'yearly' }, { title: "Vijay's Birthday 🎂", date: '2025-11-20', repeat: 'yearly' },
      { title: 'Birthday party at Sam’s', date: '2026-12-01', repeat: 'none' }, { title: 'Dentist', date: '2026-11-19', repeat: 'yearly' }, { title: 'Rosh’s birthday', date: '2027-03-03', repeat: 'yearly' },
    ]);
    expect(b).toEqual([{ name: 'Rosh', day: '03-03' }, { name: 'Vijay', day: '11-20' }]);
    expect(names('2026-11-11', b).slice(0, 2)).toEqual(['Vijay’s birthday 2026-11-20', 'Christmas 2026-12-25']);
    expect(names('2026-11-11', b)).toContain('Rosh’s birthday 2027-03-03');
    expect(names('2026-11-11', b)).not.toContain('Birthdays ?');
  });
});

describe('stickers', () => {
  it('three for every occasion and ten for Christmas, each with its own emoji', () => {
    const per = new Map<string, number>();
    for (const s of STICKERS) per.set(s.occasion, (per.get(s.occasion) || 0) + 1);
    expect(Object.fromEntries(per)).toEqual({ halloween: 3, diwali: 3, christmas: 10, newyear: 3, valentine: 3, easter: 3, birthday: 3 });
    expect(new Set(STICKERS.map(s => s.emoji)).size).toBe(STICKERS.length);
    expect(new Set(STICKERS.map(s => s.id)).size).toBe(STICKERS.length);
    expect(upcoming('2026-11-11').every(o => STICKERS.some(s => s.occasion === o.id))).toBe(true);
  });
  it('a message that is only that emoji is the sticker, however the keyboard typed it', () => {
    expect(stickerOf('🎄')?.id).toBe('tree');
    expect(stickerOf(' 🎃 ')?.id).toBe('pumpkin');
    expect(stickerOf('❤️')?.id).toBe('heart');   // with the "show as a picture" mark a keyboard adds
    expect(stickerOf('❤')?.id).toBe('heart');
    expect(stickerOf('❄\uFE0F')?.id).toBe('snowflake');
    const typed = STICKERS.filter(s => !s.trayOnly);
    expect(typed).toHaveLength(21);
    expect(typed.every(s => stickerOf(s.emoji) === s && stickerOf(`${s.emoji}\uFE0F`) === s)).toBe(true);
  });
  it('the Christmas things added since are ours only from the tray: typed alone they stay ordinary', () => {
    const picked = STICKERS.filter(s => s.trayOnly);
    expect(picked.map(s => s.id)).toEqual(['ribbon', 'star', 'bell', 'cocoa', 'ginger', 'cane', 'stocking']);
    expect(picked.every(s => s.occasion === 'christmas' && stickerOf(s.emoji) === null && stickerOf(`${s.emoji}\uFE0F`) === null)).toBe(true);
    expect(stickerOf('☕')).toBeNull();
  });
  it('words, two emoji, or an emoji we have no drawing for stay ordinary messages', () => {
    expect(stickerOf('🎄 see you at 6')).toBeNull();
    expect(stickerOf('🎄🎁')).toBeNull();
    expect(stickerOf('😀')).toBeNull();
    expect(stickerOf('')).toBeNull();
    expect(stickerOf(undefined)).toBeNull();
  });
});

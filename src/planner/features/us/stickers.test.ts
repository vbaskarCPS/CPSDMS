// The chat's stickers: which occasion is coming up (occasions.ts) and which messages are stickers (stickers.tsx).
import { describe, expect, it } from 'vitest';
import { birthdaysFrom, countdown, easter, upcoming } from './occasions';
import { STICKERS, stickerOf, stickerText } from './stickers';

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
  it('three for every occasion, each with its own emoji', () => {
    const per = new Map<string, number>();
    for (const s of STICKERS) per.set(s.occasion, (per.get(s.occasion) || 0) + 1);
    expect([...per.values()]).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(new Set(STICKERS.map(s => s.emoji)).size).toBe(STICKERS.length);
    expect(new Set(STICKERS.map(s => s.id)).size).toBe(STICKERS.length);
    expect(upcoming('2026-11-11').every(o => STICKERS.some(s => s.occasion === o.id))).toBe(true);
  });
  it('a message that is only that emoji is the sticker, typed or sent from the tray', () => {
    expect(stickerOf('🎄')?.id).toBe('tree');
    expect(stickerOf(' 🎃 ')?.id).toBe('pumpkin');
    expect(stickerOf('❤️')?.id).toBe('heart');   // with the "show as a picture" mark a keyboard adds
    expect(stickerOf('❤')?.id).toBe('heart');
    expect(stickerOf(stickerText(STICKERS.find(s => s.id === 'snowflake')!))?.id).toBe('snowflake');
    expect(STICKERS.every(s => stickerOf(stickerText(s)) === s)).toBe(true);
  });
  it('words, two emoji, or an emoji we have no drawing for stay ordinary messages', () => {
    expect(stickerOf('🎄 see you at 6')).toBeNull();
    expect(stickerOf('🎄🎁')).toBeNull();
    expect(stickerOf('😀')).toBeNull();
    expect(stickerOf('')).toBeNull();
    expect(stickerOf(undefined)).toBeNull();
  });
  it('what is sent has no words, so Arvy doesn’t read it', () => {
    for (const s of STICKERS) expect(/\p{L}{2,}/u.test(stickerText(s))).toBe(false);
  });
});

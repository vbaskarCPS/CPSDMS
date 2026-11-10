import { describe, expect, it } from 'vitest';
import { NIGHT_ROUTINE, MORNING_ROUTINE } from '../../lib/routine';
import { daysWithMeals, guessDay, guessTime } from './guess';

const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2026, 10, 9, h, m); };
const T = '2026-11-09', Y = '2026-11-08';
const run = (o: Partial<Parameters<typeof guessDay>[0]> & { meals?: Record<string, number> }) => guessDay({
  now: at('10:00'), today: T, yesterday: Y, routine: MORNING_ROUTINE, trackedDays: 5, asked: () => false,
  mealsOn: d => o.meals?.[d] ?? 0, ...o,
});

describe('guessDay', () => {
  it('asks about yesterday when it has nothing logged', () => {
    expect(run({ meals: { [T]: 1 } })).toBe(Y);
    expect(run({ meals: { [T]: 1, [Y]: 2 } })).toBeNull();
  });
  it('asks about today once it is late and today has nothing', () => {
    // morning routine: lights out 21:00, no kitchen close → late from 19:30
    expect(run({ now: at('19:00'), meals: { [Y]: 1 } })).toBeNull();
    expect(run({ now: at('19:45'), meals: { [Y]: 1 } })).toBe(T);
    // night routine: kitchen closes 14:00 → late from 15:00 (earlier than 90 min before 21:30)
    expect(run({ routine: NIGHT_ROUTINE, now: at('15:10'), meals: { [Y]: 1 } })).toBe(T);
    // late evening, both empty: today first
    expect(run({ now: at('20:30') })).toBe(T);
  });
  it('asks each day once, and never someone who does not track food', () => {
    expect(run({ asked: d => d === Y, meals: { [T]: 1 } })).toBeNull();
    expect(run({ trackedDays: 2 })).toBeNull();
  });
});

describe('helpers', () => {
  it('files a faster’s guess inside the eating window', () => {
    expect(guessTime({ ...NIGHT_ROUTINE, fast: true, eatOpen: '11:00' })).toBe('11:00');
    expect(guessTime(MORNING_ROUTINE)).toBe('12:00');
  });
  it('reads the days from meal keys', () => {
    const s = daysWithMeals(['2026-11-07~08:00~a', '2026-11-07~12:00~b', '2026-11-09~13:00~c', '2026-10-01~09:00~d'], '2026-11-01', '2026-11-09');
    expect([...s].sort()).toEqual(['2026-11-07', '2026-11-09']);
  });
});

// The 5 am club (night profile): up → gym → sauna (the meal plan, today's Brief) → the list → dinner → lights out.
import { describe, expect, it } from 'vitest';
import { blocks, currentBlock, NIGHT_ROUTINE, MORNING_ROUTINE, planAt } from './routine';

const at = (h: number, m: number) => { const d = new Date(2026, 10, 6, h, m); return d; };

describe('the 5 am club', () => {
  it('runs gym first, then the sauna for the meal plan and Brief, and nothing at night but lights out', () => {
    const b = blocks(NIGHT_ROUTINE).map(x => `${x.at} ${x.id}`);
    expect(b).toEqual(['05:00 wake', '05:15 gym', '06:20 sauna', '06:20 brief', '06:45 work', '14:00 kitchen', '21:30 lightsOut']);
    expect(blocks(NIGHT_ROUTINE).some(x => x.id === 'unwind' || x.id === 'windDown' || x.id === 'shake')).toBe(false);
  });
  it('without a sauna, the review and Brief come straight after the gym', () => {
    const r = { ...NIGHT_ROUTINE, saunaMin: 0 };
    expect(planAt(r)).toBe('06:45');
    expect(blocks(r).find(x => x.id === 'gym')!.until).toBe('06:45');
  });
  it('knows where the day is', () => {
    expect(currentBlock(NIGHT_ROUTINE, at(4, 30))).toBe('lightsOut');
    expect(currentBlock(NIGHT_ROUTINE, at(5, 30))).toBe('gym');
    expect(currentBlock(NIGHT_ROUTINE, at(6, 30))).toBe('brief');
    expect(currentBlock(NIGHT_ROUTINE, at(10, 0))).toBe('work');
    expect(currentBlock(NIGHT_ROUTINE, at(15, 0))).toBe('kitchen');
    expect(currentBlock(NIGHT_ROUTINE, at(22, 0))).toBe('lightsOut');
  });
  it('falls back to dinner when there is no kitchen cut-off', () => {
    expect(blocks({ ...NIGHT_ROUTINE, kitchenClose: '' }).map(x => x.id)).toContain('dinner');
  });
  it("leaves Rosh's morning routine as it was", () => {
    expect(blocks(MORNING_ROUTINE).map(x => x.id)).toEqual(['wake', 'morning', 'brief', 'kiaanUp', 'work', 'dinner', 'evening', 'lightsOut']);
  });
});

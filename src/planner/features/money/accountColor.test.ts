// A colour per account (accountColor.ts): the palette itself, the picked colour, and the defaults.
import { describe, expect, it } from 'vitest';
import { ACCOUNT_COLORS, accountColor, accountColors, colorName } from './accountColor';
import type { Account } from './types';

const acc = (id: string, order: number, more: Partial<Account> = {}): Account => ({ id, name: id, type: 'chequing', order, ...more });

/** WCAG contrast between two hex colours. */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('ACCOUNT_COLORS', () => {
  it('is 10 to 12 lower-case hex colours, none twice, each with a name', () => {
    expect(ACCOUNT_COLORS.length).toBeGreaterThanOrEqual(10);
    expect(ACCOUNT_COLORS.length).toBeLessThanOrEqual(12);
    for (const c of ACCOUNT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(ACCOUNT_COLORS).size).toBe(ACCOUNT_COLORS.length);
    const names = ACCOUNT_COLORS.map(colorName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/^#/);
  });
  it('shows on a white card and on both dark cards (planner.css --bg-2)', () => {
    for (const c of ACCOUNT_COLORS) for (const card of ['#ffffff', '#182650', '#382058']) expect(contrast(c, card), `${c} on ${card}`).toBeGreaterThanOrEqual(3);
  });
  it('names a colour that is not in the palette by its hex', () => {
    expect(colorName('#123456')).toBe('#123456');
    expect(colorName(ACCOUNT_COLORS[0].toUpperCase())).toBe('Blue');
  });
});

describe('accountColor', () => {
  const all = [acc('visa', 2), acc('chq', 0), acc('sav', 1)];
  it('gives the picked colour', () => {
    expect(accountColor(acc('visa', 2, { color: '#ABCDEF' }), all)).toBe('#abcdef');
    expect(accountColor(acc('visa', 2, { color: '#abc' }), all)).toBe('#abc');
  });
  it('else the palette colour for its place by order, however the list is sorted', () => {
    expect(accountColor(all[1], all)).toBe(ACCOUNT_COLORS[0]);
    expect(accountColor(all[2], all)).toBe(ACCOUNT_COLORS[1]);
    expect(accountColor(all[0], all)).toBe(ACCOUNT_COLORS[2]);
    expect(accountColor(all[0], [...all].reverse())).toBe(ACCOUNT_COLORS[2]);
  });
  it('breaks a tie in order by id', () => {
    const tied = [acc('b', 0), acc('a', 0)];
    expect(accountColor(tied[0], tied)).toBe(ACCOUNT_COLORS[1]);
    expect(accountColor(tied[1], tied)).toBe(ACCOUNT_COLORS[0]);
  });
  it('ignores a colour that is not a hex colour', () => {
    for (const color of ['red', '', '#12', '#12345g', 'url(x)', '#3b82f6; background: red']) expect(accountColor(acc('chq', 0, { color }), all)).toBe(ACCOUNT_COLORS[0]);
  });
  it('gives an account that is not in the list yet the next place', () => {
    expect(accountColor(acc('new', 9), all)).toBe(ACCOUNT_COLORS[3]);
    expect(accountColor(acc('first', 0), [])).toBe(ACCOUNT_COLORS[0]);
  });
  it('shares no default until the palette runs out, then starts again', () => {
    const many = Array.from({ length: ACCOUNT_COLORS.length + 2 }, (_, i) => acc(`a${String(i).padStart(2, '0')}`, i));
    const got = many.map(a => accountColor(a, many));
    expect(new Set(got.slice(0, ACCOUNT_COLORS.length)).size).toBe(ACCOUNT_COLORS.length);
    expect(got[ACCOUNT_COLORS.length]).toBe(ACCOUNT_COLORS[0]);
    expect(got[ACCOUNT_COLORS.length + 1]).toBe(ACCOUNT_COLORS[1]);
  });
  it('keeps the others where they were when one picks its own', () => {
    const picked = [acc('chq', 0, { color: '#000000' }), acc('sav', 1), acc('visa', 2)];
    expect(accountColor(picked[1], picked)).toBe(ACCOUNT_COLORS[1]);
    expect(accountColor(picked[2], picked)).toBe(ACCOUNT_COLORS[2]);
  });
});

describe('accountColors', () => {
  it('is every account by id, the same as accountColor one by one', () => {
    const all = [acc('visa', 2, { color: '#111111' }), acc('chq', 0), acc('sav', 1), acc('cash', 3, { type: 'cash' })];
    const map = accountColors(all);
    expect(Object.keys(map).sort()).toEqual(['cash', 'chq', 'sav', 'visa']);
    for (const a of all) expect(map[a.id]).toBe(accountColor(a, all));
    expect(map.visa).toBe('#111111');
  });
  it('is empty for no accounts', () => { expect(accountColors([])).toEqual({}); });
});

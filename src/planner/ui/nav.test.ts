// The bottom bar: which of the five buttons a screen sits under (ui/nav.ts).
import { describe, expect, it } from 'vitest';
import { groupOf, NAV_TO, pull, PULL_ARM, PULL_SLOP, SHOTS } from './nav';

describe('the bottom bar', () => {
  it('Today is only the home screen', () => {
    expect(groupOf('/')).toBe('today');
    expect(groupOf('')).toBe('today');
  });
  it('Health holds Train, Food and the cycle tracker, and its menu page', () => {
    for (const p of ['/health', '/workout', '/workout/live/abc', '/workout/templates/1', '/food', '/food/add', '/food/recipes/7', '/cycle', '/cycle/log/2026-11-11']) expect(groupOf(p)).toBe('health');
  });
  it('Wealth is Money', () => {
    for (const p of ['/money', '/money/import', '/money/budget']) expect(groupOf(p)).toBe('wealth');
    expect(NAV_TO.wealth).toBe('/money');   // one section: the button goes straight to it
  });
  it('Lifestyle holds Plan, Habits, Calendar and Shopping, and its menu page', () => {
    for (const p of ['/lifestyle', '/plan', '/plan/brief', '/plan/2026-11-10', '/habits', '/habits/new', '/calendar', '/shop']) expect(groupOf(p)).toBe('lifestyle');
  });
  it('Settings sits under none of them', () => {
    expect(groupOf('/settings')).toBeNull();
    expect(groupOf('/settings/arvy-log')).toBeNull();
  });
  it('every button that is a page goes somewhere that lights it up', () => {
    for (const g of ['today', 'health', 'wealth', 'lifestyle'] as const) expect(groupOf(NAV_TO[g])).toBe(g);
  });
});

describe('dragging a button up for a photo', () => {
  it('Health takes a meal photo and Wealth a receipt; the others take no drag', () => {
    expect(SHOTS.health?.kind).toBe('meal');
    expect(SHOTS.wealth?.kind).toBe('receipt');
    expect(SHOTS.today).toBeUndefined();
    expect(SHOTS.lifestyle).toBeUndefined();
  });
  it('letting go takes the photo only once the finger is far enough up', () => {
    expect(pull(0)).toEqual({ lift: 0, armed: false });
    expect(pull(PULL_ARM - 1).armed).toBe(false);
    expect(pull(PULL_ARM)).toEqual({ lift: 1, armed: true });
    expect(pull(300)).toEqual({ lift: 1, armed: true });       // the bubble stops rising; it stays ready
  });
  it('dragging back down takes it back, and a downward drag is nothing', () => {
    expect(pull(20).lift).toBeCloseTo(20 / PULL_ARM);
    expect(pull(-40)).toEqual({ lift: 0, armed: false });
  });
  it('a wobbly tap is not a drag', () => {
    expect(PULL_SLOP).toBeLessThan(PULL_ARM);
    expect(PULL_SLOP).toBeGreaterThanOrEqual(8);
  });
});

// The bottom bar: which of the five buttons a screen sits under (ui/nav.ts).
import { describe, expect, it } from 'vitest';
import { groupOf, NAV_TO } from './nav';

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

import { describe, expect, it } from 'vitest';
import { swayTag, swayCounts } from './tag';
import { swapFor } from './lists';

describe('swayTag', () => {
  it('matches go-list foods, singular or plural, any case', () => {
    expect(swayTag('Strawberries')).toBe('go');
    expect(swayTag('strawberry')).toBe('go');
    expect(swayTag('Greek yogurt, 1 cup')).toBe('go');
    expect(swayTag('White rice')).toBe('go');
    expect(swayTag('Black coffee')).toBe('go');
    expect(swayTag('Cucumber slices')).toBe('go');
  });
  it('matches ease-list foods and the more specific entry wins', () => {
    expect(swayTag('Bananas')).toBe('ease');
    expect(swayTag('Brown rice')).toBe('ease');
    expect(swayTag('Sweet potatoes')).toBe('ease');
    expect(swayTag('Scrambled eggs')).toBe('ease');
    expect(swayTag('Olive oil (EVOO)')).toBe('ease');
    expect(swayTag('Beef steak')).toBe('ease');
  });
  it('leaves unknown foods neutral', () => {
    expect(swayTag('Dal (lentil curry)')).toBe('neutral');
    expect(swayTag('Roti')).toBe('neutral');
  });
  it('counts and swaps', () => {
    expect(swayCounts([{ sway: 'go' }, { sway: 'go' }, { sway: 'ease' }, {}])).toEqual({ go: 2, ease: 1, neutral: 1 });
    expect(swapFor('Brown rice')).toBe('white or basmati rice');
    expect(swapFor('Tofu')).toBeNull();
  });
});

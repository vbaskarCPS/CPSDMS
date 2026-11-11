import { describe, expect, it } from 'vitest';
import { costUsd, priceOf } from '../../../supabase/functions/benny-assist/cost';
import { roughCost, toolCounts, toolSteps } from './benny';

describe('costUsd (US$, from Anthropic’s prices per million tokens)', () => {
  it('prices a main-model question with its first cache write (from the server log, 2026-11-11 10:53)', () => {
    // 1,705 in + 14,005 written to the cache + 14,005 read from it + 290 out, on Sonnet 5.5
    expect(costUsd('claude-sonnet-5-5', { steps: 2, input: 1705, cache_write: 14005, cache_read: 14005, output: 290 })).toBeCloseTo(0.042723, 6);
  });
  it('prices a small-model question that reads the cache (2026-11-11 11:54)', () => {
    expect(costUsd('claude-haiku-5-5', { steps: 2, input: 685, cache_write: 0, cache_read: 28010, output: 255 })).toBeCloseTo(0.000476, 6);
  });
  it('knows each family, Sonnet 5’s dearer cache reads, and prices an unknown model as Sonnet-class', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, write: 5, read: 0.2, output: 20 });
    expect(priceOf('claude-sonnet-5').read).toBe(0.2);
    expect(priceOf('claude-sonnet-5-5').read).toBe(0.1);
    expect(priceOf('something-new')).toEqual(priceOf('claude-sonnet-5-5'));
    expect(costUsd('claude-sonnet-5-5', null)).toBe(0);
  });
});

describe('AI log display', () => {
  it('counts each tool once, with how many times and how many failed', () => {
    expect(toolCounts([{ name: 'route' }, { name: 'route', ok: false }, { name: 'show_map', ok: true }]))
      .toEqual([{ name: 'route', n: 2, failed: 1 }, { name: 'show_map', n: 1, failed: 0 }]);
    expect(toolCounts(undefined)).toEqual([]);
  });
  it('lists the tools in order, a run of the same one in a row as one step with its total time', () => {
    expect(toolSteps([{ name: 'live_team', model: 'main', ms: 300 }, { name: 'route', model: 'main', ms: 300 }, { name: 'route', model: 'main', ms: 200 },
      { name: 'route', model: 'main', ok: false, ms: 100 }, { name: 'show_map', model: 'main', ms: 50 }]))
      .toEqual([{ name: 'live_team', model: 'main', ms: 300, n: 1 }, { name: 'route', model: 'main', ms: 500, n: 2 },
        { name: 'route', model: 'main', ok: false, ms: 100, n: 1 }, { name: 'show_map', model: 'main', ms: 50, n: 1 }]);
  });
  it('shows a rough cost readably', () => {
    expect(roughCost(0)).toBe('0¢');
    expect(roughCost(0.000476)).toBe('<0.1¢');
    expect(roughCost(0.0427)).toBe('4.3¢');
    expect(roughCost(0.31)).toBe('31¢');
    expect(roughCost(4.5)).toBe('$4.50');
  });
});

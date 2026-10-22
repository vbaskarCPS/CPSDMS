import { describe, expect, it } from 'vitest';
import { buildState } from './buildHouses';

describe('a route’s build state', () => {
  it('ready once it has houses on their rooftops', () => {
    expect(buildState(300, { geocoded_at: '2026-10-22' })).toBe('ready');
    expect(buildState(120, null)).toBe('ready');   // found by Mapbox along the streets: already placed
  });
  it('flags houses never put on rooftops, and routes with none', () => {
    expect(buildState(287, { geocoded_at: null })).toBe('unplaced');
    expect(buildState(0, { geocoded_at: null })).toBe('empty');
    expect(buildState(0, null)).toBe('empty');
  });
});

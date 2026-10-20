import { describe, expect, it } from 'vitest';
import { MAX_ROAD_SPAN_LAT, placeSearches, roadBox } from './roadBox';

const parse = (s: string) => s.split(',').map(Number);

describe('the road box the builder asks for', () => {
  it('is the view plus a margin when the view is small', () => {
    const r = roadBox({ south: 43.20, west: -79.90, north: 43.22, east: -79.87 });
    expect(r.capped).toBe(false);
    const [s, w, n, e] = parse(r.bbox);
    expect(s).toBeCloseTo(43.198, 3); expect(n).toBeCloseTo(43.222, 3);
    expect(w).toBeCloseTo(-79.903, 3); expect(e).toBeCloseTo(-79.867, 3);
  });
  it('is the middle of the view when the view is a whole city', () => {
    const r = roadBox({ south: 49.0, west: -123.4, north: 49.4, east: -122.6 });   // Vancouver, zoomed out
    expect(r.capped).toBe(true);
    const [s, w, n, e] = parse(r.bbox);
    expect(n - s).toBeCloseTo(MAX_ROAD_SPAN_LAT * 1.2, 6);
    expect((n + s) / 2).toBeCloseTo(49.2, 6); expect((w + e) / 2).toBeCloseTo(-123.0, 6);
    expect(e - w).toBeGreaterThan(n - s);   // wider in longitude to stay square on the ground
  });
});

describe('where a new map is looked up', () => {
  it('uses the city, and Canada, not Ontario', () => {
    expect(placeSearches('Kitsilano #2', 'Vancouver, BC')).toEqual(['kitsilano, Vancouver, BC, Canada', 'Vancouver, BC, Canada', 'kitsilano, Canada']);
    expect(placeSearches('Bridlewood', null)).toEqual(['bridlewood, Canada']);
  });
});

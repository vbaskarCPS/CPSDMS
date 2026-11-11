import { describe, it, expect, vi } from 'vitest';
vi.mock('mapbox-gl', () => ({ default: {} }));
vi.mock('../../lib/territory', () => ({ routeShapes: vi.fn() }));
vi.mock('../../lib/benny', () => ({ bennyOutlines: vi.fn() }));
vi.mock('../bookings/mbMap', () => ({ BLANK_STYLE: {} }));
vi.mock('../../../lib/rmMapStyle', () => ({ RM_STYLE: '', tidyRmBaseMap: () => undefined }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bennyFeatures, hullOutline, mapCaption, MapFrame, outlinesFor } from './BennyMap';

describe('mapCaption', () => {
  const pin = { lat: 49, lng: -123, label: 'x', route: null };
  it('says what is on the map, and never "0 routes highlighted"', () => {
    expect(mapCaption({ maps: ['A'], highlight: ['R1', 'R2'], pins: [] })).toBe('2 routes highlighted');
    expect(mapCaption({ maps: ['A'], highlight: ['R1'], pins: [pin] })).toBe('1 route highlighted · 1 pin');
    expect(mapCaption({ maps: ['A'], highlight: [], pins: [pin, pin] })).toBe('2 pins');
    expect(mapCaption({ maps: ['A'], highlight: [], pins: [{ ...pin, n: 1 }, { ...pin, n: 2 }] })).toBe('2 stops in order');
    expect(mapCaption({ maps: ['A', 'B'], highlight: [], pins: [] })).toBe('2 maps');     // maps only: nothing picked out
    expect(mapCaption({ maps: ['A'], highlight: [], pins: [] })).toBe('1 map');
  });
});

describe('bennyFeatures', () => {
  const shapes = [
    { code: 'SRY12', area: 'Surrey #1', number: 12, lines: [[[0, 0], [1, 1]] as [number, number][]] },
    { code: 'SRY13', area: 'Surrey #1', number: 13, lines: [[[2, 2], [3, 3]] as [number, number][]] },
  ];
  it('colours the asked-for routes, greys the rest, numbers only the coloured ones', () => {
    const f = bennyFeatures({ maps: ['Surrey #1', 'Nowhere'], highlight: ['sry12'], pins: [{ lat: 49, lng: -122, label: '12 Oak St', route: 'SRY12' }, { lat: NaN, lng: 0, label: 'x', route: null }] },
      shapes, { 'Surrey #1': { type: 'Polygon', coordinates: [] } });
    const named = bennyFeatures({ maps: ['A'], highlight: [], pins: [] }, [], { A: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [1, 3], [0, 0]]] } });
    expect((named.names.features[0].geometry as GeoJSON.Point).coordinates).toEqual([1, 3]);
    expect(f.routes.features.map(x => x.properties!.on)).toEqual([1, 0]);
    expect(f.nums.features.map(x => x.properties!.label)).toEqual(['SRY12']);
    expect(f.outlines.features).toHaveLength(1);
    expect(f.names.features).toHaveLength(0);   // an outline with no points has nowhere to put its name
    expect(f.pins.features).toHaveLength(1);
    expect(f.pins.features[0].properties).not.toHaveProperty('n');   // a plain pin carries no number
    expect(f.path.features).toHaveLength(0);                          // and has no line
  });
  it('an order is drawn as numbered stops joined in order, from where the manager is', () => {
    const pins = [{ lat: 2, lng: 20, label: 'Drop 2 · B', route: null, n: 2 }, { lat: 1, lng: 10, label: 'Drop 1 · A', route: 'SRY12', n: 1 }, { lat: 3, lng: 30, label: 'Drop 3 · C', route: null, n: 3 }];
    const f = bennyFeatures({ maps: ['Surrey #1'], highlight: [], pins, start: { lat: 0, lng: 5 } }, shapes, {});
    expect(f.pins.features.map(x => x.properties!.n)).toEqual([2, 1, 3]);
    const line = f.path.features.find(x => x.properties!.kind === 'line')!;
    expect((line.geometry as GeoJSON.LineString).coordinates).toEqual([[5, 0], [10, 1], [20, 2], [30, 3]]);   // start, then 1, 2, 3
    expect(f.path.features.filter(x => x.properties!.kind === 'start')).toHaveLength(1);
    const noStart = bennyFeatures({ maps: ['Surrey #1'], highlight: [], pins }, shapes, {});
    expect((noStart.path.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([[10, 1], [20, 2], [30, 3]]);
    expect(noStart.path.features).toHaveLength(1);
  });
});

describe('the map’s outlines and messages', () => {
  it('a missing outline is stood in for by the hull of the map’s routes', () => {
    const shapes = [{ code: 'A1', area: 'A', number: 1, lines: [[[0, 0], [4, 0]], [[4, 3], [0, 3]], [[2, 1], [2, 2]]] as [number, number][][] }];
    const kept = { B: { type: 'Polygon', coordinates: [] } as GeoJSON.Geometry };
    const o = outlinesFor(['A', 'B', 'C'], kept, shapes);
    expect(o.B).toBe(kept.B);                      // the kept one wins
    expect(o.C).toBeUndefined();                   // no routes, no outline
    const ring = (o.A as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(5);                  // the 4 corners, closed; the inside point is left out
    expect(ring[0]).toEqual(ring[4]);
    expect(hullOutline([[0, 0], [1, 1]])).toBeNull();
  });
  it('an error is drawn inside the map’s own box, never as a layer over the chat', () => {
    const html = renderToStaticMarkup(React.createElement(MapFrame, { message: 'The map didn’t load: canceling statement due to statement timeout', error: true, onRetry: () => undefined }));
    expect(html.startsWith('<div class="benny-map"')).toBe(true);
    expect(html).toMatch(/<div class="benny-map"[^>]*><div class="benny-map-msg err" role="alert">/);
    expect(html).toContain('Try again');
  });
});

import { describe, it, expect, vi } from 'vitest';
vi.mock('mapbox-gl', () => ({ default: {} }));
vi.mock('../../lib/territory', () => ({ routeShapes: vi.fn() }));
vi.mock('../../lib/benny', () => ({ bennyOutlines: vi.fn() }));
vi.mock('../bookings/mbMap', () => ({ BLANK_STYLE: {} }));
vi.mock('../../../lib/rmMapStyle', () => ({ RM_STYLE: '', tidyRmBaseMap: () => undefined }));
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bennyFeatures, hullOutline, MapFrame, outlinesFor } from './BennyMap';

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

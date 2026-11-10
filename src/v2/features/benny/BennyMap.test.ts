import { describe, it, expect, vi } from 'vitest';
vi.mock('mapbox-gl', () => ({ default: {} }));
vi.mock('../../lib/territory', () => ({ routeShapes: vi.fn(), territoryOutlines: vi.fn() }));
vi.mock('../bookings/mbMap', () => ({ BLANK_STYLE: {} }));
vi.mock('../../../lib/rmMapStyle', () => ({ RM_STYLE: '', tidyRmBaseMap: () => undefined }));
import { bennyFeatures } from './BennyMap';

describe('bennyFeatures', () => {
  const shapes = [
    { code: 'SRY12', area: 'Surrey #1', number: 12, lines: [[[0, 0], [1, 1]] as [number, number][]] },
    { code: 'SRY13', area: 'Surrey #1', number: 13, lines: [[[2, 2], [3, 3]] as [number, number][]] },
  ];
  it('colours the asked-for routes, greys the rest, numbers only the coloured ones', () => {
    const f = bennyFeatures({ maps: ['Surrey #1', 'Nowhere'], highlight: ['sry12'], pins: [{ lat: 49, lng: -122, label: '12 Oak St', route: 'SRY12' }, { lat: NaN, lng: 0, label: 'x', route: null }] },
      shapes, { 'Surrey #1': { type: 'Polygon', coordinates: [] } });
    expect(f.routes.features.map(x => x.properties!.on)).toEqual([1, 0]);
    expect(f.nums.features.map(x => x.properties!.label)).toEqual(['SRY12']);
    expect(f.outlines.features).toHaveLength(1);
    expect(f.pins.features).toHaveLength(1);
  });
});

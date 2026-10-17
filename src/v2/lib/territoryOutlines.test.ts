import { describe, expect, it } from 'vitest';
import { outlineFeatures, REGION_COLOR, type Outlines } from './territory';
import { parseBuilderView } from '../../lib/builderView';

const sq = (x: number, y: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });

describe('outlines of every map', () => {
  const o: Outlines = { 'BRONTE #1': sq(0, 0), 'ALDERSHOT': sq(10, 10), 'EMPTY': { type: 'Polygon', coordinates: [] } };
  const info = new Map([['BRONTE #1', { region: 'West' as const }]]);
  it('colours by region, grey when none, labels in the middle, skips shapes with no points', () => {
    const f = outlineFeatures(o, info);
    expect(f.shapes.features.map(x => x.properties?.area)).toEqual(['ALDERSHOT', 'BRONTE #1']);
    expect(f.shapes.features[1].properties?.color).toBe(REGION_COLOR.West);
    expect(f.shapes.features[0].properties?.color).toBe(REGION_COLOR.none);
    expect(f.labels.features[1].geometry).toEqual({ type: 'Point', coordinates: [0.4, 0.4] });
  });
  it('leaves out the map being built and marks the picked one', () => {
    const f = outlineFeatures(o, info, 'ALDERSHOT', 'BRONTE #1');
    expect(f.shapes.features.map(x => x.properties?.area)).toEqual(['BRONTE #1']);
    expect(f.shapes.features[0].properties?.sel).toBe(1);
  });
});

describe('the builder starts where it was left', () => {
  it('reads a saved view', () => {
    expect(parseBuilderView('{"center":[-79.7,43.4],"zoom":14.5}')).toEqual({ center: [-79.7, 43.4], zoom: 14.5 });
  });
  it('ignores anything that is not a sensible place', () => {
    expect(parseBuilderView(null)).toBeNull();
    expect(parseBuilderView('nope')).toBeNull();
    expect(parseBuilderView('{"center":[-79.7],"zoom":14}')).toBeNull();
    expect(parseBuilderView('{"center":[-79.7,95],"zoom":14}')).toBeNull();
    expect(parseBuilderView('{"center":[-79.7,43.4],"zoom":40}')).toBeNull();
    expect(parseBuilderView('{"center":["a",43.4],"zoom":14}')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { closeRing, filterZones, placeLabel, polygonProblem, zoneColor, zoneFeatures, type Zone } from './mainstreet';

const zone = (p: Partial<Zone> & { id: string; name: string }): Zone => ({
  polygon: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, center_lat: 0.5, center_lng: 0.5, city: null, area: null,
  status: 'active', created_at: '', updated_at: '', campaigns: [], ...p,
});
const taxifi = { campaign_id: 'c1', name: 'Taxifi', color: '#0ea5e9', is_active: true, rep_id: null, rep_name: null, assigned_at: null };

describe('mainstreet · polygons', () => {
  it('needs three distinct corners inside the world', () => {
    expect(polygonProblem([[0, 0], [1, 1]])).toMatch(/three corners/);
    expect(polygonProblem([[0, 0], [0, 0], [0, 0], [0, 0]])).toMatch(/different corners/);
    expect(polygonProblem([[0, 0], [200, 1], [1, 1]])).toMatch(/off the map/);
    expect(polygonProblem([[0, 0], [1, 0], [1, 1]])).toBeNull();
    expect(polygonProblem([[0, 0], [1, 0], [1, 1], [0, 0]])).toBeNull();   // already closed
  });
  it('closes the ring once', () => {
    expect(closeRing([[0, 0], [1, 0], [1, 1]]).coordinates[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(closeRing([[0, 0], [1, 0], [1, 1], [0, 0]]).coordinates[0]).toHaveLength(4);
  });
});

describe('mainstreet · list', () => {
  const a = zone({ id: 'a', name: 'Plaza North', city: 'Oakville', area: 'Bronte', campaigns: [{ ...taxifi, rep_id: 'r1', rep_name: 'Rep One' }] });
  const b = zone({ id: 'b', name: 'Industrial East', city: 'Burlington', campaigns: [taxifi] });
  const c = zone({ id: 'c', name: 'Old', status: 'retired' });
  it('labels the place', () => {
    expect(placeLabel(a)).toBe('Bronte, Oakville');
    expect(placeLabel(b)).toBe('Burlington');
    expect(placeLabel(c)).toBe('—');
  });
  it('filters by rep, campaign, retired and search', () => {
    expect(filterZones([a, b, c], 'all', false, '').map(z => z.id)).toEqual(['a', 'b']);
    expect(filterZones([a, b, c], 'all', true, '').map(z => z.id)).toEqual(['a', 'b', 'c']);
    expect(filterZones([a, b, c], 'unassigned', true, '').map(z => z.id)).toEqual(['b', 'c']);
    expect(filterZones([a, b, c], 'c1', false, '').map(z => z.id)).toEqual(['a', 'b']);
    expect(filterZones([a, b, c], 'all', false, 'rep one').map(z => z.id)).toEqual(['a']);
    expect(filterZones([a, b, c], 'all', false, 'burl').map(z => z.id)).toEqual(['b']);
  });
  it('colours by assignment', () => {
    expect(zoneColor(a)).toBe('#0ea5e9');
    expect(zoneColor(b)).toBe('#94a3b8');
    expect(zoneColor(c)).toBe('#64748b');
    const f = zoneFeatures([a, b], 'b');
    expect(f.shapes.features.map(x => x.properties?.sel)).toEqual([0, 1]);
    expect(f.labels.features[0].properties?.label).toBe('Plaza North');
  });
});

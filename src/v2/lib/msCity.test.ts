import { describe, expect, it } from 'vitest';
import { classifyGoogle, classifyOsm, estimateCalls, googleRow, gridCells, inPolygon, isOsmBusiness, lineKind, splitCell } from './msCity';

const square: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[-79.80, 43.40], [-79.70, 43.40], [-79.70, 43.50], [-79.80, 43.50], [-79.80, 43.40]]] };

describe('msCity · classification', () => {
  it('maps Google types to our kinds', () => {
    expect(classifyGoogle('plumber', ['plumber', 'point_of_interest'])).toBe('trades');
    expect(classifyGoogle('dental_clinic', ['dentist', 'health'])).toBe('clinic');
    expect(classifyGoogle('real_estate_agency', [])).toBe('brokerage');
    expect(classifyGoogle('insurance_agency', [])).toBe('agency');
    expect(classifyGoogle('restaurant', ['food'])).toBe('restaurant');
    expect(classifyGoogle('hair_salon', [])).toBe('salon');
    expect(classifyGoogle('car_repair', [])).toBe('auto');
    expect(classifyGoogle('gym', [])).toBe('fitness');
    expect(classifyGoogle('warehouse', [])).toBe('industrial');
    expect(classifyGoogle('shoe_store', ['store'])).toBe('retail');
    expect(classifyGoogle('point_of_interest', ['establishment'])).toBe('other');
    expect(classifyGoogle(undefined, ['bar'])).toBe('restaurant');
  });
  it('maps OSM tags to our kinds', () => {
    expect(classifyOsm({ shop: 'hairdresser' })).toBe('salon');
    expect(classifyOsm({ amenity: 'dentist' })).toBe('clinic');
    expect(classifyOsm({ office: 'estate_agent' })).toBe('brokerage');
    expect(classifyOsm({ office: 'insurance' })).toBe('agency');
    expect(classifyOsm({ craft: 'electrician' })).toBe('trades');
    expect(classifyOsm({ shop: 'car_repair' })).toBe('auto');
    expect(classifyOsm({ amenity: 'cafe', cuisine: 'coffee_shop' })).toBe('restaurant');
    expect(classifyOsm({ leisure: 'fitness_centre' })).toBe('fitness');
    expect(classifyOsm({ shop: 'clothes' })).toBe('retail');
    expect(classifyOsm({ amenity: 'bank' })).toBe('other');
  });
  it('only counts named business-like OSM features', () => {
    expect(isOsmBusiness({ amenity: 'bench' })).toBe(false);
    expect(isOsmBusiness({ shop: 'bakery' })).toBe(false);          // no name
    expect(isOsmBusiness({ shop: 'bakery', name: 'Buns' })).toBe(true);
    expect(isOsmBusiness({ amenity: 'parking', name: 'Lot 3' })).toBe(false);
    expect(isOsmBusiness({ amenity: 'restaurant', name: 'Luigi' })).toBe(true);
    expect(isOsmBusiness({ leisure: 'park', name: 'Coronation' })).toBe(false);
  });
  it('classifies streets', () => {
    expect(lineKind({ highway: 'motorway' })).toBe('highway');
    expect(lineKind({ highway: 'trunk_link' })).toBe('highway');
    expect(lineKind({ highway: 'secondary' })).toBe('arterial');
    expect(lineKind({ highway: 'residential' })).toBeNull();
    expect(lineKind({ railway: 'rail' })).toBe('rail');
    expect(lineKind({ railway: 'abandoned' })).toBeNull();
    expect(lineKind({ waterway: 'river' })).toBe('water');
    expect(lineKind({ waterway: 'ditch' })).toBeNull();
  });
  it('turns a Google place into a row', () => {
    const r = googleRow({ id: 'p1', displayName: { text: 'Joe Plumbing' }, location: { latitude: 43.4, longitude: -79.7 }, primaryType: 'plumber', types: ['plumber'],
      businessStatus: 'OPERATIONAL', nationalPhoneNumber: '(905) 555-0100', regularOpeningHours: { weekdayDescriptions: ['Monday: 9–5'] } });
    expect(r).toMatchObject({ kind: 'trades', source: 'google', google_place_id: 'p1', status: 'open', phone: '(905) 555-0100' });
    expect(googleRow({ id: 'p2', displayName: { text: 'Closed' }, location: { latitude: 1, longitude: 1 }, businessStatus: 'CLOSED_PERMANENTLY' })?.status).toBe('closed');
    expect(googleRow({ id: 'p3' })).toBeNull();
  });
});

describe('msCity · sweep grid', () => {
  it('covers the boundary with cells and splits saturated ones', () => {
    const cells = gridCells({ s: 43.40, w: -79.80, n: 43.50, e: -79.70 }, square, 1000);
    expect(cells.length).toBeGreaterThan(70);     // ~11 km × ~8 km
    expect(cells.length).toBeLessThan(130);
    expect(cells.every(c => c.radius === 708)).toBe(true);
    const quarters = splitCell(cells[0]);
    expect(quarters).toHaveLength(4);
    expect(quarters[0].radius).toBe(354);
    expect(estimateCalls(100)).toBe(250);
    expect(estimateCalls(5000)).toBe(2500);
  });
  it('point in polygon handles holes', () => {
    const donut: GeoJSON.Polygon = { type: 'Polygon', coordinates: [square.coordinates[0], [[-79.76, 43.44], [-79.74, 43.44], [-79.74, 43.46], [-79.76, 43.46], [-79.76, 43.44]]] };
    expect(inPolygon([-79.75, 43.45], square)).toBe(true);
    expect(inPolygon([-79.75, 43.45], donut)).toBe(false);
    expect(inPolygon([-79.79, 43.41], donut)).toBe(true);
    expect(inPolygon([-79.9, 43.45], square)).toBe(false);
  });
});

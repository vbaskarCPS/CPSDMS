import { afterEach, describe, expect, it } from 'vitest';
import { geocodeProvince, placeQuery, provinceForRegion } from './geoProvince';

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(), key: () => null, length: 0,
};
const pointAt = (region: string) => store.set('current_command_center', JSON.stringify({ id: 'x', region }));

describe('address searches use the centre’s province', () => {
  afterEach(() => store.clear());
  it('West is BC, East is Ontario, Central adds none', () => {
    expect(provinceForRegion('West')).toBe('British Columbia');
    expect(provinceForRegion('East')).toBe('Ontario');
    expect(provinceForRegion('Central')).toBe('');
  });
  it('follows the centre the old screens are pointed at; Ontario before any is picked', () => {
    expect(geocodeProvince()).toBe('Ontario');
    pointAt('West');
    expect(placeQuery(['12 Elm St', 'Chilliwack'])).toBe('12 Elm St, Chilliwack, British Columbia, Canada');
    pointAt('Central');
    expect(placeQuery(['12', 'Elm St', 'Calgary'], ' ')).toBe('12 Elm St Calgary Canada');
  });
  it('drops empty parts', () => {
    expect(placeQuery(['', '5 Oak Ave', null, undefined], ', ', 'Ontario')).toBe('5 Oak Ave, Ontario, Canada');
  });
});

// src/lib/geoProvince.ts — which province an address search adds, for the centre being worked.
//
// The old address lookups always added "Ontario, Canada", so a BC address could land on an Ontario
// street of the same name. They now add the province of the centre the old screens are pointed at
// (commandCenterService's current centre): West → British Columbia, East → Ontario. Central covers
// more than one province, so it adds none and leaves it to the city and the map area. With no centre
// picked yet, it stays Ontario, as before.
import { getStorageItem } from './localStorage';

const CC_STORAGE_KEY = 'current_command_center';   // commandCenterService's key

export function provinceForRegion(region: string | null | undefined): string {
  if (region === 'West') return 'British Columbia';
  if (region === 'Central') return '';
  return 'Ontario';
}

/** The province to add to an address search right now. */
export function geocodeProvince(): string {
  const cc = getStorageItem<{ region?: string } | null>(CC_STORAGE_KEY, null);
  return provinceForRegion(cc?.region);
}

/** An address search: the given parts, then the province (when there is one) and "Canada". */
export function placeQuery(parts: (string | number | null | undefined)[], sep = ', ', province = geocodeProvince()): string {
  return [...parts, province, 'Canada'].map(p => (p === null || p === undefined ? '' : String(p).trim())).filter(Boolean).join(sep);
}

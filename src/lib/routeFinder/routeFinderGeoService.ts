// src/lib/routeFinder/routeFinderGeoService.ts
//
// Geo service for the map-based Route Finder.
// Handles:
//   1. Loading approved route segments from route_maps table
//   2. Extracting available prefixes from those routes
//   3. Geocoding customer addresses via Mapbox Temporary Geocoding API
//   4. Proximity matching — finds the closest drawn route segment to a geocoded pin
//
// NOTE: Uses Mapbox Temporary Geocoding API (free tier, 100k/month).
// Coordinates are NOT stored in Supabase per Mapbox temp API terms.
// When upgrading to Permanent API, add lat/lng columns to session storage.
//

import { supabase } from '../supabase';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ApprovedRoute {
  id: string;
  area_name: string;
  route_number: number;
  route_code: string;
  route_color: string;
  segments: Array<{
    osmId: number;
    name: string;
    coordinates: [number, number][]; // [lng, lat] pairs
  }>;
}

/** One row in the call book that belongs to this customer */
export interface CustomerRow {
  sheetName: string;
  sheetRowNumber: number; // 1-based actual sheet row
  routeCodeCol: number;   // 0-based column index for route code
  streetNameCol: number;  // 0-based column index for street name
  bookingId: string;
  year: number;
}

/**
 * A single customer, potentially spanning multiple years / rows.
 * Grouped by phone number (primary key) or house+street+city (fallback).
 */
export interface GeoCustomer {
  id: string;              // phone or house|street|city key
  rows: CustomerRow[];     // all rows for this customer (one per year)
  // Display data — taken from the most recent year's row
  phone: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city: string;
  currentRouteCode: string;
  // Geocoding result (temp, not persisted)
  lat: number | null;
  lng: number | null;
  geocodeFailed: boolean;
  // Proximity match result
  pinColor: 'grey' | 'orange' | 'green';
  suggestedRouteCode: string;
  suggestedSegmentName: string;
  distanceDeg: number;      // Euclidean distance in degrees to closest segment
  noRouteFound: boolean;    // true if no route within MAX_ROUTE_DISTANCE_DEG
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/**
 * Maximum distance in degrees for a route match to be considered valid.
 * Beyond this = "No Route Found" (sidebar / unresolvable).
 * 0.004° ≈ ~400m — generous for suburban areas where houses can be far from mapped street centers.
 */
export const MAX_ROUTE_DISTANCE_DEG = 0.004;

/**
 * Tolerance in degrees: if the current assigned route is within this much
 * of the closest route, we don't flag it as wrong.
 * 0.0008° ≈ ~90m — handles cases where a customer is equidistant between two parallel routes.
 */
export const SAME_ROUTE_TOLERANCE_DEG = 0.0008;

// ─── ROUTE LOADING ────────────────────────────────────────────────────────────

/** Load all approved routes from the route_maps table */
export async function loadApprovedRoutes(): Promise<ApprovedRoute[]> {
  const { data, error } = await supabase
    .from('route_maps')
    .select('*')
    .eq('status', 'approved');

  if (error) throw new Error('Failed to load approved routes: ' + error.message);
  return (data || []) as ApprovedRoute[];
}

/**
 * Extract distinct route prefixes (the letter portion of route codes).
 * E.g. ACE01, ACE02 → "ACE"; HM01, HM02 → "HM"
 * Only prefixes that have at least one approved route are returned.
 */
export function getAvailablePrefixes(routes: ApprovedRoute[]): string[] {
  const prefixSet = new Set<string>();
  for (const route of routes) {
    const match = route.route_code.match(/^([a-zA-Z]+)/);
    if (match) prefixSet.add(match[1].toUpperCase());
  }
  return Array.from(prefixSet).sort();
}

// ─── PROXIMITY MATCHING ───────────────────────────────────────────────────────

/**
 * Compute the perpendicular distance from point P to line segment AB.
 * All values in degrees (lng/lat coordinate space).
 * This is Euclidean distance — accurate enough for the ~10km scale of a route prefix area.
 */
function pointToSegmentDistance(
  px: number, py: number, // point (lng, lat)
  ax: number, ay: number, // segment start
  bx: number, by: number  // segment end
): number {
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    // Degenerate segment — point to point
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  }

  // Project point onto segment, clamp to [0, 1]
  const t = Math.max(0, Math.min(1,
    ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  ));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

/**
 * Find the closest approved route segment to a geocoded point.
 * Searches ALL approved routes (not just the selected prefix) so that
 * customers near a master-map boundary are correctly attributed to
 * the neighbouring prefix if that's where they physically sit.
 *
 * Returns the best match, or null if no segments exist.
 */
export function findClosestRoute(
  lat: number,
  lng: number,
  routes: ApprovedRoute[]
): { routeCode: string; segmentName: string; distanceDeg: number } | null {
  let bestRouteCode = '';
  let bestSegmentName = '';
  let bestDist = Infinity;

  for (const route of routes) {
    if (!route.segments || route.segments.length === 0) continue;

    for (const segment of route.segments) {
      const coords = segment.coordinates; // each coord is [lng, lat]
      if (!coords || coords.length < 2) continue;

      for (let i = 0; i < coords.length - 1; i++) {
        const [ax, ay] = coords[i];
        const [bx, by] = coords[i + 1];
        const dist = pointToSegmentDistance(lng, lat, ax, ay, bx, by);

        if (dist < bestDist) {
          bestDist = dist;
          bestRouteCode = route.route_code;
          bestSegmentName = segment.name;
        }
      }
    }
  }

  if (!bestRouteCode) return null;
  return { routeCode: bestRouteCode, segmentName: bestSegmentName, distanceDeg: bestDist };
}

/**
 * Find the closest distance from a point to a specific route's segments.
 * Used to compare how close a customer is to their ASSIGNED route
 * vs the CLOSEST route overall.
 */
export function distanceToRoute(
  lat: number,
  lng: number,
  routeCode: string,
  routes: ApprovedRoute[]
): number {
  let bestDist = Infinity;
  const targetRoutes = routes.filter(r => r.route_code === routeCode);

  for (const route of targetRoutes) {
    if (!route.segments) continue;
    for (const segment of route.segments) {
      const coords = segment.coordinates;
      if (!coords || coords.length < 2) continue;
      for (let i = 0; i < coords.length - 1; i++) {
        const [ax, ay] = coords[i];
        const [bx, by] = coords[i + 1];
        const dist = pointToSegmentDistance(lng, lat, ax, ay, bx, by);
        if (dist < bestDist) bestDist = dist;
      }
    }
  }

  return bestDist;
}

// ─── GEOCODING ────────────────────────────────────────────────────────────────

/**
 * Geocode a single address using the Mapbox Temporary Geocoding API.
 * Results must NOT be stored permanently (per Mapbox temp API terms).
 * Free tier: 100,000 requests/month.
 *
 * Returns { lat, lng } on success, null if address not found or API error.
 */
export async function geocodeAddress(
  houseNum: string,
  streetName: string,
  city: string,
  mapboxToken: string
): Promise<{ lat: number; lng: number } | null> {
  // Build the query — add Ontario + Canada for better Canadian results
  const parts = [houseNum, streetName, city, 'Ontario', 'Canada'].filter(s => s.trim());
  const query = parts.join(' ');
  const encoded = encodeURIComponent(query);

  const url = [
    'https://api.mapbox.com/geocoding/v5/mapbox.places/',
    encoded,
    '.json?access_token=', mapboxToken,
    '&limit=1',
    '&country=ca',
    '&types=address',
  ].join('');

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].center as [number, number];
      return { lat, lng };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── PHONE NORMALIZATION ──────────────────────────────────────────────────────

/** Normalize a raw phone value to a 10-digit string, or empty string if invalid */
export function normalizePhone(raw: any): string {
  let s = String(raw ?? '').trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const digits = s.replace(/\D/g, '');
  const trimmed = digits.length > 10 ? digits.slice(-10) : digits;
  return trimmed.length === 10 ? trimmed : '';
}
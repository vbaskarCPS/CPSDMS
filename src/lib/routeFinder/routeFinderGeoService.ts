// src/lib/routeFinder/routeFinderGeoService.ts
//
// Geo service for the map-based Route Finder.
// Handles:
//   1. Loading approved route segments from route_maps table
//   2. Extracting available prefixes from those routes
//   3. Geocoding customer addresses via Mapbox Temporary Geocoding API
//   4. Proximity matching — finds the closest drawn route segment to a geocoded pin
//   5. Bounding box computation from successfully geocoded customers
//   6. Fuzzy segment name matching for failed geocodes
//
// NOTE: Uses Mapbox Temporary Geocoding API (free tier, 100k/month).
// Coordinates are NOT stored in Supabase per Mapbox temp API terms.
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
  spreadsheetId: string;    // which spreadsheet this row lives in
  sheetName: string;
  sheetRowNumber: number;   // 1-based actual sheet row
  routeCodeCol: number;     // 0-based column index for route code
  streetNameCol: number;    // 0-based column index for street name
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
  pinColor: 'grey' | 'orange' | 'green' | 'red';
  suggestedRouteCode: string;
  suggestedSegmentName: string;
  distanceDeg: number;      // Euclidean distance in degrees to closest segment
  noRouteFound: boolean;    // true if no route within MAX_ROUTE_DISTANCE_DEG
}

/** A fuzzy segment name match result for failed geocodes */
export interface SegmentSuggestion {
  segmentName: string;
  routeCode: string;
  score: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/**
 * Maximum distance in degrees for a route match to be considered valid.
 * 0.004° ≈ ~400m
 */
export const MAX_ROUTE_DISTANCE_DEG = 0.004;

/**
 * Tolerance in degrees: if the assigned route is within this much of the
 * closest route, don't flag it as wrong.
 * 0.0008° ≈ ~90m
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
 */
function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  }

  const t = Math.max(0, Math.min(1,
    ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  ));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

/**
 * Find the closest approved route segment to a geocoded point.
 * Searches ALL approved routes so customers near prefix boundaries
 * are correctly attributed to whichever route they physically sit on.
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
      const coords = segment.coordinates;
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
 */
export async function geocodeAddress(
  houseNum: string,
  streetName: string,
  city: string,
  mapboxToken: string
): Promise<{ lat: number; lng: number } | null> {
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

// ─── BOUNDING BOX ─────────────────────────────────────────────────────────────

/**
 * Compute the geographic bounding box of all successfully geocoded customers.
 * Used to constrain fuzzy street matching to the relevant area.
 * Returns null if no customers have been geocoded yet.
 */
export function getCustomerBoundingBox(
  customers: GeoCustomer[]
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const geocoded = customers.filter(
    c => c.lat !== null && c.lng !== null && !c.geocodeFailed
  );
  if (geocoded.length === 0) return null;

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const c of geocoded) {
    if (c.lat! < minLat) minLat = c.lat!;
    if (c.lat! > maxLat) maxLat = c.lat!;
    if (c.lng! < minLng) minLng = c.lng!;
    if (c.lng! > maxLng) maxLng = c.lng!;
  }

  return { minLat, maxLat, minLng, maxLng };
}

// ─── FUZZY SEGMENT MATCHING ───────────────────────────────────────────────────

/**
 * Normalize a street name for fuzzy comparison.
 * Strips common suffixes, directions, and non-alphanumeric chars.
 */
function normalizeForFuzzy(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /\b(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|lane|ln|place|pl|circle|cir|way|trail|tr|grove|gv|gardens|gdns|gate|gt|heights|hts|hollow|loop|lp|park|pk|path|point|pt|ridge|run|parkway|pkwy|close|crossing|xing|square|sq|terrace|ter|terr|view|vista|walk|wood|woods|wynd)\b/g,
      ''
    )
    .replace(/\bnorth\b/g, 'n')
    .replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e')
    .replace(/\bwest\b/g, 'w')
    .replace(/[^a-z0-9]/g, '');
}

/** Levenshtein edit distance between two strings */
function levenshteinDist(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/** Similarity score [0–1] between two street names after normalization */
function segmentNameSimilarity(a: string, b: string): number {
  const na = normalizeForFuzzy(a);
  const nb = normalizeForFuzzy(b);
  if (na === nb) return 1.0;
  if (!na || !nb) return 0.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const dist = levenshteinDist(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

/**
 * Fuzzy-match a failed street name against all segment names whose
 * coordinates fall within the customer bounding box (+ padding).
 *
 * This is purely geographic — it ignores route prefix — so it correctly
 * handles areas where map prefixes differ from the call book.
 *
 * Returns up to 3 best matches sorted by score descending.
 */
export function fuzzyMatchSegmentName(
  streetName: string,
  routes: ApprovedRoute[],
  boundingBox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  paddingDeg: number = 0.02 // ~2 km padding around the geocoded customer cluster
): SegmentSuggestion[] {
  const { minLat, maxLat, minLng, maxLng } = boundingBox;
  const seen = new Set<string>();
  const results: SegmentSuggestion[] = [];

  for (const route of routes) {
    if (!route.segments) continue;
    for (const segment of route.segments) {
      if (!segment.name || !segment.coordinates || segment.coordinates.length === 0) continue;

      // Check if any coordinate of this segment falls within the padded bounding box
      const inBox = segment.coordinates.some(([lng, lat]) =>
        lat >= minLat - paddingDeg &&
        lat <= maxLat + paddingDeg &&
        lng >= minLng - paddingDeg &&
        lng <= maxLng + paddingDeg
      );
      if (!inBox) continue;

      const key = segment.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const score = segmentNameSimilarity(streetName, segment.name);
      if (score >= 0.4) {
        results.push({ segmentName: segment.name, routeCode: route.route_code, score });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}
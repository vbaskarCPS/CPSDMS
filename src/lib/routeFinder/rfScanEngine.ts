// src/lib/routeFinder/rfScanEngine.ts
//
// Route Finder scan engine — pure suggestion generator.
// Runs 3-pass geocoding + fuzzy fallback per customer group and returns
// SuggestionEntry objects. No Supabase writes, no auto-fixing.
//
// Color key:
//   green  — geocoded successfully, suggested route = current route (spelling standardization only)
//   yellow — geocoded successfully, suggested route differs from current (re-route needed)
//   orange — geocode failed, fuzzy segment-name match found it
//   red    — no match found at all
//

import {
  geocodeAddress,
  findClosestRoute,
  getRouteCentroid,
  findSegmentByName,
  fuzzyMatchSegmentName,
  getCustomerBoundingBox,
  ApprovedRoute,
  GeoCustomer,
} from './routeFinderGeoService';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type SuggestionColor = 'green' | 'yellow' | 'orange' | 'red';

export interface SuggestionEntry {
  spreadsheetId: string;
  sheetName: string;
  sheetRowNumber: number;     // 1-based actual sheet row
  suggestedRouteCode: string;
  suggestedStreetName: string;
  color: SuggestionColor;
}

export interface ScanGroupParams {
  mapPrefix: string;
  customers: GeoCustomer[];
  approvedRoutes: ApprovedRoute[];
  mapboxToken: string;
  onProgress: (params: {
    current: number;
    total: number;
    message: string;
    green: number;
    yellow: number;
    orange: number;
    red: number;
  }) => void;
}

export interface ScanGroupResult {
  suggestions: SuggestionEntry[];
  green: number;
  yellow: number;
  orange: number;
  red: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PASS1_THRESHOLD_DEG        = 0.008; // ~800m — discard geocode if beyond this
const STREET_NORMALIZE_THRESHOLD = 0.75;  // pre-pass fuzzy confidence floor

// ─── MAIN SCAN ────────────────────────────────────────────────────────────────

export async function scanGroup(params: ScanGroupParams): Promise<ScanGroupResult> {
  const { mapPrefix, customers, approvedRoutes, mapboxToken, onProgress } = params;

  const suggestions: SuggestionEntry[] = [];
  let green = 0, yellow = 0, orange = 0, red = 0;

  const geocodedSoFar: GeoCustomer[] = [];
  const routeCentroid = getRouteCentroid(approvedRoutes, mapPrefix);

  // ── PRE-PASS: normalize street names against known segments ─────────────
  // Catches obvious typos / abbreviations before geocoding.
  // Zero Mapbox calls — purely local segment data.
  const exactRouteSegments = approvedRoutes
    .filter(r => r.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() === mapPrefix.toUpperCase())
    .flatMap(r => r.segments || [])
    .filter(s => s.name);

  for (const customer of customers) {
    if (exactRouteSegments.length === 0) break;

    let bestScore = 0;
    let bestName  = '';

    for (const segment of exactRouteSegments) {
      const na = normalizeForPrePass(customer.streetName);
      const nb = normalizeForPrePass(segment.name);
      if (!na || !nb) continue;
      if (na === nb) { bestScore = 1; bestName = segment.name; break; }
      const score = prePassSimilarity(na, nb, customer.streetName, segment.name);
      if (score > bestScore) { bestScore = score; bestName = segment.name; }
    }

    if (
      bestScore >= STREET_NORMALIZE_THRESHOLD &&
      bestName.toLowerCase() !== customer.streetName.toLowerCase()
    ) {
      customer.streetName = bestName;
    }
  }

  // ── PASS 1: geocode each customer (unbiased) ─────────────────────────────
  const pass2Queue: GeoCustomer[] = [];

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];

    onProgress({
      current: i + 1,
      total:   customers.length,
      message: `Pass 1: geocoding ${i + 1} of ${customers.length}...`,
      green, yellow, orange, red,
    });

    const geo = await geocodeAddress(
      customer.houseNum, customer.streetName, customer.city, mapboxToken
    );

    if (geo) {
      const match = findClosestRoute(geo.lat, geo.lng, approvedRoutes);
      if (match && match.distanceDeg <= PASS1_THRESHOLD_DEG) {
        customer.lat = geo.lat;
        customer.lng = geo.lng;
        geocodedSoFar.push(customer);

        const color: SuggestionColor =
          match.routeCode === customer.currentRouteCode ? 'green' : 'yellow';
        pushEntries(suggestions, customer, match.routeCode, match.segmentName || customer.streetName, color);
        if (color === 'green') green++; else yellow++;
        continue;
      }
      // Geocoded but too far from any route — save coords for Pass 2 bbox
      customer.lat = geo.lat;
      customer.lng = geo.lng;
    }

    pass2Queue.push(customer);
  }

  // ── PASS 2: retry with proximity bias + fuzzy street correction ──────────
  const pass1Bbox = getCustomerBoundingBox(geocodedSoFar);

  for (let i = 0; i < pass2Queue.length; i++) {
    const customer = pass2Queue[i];

    // Try to correct the street name using fuzzy segment matching before re-geocoding
    let streetToGeocode = customer.streetName;
    if (pass1Bbox) {
      const fuzzySugg = fuzzyMatchSegmentName(
        customer.streetName, approvedRoutes, pass1Bbox, 0.02,
        routeCentroid?.lat, routeCentroid?.lng
      );
      const best = fuzzySugg[0];
      if (
        best &&
        best.score >= 0.85 &&
        best.segmentName.toLowerCase() !== customer.streetName.toLowerCase()
      ) {
        streetToGeocode = best.segmentName;
      }
    }

    onProgress({
      current: i + 1,
      total:   pass2Queue.length,
      message: `Pass 2: retrying ${i + 1} of ${pass2Queue.length}${
        streetToGeocode !== customer.streetName ? ` → "${streetToGeocode}"` : ''
      }...`,
      green, yellow, orange, red,
    });

    const geo = await geocodeAddress(
      customer.houseNum, streetToGeocode, customer.city, mapboxToken,
      routeCentroid?.lat, routeCentroid?.lng
    );

    if (geo) {
      const match = findClosestRoute(geo.lat, geo.lng, approvedRoutes);
      if (match && match.distanceDeg <= PASS1_THRESHOLD_DEG) {
        customer.lat = geo.lat;
        customer.lng = geo.lng;
        if (streetToGeocode !== customer.streetName) customer.streetName = streetToGeocode;
        geocodedSoFar.push(customer);

        const color: SuggestionColor =
          match.routeCode === customer.currentRouteCode ? 'green' : 'yellow';
        pushEntries(suggestions, customer, match.routeCode, match.segmentName || customer.streetName, color);
        if (color === 'green') green++; else yellow++;
        continue;
      }
    }

    // ── PASS 3: segment-name fallback (no geocoding) ──────────────────────
    const bbox = getCustomerBoundingBox(geocodedSoFar) || pass1Bbox;
    const segMatch = bbox
      ? findSegmentByName(customer.streetName, approvedRoutes, bbox, mapPrefix)
      : null;

    if (segMatch) {
      pushEntries(suggestions, customer, segMatch.routeCode, segMatch.segmentName, 'orange');
      orange++;
    } else {
      // Truly unresolvable — red, keep original values as suggestion
      pushEntries(suggestions, customer, customer.currentRouteCode, customer.streetName, 'red');
      red++;
    }
  }

  return { suggestions, green, yellow, orange, red };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Create one SuggestionEntry per call-book row belonging to this customer. */
function pushEntries(
  out: SuggestionEntry[],
  customer: GeoCustomer,
  suggestedRouteCode: string,
  suggestedStreetName: string,
  color: SuggestionColor
): void {
  for (const row of customer.rows) {
    out.push({
      spreadsheetId:    row.spreadsheetId,
      sheetName:        row.sheetName,
      sheetRowNumber:   row.sheetRowNumber,
      suggestedRouteCode,
      suggestedStreetName,
      color,
    });
  }
}

function normalizeForPrePass(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|lane|ln|place|pl|circle|cir|way|trail|tr|parkway|pkwy|terrace|ter|close|crossing|xing|square|sq|grove|gv|gardens|gdns|gate|gt|heights|hts|hollow|loop|lp|park|pk|path|point|pt|ridge|run|view|vista|walk|wood|woods|wynd)/g,
      ''
    )
    .replace(/north/g, 'n').replace(/south/g, 's')
    .replace(/east/g,  'e').replace(/west/g,  'w')
    .replace(/[^a-z0-9]/g, '');
}

function levenshteinScore(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

function prePassSimilarity(na: string, nb: string, rawA: string, rawB: string): number {
  return Math.max(
    levenshteinScore(na, nb),
    levenshteinScore(rawA.toLowerCase(), rawB.toLowerCase())
  );
}
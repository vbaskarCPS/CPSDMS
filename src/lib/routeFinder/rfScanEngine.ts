// src/lib/routeFinder/rfScanEngine.ts
//
// Route Finder scan engine — pure suggestion generator.
//
// Pipeline per customer:
//   PRE-PASS  — normalize street name against known listings/segments
//   PASS 1    — geocode unbiased, accept if within ~800m of any route
//   PASS 2    — geocode with proximity bias + fuzzy street correction
//   RESCUE 1  — phone-group: prior clean year for same customer
//   RESCUE 2  — listings lookup: exact / fuzzy on assigned route, then cross-route within map prefix
//   RESCUE 3  — contractor+date cluster: ≥3 rows AND ≥60% on one route
//   else      — leave route + address unchanged (red)
//
// Color key:
//   green       — geocoded, suggested route = current route
//   light_green — geocoded, suggested route differs from current
//   blue        — rescued via prior-year phone match
//   orange      — rescued via Listings lookup
//   purple      — rescued via contractor+date cluster
//   red         — no match found; current values written unchanged
//

import {
  geocodeAddress,
  findClosestRoute,
  getRouteCentroid,
  fuzzyMatchSegmentName,
  getCustomerBoundingBox,
  ApprovedRoute,
  GeoCustomer,
} from './routeFinderGeoService';
import {
  ListingsData,
  normalizeStreetForMatch,
  stringSimilarity,
} from './routeFinderEngine';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type SuggestionColor =
  | 'green'        // geocoded, same route as current
  | 'light_green'  // geocoded, different route
  | 'blue'         // phone-group rescue
  | 'orange'       // listings rescue
  | 'purple'       // cluster rescue
  | 'red';         // no match — current values written unchanged

export interface SuggestionEntry {
  spreadsheetId: string;
  sheetName: string;
  sheetRowNumber: number;     // 1-based actual sheet row
  suggestedRouteCode: string;
  suggestedStreetName: string;
  color: SuggestionColor;
}

/**
 * Per-customer context built in V2 before scanGroup runs.
 * Holds anything the rescue layers need that GeoCustomer doesn't already carry.
 */
export interface CustomerRescueInfo {
  /**
   * Cleanest prior-year row matching this customer's phone, where
   * (routeCode, streetName) is an exact Listings match.
   * V2 only includes this when it differs from the customer's current
   * route + street, so the engine can take it at face value.
   */
  phoneMatch?: {
    routeCode: string;
    streetName: string;
    year: number;
  };
  /**
   * Raw cluster data for the customer's most-recent contractor+date.
   * The engine applies the CLUSTER_MIN_ROWS / CLUSTER_MIN_PCT threshold.
   */
  cluster?: {
    contractor: string;
    date: string;
    dominantRoute: string;
    dominantCount: number;
    totalRows: number;
  };
}

export interface ScanGroupParams {
  mapPrefix: string;
  customers: GeoCustomer[];
  approvedRoutes: ApprovedRoute[];
  mapboxToken: string;
  listingsData: ListingsData;
  /** Keyed by customer.id (phone or address fallback) */
  customerRescueInfo: Map<string, CustomerRescueInfo>;
  onProgress: (params: {
    current: number;
    total: number;
    message: string;
    green: number;
    lightGreen: number;
    blue: number;
    orange: number;
    purple: number;
    red: number;
  }) => void;
}

export interface ScanGroupResult {
  suggestions: SuggestionEntry[];
  green: number;
  lightGreen: number;
  blue: number;
  orange: number;
  purple: number;
  red: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PASS1_THRESHOLD_DEG        = 0.008; // ~800m — discard geocode if beyond this
const STREET_NORMALIZE_THRESHOLD = 0.75;  // pre-pass fuzzy confidence floor
const SAME_ROUTE_FUZZY_CUTOFF    = 0.52;  // Rescue 2a (assigned route, fuzzy)
const CROSS_ROUTE_FUZZY_CUTOFF   = 0.62;  // Rescue 2b (cross-route, fuzzy)
const PASS2_FUZZY_STREET_CUTOFF  = 0.85;  // Pass 2 in-flight street correction
const PREFERRED_SEGMENT_CUTOFF   = 0.60;  // post-geocode segment-name preference
const CLUSTER_MIN_ROWS           = 3;
const CLUSTER_MIN_PCT            = 0.60;

// ─── MAIN SCAN ────────────────────────────────────────────────────────────────

export async function scanGroup(params: ScanGroupParams): Promise<ScanGroupResult> {
  const {
    mapPrefix, customers, approvedRoutes, mapboxToken,
    listingsData, customerRescueInfo, onProgress,
  } = params;

  const suggestions: SuggestionEntry[] = [];
  let green = 0, lightGreen = 0, blue = 0, orange = 0, purple = 0, red = 0;

  // Routes belonging to this map prefix — searched first before falling back globally
  const prefixRoutes = approvedRoutes.filter(
    r => r.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() === mapPrefix.toUpperCase()
  );

  const geocodedSoFar: GeoCustomer[] = [];
  const routeCentroid = getRouteCentroid(approvedRoutes, mapPrefix);

  // ── PRE-PASS: normalize street names against listings + segments ─────────
  // Catches obvious typos / abbreviations before geocoding. Zero Mapbox cost.
  // Uses the Listings tab AND drawn segments as sources of canonical names.
  const streetVariants = collectStreetVariants(approvedRoutes, listingsData, mapPrefix);

  for (const customer of customers) {
    if (streetVariants.length === 0) break;
    const best = bestStreetVariant(customer.streetName, streetVariants);
    if (
      best &&
      best.score >= STREET_NORMALIZE_THRESHOLD &&
      best.original.toLowerCase() !== customer.streetName.toLowerCase()
    ) {
      customer.streetName = best.original;
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
      green, lightGreen, blue, orange, purple, red,
    });

    const geo = await geocodeAddress(
      customer.houseNum, customer.streetName, customer.city, mapboxToken
    );

    if (geo) {
      // Try matching within the map prefix first — only fall back globally if nothing close enough
      const prefixMatch = findClosestRoute(geo.lat, geo.lng, prefixRoutes);
      const match = (prefixMatch && prefixMatch.distanceDeg <= PASS1_THRESHOLD_DEG)
        ? prefixMatch
        : findClosestRoute(geo.lat, geo.lng, approvedRoutes);

      if (match && match.distanceDeg <= PASS1_THRESHOLD_DEG) {
        customer.lat = geo.lat;
        customer.lng = geo.lng;
        geocodedSoFar.push(customer);

        const segmentName = preferredSegmentName(
          customer.streetName, match.routeCode, match.segmentName, approvedRoutes
        );
        const isSame = match.routeCode === customer.currentRouteCode;
        const color: SuggestionColor = isSame ? 'green' : 'light_green';
        pushEntries(suggestions, customer, match.routeCode, segmentName, color);
        if (isSame) green++; else lightGreen++;
        continue;
      }
      // Geocoded but too far from any route — save coords for Pass 2 bbox use
      customer.lat = geo.lat;
      customer.lng = geo.lng;
    }

    pass2Queue.push(customer);
  }

  // ── PASS 2: retry with proximity bias + fuzzy street correction ──────────
  const pass1Bbox = getCustomerBoundingBox(geocodedSoFar);
  const rescueQueue: GeoCustomer[] = [];

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
        best.score >= PASS2_FUZZY_STREET_CUTOFF &&
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
      green, lightGreen, blue, orange, purple, red,
    });

    const geo = await geocodeAddress(
      customer.houseNum, streetToGeocode, customer.city, mapboxToken,
      routeCentroid?.lat, routeCentroid?.lng
    );

    if (geo) {
      const prefixMatch = findClosestRoute(geo.lat, geo.lng, prefixRoutes);
      const match = (prefixMatch && prefixMatch.distanceDeg <= PASS1_THRESHOLD_DEG)
        ? prefixMatch
        : findClosestRoute(geo.lat, geo.lng, approvedRoutes);

      if (match && match.distanceDeg <= PASS1_THRESHOLD_DEG) {
        customer.lat = geo.lat;
        customer.lng = geo.lng;
        if (streetToGeocode !== customer.streetName) customer.streetName = streetToGeocode;
        geocodedSoFar.push(customer);

        const segmentName = preferredSegmentName(
          customer.streetName, match.routeCode, match.segmentName, approvedRoutes
        );
        const isSame = match.routeCode === customer.currentRouteCode;
        const color: SuggestionColor = isSame ? 'green' : 'light_green';
        pushEntries(suggestions, customer, match.routeCode, segmentName, color);
        if (isSame) green++; else lightGreen++;
        continue;
      }
    }

    rescueQueue.push(customer);
  }

  // ── RESCUE LAYERS: only for customers neither geocode pass could place ───
  for (let i = 0; i < rescueQueue.length; i++) {
    const customer = rescueQueue[i];

    onProgress({
      current: i + 1,
      total:   rescueQueue.length,
      message: `Rescue: ${i + 1} of ${rescueQueue.length}...`,
      green, lightGreen, blue, orange, purple, red,
    });

    const info = customerRescueInfo.get(customer.id);

    // ── Rescue 1: phone-group ─────────────────────────────────────────────
    // V2 already filters phoneMatch to only include entries that differ from
    // current route+street, so any hit here is genuine new information.
    if (info?.phoneMatch) {
      pushEntries(
        suggestions, customer,
        info.phoneMatch.routeCode, info.phoneMatch.streetName,
        'blue'
      );
      blue++;
      continue;
    }

    // ── Rescue 2: listings lookup ─────────────────────────────────────────
    const listingsHit = tryListingsRescue(customer, listingsData, mapPrefix);
    if (listingsHit) {
      pushEntries(
        suggestions, customer,
        listingsHit.routeCode, listingsHit.streetName,
        'orange'
      );
      orange++;
      continue;
    }

    // ── Rescue 3: contractor+date cluster ─────────────────────────────────
    if (info?.cluster) {
      const c = info.cluster;
      const pct = c.totalRows > 0 ? c.dominantCount / c.totalRows : 0;
      if (
        c.totalRows >= CLUSTER_MIN_ROWS &&
        pct >= CLUSTER_MIN_PCT &&
        c.dominantRoute &&
        c.dominantRoute !== customer.currentRouteCode
      ) {
        pushEntries(
          suggestions, customer,
          c.dominantRoute, customer.streetName,
          'purple'
        );
        purple++;
        continue;
      }
    }

    // ── No rescue worked → write current values back, mark red ────────────
    pushEntries(
      suggestions, customer,
      customer.currentRouteCode, customer.streetName,
      'red'
    );
    red++;
  }

  return { suggestions, green, lightGreen, blue, orange, purple, red };
}

// ─── RESCUE 2: LISTINGS LOOKUP ────────────────────────────────────────────────

/**
 * Search the Listings tab for a route the customer's street belongs to.
 *
 * Order of preference:
 *   2a — exact match on assigned route       → keep route, standardize street
 *   2a — fuzzy match on assigned route       → keep route, standardize street
 *   2b — exact match on a different route    → suggest that route
 *   2b — fuzzy match on a different route    → suggest that route
 *
 * 2b is scoped to routes whose prefix matches the customer group's map prefix,
 * so we don't accidentally suggest a route from a different region that happens
 * to have a "Maple Street" too.
 */
function tryListingsRescue(
  customer: GeoCustomer,
  listingsData: ListingsData,
  mapPrefix: string
): { routeCode: string; streetName: string } | null {
  const normalizedStreet = normalizeStreetForMatch(customer.streetName);
  if (!normalizedStreet) return null;

  const currentRC = customer.currentRouteCode.toUpperCase();
  const upperPrefix = mapPrefix.toUpperCase();

  // 2a-exact: street appears verbatim in assigned route's list
  const assignedNorms     = listingsData.routeMap.get(currentRC) || [];
  const assignedOriginals = listingsData.routeMapOriginal.get(currentRC) || [];
  const exactIdx = assignedNorms.indexOf(normalizedStreet);
  if (exactIdx >= 0) {
    return {
      routeCode:  currentRC,
      streetName: assignedOriginals[exactIdx] || customer.streetName,
    };
  }

  // 2a-fuzzy: best fuzzy match in assigned route's list
  let bestSame: { score: number; originalStreet: string } | null = null;
  for (let i = 0; i < assignedNorms.length; i++) {
    const score = stringSimilarity(normalizedStreet, assignedNorms[i]);
    if (score >= SAME_ROUTE_FUZZY_CUTOFF && (!bestSame || score > bestSame.score)) {
      bestSame = {
        score,
        originalStreet: assignedOriginals[i] || assignedNorms[i],
      };
    }
  }
  if (bestSame) {
    return {
      routeCode:  currentRC,
      streetName: bestSame.originalStreet,
    };
  }

  // 2b: cross-route search, scoped to mapPrefix
  // Prefer exact matches over fuzzy; among exacts/fuzzies, prefer highest score.
  let bestCross: {
    routeCode: string;
    originalStreet: string;
    score: number;
    isExact: boolean;
  } | null = null;

  for (const [routeCode, norms] of listingsData.routeMap) {
    const rcPrefix = routeCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
    if (rcPrefix !== upperPrefix) continue;
    if (routeCode === currentRC) continue;

    const originals = listingsData.routeMapOriginal.get(routeCode) || [];

    // Exact match within this route's list
    const idx = norms.indexOf(normalizedStreet);
    if (idx >= 0) {
      if (!bestCross || !bestCross.isExact || 1.0 > bestCross.score) {
        bestCross = {
          routeCode,
          originalStreet: originals[idx] || norms[idx],
          score: 1.0,
          isExact: true,
        };
      }
      continue;
    }

    // Fuzzy — only consider if we don't already have an exact hit
    if (!bestCross || !bestCross.isExact) {
      for (let i = 0; i < norms.length; i++) {
        const score = stringSimilarity(normalizedStreet, norms[i]);
        if (
          score >= CROSS_ROUTE_FUZZY_CUTOFF &&
          (!bestCross || score > bestCross.score)
        ) {
          bestCross = {
            routeCode,
            originalStreet: originals[i] || norms[i],
            score,
            isExact: false,
          };
        }
      }
    }
  }

  if (bestCross) {
    return {
      routeCode:  bestCross.routeCode,
      streetName: bestCross.originalStreet,
    };
  }

  return null;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Build a deduped list of canonical street-name variants we know about for
 * this map prefix, sourced from BOTH the Listings tab and the drawn route
 * segments. Used by the pre-pass to standardize obvious typos before geocoding.
 */
function collectStreetVariants(
  approvedRoutes: ApprovedRoute[],
  listingsData: ListingsData,
  mapPrefix: string
): { original: string; normalized: string }[] {
  const upperPrefix = mapPrefix.toUpperCase();
  const variants = new Map<string, string>(); // normalized → first-seen original

  // From listings, mapPrefix routes only
  for (const [routeCode, _norms] of listingsData.routeMap) {
    const rcPrefix = routeCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
    if (rcPrefix !== upperPrefix) continue;
    const originals = listingsData.routeMapOriginal.get(routeCode) || [];
    for (const original of originals) {
      const norm = normalizeStreetForMatch(original);
      if (norm && !variants.has(norm)) variants.set(norm, original);
    }
  }

  // From drawn segments on approved routes matching the prefix
  for (const route of approvedRoutes) {
    const rcPrefix = route.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
    if (rcPrefix !== upperPrefix) continue;
    for (const seg of route.segments || []) {
      if (!seg.name) continue;
      const norm = normalizeStreetForMatch(seg.name);
      if (norm && !variants.has(norm)) variants.set(norm, seg.name);
    }
  }

  return Array.from(variants).map(([normalized, original]) => ({
    normalized, original,
  }));
}

/** Best fuzzy variant for a given street name from a pre-built variants list. */
function bestStreetVariant(
  streetName: string,
  variants: { original: string; normalized: string }[]
): { original: string; score: number } | null {
  if (variants.length === 0) return null;
  const norm = normalizeStreetForMatch(streetName);
  if (!norm) return null;

  let bestScore   = 0;
  let bestOriginal = '';

  for (const v of variants) {
    if (norm === v.normalized) return { original: v.original, score: 1.0 };
    const score = stringSimilarity(norm, v.normalized);
    if (score > bestScore) {
      bestScore    = score;
      bestOriginal = v.original;
    }
  }

  return bestOriginal ? { original: bestOriginal, score: bestScore } : null;
}

/**
 * After a successful geocode + route match, prefer the segment name that best
 * fuzzy-matches the customer's own street name over the geometry-nearest segment.
 *
 * Prevents cases where two streets run physically close (e.g. Meadowlark Dr
 * and Redwing Rd) and the geocoded point lands slightly nearer the wrong
 * segment line, even though the customer's address clearly names the right street.
 *
 * Threshold is lower than pre-pass (0.6) so partial matches like
 * "Meadow Lark" → "Meadowlark Drive" survive even after normalization.
 * Falls back to the geometry result if no segment matches well enough.
 */
function preferredSegmentName(
  customerStreet: string,
  matchedRouteCode: string,
  geometrySegmentName: string | undefined,
  approvedRoutes: ApprovedRoute[]
): string {
  const routeSegments = approvedRoutes
    .filter(r => r.route_code === matchedRouteCode)
    .flatMap(r => r.segments || [])
    .filter(s => s.name);

  if (routeSegments.length === 0) return geometrySegmentName || customerStreet;

  let bestScore = 0;
  let bestName  = '';
  const na = normalizeStreetForMatch(customerStreet);

  for (const seg of routeSegments) {
    const nb = normalizeStreetForMatch(seg.name);
    if (!na || !nb) continue;
    if (na === nb) return seg.name; // exact normalized match — stop here
    const score = stringSimilarity(na, nb);
    if (score > bestScore) { bestScore = score; bestName = seg.name; }
  }

  if (bestScore >= PREFERRED_SEGMENT_CUTOFF) return bestName;
  return geometrySegmentName || customerStreet;
}

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
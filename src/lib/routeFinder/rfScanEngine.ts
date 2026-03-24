// src/lib/routeFinder/rfScanEngine.ts
//
// Core scan engine for one city+prefix group.
// Interleaves Mapbox geocoding with Google Sheets writes to naturally
// rate-limit both APIs without explicit delays.
//
// For each customer:
//   Pass 1 — unbiased geocode
//   Pass 2 — proximity-biased retry (if Pass 1 > 800m from any route)
//   Pass 3 — segment midpoint fallback (if Pass 2 still fails)
//
// Auto-fix: if the suggested route prefix matches the map prefix being scanned,
// write immediately to the sheet (same-prefix = high confidence).
// Queue: if different prefix or red, add to rf_review_queue for manual review.
//

import {
  geocodeAddress,
  findClosestRoute,
  distanceToRoute,
  getRouteCentroid,
  findSegmentByName,
  fuzzyMatchSegmentName,
  getCustomerBoundingBox,
  ApprovedRoute,
  GeoCustomer,
} from './routeFinderGeoService';
import { routeFinderSheetsService } from './routeFinderSheetsService';
import { rfScanSessionService, RFQueueEntry } from './rfScanSessionService';
import { SAME_ROUTE_TOLERANCE_DEG } from './routeFinderGeoService';

export interface ScanGroupParams {
  sessionId: string;
  mapPrefix: string;        // the digital map prefix (e.g. ACT)
  areaName: string;         // human-readable area name
  customers: GeoCustomer[]; // all customers in this city+prefix group
  approvedRoutes: ApprovedRoute[];
  mapboxToken: string;
  onProgress: (params: {
    current: number;
    total: number;
    message: string;
    fixed: number;
    queued: number;
  }) => void;
  isPaused: () => boolean;  // callback to check if user paused
}

export interface ScanGroupResult {
  fixed: number;
  queued: number;
  skipped: number;
  paused: boolean;
}

const PASS1_THRESHOLD_DEG = 0.008; // ~800m — beyond this, geocode is likely wrong
const WRITE_BATCH_SIZE    = 20;    // flush Sheets writes every N auto-fixed customers

export async function scanGroup(params: ScanGroupParams): Promise<ScanGroupResult> {
  const {
    sessionId, mapPrefix, areaName, customers, approvedRoutes,
    mapboxToken, onProgress, isPaused,
  } = params;

  let fixed = 0;
  let queued = 0;
  const toQueue: Omit<RFQueueEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [];

  // Pending Sheets writes: spreadsheetId → list of range/value updates
  // Flushed every WRITE_BATCH_SIZE auto-fixed customers
  const pendingWrites = new Map<string, { range: string; values: any[][] }[]>();

  // Flush all pending writes — one batchUpdate per spreadsheet
  const flushWrites = async () => {
    for (const [spreadsheetId, updates] of pendingWrites) {
      if (updates.length === 0) continue;
      await sheetsWriteWithRetry(() =>
        routeFinderSheetsService.applyBatchStreetWrites(spreadsheetId, updates)
      );
    }
    pendingWrites.clear();
  };

  // Collect geocoded customers for bbox computation
  const geocodedSoFar: GeoCustomer[] = [];

  // Route centroid for Pass 2 proximity bias
  const routeCentroid = getRouteCentroid(approvedRoutes, mapPrefix);

  // ── PRE-PASS: Street name normalization ─────────────────────────────────
  // Before geocoding, fuzzy-match each customer's street name against segments
  // on their exact current route. Threshold (0.80) — corrects obvious typos
  // obvious abbreviations/typos where we're highly confident.
  // "Eagle Cres St" on EB23 → matches "Eaglecrest Street" in EB23 segments.
  // Runs entirely from local route data, zero Mapbox calls.

  const STREET_NORMALIZE_THRESHOLD = 0.75;

  for (const customer of customers) {
    // Use the digital map prefix (e.g. ACT) not the call book prefix (e.g. A)
    // so we match against the correct segment data regardless of prefix mismatch
    const exactRouteSegments = approvedRoutes
      .filter(r => r.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() === mapPrefix.toUpperCase())
      .flatMap(r => r.segments || [])
      .filter(s => s.name);

    if (exactRouteSegments.length === 0) continue;

    let bestScore = 0;
    let bestName = '';

    for (const segment of exactRouteSegments) {
      // Use the same segmentNameSimilarity logic via fuzzyMatchSegmentName internals
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

  // ── PASS 1 ───────────────────────────────────────────────────────────────

  const pass2Queue: GeoCustomer[] = [];

  for (let i = 0; i < customers.length; i++) {
    if (isPaused()) {
      await flushWrites();
      await rfScanSessionService.pushToQueue(toQueue);
      return { fixed, queued, skipped: 0, paused: true };
    }

    const customer = customers[i];

    onProgress({
      current: i + 1,
      total: customers.length,
      message: `Pass 1: geocoding ${i + 1} of ${customers.length}...`,
      fixed,
      queued,
    });

    const geoResult = await geocodeAddress(
      customer.houseNum, customer.streetName, customer.city, mapboxToken
    );

    if (geoResult) {
      const match = findClosestRoute(geoResult.lat, geoResult.lng, approvedRoutes);
      if (match && match.distanceDeg <= PASS1_THRESHOLD_DEG) {
        customer.lat = geoResult.lat;
        customer.lng = geoResult.lng;
        geocodedSoFar.push(customer);
        assignResult(customer, geoResult.lat, geoResult.lng, match, approvedRoutes);

        const result = await handleAssigned(
          customer, mapPrefix, areaName, sessionId,
          toQueue, approvedRoutes, pendingWrites
        );
        if (result === 'fixed') fixed++;
        else queued++;
        if (fixed > 0 && fixed % WRITE_BATCH_SIZE === 0) await flushWrites();
      } else {
        // Too far — queue for Pass 2
        customer.lat = geoResult.lat;
        customer.lng = geoResult.lng;
        pass2Queue.push(customer);
      }
    } else {
      // Geocode failed — goes straight to Pass 3
      pass2Queue.push(customer);
    }
  }

  // ── PASS 2 ───────────────────────────────────────────────────────────────

  const pass1Bbox = getCustomerBoundingBox(geocodedSoFar);

  for (let i = 0; i < pass2Queue.length; i++) {
    if (isPaused()) {
      await flushWrites();
      await rfScanSessionService.pushToQueue(toQueue);
      return { fixed, queued, skipped: 0, paused: true };
    }

    const customer = pass2Queue[i];

    // Fuzzy street name correction before geocoding
    let streetToGeocode = customer.streetName;
    if (pass1Bbox) {
      const suggestions = fuzzyMatchSegmentName(
        customer.streetName, approvedRoutes, pass1Bbox, 0.02,
        routeCentroid?.lat, routeCentroid?.lng
      );
      const best = suggestions[0];
      if (best && best.score >= 0.85 && best.segmentName.toLowerCase() !== customer.streetName.toLowerCase()) {
        streetToGeocode = best.segmentName;
      }
    }

    onProgress({
      current: i + 1,
      total: pass2Queue.length,
      message: `Pass 2: retrying ${i + 1} of ${pass2Queue.length}${streetToGeocode !== customer.streetName ? ` → "${streetToGeocode}"` : ''}...`,
      fixed,
      queued,
    });

    const geoResult = await geocodeAddress(
      customer.houseNum, streetToGeocode, customer.city, mapboxToken,
      routeCentroid?.lat, routeCentroid?.lng
    );

    if (geoResult) {
      const match = findClosestRoute(geoResult.lat, geoResult.lng, approvedRoutes);
      if (match && match.distanceDeg <= PASS1_THRESHOLD_DEG) {
        customer.lat = geoResult.lat;
        customer.lng = geoResult.lng;
        if (streetToGeocode !== customer.streetName) customer.streetName = streetToGeocode;
        geocodedSoFar.push(customer);
        assignResult(customer, geoResult.lat, geoResult.lng, match, approvedRoutes, true);

        const result = await handleAssigned(
          customer, mapPrefix, areaName, sessionId,
          toQueue, approvedRoutes, pendingWrites
        );
        if (result === 'fixed') fixed++;
        else queued++;
        if (fixed > 0 && fixed % WRITE_BATCH_SIZE === 0) await flushWrites();
        continue;
      }
    }

    // Pass 2 failed or still too far — try Pass 3
    const updatedBbox = getCustomerBoundingBox(geocodedSoFar) || pass1Bbox;
    const segmentMatch = updatedBbox
      ? findSegmentByName(customer.streetName, approvedRoutes, updatedBbox, mapPrefix)
      : null;

    if (segmentMatch) {
      customer.lat = segmentMatch.lat;
      customer.lng = segmentMatch.lng;
      const match = findClosestRoute(segmentMatch.lat, segmentMatch.lng, approvedRoutes);
      if (match) {
        assignResult(customer, segmentMatch.lat, segmentMatch.lng, match, approvedRoutes, true);
        const result = await handleAssigned(
          customer, mapPrefix, areaName, sessionId,
          toQueue, approvedRoutes, pendingWrites
        );
        if (result === 'fixed') fixed++;
        else queued++;
        if (fixed > 0 && fixed % WRITE_BATCH_SIZE === 0) await flushWrites();
      } else {
        customer.geocodeFailed = true;
        queued++;
        toQueue.push(buildQueueEntry(customer, mapPrefix, areaName, sessionId, 'red'));
      }
    } else {
      // Truly unresolvable — goes to review queue as geocode failed
      customer.geocodeFailed = true;
      queued++;
      toQueue.push(buildQueueEntry(customer, mapPrefix, areaName, sessionId, 'red'));
    }
  }

  // Flush any remaining pending writes
  await flushWrites();

  // Flush remaining queue entries
  if (toQueue.length > 0) {
    await rfScanSessionService.pushToQueue(toQueue);
  }

  return { fixed, queued, skipped: 0, paused: false };
}

// ─── PRE-PASS HELPERS ────────────────────────────────────────────────────────

function normalizeForPrePass(s: string): string {
  return s
    .toLowerCase()
    .replace(/(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|lane|ln|place|pl|circle|cir|way|trail|tr|parkway|pkwy|terrace|ter|close|crossing|xing|square|sq|grove|gv|gardens|gdns|gate|gt|heights|hts|hollow|loop|lp|park|pk|path|point|pt|ridge|run|view|vista|walk|wood|woods|wynd)/g, '')
    .replace(/north/g, 'n').replace(/south/g, 's')
    .replace(/east/g, 'e').replace(/west/g, 'w')
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
      dp[j] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, dp[j], dp[j-1]);
      prev = temp;
    }
  }
  return 1 - dp[n] / Math.max(m, n);
}

function prePassSimilarity(normalizedA: string, normalizedB: string, rawA: string, rawB: string): number {
  // Take the max of normalized and raw scores — catches cases where normalization
  // strips suffixes and makes strings appear less similar than they are.
  // e.g. "Sommervile" vs "Somerville Road": raw normalized score = 0.78,
  // but comparing just the base names "sommervil" vs "somervill" = 0.78 too.
  // Using both gives the best chance of a correct match.
  const normalizedScore = levenshteinScore(normalizedA, normalizedB);
  const rawScore = levenshteinScore(rawA.toLowerCase(), rawB.toLowerCase());
  return Math.max(normalizedScore, rawScore);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function assignResult(
  customer: GeoCustomer,
  lat: number,
  lng: number,
  match: { routeCode: string; segmentName: string; distanceDeg: number },
  approvedRoutes: ApprovedRoute[],
  forceOrange: boolean = false
): void {
  customer.suggestedRouteCode   = match.routeCode;
  customer.suggestedSegmentName = match.segmentName;
  customer.distanceDeg          = match.distanceDeg;

  if (forceOrange) {
    customer.pinColor = 'orange';
  } else if (match.routeCode === customer.currentRouteCode) {
    customer.pinColor = 'grey';
  } else {
    const assignedDist = distanceToRoute(lat, lng, customer.currentRouteCode, approvedRoutes);
    customer.pinColor = assignedDist - match.distanceDeg < SAME_ROUTE_TOLERANCE_DEG ? 'grey' : 'orange';
  }
}

// ── Sheets write with exponential backoff on 429 ────────────────────────────
async function sheetsWriteWithRetry(
  fn: () => Promise<void>,
  maxRetries = 4
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fn();
      return;
    } catch (e: any) {
      const is429 = e?.message?.includes('429') || e?.message?.includes('Quota');
      if (!is429 || attempt === maxRetries) throw e;
      // Exponential backoff: 2s, 4s, 8s, 16s
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`RF: Sheets 429 — retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function handleAssigned(
  customer: GeoCustomer,
  mapPrefix: string,
  areaName: string,
  sessionId: string,
  toQueue: Omit<RFQueueEntry, 'id' | 'createdAt' | 'updatedAt'>[],
  approvedRoutes: ApprovedRoute[],
  pendingWrites: Map<string, { range: string; values: any[][] }[]>
): Promise<'fixed' | 'queued'> {
  const suggestedPrefix = customer.suggestedRouteCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
  const isGrey = customer.pinColor === 'grey';
  const isSamePrefix = suggestedPrefix === mapPrefix.toUpperCase();

  if (isGrey || isSamePrefix) {
    // Collect this customer's updates into the pending batch.
    // The scan loop flushes every WRITE_BATCH_SIZE customers.
    for (const row of customer.rows) {
      if (!pendingWrites.has(row.spreadsheetId)) {
        pendingWrites.set(row.spreadsheetId, []);
      }
      const updates = pendingWrites.get(row.spreadsheetId)!;

      if (row.routeCodeCol >= 0 && customer.suggestedRouteCode) {
        const col = columnIndexToLetter(row.routeCodeCol);
        updates.push({ range: `'${row.sheetName}'!${col}${row.sheetRowNumber}`, values: [[customer.suggestedRouteCode]] });
      }

      const newStreet = customer.suggestedSegmentName || customer.streetName;
      if (row.streetNameCol >= 0 && newStreet) {
        const col = columnIndexToLetter(row.streetNameCol);
        updates.push({ range: `'${row.sheetName}'!${col}${row.sheetRowNumber}`, values: [[newStreet]] });
      }
    }

    // Log as fixed in queue
    toQueue.push({
      ...buildQueueEntry(customer, mapPrefix, areaName, sessionId, 'orange'),
      status:  'fixed',
      fix_log: {
        newRouteCode:  customer.suggestedRouteCode,
        newStreetName: customer.suggestedSegmentName || customer.streetName,
        fixedBy:       'auto',
        timestamp:     new Date().toISOString(),
      },
    } as any);

    return 'fixed';
  }

  // Different prefix or write failed — queue for manual review
  toQueue.push(buildQueueEntry(customer, mapPrefix, areaName, sessionId,
    customer.pinColor === 'grey' ? 'orange' : customer.pinColor as 'orange' | 'red'
  ));
  return 'queued';
}

// Column index to letter (e.g. 0 → A, 25 → Z, 26 → AA)
function columnIndexToLetter(colIndex: number): string {
  let s = '';
  let c = colIndex + 1;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

function buildQueueEntry(
  customer: GeoCustomer,
  mapPrefix: string,
  areaName: string,
  sessionId: string,
  pinColor: 'orange' | 'red'
): Omit<RFQueueEntry, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    scanSessionId:        sessionId,
    customerId:           customer.id,
    mapPrefix,
    areaName,
    firstName:            customer.firstName,
    lastName:             customer.lastName,
    phone:                customer.phone,
    houseNum:             customer.houseNum,
    streetName:           customer.streetName,
    city:                 customer.city,
    currentRouteCode:     customer.currentRouteCode,
    suggestedRouteCode:   customer.suggestedRouteCode,
    suggestedSegmentName: customer.suggestedSegmentName,
    distanceDeg:          customer.distanceDeg,
    pinColor,
    lat:                  customer.lat,
    lng:                  customer.lng,
    rows:                 customer.rows,
    status:               'pending',
    fixLog:               {},
  };
}

// ─── POST-SCAN QUEUE FILTER ───────────────────────────────────────────────────

export interface PostFilterResult {
  resolved: number;
  remaining: number;
}

/**
 * After the full scan, sweep the entire review queue and auto-fix any entry
 * whose street name fuzzy-matches a segment in the mapped prefix at ≥0.80.
 * Handles cases where the old call book prefix didn't match any digital segments
 * during the scan (e.g. "EB" call book → "EB" digital, but segments weren't
 * available during pre-pass). Writes to sheets in batches of WRITE_BATCH_SIZE.
 */
export async function runQueuePostFilter(params: {
  sessionId: string;
  approvedRoutes: ApprovedRoute[];
  mapPrefix?: string;  // if provided, only sweep entries for this prefix
  onProgress: (current: number, total: number) => void;
}): Promise<PostFilterResult> {
  const { sessionId, approvedRoutes, mapPrefix, onProgress } = params;

  // Load pending entries — scoped to prefix if provided, otherwise full queue
  const pending = mapPrefix
    ? await rfScanSessionService.loadPendingQueueForPrefix(sessionId, mapPrefix)
    : await rfScanSessionService.loadPendingQueue(sessionId);
  if (pending.length === 0) return { resolved: 0, remaining: 0 };

  // Build a segment lookup per map prefix
  const segmentsByPrefix = new Map<string, { name: string; routeCode: string }[]>();
  for (const route of approvedRoutes) {
    const prefix = route.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
    if (!prefix) continue;
    if (!segmentsByPrefix.has(prefix)) segmentsByPrefix.set(prefix, []);
    for (const seg of route.segments || []) {
      if (seg.name) segmentsByPrefix.get(prefix)!.push({ name: seg.name, routeCode: route.route_code });
    }
  }

  const pendingWrites = new Map<string, { range: string; values: any[][] }[]>();
  let resolved = 0;

  const flushWrites = async () => {
    for (const [spreadsheetId, updates] of pendingWrites) {
      if (updates.length === 0) continue;
      await sheetsWriteWithRetry(() =>
        routeFinderSheetsService.applyBatchStreetWrites(spreadsheetId, updates)
      );
    }
    pendingWrites.clear();
  };

  for (let i = 0; i < pending.length; i++) {
    onProgress(i + 1, pending.length);
    const entry = pending[i];

    const segments = segmentsByPrefix.get(entry.mapPrefix.toUpperCase()) || [];
    if (segments.length === 0) continue;

    // Fuzzy match street name against all segments in this prefix
    const normalizedEntry = normalizeForPrePass(entry.streetName);
    let bestScore = 0;
    let bestSegmentName = '';
    let bestRouteCode = '';

    for (const seg of segments) {
      const normalizedSeg = normalizeForPrePass(seg.name);
      if (!normalizedEntry || !normalizedSeg) continue;
      const score = prePassSimilarity(normalizedEntry, normalizedSeg, entry.streetName, seg.name);
      if (score > bestScore) {
        bestScore = score;
        bestSegmentName = seg.name;
        bestRouteCode = seg.routeCode;
      }
    }

    if (bestScore < 0.75) continue;
    if (bestSegmentName.toLowerCase() === entry.streetName.toLowerCase() &&
        bestRouteCode === entry.currentRouteCode) continue;

    // Queue the sheet writes
    for (const row of entry.rows) {
      if (!pendingWrites.has(row.spreadsheetId)) {
        pendingWrites.set(row.spreadsheetId, []);
      }
      const updates = pendingWrites.get(row.spreadsheetId)!;

      if (row.routeCodeCol >= 0 && bestRouteCode) {
        const col = columnIndexToLetter(row.routeCodeCol);
        updates.push({ range: `'${row.sheetName}'!${col}${row.sheetRowNumber}`, values: [[bestRouteCode]] });
      }
      if (row.streetNameCol >= 0 && bestSegmentName) {
        const col = columnIndexToLetter(row.streetNameCol);
        updates.push({ range: `'${row.sheetName}'!${col}${row.sheetRowNumber}`, values: [[bestSegmentName]] });
      }
    }

    // Mark as fixed in Supabase
    await rfScanSessionService.markFixed({
      entryId:       entry.id,
      newRouteCode:  bestRouteCode,
      newStreetName: bestSegmentName,
      fixedBy:       'auto',
    });

    resolved++;

    // Flush every WRITE_BATCH_SIZE
    if (resolved > 0 && resolved % WRITE_BATCH_SIZE === 0) {
      await flushWrites();
    }
  }

  // Final flush
  await flushWrites();

  return { resolved, remaining: pending.length - resolved };
}
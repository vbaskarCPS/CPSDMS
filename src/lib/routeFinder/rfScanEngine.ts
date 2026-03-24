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
  
  const PASS1_THRESHOLD_DEG = 0.008; // ~800m
  
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
  
  export async function scanGroup(params: ScanGroupParams): Promise<ScanGroupResult> {
    const {
      sessionId, mapPrefix, areaName, customers, approvedRoutes,
      mapboxToken, onProgress, isPaused,
    } = params;
  
    let fixed = 0;
    let queued = 0;
    const toQueue: Omit<RFQueueEntry, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  
    // Collect geocoded customers for bbox computation
    const geocodedSoFar: GeoCustomer[] = [];
  
    // Route centroid for Pass 2 proximity bias
    const routeCentroid = getRouteCentroid(approvedRoutes, mapPrefix);
  
    // ── PASS 1 ───────────────────────────────────────────────────────────────
  
    const pass2Queue: GeoCustomer[] = [];
  
    for (let i = 0; i < customers.length; i++) {
      if (isPaused()) return { fixed, queued, skipped: 0, paused: true };
  
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
            toQueue, approvedRoutes
          );
          if (result === 'fixed') fixed++;
          else queued++;
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
        // Flush whatever we have to queue before pausing
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
            toQueue, approvedRoutes
          );
          if (result === 'fixed') fixed++;
          else queued++;
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
            toQueue, approvedRoutes
          );
          if (result === 'fixed') fixed++;
          else queued++;
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
  
    // Flush remaining queue entries
    if (toQueue.length > 0) {
      await rfScanSessionService.pushToQueue(toQueue);
    }
  
    return { fixed, queued, skipped: 0, paused: false };
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
  
  async function handleAssigned(
    customer: GeoCustomer,
    mapPrefix: string,
    areaName: string,
    sessionId: string,
    toQueue: Omit<RFQueueEntry, 'id' | 'createdAt' | 'updatedAt'>[],
    approvedRoutes: ApprovedRoute[]
  ): Promise<'fixed' | 'queued'> {
    const suggestedPrefix = customer.suggestedRouteCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
    const isGrey = customer.pinColor === 'grey';
    const isSamePrefix = suggestedPrefix === mapPrefix.toUpperCase();
  
    if (isGrey || isSamePrefix) {
      // Auto-fix: write to sheet immediately (interleaved with geocoding)
      try {
        for (const row of customer.rows) {
          await routeFinderSheetsService.applyFix(
            row.spreadsheetId,
            row.sheetName,
            row.sheetRowNumber,
            row.routeCodeCol,
            row.streetNameCol,
            customer.suggestedRouteCode,
            customer.suggestedSegmentName || customer.streetName,
          );
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
      } catch (e) {
        console.warn('RF: auto-fix write failed, queuing for manual review:', e);
      }
    }
  
    // Different prefix or write failed — queue for manual review
    toQueue.push(buildQueueEntry(customer, mapPrefix, areaName, sessionId,
      customer.pinColor === 'grey' ? 'orange' : customer.pinColor as 'orange' | 'red'
    ));
    return 'queued';
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
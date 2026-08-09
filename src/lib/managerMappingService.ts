// src/lib/managerMappingService.ts
//
// PER-MANAGER DIGITAL MAPPING — data + geometry helpers.
//
// Feature context: on a command center whose CC-level digitalMappingEnabled
// flag is OFF, an individual Route Manager can be given digital mapping for a
// single Sealing session. The admin picks a master-map area (route_maps) and
// a from–to range of its route numbers in the Session Command Center preview;
// the config is stored in users.metadata.digitalMapping (see
// ManagerMappingConfig in types).
//
// This module owns everything the feature needs from the route_maps table and
// the geometry math on top of it:
//   - getApprovedAreaSummaries(): lightweight area list for the SCC picker
//     (segments deliberately NOT fetched — heavy jsonb).
//   - getApprovedRouteMapsByCodes(): full rows WITH segments, for street
//     derivation and PCL bucketing.
//   - buildMappingConfig(): area + from–to range → ManagerMappingConfig,
//     with routeCodes taken straight from route_maps rows (never assembled
//     by string concatenation).
//   - streetsFromSegments(): deduped street names for the routes table.
//   - bboxForRouteMaps(): padded bounding box, used to hard-constrain
//     geocoding so a garbled address can't land in another city.
//   - nearestRouteForPoint(): which route's segment is closest to a lat/lng —
//     the PCL bucketing engine. Same math as RMMapTab's
//     findNearestAssignedRoute, minus the assigned-worker requirement and
//     the 50 m threshold (bucketing assigns to the nearest route regardless,
//     because the geocode was already bbox-constrained to the area).
//   - geocodeAddressInBbox(): Mapbox forward geocode mirroring RMMapTab's
//     geocodeAddress behaviour (Ontario/Canada suffix, address-type results,
//     bbox REJECTS out-of-area results rather than merely biasing).
//
// Read-only with respect to route_maps — this module never writes to it.

import { supabase } from './supabase';
import { ManagerMappingConfig } from '../types';

// Segment shape as stored in route_maps.segments (see Map Builder / MapViewer).
export interface MapSegment {
  osmId: number;
  name: string;
  coordinates: [number, number][]; // [lng, lat] pairs
}

export interface ApprovedRouteMap {
  id: string;
  areaName: string;
  routeNumber: number;
  routeCode: string;
  routeColor: string;
  segments: MapSegment[];
}

// One entry per master-map area, for the SCC picker.
export interface AreaSummary {
  areaName: string;
  // Bare route-code prefix derived from the area's codes (e.g. "WASA").
  // This is what the sealing callbook's bare-prefix PCL rows are expected
  // to carry.
  prefix: string;
  // Available routes, sorted ascending by routeNumber.
  routes: { routeNumber: number; routeCode: string }[];
}

const mapRow = (r: any): ApprovedRouteMap => ({
  id: r.id,
  areaName: r.area_name,
  routeNumber: r.route_number,
  routeCode: r.route_code,
  routeColor: r.route_color,
  segments: Array.isArray(r.segments) ? r.segments : [],
});

/**
 * Derive the bare prefix from a full route code by stripping trailing digits.
 * "WASA12" → "WASA". Returns '' for empty or all-digit codes.
 */
export function prefixFromRouteCode(routeCode: string): string {
  return (routeCode || '').replace(/\d+$/, '').trim();
}

/**
 * Lightweight list of every approved area and its route numbers, for the SCC
 * picker. Batched to bypass the 1000-row server cap, mirroring MapViewer's
 * loader.
 */
export async function getApprovedAreaSummaries(): Promise<AreaSummary[]> {
  const BATCH_SIZE = 1000;
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('route_maps')
      .select('area_name, route_number, route_code')
      .eq('status', 'approved')
      .range(from, from + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  const byArea = new Map<string, AreaSummary>();
  for (const r of all) {
    if (!r.area_name || !r.route_code) continue;
    let area = byArea.get(r.area_name);
    if (!area) {
      area = {
        areaName: r.area_name,
        prefix: prefixFromRouteCode(r.route_code),
        routes: [],
      };
      byArea.set(r.area_name, area);
    }
    area.routes.push({ routeNumber: r.route_number, routeCode: r.route_code });
  }

  const out = Array.from(byArea.values());
  out.forEach(a => a.routes.sort((x, y) => x.routeNumber - y.routeNumber));
  out.sort((a, b) => a.areaName.localeCompare(b.areaName));
  return out;
}

/**
 * Full route_maps rows (WITH segments) for a set of route codes.
 * Approved rows only.
 */
export async function getApprovedRouteMapsByCodes(
  routeCodes: string[],
): Promise<ApprovedRouteMap[]> {
  if (!routeCodes || routeCodes.length === 0) return [];
  const { data, error } = await supabase
    .from('route_maps')
    .select('*')
    .in('route_code', routeCodes)
    .eq('status', 'approved');
  if (error) throw new Error(error.message);
  return (data || []).map(mapRow);
}

/**
 * Build a ManagerMappingConfig from an area summary and an inclusive
 * route-number range. routeCodes come straight from the route_maps rows.
 */
export function buildMappingConfig(
  area: AreaSummary,
  routeStart: number,
  routeEnd: number,
): ManagerMappingConfig {
  const chosen = area.routes.filter(
    r => r.routeNumber >= routeStart && r.routeNumber <= routeEnd
  );
  return {
    areaName: area.areaName,
    prefix: area.prefix,
    routeStart,
    routeEnd,
    routeCodes: chosen.map(r => r.routeCode),
  };
}

/**
 * Deduped street names from a route's segments, in order of first appearance.
 * Used to populate routes.streets for a mapped manager's injected routes.
 */
export function streetsFromSegments(segments: MapSegment[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of segments || []) {
    const name = (seg.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/**
 * Padded bounding box around every coordinate of the given routes.
 * Default pad of 0.02° ≈ 2 km keeps just-off-route addresses geocodable
 * while still rejecting other-city results. Returns null if no coordinates
 * exist at all.
 */
export function bboxForRouteMaps(
  maps: ApprovedRouteMap[],
  padDeg: number = 0.02,
): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let found = false;
  for (const rm of maps) {
    for (const seg of rm.segments || []) {
      for (const c of seg.coordinates || []) {
        const [lng, lat] = c;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        found = true;
      }
    }
  }
  if (!found) return null;
  return {
    minLng: minLng - padDeg,
    minLat: minLat - padDeg,
    maxLng: maxLng + padDeg,
    maxLat: maxLat + padDeg,
  };
}

/**
 * Point-to-segment distance in metres using the equirectangular
 * approximation — plenty accurate at city-block scale (same approach as
 * RMMapTab's segment math).
 */
function distToSegmentMeters(
  lat: number, lng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const px = (lng - lng1) * mPerDegLng;
  const py = (lat - lat1) * mPerDegLat;
  const bx = (lng2 - lng1) * mPerDegLng;
  const by = (lat2 - lat1) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const cx = t * bx;
  const cy = t * by;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/**
 * The route whose segments come closest to the given point, across the given
 * route maps. No distance threshold — PCL bucketing assigns to the nearest
 * route regardless, since the geocode was already bbox-constrained to the
 * area. Returns null only when no route has any coordinates at all.
 */
export function nearestRouteForPoint(
  lat: number,
  lng: number,
  maps: ApprovedRouteMap[],
): { routeCode: string; distMeters: number } | null {
  let best: { routeCode: string; distMeters: number } | null = null;
  for (const rm of maps) {
    for (const seg of rm.segments || []) {
      const coords = seg.coordinates || [];
      if (coords.length === 1) {
        const [cLng, cLat] = coords[0];
        const d = distToSegmentMeters(lat, lng, cLat, cLng, cLat, cLng);
        if (!best || d < best.distMeters) {
          best = { routeCode: rm.routeCode, distMeters: d };
        }
        continue;
      }
      for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        const d = distToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2);
        if (!best || d < best.distMeters) {
          best = { routeCode: rm.routeCode, distMeters: d };
        }
      }
    }
  }
  return best;
}

/**
 * Mapbox forward geocode with a hard bbox constraint. Mirrors RMMapTab's
 * geocodeAddress: Ontario/Canada query suffix, address-type results only,
 * and the bbox REJECTS out-of-area results rather than merely biasing toward
 * them. Returns null on any failure (missing token, network error, no result).
 */
export async function geocodeAddressInBbox(
  addr: string,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null,
): Promise<{ lat: number; lng: number } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
  if (!token || !addr) return null;
  const q = encodeURIComponent([addr, 'Ontario', 'Canada'].join(', '));
  let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${token}&limit=1&country=ca&types=address`;
  if (bbox) url += `&bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.features?.length > 0) {
      const [lng, lat] = data.features[0].center;
      return { lat, lng };
    }
    return null;
  } catch {
    return null;
  }
}
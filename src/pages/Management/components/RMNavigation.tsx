// src/pages/Management/components/RMNavigation.tsx
//
// In-app navigation overlay. Renders on top of the existing Mapbox map:
//   - A blue route polyline (Mapbox layer 'rm-nav-route')
//   - A full-width maneuver card at the top of the map showing next turn,
//     distance, instruction, ETA, total remaining, and an X cancel button
//   - A brief "Recalculating…" toast when off-route deviation triggers a recalc
//
// Lifecycle:
//   1. Parent (RMMapTab) mounts RMNavigation with destination {lat,lng,label}.
//   2. RMNavigation fetches a route from the Mapbox Directions API using the
//      current GPS position as origin.
//   3. Polls GPS via watchPosition. On each update:
//        - Recompute distance to destination → if <= ARRIVAL_THRESHOLD_M, fire onArrived.
//        - Recompute distance from current planned route line → if > DEVIATION_THRESHOLD_M,
//          trigger a recalc (refetch from new GPS position), show toast.
//        - Recompute next-step distance and ETA from remaining geometry.
//   4. User taps X → onCancel.
//   5. Parent unmounts RMNavigation; cleanup removes layer/source/marker.
//
// The map style is owned by RMMapTab. RMNavigation only adds/removes its own
// layer ('rm-nav-route') and source ('rm-nav-route-src'). It never touches
// other layers, the camera, or follow-me state.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { X, CornerUpLeft, CornerUpRight, ArrowUp, RotateCcw, Merge, ChevronUp, MapPin } from 'lucide-react';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// --- TUNING CONSTANTS ---
// Arrival fires when GPS is within this many metres of the destination.
const ARRIVAL_THRESHOLD_M = 40;
// Recalc fires when GPS drifts more than this many metres from the planned route line.
const DEVIATION_THRESHOLD_M = 50;
// Minimum time between recalcs — keeps the Directions API call rate sane even if
// GPS jitter pushes you in and out of the deviation threshold.
const MIN_RECALC_INTERVAL_MS = 15000;
// Mapbox style/source/layer IDs — kept distinct from any other RM* layer.
const NAV_SOURCE_ID = 'rm-nav-route-src';
const NAV_LAYER_ID = 'rm-nav-route';
const NAV_LAYER_OUTLINE_ID = 'rm-nav-route-outline';
// Recalc toast visibility duration.
const RECALC_TOAST_MS = 1800;

// --- TYPES ---

export interface NavDestination {
  lat: number;
  lng: number;
  label: string;        // Display name on the maneuver card ("Vijay B." or "John & Mike")
}

export interface RMNavigationProps {
  map: mapboxgl.Map;                  // The parent's mapbox map instance
  destination: NavDestination;
  onArrived: () => void;
  onCancel: () => void;
}

// Mapbox Directions API response shapes. Trimmed to only the fields we use.
interface DirectionsStep {
  distance: number;                    // metres
  duration: number;                    // seconds
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  maneuver: {
    type: string;                      // 'turn', 'depart', 'arrive', 'merge', 'roundabout', etc.
    modifier?: string;                 // 'left', 'right', 'slight left', 'sharp right', 'straight', 'uturn'
    instruction: string;               // human-readable, e.g. "Turn right onto Main St"
    location: [number, number];        // [lng, lat] of the turn
  };
}

interface DirectionsLeg {
  distance: number;                    // metres
  duration: number;                    // seconds
  steps: DirectionsStep[];
}

interface DirectionsRoute {
  distance: number;                    // total metres
  duration: number;                    // total seconds
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  legs: DirectionsLeg[];
}

// --- DISTANCE HELPERS ---

// Equirectangular approximation. Plenty accurate for the metre-scale checks we
// do (deviation, arrival). Avoids the cos/sin cost of haversine.
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const meanLat = (lat1 + lat2) / 2;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const dx = (lng2 - lng1) * mPerDegLng;
  const dy = (lat2 - lat1) * mPerDegLat;
  return Math.sqrt(dx * dx + dy * dy);
}

// Perpendicular distance from point to a finite line segment (in metres).
function distToSegmentMeters(
  lat: number, lng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const meanLat = (lat + lat1 + lat2) / 3;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
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

// Minimum distance from a point to a polyline. Returns metres.
function distToPolylineMeters(lat: number, lng: number, coords: [number, number][]): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) {
    const [lng1, lat1] = coords[0];
    return distanceMeters(lat, lng, lat1, lng1);
  }
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    const d = distToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2);
    if (d < best) best = d;
  }
  return best;
}

// --- MANEUVER ICON PICKER ---

function ManeuverIcon({ type, modifier, size = 36 }: { type: string; modifier?: string; size?: number }) {
  // Arrival/destination
  if (type === 'arrive') {
    return <MapPin size={size} className="text-green-400" />;
  }
  // U-turn
  if (modifier === 'uturn') {
    return <RotateCcw size={size} className="text-white" />;
  }
  // Merge
  if (type === 'merge' || type === 'on ramp') {
    return <Merge size={size} className="text-white" />;
  }
  // Right family
  if (modifier && modifier.includes('right')) {
    return <CornerUpRight size={size} className="text-white" />;
  }
  // Left family
  if (modifier && modifier.includes('left')) {
    return <CornerUpLeft size={size} className="text-white" />;
  }
  // Straight / depart / default
  return <ArrowUp size={size} className="text-white" />;
}

// --- FORMATTERS ---

function formatDistance(metres: number): string {
  if (metres < 1000) {
    // Round to nearest 10m for nearby maneuvers — feels more responsive than the metre.
    const rounded = Math.max(10, Math.round(metres / 10) * 10);
    return `${rounded} m`;
  }
  const km = metres / 1000;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

function formatDuration(seconds: number): string {
  const totalMin = Math.max(1, Math.round(seconds / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return min === 0 ? `${hours} h` : `${hours} h ${min} min`;
}

// --- COMPONENT ---

const RMNavigation: React.FC<RMNavigationProps> = ({ map, destination, onArrived, onCancel }) => {
  // Current planned route from Directions API (null while loading / on error).
  const [route, setRoute] = useState<DirectionsRoute | null>(null);
  // Which step index in legs[0].steps the user is currently on.
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  // Current GPS — set by our own watcher below.
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  // Brief "Recalculating…" toast.
  const [showRecalcToast, setShowRecalcToast] = useState(false);
  // Hard error (token scope, network) — shown as fallback inside the maneuver card.
  const [error, setError] = useState<string | null>(null);

  // Tracks last recalc time to throttle. Ref so it doesn't drive renders.
  const lastRecalcAtRef = useRef<number>(0);
  // Geolocation watch id so we can clear on unmount.
  const watchIdRef = useRef<number | null>(null);
  // Track whether the route source/layer have been added to the map.
  const layerAddedRef = useRef(false);
  // Toast timeout handle.
  const recalcToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against state updates after unmount.
  const mountedRef = useRef(true);

  // --- DIRECTIONS API CALL ---

  const fetchRoute = useCallback(async (fromLat: number, fromLng: number): Promise<DirectionsRoute | null> => {
    const origin = `${fromLng},${fromLat}`;
    const dest = `${destination.lng},${destination.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin};${dest}?geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Common cause: token lacks 'directions:read' scope.
        if (res.status === 401 || res.status === 403) {
          setError('Mapbox token cannot access Directions API. Check token scopes.');
        } else {
          setError(`Directions API error (${res.status})`);
        }
        console.warn('[RMNav] Directions fetch failed:', res.status, body);
        return null;
      }
      const data = await res.json();
      if (!data.routes || data.routes.length === 0) {
        setError('No driving route available.');
        return null;
      }
      setError(null);
      return data.routes[0] as DirectionsRoute;
    } catch (err) {
      console.warn('[RMNav] Directions fetch threw:', err);
      setError('Network error fetching directions.');
      return null;
    }
  }, [destination.lat, destination.lng]);

  // --- MAP LAYER MANAGEMENT ---

  // Add the route line source + 2 layers (outline halo + main line). Done once
  // per mount. The HTML markers in RMMapTab (GPS arrow, pulsing completions,
  // dashed pending rings, worker dots) naturally render above all Mapbox layers
  // so we don't need to worry about them.
  const ensureLayerAdded = useCallback(() => {
    if (layerAddedRef.current) return;
    if (!map || !map.isStyleLoaded()) return;

    if (!map.getSource(NAV_SOURCE_ID)) {
      map.addSource(NAV_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    // White outer halo for contrast against busy backgrounds.
    if (!map.getLayer(NAV_LAYER_OUTLINE_ID)) {
      map.addLayer({
        id: NAV_LAYER_OUTLINE_ID,
        type: 'line',
        source: NAV_SOURCE_ID,
        paint: {
          'line-color': '#ffffff',
          'line-width': 10,
          'line-opacity': 0.7,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }

    // Main blue route line.
    if (!map.getLayer(NAV_LAYER_ID)) {
      map.addLayer({
        id: NAV_LAYER_ID,
        type: 'line',
        source: NAV_SOURCE_ID,
        paint: {
          'line-color': '#4285F4',
          'line-width': 6,
          'line-opacity': 0.95,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }

    layerAddedRef.current = true;
  }, [map]);

  const updateRouteOnMap = useCallback((r: DirectionsRoute | null) => {
    if (!map) return;
    ensureLayerAdded();
    const src = map.getSource(NAV_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    if (!r) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: r.geometry,
      }],
    });
  }, [map, ensureLayerAdded]);

  // --- INITIAL FETCH ---
  // Wait until we have at least one GPS fix before requesting the first route.
  useEffect(() => {
    if (!gps) return;
    if (route) return; // already fetched once
    (async () => {
      const r = await fetchRoute(gps.lat, gps.lng);
      if (!mountedRef.current) return;
      if (r) {
        setRoute(r);
        setCurrentStepIdx(0);
        updateRouteOnMap(r);
      }
    })();
  }, [gps, route, fetchRoute, updateRouteOnMap]);

  // --- GEOLOCATION WATCH ---
  // RMNavigation runs its OWN watch. The parent map's watch keeps doing GPS arrow
  // + follow-me; this one drives nav-specific logic. Both reading the same
  // underlying GPS is fine.
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not available on this device.');
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        if (!mountedRef.current) return;
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        console.warn('[RMNav] watchPosition error:', err);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // --- ARRIVAL + DEVIATION + STEP-ADVANCE LOGIC ---
  // Runs on every GPS update once a route is loaded.
  useEffect(() => {
    if (!gps || !route) return;

    // 1. Arrival check.
    const distToDest = distanceMeters(gps.lat, gps.lng, destination.lat, destination.lng);
    if (distToDest <= ARRIVAL_THRESHOLD_M) {
      onArrived();
      return;
    }

    // 2. Step advance — find the closest step ahead and use its index. We never
    //    go backwards, so step index only ever increases (or stays the same).
    const steps = route.legs[0]?.steps || [];
    if (steps.length > 0) {
      let newIdx = currentStepIdx;
      for (let i = currentStepIdx; i < steps.length; i++) {
        const endPt = i < steps.length - 1
          ? steps[i + 1].maneuver.location
          : [destination.lng, destination.lat];
        const d = distanceMeters(gps.lat, gps.lng, endPt[1], endPt[0]);
        // If we're past this step's endpoint (within 20m of the next step's start),
        // advance. Otherwise stop and use this step.
        if (d < 20 && i < steps.length - 1) {
          newIdx = i + 1;
        } else {
          newIdx = i;
          break;
        }
      }
      if (newIdx !== currentStepIdx) {
        setCurrentStepIdx(newIdx);
      }
    }

    // 3. Deviation check — recalc if we're > DEVIATION_THRESHOLD_M from the planned
    //    route line. Throttled by MIN_RECALC_INTERVAL_MS.
    const distFromRoute = distToPolylineMeters(gps.lat, gps.lng, route.geometry.coordinates);
    const now = Date.now();
    if (distFromRoute > DEVIATION_THRESHOLD_M && now - lastRecalcAtRef.current > MIN_RECALC_INTERVAL_MS) {
      lastRecalcAtRef.current = now;
      setShowRecalcToast(true);
      if (recalcToastTimerRef.current) clearTimeout(recalcToastTimerRef.current);
      recalcToastTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setShowRecalcToast(false);
      }, RECALC_TOAST_MS);
      (async () => {
        const r = await fetchRoute(gps.lat, gps.lng);
        if (!mountedRef.current) return;
        if (r) {
          setRoute(r);
          setCurrentStepIdx(0);
          updateRouteOnMap(r);
        }
      })();
    }
  }, [gps, route, currentStepIdx, destination.lat, destination.lng, onArrived, fetchRoute, updateRouteOnMap]);

  // --- CLEANUP ON UNMOUNT ---
  // Remove layers/sources so we leave the map exactly as we found it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (recalcToastTimerRef.current) clearTimeout(recalcToastTimerRef.current);
      if (!map) return;
      try {
        if (map.getLayer(NAV_LAYER_ID)) map.removeLayer(NAV_LAYER_ID);
        if (map.getLayer(NAV_LAYER_OUTLINE_ID)) map.removeLayer(NAV_LAYER_OUTLINE_ID);
        if (map.getSource(NAV_SOURCE_ID)) map.removeSource(NAV_SOURCE_ID);
      } catch (e) {
        // Map might be in the middle of being torn down by the parent —
        // ignore, the source/layer will go with it.
      }
      layerAddedRef.current = false;
    };
  }, [map]);

  // --- RENDER MANEUVER CARD ---

  const steps = route?.legs[0]?.steps || [];
  const currentStep: DirectionsStep | undefined = steps[currentStepIdx];

  // Distance to the next maneuver point. For the last step, this is the distance
  // to the destination.
  let distToNextManeuver = 0;
  if (currentStep && gps) {
    const nextPt = currentStepIdx < steps.length - 1
      ? steps[currentStepIdx + 1].maneuver.location
      : [destination.lng, destination.lat];
    distToNextManeuver = distanceMeters(gps.lat, gps.lng, nextPt[1], nextPt[0]);
  }

  // Total remaining distance and ETA. For the current step we prorate by how
  // much of it we have left (linear approximation: distToNextManeuver of
  // currentStep.distance remaining).
  let remainingDistance = 0;
  let remainingDuration = 0;
  if (route && currentStep) {
    const stepRemainFraction = currentStep.distance > 0
      ? Math.min(1, distToNextManeuver / currentStep.distance)
      : 0;
    remainingDistance = currentStep.distance * stepRemainFraction;
    remainingDuration = currentStep.duration * stepRemainFraction;
    for (let i = currentStepIdx + 1; i < steps.length; i++) {
      remainingDistance += steps[i].distance;
      remainingDuration += steps[i].duration;
    }
  }

  const instructionText = currentStep?.maneuver.instruction || 'Starting route…';
  const maneuverType = currentStep?.maneuver.type || 'depart';
  const maneuverModifier = currentStep?.maneuver.modifier;

  return (
    <>
      {/* Maneuver card — fixed across top of the map, full-width */}
      <div className="absolute top-0 left-0 right-0 z-[45] pointer-events-none">
        <div className="m-2 sm:m-3 pointer-events-auto">
          <div className="bg-gray-900/95 backdrop-blur-sm border border-blue-500/60 rounded-xl shadow-2xl text-white overflow-hidden">

            {/* Top row: turn icon + distance + instruction + cancel */}
            <div className="flex items-center gap-3 p-3">
              <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 bg-blue-600 rounded-lg flex items-center justify-center">
                {error ? (
                  <X size={28} className="text-red-300" />
                ) : (
                  <ManeuverIcon type={maneuverType} modifier={maneuverModifier} size={32} />
                )}
              </div>

              <div className="flex-1 min-w-0">
                {!error ? (
                  <>
                    <div className="text-blue-300 text-xs font-bold uppercase tracking-wide">
                      In {formatDistance(distToNextManeuver)}
                    </div>
                    <div className="text-white text-sm sm:text-base font-bold leading-tight truncate">
                      {instructionText}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-red-300 text-xs font-bold uppercase tracking-wide">
                      Navigation error
                    </div>
                    <div className="text-white text-sm font-medium leading-tight">
                      {error}
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={onCancel}
                className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-700 hover:bg-red-700 text-gray-300 hover:text-white flex items-center justify-center transition-colors"
                title="Cancel navigation"
              >
                <X size={18} />
              </button>
            </div>

            {/* Bottom row: destination label + ETA + total remaining */}
            <div className="px-3 pb-2.5 pt-1 border-t border-gray-700/50 flex items-center justify-between gap-3 bg-gray-900/60">
              <div className="flex items-center gap-1.5 min-w-0">
                <ChevronUp size={12} className="text-blue-400 flex-shrink-0" />
                <span className="text-[11px] text-gray-400 uppercase tracking-wide font-bold">Going to</span>
                <span className="text-[11px] text-white font-bold truncate">{destination.label}</span>
              </div>
              {route && !error && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-blue-300 font-bold">{formatDuration(remainingDuration)}</span>
                  <span className="text-gray-600">•</span>
                  <span className="text-[11px] text-gray-300 font-bold">{formatDistance(remainingDistance)}</span>
                </div>
              )}
            </div>

            {/* Recalc toast — appears inside the card briefly */}
            {showRecalcToast && (
              <div className="px-3 py-1.5 bg-amber-700/30 border-t border-amber-600/40 text-amber-200 text-[11px] font-bold text-center">
                Recalculating route…
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};


export default RMNavigation;

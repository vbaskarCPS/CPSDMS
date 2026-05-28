// src/components/RouteSplitModal.tsx
//
// Modal for splitting a single route into two halves ('a' and 'b') by drawing
// axis-aligned rectangles over a Mapbox preview. Segments whose midpoint falls
// inside ANY rectangle are bucketed to 'b'; everything else is 'a'. Prebookings
// inherit the bucket of their closest segment (by midpoint distance).
//
// The modal does NOT mutate any state — it only computes the buckets and hands
// them back to the parent via onConfirm. The parent (RMMapTab) is responsible
// for calling sessionService.createRouteSplit and orchestrating the post-split
// assignment flow.
//
// Tablet-friendly:
//   - Map is rendered with interactive: false so Mapbox doesn't fight us for
//     pointer events. The user can't pan/zoom — the map is fitted to the route
//     bounds on load and stays there.
//   - Pointer events on the map container drive the box-drag: pointerdown starts
//     a rectangle, pointermove updates the in-progress drag, pointerup commits.
//   - Multiple rectangles accumulate. Undo removes the most recent. Cancel
//     discards everything. Confirm fires the callback.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// --- Public input types ---

export interface RouteSplitSegment {
  osmId: number;
  name?: string;
  // GeoJSON convention: [longitude, latitude].
  coordinates: [number, number][];
}

export interface RouteSplitBooking {
  bookingId: string;
  lat: number;
  lng: number;
}

export interface RouteSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  routeCode: string;                    // e.g. "BIN09" — display only; no DB writes.
  routeColor: string;                   // hex like "#7a3fbf"; 'a' half stays this colour.
  segments: RouteSplitSegment[];
  prebookings: RouteSplitBooking[];
  mapboxToken: string;
  onConfirm: (segmentBOsmIds: number[], bookingBIds: string[]) => void;
}

// --- Internal rectangle representation (geographic bounds) ---

interface Rect {
  west: number;
  east: number;
  south: number;
  north: number;
}

// --- Small geometry helpers ---

// Midpoint = the middle entry in the coordinate array. Good enough for bucket
// assignment since segments on a route are short. We don't need real length-based
// midpoints here.
function segmentMidpoint(coords: [number, number][]): [number, number] {
  if (!coords || coords.length === 0) return [0, 0];
  return coords[Math.floor(coords.length / 2)];
}

function pointInRect(lng: number, lat: number, r: Rect): boolean {
  return lng >= r.west && lng <= r.east && lat >= r.south && lat <= r.north;
}

function pointInAnyRect(lng: number, lat: number, rects: Rect[]): boolean {
  for (const r of rects) if (pointInRect(lng, lat, r)) return true;
  return false;
}

// Closest segment to a booking, by distance from booking to segment's midpoint.
// O(N*M) — fine for typical sizes (≤ 200 prebooks × ≤ 60 segments = 12k checks).
function closestSegment(b: RouteSplitBooking, segs: RouteSplitSegment[]): RouteSplitSegment | null {
  let best: RouteSplitSegment | null = null;
  let bestDist = Infinity;
  for (const s of segs) {
    const [mlng, mlat] = segmentMidpoint(s.coordinates);
    const dlng = b.lng - mlng;
    const dlat = b.lat - mlat;
    const d = dlng * dlng + dlat * dlat;     // squared, no sqrt needed for comparison
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

// HSL hue rotation by 180° to derive the 'b'-half colour from the route's colour.
// Same rule used by the master map render path so previews stay consistent.
function complementaryColor(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '#facc15'; // fallback amber

  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = ((b - r) / d + 2);
    else h = ((r - g) / d + 4);
    h *= 60;
  }

  const newH = (h + 180) % 360;

  // HSL → RGB
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((newH / 60) % 2) - 1));
  const mm = l - c / 2;
  let rr = 0, gg = 0, bb = 0;
  if (newH < 60) { rr = c; gg = x; bb = 0; }
  else if (newH < 120) { rr = x; gg = c; bb = 0; }
  else if (newH < 180) { rr = 0; gg = c; bb = x; }
  else if (newH < 240) { rr = 0; gg = x; bb = c; }
  else if (newH < 300) { rr = x; gg = 0; bb = c; }
  else { rr = c; gg = 0; bb = x; }
  const to = (v: number) => Math.round((v + mm) * 255).toString(16).padStart(2, '0');
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

// --- GeoJSON builders ---

function segmentsToFeatureCollection(segs: RouteSplitSegment[], rects: Rect[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: segs.map(s => {
      const [mlng, mlat] = segmentMidpoint(s.coordinates);
      const bucket = pointInAnyRect(mlng, mlat, rects) ? 'b' : 'a';
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coordinates },
        properties: { osmId: s.osmId, bucket },
      };
    }),
  };
}

function rectsToFeatureCollection(rects: Rect[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rects.map((r, i) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [r.west, r.south],
          [r.east, r.south],
          [r.east, r.north],
          [r.west, r.north],
          [r.west, r.south],
        ]],
      },
      properties: { id: i },
    })),
  };
}

// --- Component ---

const RouteSplitModal: React.FC<RouteSplitModalProps> = ({
  isOpen,
  onClose,
  routeCode,
  routeColor,
  segments,
  prebookings,
  mapboxToken,
  onConfirm,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const styleLoadedRef = useRef(false);

  const [rectangles, setRectangles] = useState<Rect[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ lng: number; lat: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ lng: number; lat: number } | null>(null);

  const bColor = useMemo(() => complementaryColor(routeColor), [routeColor]);

  // The list of rectangles used for live preview = committed + in-progress drag.
  const previewRects = useMemo<Rect[]>(() => {
    const out = [...rectangles];
    if (isDragging && dragStart && dragCurrent) {
      out.push({
        west: Math.min(dragStart.lng, dragCurrent.lng),
        east: Math.max(dragStart.lng, dragCurrent.lng),
        south: Math.min(dragStart.lat, dragCurrent.lat),
        north: Math.max(dragStart.lat, dragCurrent.lat),
      });
    }
    return out;
  }, [rectangles, isDragging, dragStart, dragCurrent]);

  // Live counts driving the header readout.
  const counts = useMemo(() => {
    let aSegs = 0, bSegs = 0;
    for (const s of segments) {
      const [mlng, mlat] = segmentMidpoint(s.coordinates);
      if (pointInAnyRect(mlng, mlat, previewRects)) bSegs++;
      else aSegs++;
    }
    let aBookings = 0, bBookings = 0;
    for (const b of prebookings) {
      const seg = closestSegment(b, segments);
      if (!seg) { aBookings++; continue; }
      const [mlng, mlat] = segmentMidpoint(seg.coordinates);
      if (pointInAnyRect(mlng, mlat, previewRects)) bBookings++;
      else aBookings++;
    }
    return { aSegs, bSegs, aBookings, bBookings };
  }, [previewRects, segments, prebookings]);

  // --- Reset state every time the modal opens fresh ---
  useEffect(() => {
    if (isOpen) {
      setRectangles([]);
      setIsDragging(false);
      setDragStart(null);
      setDragCurrent(null);
      styleLoadedRef.current = false;
    }
  }, [isOpen]);

  // --- Mapbox lifecycle ---
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    mapboxgl.accessToken = mapboxToken;

    // Build bounds from all segment coordinates.
    const allCoords = segments.flatMap(s => s.coordinates);
    if (allCoords.length === 0) return;
    const lngs = allCoords.map(c => c[0]);
    const lats = allCoords.map(c => c[1]);
    const bounds: mapboxgl.LngLatBoundsLike = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds,
      fitBoundsOptions: { padding: 60 },
      interactive: false,            // No pan/zoom — pointer events go to our drag handler.
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      styleLoadedRef.current = true;

      // Rectangles layer first (drawn beneath segments so segment lines stay visible).
      map.addSource('rs-rects', {
        type: 'geojson',
        data: rectsToFeatureCollection([]),
      });
      map.addLayer({
        id: 'rs-rects-fill',
        type: 'fill',
        source: 'rs-rects',
        paint: {
          'fill-color': bColor,
          'fill-opacity': 0.18,
        },
      });
      map.addLayer({
        id: 'rs-rects-outline',
        type: 'line',
        source: 'rs-rects',
        paint: {
          'line-color': bColor,
          'line-width': 2,
          'line-dasharray': [3, 2],
        },
      });

      // Segments layer with data-driven colouring.
      map.addSource('rs-segments', {
        type: 'geojson',
        data: segmentsToFeatureCollection(segments, []),
      });
      map.addLayer({
        id: 'rs-segments-layer',
        type: 'line',
        source: 'rs-segments',
        paint: {
          'line-color': [
            'match',
            ['get', 'bucket'],
            'b', bColor,
            routeColor,
          ],
          'line-width': 5,
          'line-opacity': 0.95,
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    });

    return () => {
      try { map.remove(); } catch { /* noop */ }
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // We deliberately do NOT re-run this effect when segments change — the modal
    // is created fresh each open, and segments don't change during a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // --- Push preview updates into Mapbox sources whenever the rectangles change ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const segSrc = map.getSource('rs-segments') as mapboxgl.GeoJSONSource | undefined;
    if (segSrc) segSrc.setData(segmentsToFeatureCollection(segments, previewRects));

    const rectSrc = map.getSource('rs-rects') as mapboxgl.GeoJSONSource | undefined;
    if (rectSrc) rectSrc.setData(rectsToFeatureCollection(previewRects));
  }, [previewRects, segments]);

  // --- Pointer-driven box-drag ---
  // We attach handlers on the container (not the canvas) so they survive any
  // internal Mapbox repaints. With interactive:false, Mapbox doesn't intercept
  // these events.

  const containerToLngLat = useCallback((clientX: number, clientY: number) => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return null;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ll = map.unproject([x, y]);
    return { lng: ll.lng, lat: ll.lat };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only start drag with primary pointer/button.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pos = containerToLngLat(e.clientX, e.clientY);
    if (!pos) return;
    setDragStart(pos);
    setDragCurrent(pos);
    setIsDragging(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [containerToLngLat]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const pos = containerToLngLat(e.clientX, e.clientY);
    if (!pos) return;
    setDragCurrent(pos);
  }, [isDragging, containerToLngLat]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const finalRect = (dragStart && dragCurrent) ? {
      west: Math.min(dragStart.lng, dragCurrent.lng),
      east: Math.max(dragStart.lng, dragCurrent.lng),
      south: Math.min(dragStart.lat, dragCurrent.lat),
      north: Math.max(dragStart.lat, dragCurrent.lat),
    } : null;
    setIsDragging(false);
    setDragStart(null);
    setDragCurrent(null);

    // Only commit rectangles with a meaningful area. Tiny rectangles (a tap that
    // barely moved) get discarded so accidental taps don't create stray overlays.
    if (finalRect) {
      const widthDeg = finalRect.east - finalRect.west;
      const heightDeg = finalRect.north - finalRect.south;
      if (widthDeg > 0.0001 && heightDeg > 0.0001) {
        setRectangles(prev => [...prev, finalRect]);
      }
    }

    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, [isDragging, dragStart, dragCurrent]);

  // --- Action handlers ---

  const handleUndo = () => {
    setRectangles(prev => prev.slice(0, -1));
  };

  const handleCancel = () => {
    onClose();
  };

  const handleConfirm = () => {
    // Compute final buckets from the committed rectangles.
    const segmentBOsmIds: number[] = [];
    for (const s of segments) {
      const [mlng, mlat] = segmentMidpoint(s.coordinates);
      if (pointInAnyRect(mlng, mlat, rectangles)) segmentBOsmIds.push(s.osmId);
    }
    const bSegSet = new Set(segmentBOsmIds);
    const bookingBIds: string[] = [];
    for (const b of prebookings) {
      const seg = closestSegment(b, segments);
      if (seg && bSegSet.has(seg.osmId)) bookingBIds.push(b.bookingId);
    }
    onConfirm(segmentBOsmIds, bookingBIds);
  };

  // Confirm is disabled until the user has carved out a non-empty 'b' bucket
  // AND left at least one segment in 'a'. Otherwise the "split" isn't a split.
  const canConfirm = counts.bSegs > 0 && counts.aSegs > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col border border-gray-700">
        {/* --- Header with live counts --- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">Split route {routeCode}</h2>
            <div className="text-sm text-gray-300 flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: routeColor }}
                />
                <span className="font-semibold text-white">{routeCode}a:</span>
                <span>{counts.aSegs} streets, {counts.aBookings} prebooks</span>
              </span>
              <span className="text-gray-600">·</span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-3 rounded-sm"
                  style={{ backgroundColor: bColor }}
                />
                <span className="font-semibold text-white">{routeCode}b:</span>
                <span>{counts.bSegs} streets, {counts.bBookings} prebooks</span>
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-gray-400 hover:text-white text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* --- Instructions banner --- */}
        <div className="px-6 py-2 bg-gray-800/60 border-b border-gray-700 text-xs text-gray-400">
          Drag a rectangle over the streets you want in the <span className="text-white font-semibold">b</span> half.
          Draw multiple rectangles to add more. Use <span className="text-white">Undo</span> to remove the last one.
        </div>

        {/* --- Map container --- */}
        <div className="relative flex-1 bg-gray-100 overflow-hidden">
          <div
            ref={containerRef}
            className="absolute inset-0 cursor-crosshair select-none"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {segments.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
              No segment geometry available for this route.
            </div>
          )}
        </div>

        {/* --- Action bar --- */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700 gap-3">
          <button
            type="button"
            onClick={handleUndo}
            disabled={rectangles.length === 0}
            className="px-4 py-2 rounded-lg bg-gray-700 text-white text-sm font-semibold hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="px-5 py-2 rounded-lg bg-gray-700 text-white text-sm font-semibold hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm split
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RouteSplitModal;

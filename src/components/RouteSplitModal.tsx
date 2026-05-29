// src/components/RouteSplitModal.tsx
//
// Modal for splitting a single bucket of a route by drawing axis-aligned
// rectangles over a Mapbox preview. Each rectangle becomes part of the new
// bucket's geographic definition.
//
// V2 changes vs the original a/b modal:
//   - Recursive: caller passes the existing buckets array + the sourceLetter
//     being carved + the newLetter being assigned. Modal renders all current
//     buckets in their colours, with the source bucket as the only one that
//     can be "stolen from" by the new rectangles.
//   - Half-segment accuracy: rendering is per-line-piece (each pair of
//     consecutive coords is its own LineString). A line-piece's bucket is
//     determined by which rectangles contain its midpoint, applied via a
//     cascade: piece starts in 'a', then each subsequent bucket can promote
//     it if (current bucket == bucket.sourceLetter) and midpoint is inside.
//   - Returns rectangles + the booking IDs that move from source → new.
//     Rectangles are persisted by sessionService so the master map can
//     re-render with the same algorithm after the modal closes.
//
// Tablet/touch-friendly with mode toggle:
//   - The modal has two modes — 'navigate' (default) and 'draw' — toggled by
//     a button in the header.
//   - In NAVIGATE mode: Mapbox's full gesture set is enabled (pinch-zoom,
//     two-finger rotate + tilt, single-finger pan, double-tap zoom). The
//     drawing overlay is transparent to pointer events so all gestures reach
//     the map. Initial fit-to-route happens on first load only.
//   - In DRAW mode: every Mapbox gesture handler is disabled. The overlay
//     gets touch-action: none and captures pointer events for single-finger
//     box-drag — pointerdown starts a rectangle, pointermove updates it,
//     pointerup commits.
//   - Multiple rectangles accumulate. Undo removes the most recent. Cancel
//     discards everything. Confirm fires the callback.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { X, Undo2, Check, Pencil, Move } from 'lucide-react';

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

// Mirror of RouteSplitRectangle from types.ts — duplicated here so the modal
// can be imported as a standalone component without circular imports.
//
// Corners-based storage (not axis-aligned bounds) so that rectangles drawn
// while the map is rotated stay screen-aligned at draw time and lock to
// their geographic positions afterward.
export interface SplitRect {
  corners: Array<{ lng: number; lat: number }>;
}

// Mirror of RouteSplitBucket from types.ts. The modal needs to know the full
// current bucket array to render existing splits correctly.
export interface SplitBucket {
  letter: string;
  sourceLetter: string | null;
  rectangles: SplitRect[];
  bookingIds: string[];
  assignedWorkers: string[];
}

export interface RouteSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  routeCode: string;                    // e.g. "BIN09" — display only.
  baseRouteColor: string;               // hex; 'a' bucket stays this colour.
  segments: RouteSplitSegment[];
  prebookings: RouteSplitBooking[];     // ALL prebookings on this route, not just source.
  // Existing buckets on this route. null when this is the FIRST split (no row yet).
  // The modal will pretend bucket 'a' contains all prebookings in that case.
  existingBuckets: SplitBucket[] | null;
  // The bucket being carved FROM (e.g. 'a' for the first split, 'b' to shrink b).
  splittingFromLetter: string;
  // The letter being assigned to the new bucket (computed by the caller via
  // sessionService.nextAvailableLetter).
  newLetter: string;
  mapboxToken: string;
  // On Confirm, the modal returns the rectangles and the list of booking IDs
  // moving from sourceLetter → newLetter. The parent calls sessionService
  // .splitBucket with these.
  onConfirm: (rectangles: SplitRect[], bookingsMovingToNew: string[]) => void;
}

// --- Internal rectangle representation (4 geographic corners) ---
//
// Same shape as SplitRect — kept as a separate local alias only so changes
// to the public type don't accidentally ripple into internal state code.
interface Rect {
  corners: Array<{ lng: number; lat: number }>;
}

// --- Geometry helpers ---

// Standard ray-casting point-in-polygon. Works for any simple polygon (no
// self-intersections). The 4-corner quadrilaterals we draw always satisfy
// that constraint since they're built from a screen-aligned pixel rectangle
// projected through map.unproject.
function pointInPolygon(lng: number, lat: number, corners: Array<{lng: number; lat: number}>): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].lng, yi = corners[i].lat;
    const xj = corners[j].lng, yj = corners[j].lat;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInAnyRect(lng: number, lat: number, rects: Rect[]): boolean {
  for (const r of rects) {
    if (r.corners && r.corners.length >= 3 && pointInPolygon(lng, lat, r.corners)) return true;
  }
  return false;
}

// Squared distance from point (px, py) to segment (ax, ay)-(bx, by).
// Used for booking → closest-line-piece. Squared because we only compare.
function distSqPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

// --- Colour helpers ---

// Parse #rrggbb to {r,g,b} 0–255.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 128, g: 128, b: 128 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)        { r = c; g = x; b = 0; }
  else if (h < 120)  { r = x; g = c; b = 0; }
  else if (h < 180)  { r = 0; g = c; b = x; }
  else if (h < 240)  { r = 0; g = x; b = c; }
  else if (h < 300)  { r = x; g = 0; b = c; }
  else               { r = c; g = 0; b = x; }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  const hh = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hh(R)}${hh(G)}${hh(B)}`;
}

// colorForBucket: a stays base, b/c/d/e/f rotate 60° in hue each step.
// Exported so RMMapTab.tsx can use the same algorithm (consistent palette).
export function colorForBucket(baseColor: string, letter: string): string {
  if (letter === 'a' || !letter) return baseColor;
  const idx = letter.charCodeAt(0) - 'a'.charCodeAt(0);
  if (idx <= 0) return baseColor;
  const { r, g, b } = hexToRgb(baseColor);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToHex(h + idx * 60, s, l);
}

// --- Bucket cascade ---
//
// Given a point and the current bucket array, determine which bucket the point
// belongs to. Algorithm:
//   - Start in 'a'.
//   - For each subsequent bucket X in chronological order:
//       if currentBucket == X.sourceLetter AND point inside any rectangle in X →
//       currentBucket = X.letter
//   - Final currentBucket is the answer.
//
// This is identical to the algorithm used by the master map's render code so
// preview and final state are consistent.
function bucketForPoint(
  lng: number, lat: number,
  buckets: SplitBucket[]
): string {
  let current = 'a';
  // Index 0 is always 'a' (no rectangles to check); start from index 1.
  for (let i = 1; i < buckets.length; i++) {
    const b = buckets[i];
    if (b.sourceLetter !== current) continue;
    if (b.rectangles.length === 0) continue;
    if (pointInAnyRect(lng, lat, b.rectangles)) {
      current = b.letter;
    }
  }
  return current;
}

// Line-piece midpoint = average of the two endpoints.
function lineMidpoint(
  a: [number, number],
  b: [number, number]
): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// --- Component ---

const RouteSplitModal: React.FC<RouteSplitModalProps> = ({
  isOpen,
  onClose,
  routeCode,
  baseRouteColor,
  segments,
  prebookings,
  existingBuckets,
  splittingFromLetter,
  newLetter,
  mapboxToken,
  onConfirm,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Mode toggle: 'navigate' lets the user pan/pinch-zoom/rotate the map;
  // 'draw' freezes the map and lets the user drag rectangles. Default to
  // navigate so the RM can orient the map before drawing.
  const [mode, setMode] = useState<'navigate' | 'draw'>('navigate');

  // Rectangles the user has committed so far for the NEW bucket.
  const [rectangles, setRectangles] = useState<Rect[]>([]);
  // In-progress drag — track the START pixel within the container. We can't
  // store the start lng/lat because if the map were rotated mid-drag (it
  // can't, but defensively) the geographic anchor would slide. The pixel is
  // the canonical anchor; we project to lng/lat on each move using the
  // current camera so corners come out screen-aligned at the drag's end.
  const dragStartPixelRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);

  // --- Compute the effective buckets array including the in-progress new bucket.
  // This drives the live preview: as the user drags, pieces flip colour.
  // If existingBuckets is null (first split), synthesize buckets = [{letter:'a', ...}].
  const effectiveBaseBuckets = useMemo<SplitBucket[]>(() => {
    if (existingBuckets) return existingBuckets;
    return [{
      letter: 'a',
      sourceLetter: null,
      rectangles: [],
      bookingIds: prebookings.map(p => p.bookingId),
      assignedWorkers: [],
    }];
  }, [existingBuckets, prebookings]);

  // The active rect set for the new bucket = committed rectangles + drag rect.
  const activeNewRects = useMemo<Rect[]>(() => {
    return dragRect ? [...rectangles, dragRect] : rectangles;
  }, [rectangles, dragRect]);

  // The full buckets array as it would be after Confirm (with the new bucket appended).
  const previewBuckets = useMemo<SplitBucket[]>(() => {
    return [...effectiveBaseBuckets, {
      letter: newLetter,
      sourceLetter: splittingFromLetter,
      rectangles: activeNewRects,
      bookingIds: [], // unused for piece bucketing
      assignedWorkers: [],
    }];
  }, [effectiveBaseBuckets, activeNewRects, newLetter, splittingFromLetter]);

  // Per-piece bucket mapping. Each "piece" is a pair of consecutive coords.
  // We compute this every time rectangles or drag change.
  const pieceFeatures = useMemo(() => {
    type PieceFeature = {
      type: 'Feature';
      properties: { bucket: string };
      geometry: { type: 'LineString'; coordinates: [number, number][] };
    };
    const feats: PieceFeature[] = [];
    for (const seg of segments) {
      const cs = seg.coordinates;
      if (!cs || cs.length < 2) continue;
      for (let i = 0; i < cs.length - 1; i++) {
        const a = cs[i];
        const b = cs[i + 1];
        const mid = lineMidpoint(a, b);
        const bucket = bucketForPoint(mid[0], mid[1], previewBuckets);
        feats.push({
          type: 'Feature',
          properties: { bucket },
          geometry: { type: 'LineString', coordinates: [a, b] },
        });
      }
    }
    return feats;
  }, [segments, previewBuckets]);

  // Compute which prebookings would move from source → new. A prebooking moves
  // iff:
  //   1. Its closest line piece's midpoint currently belongs to splittingFromLetter
  //      under the BASE buckets (i.e. without the new rectangles), AND
  //   2. That closest piece's midpoint falls inside any active new rectangle.
  //
  // We can simplify: under previewBuckets, a piece is in newLetter iff
  // (its base-bucket == splittingFromLetter) AND (midpoint in activeNewRects).
  // So a prebooking moves iff its closest piece's preview-bucket == newLetter.
  const bookingPreview = useMemo(() => {
    // Flatten all pieces with their midpoints + bucket assignments.
    type PieceInfo = { midLng: number; midLat: number; aLng: number; aLat: number; bLng: number; bLat: number; bucket: string };
    const pieces: PieceInfo[] = [];
    for (const seg of segments) {
      const cs = seg.coordinates;
      if (!cs || cs.length < 2) continue;
      for (let i = 0; i < cs.length - 1; i++) {
        const a = cs[i];
        const b = cs[i + 1];
        const mid = lineMidpoint(a, b);
        const bucket = bucketForPoint(mid[0], mid[1], previewBuckets);
        pieces.push({
          midLng: mid[0], midLat: mid[1],
          aLng: a[0], aLat: a[1],
          bLng: b[0], bLat: b[1],
          bucket,
        });
      }
    }
    const sourceCount = { current: 0 };
    const newCount = { current: 0 };
    const movingIds: string[] = [];
    const perBookingBucket: Array<{ id: string; bucket: string; lat: number; lng: number }> = [];

    for (const pb of prebookings) {
      // Find closest piece by perpendicular distance.
      let best: PieceInfo | null = null;
      let bestD = Infinity;
      for (const p of pieces) {
        const d = distSqPointToSegment(pb.lng, pb.lat, p.aLng, p.aLat, p.bLng, p.bLat);
        if (d < bestD) { bestD = d; best = p; }
      }
      const bucketLetter = best ? best.bucket : 'a';
      perBookingBucket.push({ id: pb.bookingId, bucket: bucketLetter, lat: pb.lat, lng: pb.lng });
      if (bucketLetter === splittingFromLetter) sourceCount.current++;
      if (bucketLetter === newLetter) {
        newCount.current++;
        movingIds.push(pb.bookingId);
      }
    }
    return {
      sourceBucketBookingCount: sourceCount.current,
      newBucketBookingCount: newCount.current,
      bookingsMovingToNew: movingIds,
      perBookingBucket,
    };
  }, [segments, prebookings, previewBuckets, splittingFromLetter, newLetter]);

  // Counts for header. Source "before" = how many bookings were in
  // splittingFromLetter BEFORE this split. Same for piece counts.
  const headerCounts = useMemo(() => {
    // Before-split: use effectiveBaseBuckets (without the new bucket).
    let sourceBookingsBefore = 0;
    for (const pb of prebookings) {
      // Closest-piece logic in base buckets.
      let bestBucket = 'a';
      let bestD = Infinity;
      for (const seg of segments) {
        const cs = seg.coordinates;
        if (!cs || cs.length < 2) continue;
        for (let i = 0; i < cs.length - 1; i++) {
          const a = cs[i];
          const b = cs[i + 1];
          const d = distSqPointToSegment(pb.lng, pb.lat, a[0], a[1], b[0], b[1]);
          if (d < bestD) {
            bestD = d;
            const mid = lineMidpoint(a, b);
            bestBucket = bucketForPoint(mid[0], mid[1], effectiveBaseBuckets);
          }
        }
      }
      if (bestBucket === splittingFromLetter) sourceBookingsBefore++;
    }

    // Piece counts (before/after) — simpler.
    let sourcePiecesBefore = 0;
    let sourcePiecesAfter = 0;
    let newPieces = 0;
    for (const seg of segments) {
      const cs = seg.coordinates;
      if (!cs || cs.length < 2) continue;
      for (let i = 0; i < cs.length - 1; i++) {
        const a = cs[i];
        const b = cs[i + 1];
        const mid = lineMidpoint(a, b);
        const baseBucket = bucketForPoint(mid[0], mid[1], effectiveBaseBuckets);
        const previewBucket = bucketForPoint(mid[0], mid[1], previewBuckets);
        if (baseBucket === splittingFromLetter) sourcePiecesBefore++;
        if (previewBucket === splittingFromLetter) sourcePiecesAfter++;
        if (previewBucket === newLetter) newPieces++;
      }
    }
    return {
      sourceBookingsBefore,
      sourceBookingsAfter: bookingPreview.sourceBucketBookingCount,
      newBookings: bookingPreview.newBucketBookingCount,
      sourcePiecesBefore,
      sourcePiecesAfter,
      newPieces,
    };
  }, [segments, prebookings, effectiveBaseBuckets, previewBuckets, splittingFromLetter, newLetter, bookingPreview]);

  // --- Bounds: fit map to all route geometry on load.
  const routeBounds = useMemo(() => {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const seg of segments) {
      for (const [lng, lat] of seg.coordinates) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    if (!isFinite(minLng)) return null;
    return new mapboxgl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
  }, [segments]);

  // --- Map init ---
  useEffect(() => {
    if (!isOpen) return;
    if (!containerRef.current) return;
    if (mapRef.current) return;
    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-79.87, 43.32],
      zoom: 13,
      interactive: true,
      attributionControl: false,
    });
    map.on('load', () => {
      if (routeBounds) {
        map.fitBounds(routeBounds, { padding: 60, animate: false });
      }
      setMapLoaded(true);
    });
    mapRef.current = map;
    return () => {
      try { map.remove(); } catch {}
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [isOpen, mapboxToken, routeBounds]);

  // --- Mode effect: enable/disable Mapbox handlers based on mode. ---
  //
  // In 'navigate' mode, all gesture handlers are on so the RM can pinch-zoom,
  // two-finger rotate, two-finger tilt, drag-pan, double-click-zoom, etc.
  //
  // In 'draw' mode, every handler is disabled so the map is frozen while the
  // user drags rectangles. Rectangle drawing works at any map rotation/pitch
  // because rectangles are stored as 4 explicit geographic corners (not as
  // axis-aligned bounds): the drag computes a screen-aligned pixel rectangle
  // and projects its 4 corners through the current camera. The drawn shape
  // therefore appears as a clean rectangle on screen, then later rotates with
  // the streets in the master map.
  //
  // Also cancels any in-progress drag if the user switches modes mid-drag.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const handlers: Array<{ enable: () => void; disable: () => void }> = [
      map.dragPan, map.dragRotate, map.scrollZoom, map.boxZoom,
      map.doubleClickZoom, map.keyboard, map.touchZoomRotate, map.touchPitch,
    ];
    if (mode === 'navigate') {
      for (const h of handlers) { try { h.enable(); } catch {} }
    } else {
      for (const h of handlers) { try { h.disable(); } catch {} }
      // Cancel any in-progress drag.
      if (dragStartPixelRef.current) {
        dragStartPixelRef.current = null;
        setDragRect(null);
      }
    }
  }, [mode, mapLoaded]);

  // --- Render pieces as a layer driven by the bucket property + match expression. ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = 'split-pieces';
    const lyr = 'split-pieces-line';

    // Build the colour match. We support up to bucket 'f' (six bucket cap).
    // Any letter beyond f falls back to base colour.
    const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    const matchExpr: any = ['match', ['get', 'bucket']];
    for (const L of letters) {
      matchExpr.push(L);
      matchExpr.push(colorForBucket(baseRouteColor, L));
    }
    matchExpr.push(baseRouteColor); // default

    const data = { type: 'FeatureCollection' as const, features: pieceFeatures };

    if (map.getSource(src)) {
      (map.getSource(src) as mapboxgl.GeoJSONSource).setData(data as any);
      if (map.getLayer(lyr)) {
        map.setPaintProperty(lyr, 'line-color', matchExpr);
      }
    } else {
      map.addSource(src, { type: 'geojson', data: data as any });
      map.addLayer({
        id: lyr,
        type: 'line',
        source: src,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': matchExpr,
          'line-width': 5,
          'line-opacity': 0.95,
        },
      });
    }
  }, [pieceFeatures, baseRouteColor, mapLoaded]);

  // --- Render prebookings as circles, coloured by their preview bucket. ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = 'split-pins';
    const lyr = 'split-pins-circle';

    const features = bookingPreview.perBookingBucket.map(b => ({
      type: 'Feature' as const,
      properties: { bucket: b.bucket },
      geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
    }));
    const data = { type: 'FeatureCollection' as const, features };

    const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    const matchExpr: any = ['match', ['get', 'bucket']];
    for (const L of letters) {
      matchExpr.push(L);
      matchExpr.push(colorForBucket(baseRouteColor, L));
    }
    matchExpr.push(baseRouteColor);

    if (map.getSource(src)) {
      (map.getSource(src) as mapboxgl.GeoJSONSource).setData(data as any);
      if (map.getLayer(lyr)) {
        map.setPaintProperty(lyr, 'circle-color', matchExpr);
      }
    } else {
      map.addSource(src, { type: 'geojson', data: data as any });
      map.addLayer({
        id: lyr,
        type: 'circle',
        source: src,
        paint: {
          'circle-radius': 5,
          'circle-color': matchExpr,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
    }
  }, [bookingPreview, baseRouteColor, mapLoaded]);

  // --- Render committed + drag rectangles as a fill layer. ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const src = 'split-rects';
    const lyrFill = 'split-rects-fill';
    const lyrLine = 'split-rects-line';

    const features = activeNewRects.map(r => {
      // Build a closed polygon ring from the 4 stored corners. We close by
      // repeating the first corner at the end (GeoJSON convention).
      const ring: [number, number][] = r.corners.map(c => [c.lng, c.lat] as [number, number]);
      if (ring.length > 0) ring.push(ring[0]);
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [ring],
        },
      };
    });
    const data = { type: 'FeatureCollection' as const, features };

    const newColor = colorForBucket(baseRouteColor, newLetter);

    if (map.getSource(src)) {
      (map.getSource(src) as mapboxgl.GeoJSONSource).setData(data as any);
      if (map.getLayer(lyrFill)) {
        map.setPaintProperty(lyrFill, 'fill-color', newColor);
      }
      if (map.getLayer(lyrLine)) {
        map.setPaintProperty(lyrLine, 'line-color', newColor);
      }
    } else {
      map.addSource(src, { type: 'geojson', data: data as any });
      map.addLayer({
        id: lyrFill,
        type: 'fill',
        source: src,
        paint: { 'fill-color': newColor, 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: lyrLine,
        type: 'line',
        source: src,
        layout: { 'line-cap': 'square', 'line-join': 'miter' },
        paint: {
          'line-color': newColor,
          'line-width': 2,
          'line-dasharray': [4, 3],
        },
      });
    }
  }, [activeNewRects, baseRouteColor, newLetter, mapLoaded]);

  // --- Pointer interaction: drag to draw a rectangle. ---
  // Helpers: convert client coordinates to container-local pixels and back
  // to lng/lat. We split these because the drag math operates in PIXELS (so
  // the resulting rectangle is screen-aligned), but the storage is lng/lat
  // (so the rectangle locks to its geographic position after the drag ends).
  const clientToPixel = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // Given two screen-pixel diagonal points, build the 4 corners of the
  // axis-aligned-on-screen rectangle they bound and unproject each through
  // the current camera. The result is a lng/lat quadrilateral that renders
  // as a clean rectangle at the current rotation/pitch and stays locked to
  // those geographic positions afterward.
  const pixelDiagonalToCorners = useCallback((
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ): Array<{ lng: number; lat: number }> | null => {
    const map = mapRef.current;
    if (!map) return null;
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const tl = map.unproject([minX, minY] as any);
    const tr = map.unproject([maxX, minY] as any);
    const br = map.unproject([maxX, maxY] as any);
    const bl = map.unproject([minX, maxY] as any);
    return [
      { lng: tl.lng, lat: tl.lat },
      { lng: tr.lng, lat: tr.lat },
      { lng: br.lng, lat: br.lat },
      { lng: bl.lng, lat: bl.lat },
    ];
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!mapLoaded) return;
    if (mode !== 'draw') return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const px = clientToPixel(e.clientX, e.clientY);
    if (!px) return;
    dragStartPixelRef.current = px;
    // Initial drag rect is degenerate (all 4 corners at the same point).
    const corners = pixelDiagonalToCorners(px, px);
    if (!corners) return;
    setDragRect({ corners });
  }, [mapLoaded, mode, clientToPixel, pixelDiagonalToCorners]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'draw') return;
    if (!dragStartPixelRef.current) return;
    const px = clientToPixel(e.clientX, e.clientY);
    if (!px) return;
    const corners = pixelDiagonalToCorners(dragStartPixelRef.current, px);
    if (!corners) return;
    setDragRect({ corners });
  }, [mode, clientToPixel, pixelDiagonalToCorners]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartPixelRef.current) return;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
    const finalDrag = dragRect;
    const startPx = dragStartPixelRef.current;
    const endPx = clientToPixel(e.clientX, e.clientY);
    dragStartPixelRef.current = null;
    setDragRect(null);
    if (!finalDrag) return;
    // Reject tiny accidental clicks: require the drag to span at least 8
    // pixels diagonally on screen. Geographic checks (lng/lat span) don't
    // work cleanly with rotated rectangles — pixel distance is the right
    // unit for "did the user actually drag?".
    if (endPx) {
      const dx = endPx.x - startPx.x;
      const dy = endPx.y - startPx.y;
      if (Math.sqrt(dx * dx + dy * dy) < 8) return;
    }
    setRectangles(prev => [...prev, finalDrag]);
  }, [dragRect, clientToPixel]);

  const handleUndo = useCallback(() => {
    setRectangles(prev => prev.slice(0, -1));
  }, []);

  const handleConfirm = useCallback(() => {
    if (rectangles.length === 0) return;
    onConfirm(rectangles, bookingPreview.bookingsMovingToNew);
  }, [rectangles, bookingPreview.bookingsMovingToNew, onConfirm]);

  // --- Reset rectangles whenever modal opens fresh (so re-opens are clean). ---
  useEffect(() => {
    if (!isOpen) {
      setRectangles([]);
      setDragRect(null);
      dragStartPixelRef.current = null;
      setMode('navigate');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sourceColor = colorForBucket(baseRouteColor, splittingFromLetter);
  const newColor = colorForBucket(baseRouteColor, newLetter);

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-700 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="h-8 px-2 min-w-[44px] rounded-md flex items-center justify-center font-bold text-white text-xs flex-shrink-0 leading-none whitespace-nowrap"
            style={{ background: sourceColor }}
          >{routeCode}{splittingFromLetter !== 'a' ? splittingFromLetter : ''}</div>
          <span className="text-gray-500 text-sm font-bold">→</span>
          <div
            className="h-8 px-2 min-w-[44px] rounded-md flex items-center justify-center font-bold text-white text-xs flex-shrink-0 leading-none whitespace-nowrap"
            style={{ background: newColor }}
          >{routeCode}{newLetter}</div>
          <div className="text-white text-sm font-bold">Split bucket</div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Mode toggle: swaps icon+label between Draw (currently navigating)
              and Move (currently drawing). The active mode is highlighted. */}
          <button
            onClick={() => setMode(m => m === 'navigate' ? 'draw' : 'navigate')}
            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors ${
              mode === 'draw'
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
            title={mode === 'navigate' ? 'Switch to drawing mode' : 'Switch to navigate mode (pinch/pan/rotate)'}
          >
            {mode === 'navigate' ? <><Pencil size={12} />Draw</> : <><Move size={12} />Move map</>}
          </button>
          <button
            onClick={handleUndo}
            disabled={rectangles.length === 0}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors"
          ><Undo2 size={12} />Undo</button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded-md flex items-center gap-1.5"
          ><X size={12} />Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={rectangles.length === 0}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-500 text-white text-xs font-bold rounded-md flex items-center gap-1.5 transition-colors"
          ><Check size={12} />Confirm</button>
        </div>
      </div>

      {/* Sub-header: counts + mode-aware instruction */}
      <div className="flex-shrink-0 bg-gray-900/80 border-b border-gray-800 px-4 py-2 text-xs text-gray-300 flex items-center gap-4 flex-wrap">
        <span>
          <span className="font-bold" style={{ color: sourceColor }}>
            {routeCode}{splittingFromLetter !== 'a' ? splittingFromLetter : ''}
          </span>:{' '}
          {headerCounts.sourcePiecesAfter} pieces (was {headerCounts.sourcePiecesBefore}),{' '}
          {headerCounts.sourceBookingsAfter} prebooks (was {headerCounts.sourceBookingsBefore})
        </span>
        <span className="text-gray-600">·</span>
        <span>
          <span className="font-bold" style={{ color: newColor }}>
            {routeCode}{newLetter}
          </span>:{' '}
          {headerCounts.newPieces} pieces,{' '}
          {headerCounts.newBookings} prebooks
        </span>
        <span className="text-gray-500 ml-auto">
          {mode === 'navigate' ? (
            <>Pinch to zoom, two-finger twist to rotate, drag to pan. Tap <span className="font-bold text-amber-300">Draw</span> when ready to select streets.</>
          ) : (
            <>Drag to select streets you want in <span className="font-bold" style={{ color: newColor }}>{newLetter}</span>. Draw more rectangles to add. Tap <span className="font-bold text-blue-300">Move map</span> to pinch/rotate.</>
          )}
        </span>
      </div>

      {/* Map area with pointer overlay.
          In 'navigate' mode the overlay is transparent to pointer events
          (pointer-events: none) so Mapbox's own touch handlers receive the
          gestures. In 'draw' mode it captures pointers with touch-action: none
          so the browser doesn't try to scroll/pinch-zoom the page during a
          single-finger drag. */}
      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        <div
          className={`absolute inset-0 ${mode === 'draw' ? 'cursor-crosshair' : 'pointer-events-none'}`}
          style={{ touchAction: mode === 'draw' ? 'none' : 'auto' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
};

export default RouteSplitModal;

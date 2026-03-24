// src/components/RouteFinder/RouteFinderView.tsx
//
// Map-based Route Finder — scans aeration + sealing call books.
// Flow:
//   1. Auth       — Connect to Google
//   2. Setup      — Pick route prefix + enter aeration/sealing spreadsheet IDs
//   3. Scanning   — Read all tabs from both books, geocode, proximity match
//   4. Working    — Mapbox map with route lines + customer pins
//   5. Complete   — All done screen
//
// Pin colours:
//   Grey   — correct route (proximity confirms)
//   Orange — proximity suggests a different route
//   Green  — fixed this session
//   Red    — geocoded but no approved route nearby
//   (geocode failures live in sidebar only — no pin)
//
// Select Area: draw a bounding box on the map to mass-fix orange pins inside.
// Unresolvable sidebar: fuzzy street suggestions + manual address edit + retry geocode.
// Red pin confirm: writes customer city to route code column.
//

import React, { useState, useEffect, useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, MapPin, CheckCircle, Loader, RefreshCw,
  Search, X, AlertCircle, Navigation, Square, Edit2, Zap,
} from 'lucide-react';

import { routeFinderSheetsService } from '../../lib/routeFinder/routeFinderSheetsService';
import {
  routeFinderSessionService,
  RouteFinderSession,
  FixLogEntry,
} from '../../lib/routeFinder/routeFinderSessionService';
import {
  loadApprovedRoutes,
  getAvailablePrefixes,
  findClosestRoute,
  distanceToRoute,
  geocodeAddress,
  normalizePhone,
  getCustomerBoundingBox,
  fuzzyMatchSegmentName,
  MAX_ROUTE_DISTANCE_DEG,
  SAME_ROUTE_TOLERANCE_DEG,
  ApprovedRoute,
  GeoCustomer,
  CustomerRow,
  SegmentSuggestion,
} from '../../lib/routeFinder/routeFinderGeoService';

(mapboxgl as any).accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Phase = 'auth' | 'setup' | 'scanning' | 'working' | 'complete';

interface DrawRect { x: number; y: number; w: number; h: number; }

interface Props {
  onBack: () => void;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PIN_COLORS = {
  grey:   '#6B7280',
  orange: '#F97316',
  green:  '#22C55E',
  red:    '#EF4444',
};

// Convert 0-based column index to sheet letter (e.g. 0→A, 25→Z, 26→AA)
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

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

const RouteFinderView: React.FC<Props> = ({ onBack }) => {
  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('auth');

  // ── Setup ──────────────────────────────────────────────────────────────────
  const [aerationInput, setAerationInput] = useState(
    () => localStorage.getItem('rf_aeration_id') || ''
  );
  const [sealingInput, setSealingInput] = useState(
    () => localStorage.getItem('rf_sealing_id') || ''
  );
  const [sessionKey, setSessionKey] = useState('');
  const [selectedPrefix, setSelectedPrefix] = useState('');
  const [availablePrefixes, setAvailablePrefixes] = useState<string[]>([]);
  const [approvedRoutes, setApprovedRoutes] = useState<ApprovedRoute[]>([]);
  const [prefixesLoading, setPrefixesLoading] = useState(false);

  // ── Working ────────────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<GeoCustomer[]>([]);
  const [session, setSession] = useState<RouteFinderSession | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [customerBoundingBox, setCustomerBoundingBox] = useState<ReturnType<typeof getCustomerBoundingBox>>(null);

  // ── Street standardization (post-scan grey writes) ───────────────────────
  const [standardizeProgress, setStandardizeProgress] = useState<{ current: number; total: number } | null>(null);

  // ── Box selection ──────────────────────────────────────────────────────────
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [drawRect, setDrawRect] = useState<DrawRect | null>(null);
  const [boxSelectedIds, setBoxSelectedIds] = useState<Set<string>>(new Set());

  // ── Scanning ───────────────────────────────────────────────────────────────
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, message: '' });

  // ── Map ────────────────────────────────────────────────────────────────────
  const [mapLoaded, setMapLoaded] = useState(false);

  // ── General ────────────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const isMouseDownRef = useRef(false);

  // ─── Check auth on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (routeFinderSheetsService.isAuthenticated()) setPhase('setup');
    else setPhase('auth');
  }, []);

  // ─── Load approved routes when entering setup ─────────────────────────────
  useEffect(() => {
    if (phase !== 'setup') return;
    setPrefixesLoading(true);
    setError(null);
    loadApprovedRoutes()
      .then(routes => {
        setApprovedRoutes(routes);
        const prefixes = getAvailablePrefixes(routes);
        setAvailablePrefixes(prefixes);
        if (prefixes.length > 0 && !selectedPrefix) setSelectedPrefix(prefixes[0]);
      })
      .catch(e => setError(e?.message || 'Failed to load route data.'))
      .finally(() => setPrefixesLoading(false));
  }, [phase]);

  // ─── Initialize Mapbox once on mount ─────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-79.870, 43.270],
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      map.resize();
      setMapLoaded(true);
    });

    map.on('click', 'customer-pins', e => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      if (!props) return;
      if (props.pinColor !== 'orange' && props.pinColor !== 'red') return;
      setSelectedCustomerId(props.id);
    });

    map.on('mousemove', 'customer-pins', e => {
      if (!e.features || e.features.length === 0) return;
      const pinColor = e.features[0].properties?.pinColor;
      map.getCanvas().style.cursor =
        pinColor === 'orange' || pinColor === 'red' ? 'pointer' : '';
    });

    map.on('mouseleave', 'customer-pins', () => {
      map.getCanvas().style.cursor = '';
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMapLoaded(false);
      }
    };
  }, []);

  // ─── Resize map when working phase becomes visible ────────────────────────
  useEffect(() => {
    if (phase !== 'working') return;
    const t = setTimeout(() => { if (mapRef.current) mapRef.current.resize(); }, 50);
    return () => clearTimeout(t);
  }, [phase]);

  // ─── Draw approved route lines once map is loaded ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || approvedRoutes.length === 0) return;

    approvedRoutes.forEach(route => {
      if (!route.segments || route.segments.length === 0) return;
      const sourceId = `rf-route-src-${route.id}`;
      const lineId   = `rf-route-line-${route.id}`;
      const labelId  = `rf-route-label-${route.id}`;

      if (map.getLayer(labelId)) map.removeLayer(labelId);
      if (map.getLayer(lineId))  map.removeLayer(lineId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      const features: GeoJSON.Feature[] = route.segments.map(seg => ({
        type: 'Feature',
        properties: { route_code: route.route_code },
        geometry: { type: 'LineString', coordinates: seg.coordinates },
      }));

      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });

      map.addLayer({
        id: lineId, type: 'line', source: sourceId,
        paint: { 'line-color': route.route_color, 'line-width': 3, 'line-opacity': 0.5 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });

      map.addLayer({
        id: labelId, type: 'symbol', source: sourceId,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 200,
          'text-field': route.route_code,
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': 11, 'text-keep-upright': true,
        },
        paint: {
          'text-color': route.route_color,
          'text-halo-color': '#000000', 'text-halo-width': 1.5,
        },
      });
    });
  }, [mapLoaded, approvedRoutes]);

  // ─── Draw / update customer pins ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const features: GeoJSON.Feature[] = customers
      .filter(c => c.lat !== null && c.lng !== null && !c.geocodeFailed)
      .map(c => ({
        type: 'Feature',
        properties: {
          id:        c.id,
          pinColor:  c.pinColor,
          color:     PIN_COLORS[c.pinColor] ?? PIN_COLORS.grey,
          name:      [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
          route:     c.currentRouteCode,
          suggested: c.suggestedRouteCode,
        },
        geometry: { type: 'Point', coordinates: [c.lng!, c.lat!] },
      }));

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    if (map.getSource('customer-pins')) {
      (map.getSource('customer-pins') as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource('customer-pins', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'customer-pins', type: 'circle', source: 'customer-pins',
        paint: {
          'circle-color':        ['get', 'color'],
          'circle-radius':       ['case', ['==', ['get', 'pinColor'], 'grey'], 4, 6],
          'circle-stroke-width': ['case', ['==', ['get', 'pinColor'], 'grey'], 1, 2],
          'circle-stroke-color': '#111827',
          'circle-opacity':      ['case', ['==', ['get', 'pinColor'], 'grey'], 0.5, 1],
        },
      });

      // Fit to densest cluster on first load
      const allCoords = features.map(
        f => (f.geometry as GeoJSON.Point).coordinates as [number, number]
      );
      if (allCoords.length > 0) {
        const NEIGHBOUR_RADIUS = 0.015;
        const FIT_RADIUS = 0.025;
        let bestIdx = 0, bestCount = 0;
        for (let i = 0; i < allCoords.length; i++) {
          const [lngA, latA] = allCoords[i];
          let count = 0;
          for (let j = 0; j < allCoords.length; j++) {
            if (i === j) continue;
            const [lngB, latB] = allCoords[j];
            if (Math.abs(lngA - lngB) < NEIGHBOUR_RADIUS && Math.abs(latA - latB) < NEIGHBOUR_RADIUS) count++;
          }
          if (count > bestCount) { bestCount = count; bestIdx = i; }
        }
        const [cLng, cLat] = allCoords[bestIdx];
        const clusterCoords = allCoords.filter(([lng, lat]) =>
          Math.abs(lng - cLng) < FIT_RADIUS && Math.abs(lat - cLat) < FIT_RADIUS
        );
        const boundsCoords = clusterCoords.length > 0 ? clusterCoords : allCoords;
        const bounds = boundsCoords.reduce(
          (b, c) => b.extend(c as mapboxgl.LngLatLike),
          new mapboxgl.LngLatBounds(boundsCoords[0] as mapboxgl.LngLatLike, boundsCoords[0] as mapboxgl.LngLatLike)
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
      }
    }
  }, [mapLoaded, customers]);

  // ─── Disable/enable map interactions while drawing ────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (isDrawingBox) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
    } else {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.doubleClickZoom.enable();
    }
  }, [isDrawingBox, mapLoaded]);

  // ─── Global mouse listeners for box drawing ───────────────────────────────
  useEffect(() => {
    if (!isDrawingBox) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current || !drawStartRef.current || !mapContainerRef.current) return;
      const rect = mapContainerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      const { x: sx, y: sy } = drawStartRef.current;
      setDrawRect({ x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) });
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (!isMouseDownRef.current || !mapRef.current || !mapContainerRef.current) return;
      isMouseDownRef.current = false;
      setIsDrawingBox(false);

      const start = drawStartRef.current;
      if (!start) return;

      const rect = mapContainerRef.current.getBoundingClientRect();
      const endX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const endY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

      if (Math.abs(endX - start.x) < 5 || Math.abs(endY - start.y) < 5) {
        setDrawRect(null);
        return;
      }

      const sw = mapRef.current.unproject([Math.min(start.x, endX), Math.max(start.y, endY)]);
      const ne = mapRef.current.unproject([Math.max(start.x, endX), Math.min(start.y, endY)]);

      const selected = new Set<string>();
      for (const c of customers) {
        if (c.pinColor !== 'orange' || c.lat === null || c.lng === null) continue;
        if (c.lng >= sw.lng && c.lng <= ne.lng && c.lat >= sw.lat && c.lat <= ne.lat) {
          selected.add(c.id);
        }
      }
      setBoxSelectedIds(selected);
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDrawingBox, customers]);

  // ─── Toast helper ─────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ─── Clear box selection ──────────────────────────────────────────────────
  const clearBoxSelection = useCallback(() => {
    setBoxSelectedIds(new Set());
    setDrawRect(null);
    drawStartRef.current = null;
    isMouseDownRef.current = false;
  }, []);

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const ok = await routeFinderSheetsService.authenticate();
      if (ok) setPhase('setup');
      else setError('Failed to connect. Please try again.');
    } catch (e: any) {
      setError(e?.message || 'Auth failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // ─── SCAN ─────────────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    const resolveId = (raw: string): string => {
      const match = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return match ? match[1] : raw.trim();
    };

    const resolvedAerationId = aerationInput.trim() ? resolveId(aerationInput) : '';
    const resolvedSealingId  = sealingInput.trim()  ? resolveId(sealingInput)  : '';

    if (!resolvedAerationId && !resolvedSealingId) {
      setError('Please enter at least one spreadsheet ID or URL.');
      return;
    }
    if (!selectedPrefix) { setError('Please select a route prefix.'); return; }

    setError(null);
    setPhase('scanning');

    if (resolvedAerationId) localStorage.setItem('rf_aeration_id', resolvedAerationId);
    if (resolvedSealingId)  localStorage.setItem('rf_sealing_id',  resolvedSealingId);

    const combinedKey = [resolvedAerationId, resolvedSealingId].filter(Boolean).join('::');
    setSessionKey(combinedKey);

    const books = [
      resolvedAerationId ? { id: resolvedAerationId, label: 'Aeration' } : null,
      resolvedSealingId  ? { id: resolvedSealingId,  label: 'Sealing'  } : null,
    ].filter(Boolean) as { id: string; label: string }[];

    try {
      // Validate all books
      for (const book of books) {
        setScanProgress({ current: 0, total: 0, message: `Validating ${book.label} book...` });
        const validation = await routeFinderSheetsService.validateSpreadsheet(book.id);
        if (!validation.valid) {
          setError(`${book.label}: ${validation.error || 'Cannot access spreadsheet.'}`);
          setPhase('setup');
          return;
        }
      }

      // Load or create session
      setScanProgress({ current: 0, total: 0, message: 'Checking existing session...' });
      const existingSession = await routeFinderSessionService.loadSession(combinedKey);

      // Scan all books and build merged customer map
      const customerMap = new Map<string, GeoCustomer>();

      for (const book of books) {
        setScanProgress({ current: 0, total: 0, message: `Discovering ${book.label} tabs...` });
        const tabNames = await routeFinderSheetsService.getCallBookTabs(book.id);

        const loadedSheets = await routeFinderSheetsService.readCallBookSheets(
          book.id,
          tabNames,
          (current, total, sheetName) =>
            setScanProgress({ current, total, message: `Reading ${book.label}: ${sheetName}...` })
        );

        setScanProgress({ current: 0, total: 0, message: `Building ${book.label} customer groups...` });

        for (const sheet of loadedSheets) {
          const { CI, rows, sheetName } = sheet;

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row[0]) continue;

            const routeCode = CI.routeCode >= 0
              ? String(row[CI.routeCode] ?? '').trim().toUpperCase()
              : '';
            const routePrefix = routeCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
            if (routePrefix !== selectedPrefix) continue;

            // Combine area code + phone for sealing sheets (separate columns)
            const rawPhone   = CI.phone >= 0    ? String(row[CI.phone] ?? '').trim()  : '';
            const rawArea    = CI.areaCode >= 0 ? String(row[CI.areaCode] ?? '').trim() : '';
            const combinedDigits = (rawArea.replace(/\D/g, '') + rawPhone.replace(/\D/g, '')).slice(-10);
            const phone      = combinedDigits.length === 10 ? combinedDigits : normalizePhone(rawPhone);
            const houseNum   = CI.houseNum >= 0   ? String(row[CI.houseNum] ?? '').trim()           : '';
            const streetName = CI.streetName >= 0 ? String(row[CI.streetName] ?? '').trim()         : '';
            const city       = CI.city >= 0       ? String(row[CI.city] ?? '').trim()               : '';
            const firstName  = CI.firstName >= 0  ? String(row[CI.firstName] ?? '').trim()          : '';
            const lastName   = CI.lastName >= 0   ? String(row[CI.lastName] ?? '').trim()           : '';
            const bookingId  = CI.bookingId >= 0  ? String(row[CI.bookingId] ?? '').trim()          : '';
            const year       = CI.year >= 0       ? (parseInt(String(row[CI.year] ?? ''), 10) || 0) : 0;

            if (!phone && !houseNum && !streetName) continue;

            const groupKey = phone
              ? phone
              : `${houseNum}|${streetName.toLowerCase()}|${city.toLowerCase()}`;

            const customerRow: CustomerRow = {
              spreadsheetId:  book.id,
              sheetName,
              sheetRowNumber: i + CI.headerRowIndex + 2,
              routeCodeCol:   CI.routeCode,
              streetNameCol:  CI.streetName,
              bookingId,
              year,
            };

            if (customerMap.has(groupKey)) {
              const existing = customerMap.get(groupKey)!;
              existing.rows.push(customerRow);
              if (year > 0) {
                const existingMaxYear = Math.max(...existing.rows.map(r => r.year));
                if (year >= existingMaxYear) {
                  if (firstName)  existing.firstName  = firstName;
                  if (lastName)   existing.lastName   = lastName;
                  if (houseNum)   existing.houseNum   = houseNum;
                  if (streetName) existing.streetName = streetName;
                  if (city)       existing.city       = city;
                  existing.currentRouteCode = routeCode;
                }
              }
            } else {
              customerMap.set(groupKey, {
                id: groupKey,
                rows: [customerRow],
                phone, firstName, lastName, houseNum, streetName, city,
                currentRouteCode: routeCode,
                lat: null, lng: null,
                geocodeFailed: false,
                pinColor: 'grey',
                suggestedRouteCode: routeCode,
                suggestedSegmentName: '',
                distanceDeg: 0,
                noRouteFound: false,
              });
            }
          }
        }
      }

      const allCustomers = Array.from(customerMap.values());
      let activeSession: RouteFinderSession;

      if (existingSession) {
        const dismissedSet = new Set(existingSession.fixLog.map(e => e.rowId));
        for (const c of allCustomers) {
          if (dismissedSet.has(c.id)) c.pinColor = 'green';
        }
        activeSession = existingSession;
      } else {
        activeSession = await routeFinderSessionService.createSession(
          combinedKey, [], allCustomers.length
        );
      }

      setSession(activeSession);

      // Geocode each unique customer
      const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
      const geocodedCustomers: GeoCustomer[] = [];

      // Build a running bounding box as we geocode — used for in-loop fuzzy retry
      let runningBbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null = null;

      // Collect grey customers needing street name standardization — written after scan
      const greyStandardizeQueue: { customer: GeoCustomer; newStreetName: string }[] = [];

      for (let i = 0; i < allCustomers.length; i++) {
        const customer = allCustomers[i];

        if (customer.pinColor === 'green') {
          geocodedCustomers.push(customer);
          continue;
        }

        setScanProgress({
          current: i + 1,
          total: allCustomers.length,
          message: `Geocoding ${i + 1} of ${allCustomers.length}...`,
        });

        const geoResult = await geocodeAddress(
          customer.houseNum, customer.streetName, customer.city, token
        );

        if (geoResult) {
          customer.lat = geoResult.lat;
          customer.lng = geoResult.lng;

          // Expand running bounding box
          if (!runningBbox) {
            runningBbox = { minLat: geoResult.lat, maxLat: geoResult.lat, minLng: geoResult.lng, maxLng: geoResult.lng };
          } else {
            runningBbox.minLat = Math.min(runningBbox.minLat, geoResult.lat);
            runningBbox.maxLat = Math.max(runningBbox.maxLat, geoResult.lat);
            runningBbox.minLng = Math.min(runningBbox.minLng, geoResult.lng);
            runningBbox.maxLng = Math.max(runningBbox.maxLng, geoResult.lng);
          }

          const match = findClosestRoute(geoResult.lat, geoResult.lng, approvedRoutes);

          if (match && match.distanceDeg <= MAX_ROUTE_DISTANCE_DEG) {
            customer.suggestedRouteCode   = match.routeCode;
            customer.suggestedSegmentName = match.segmentName;
            customer.distanceDeg          = match.distanceDeg;

            if (match.routeCode === customer.currentRouteCode) {
              customer.pinColor = 'grey';
            } else {
              const assignedDist = distanceToRoute(
                geoResult.lat, geoResult.lng, customer.currentRouteCode, approvedRoutes
              );
              customer.pinColor =
                assignedDist - match.distanceDeg < SAME_ROUTE_TOLERANCE_DEG ? 'grey' : 'orange';
            }

            // Queue grey street name standardization if segment name differs from sheet value
            if (
              customer.pinColor === 'grey' &&
              match.segmentName &&
              match.segmentName.trim().toLowerCase() !== customer.streetName.trim().toLowerCase()
            ) {
              greyStandardizeQueue.push({ customer, newStreetName: match.segmentName.trim() });
            }
          } else {
            // No route found — try fuzzy street correction before giving up.
            // Use the customer's real coords + running bbox to find geographically close segments.
            if (runningBbox) {
              const suggestions = fuzzyMatchSegmentName(
                customer.streetName, approvedRoutes, runningBbox,
                0.02, geoResult.lat, geoResult.lng
              );
              const best = suggestions.find(s => s.score >= 1.0) ?? suggestions[0];

              if (best && best.score >= 0.7 && best.segmentName.toLowerCase() !== customer.streetName.toLowerCase()) {
                // Re-geocode with the corrected street name
                setScanProgress({
                  current: i + 1,
                  total: allCustomers.length,
                  message: `Retrying ${i + 1} of ${allCustomers.length} with "${best.segmentName}"...`,
                });

                const retryResult = await geocodeAddress(
                  customer.houseNum, best.segmentName, customer.city, token
                );

                if (retryResult) {
                  const retryMatch = findClosestRoute(retryResult.lat, retryResult.lng, approvedRoutes);
                  if (retryMatch && retryMatch.distanceDeg <= MAX_ROUTE_DISTANCE_DEG) {
                    // Retry succeeded — use the corrected geocode
                    customer.lat = retryResult.lat;
                    customer.lng = retryResult.lng;
                    customer.streetName = best.segmentName; // update display name
                    customer.suggestedRouteCode   = retryMatch.routeCode;
                    customer.suggestedSegmentName = retryMatch.segmentName;
                    customer.distanceDeg          = retryMatch.distanceDeg;

                    if (retryMatch.routeCode === customer.currentRouteCode) {
                      customer.pinColor = 'grey';
                    } else {
                      const assignedDist = distanceToRoute(
                        retryResult.lat, retryResult.lng, customer.currentRouteCode, approvedRoutes
                      );
                      customer.pinColor =
                        assignedDist - retryMatch.distanceDeg < SAME_ROUTE_TOLERANCE_DEG ? 'grey' : 'orange';
                    }
                  } else {
                    customer.noRouteFound = true;
                    customer.pinColor = 'red';
                  }
                } else {
                  customer.noRouteFound = true;
                  customer.pinColor = 'red';
                }
              } else {
                customer.noRouteFound = true;
                customer.pinColor = 'red';
              }
            } else {
              customer.noRouteFound = true;
              customer.pinColor = 'red';
            }
          }
        } else {
          customer.geocodeFailed = true;
        }

        geocodedCustomers.push(customer);

        if (i % 25 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      const bbox = getCustomerBoundingBox(geocodedCustomers);
      setCustomerBoundingBox(bbox);
      setCustomers(geocodedCustomers);

      const hasIssues = geocodedCustomers.some(c => c.pinColor === 'orange');
      setPhase(hasIssues ? 'working' : 'complete');

      // ── Post-scan: standardize grey street names ──────────────────────────
      // Group ALL rows for ALL grey customers by spreadsheetId, then fire ONE
      // batchUpdate per spreadsheet. Google counts each batchUpdate as a single
      // write quota unit regardless of how many ranges it contains — so this
      // goes from potentially hundreds of quota hits down to just 1-2 total.
      if (greyStandardizeQueue.length > 0) {
        // Build range map: spreadsheetId → list of {range, values} updates
        const bySpreadsheet = new Map<string, { range: string; values: any[][] }[]>();

        for (const { customer, newStreetName } of greyStandardizeQueue) {
          for (const row of customer.rows) {
            if (row.streetNameCol < 0) continue;
            const col = columnIndexToLetter(row.streetNameCol);
            const range = `'${row.sheetName}'!${col}${row.sheetRowNumber}`;
            if (!bySpreadsheet.has(row.spreadsheetId)) {
              bySpreadsheet.set(row.spreadsheetId, []);
            }
            bySpreadsheet.get(row.spreadsheetId)!.push({
              range,
              values: [[newStreetName]],
            });
          }
        }

        const spreadsheetIds = Array.from(bySpreadsheet.keys());
        setStandardizeProgress({ current: 0, total: spreadsheetIds.length });

        for (let i = 0; i < spreadsheetIds.length; i++) {
          const spreadsheetId = spreadsheetIds[i];
          const updates = bySpreadsheet.get(spreadsheetId)!;
          setStandardizeProgress({ current: i + 1, total: spreadsheetIds.length });

          // Chunk at 500 ranges — well within Sheets API payload limits
          for (let c = 0; c < updates.length; c += 500) {
            const chunk = updates.slice(c, c + 500);
            try {
              await routeFinderSheetsService.applyBatchStreetWrites(spreadsheetId, chunk);
            } catch (e) {
              console.warn('RF: grey street standardize failed:', e);
            }
            // If there are multiple chunks for same spreadsheet, pause 2s between them
            if (c + 500 < updates.length) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }

          // Pause 2s between spreadsheets
          if (i + 1 < spreadsheetIds.length) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        setStandardizeProgress(null);
      }

    } catch (e: any) {
      console.error('Route Finder scan failed:', e);
      setError(e?.message || 'Scan failed. Please try again.');
      setPhase('setup');
    }
  };

  // ─── CONFIRM FIX (orange) ─────────────────────────────────────────────────
  const handleConfirm = useCallback(async (
    customer: GeoCustomer,
    newRouteCode: string,
    newStreetName: string
  ) => {
    if (!session) return;
    setApplying(true);
    setError(null);

    try {
      for (const row of customer.rows) {
        await routeFinderSheetsService.applyFix(
          row.spreadsheetId,
          row.sheetName,
          row.sheetRowNumber,
          row.routeCodeCol,
          row.streetNameCol,
          newRouteCode,
          newStreetName,
        );
      }

      const logEntry: FixLogEntry = {
        rowId:         customer.id,
        bookingId:     customer.rows[0]?.bookingId || customer.id,
        sheetName:     customer.rows[0]?.sheetName || '',
        oldRouteCode:  customer.currentRouteCode,
        newRouteCode,
        oldStreetName: customer.streetName,
        newStreetName,
        cascadeCount:  customer.rows.length - 1,
        timestamp:     new Date().toISOString(),
        type:          'fix',
      };

      const { newFixedRows } = await routeFinderSessionService.markRowFixed({
        sessionId:          session.id,
        rowId:              customer.id,
        logEntry,
        currentFixedRows:   session.fixedRows,
        cascadeResolvedIds: [],
      });

      setCustomers(prev => prev.map(c =>
        c.id === customer.id
          ? { ...c, pinColor: 'green', currentRouteCode: newRouteCode }
          : c
      ));
      setSession(prev => prev ? { ...prev, fixedRows: newFixedRows } : null);
      setSelectedCustomerId(null);

      showToast(customer.rows.length > 1
        ? `Fixed — updated ${customer.rows.length} rows.`
        : 'Fixed.'
      );

      const remaining = customers.filter(c => c.id !== customer.id && c.pinColor === 'orange');
      if (remaining.length === 0) setTimeout(() => setPhase('complete'), 800);

    } catch (e: any) {
      setError('Fix failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  }, [session, customers, showToast]);

  // ─── CONFIRM CITY (red pins) ──────────────────────────────────────────────
  const handleConfirmCity = useCallback(async (customer: GeoCustomer) => {
    if (!session) return;
    const cityValue = customer.city.trim();
    setApplying(true);
    setError(null);

    try {
      if (cityValue) {
        for (const row of customer.rows) {
          // Pass -1 for streetNameCol so applyFix skips it
          await routeFinderSheetsService.applyFix(
            row.spreadsheetId,
            row.sheetName,
            row.sheetRowNumber,
            row.routeCodeCol,
            -1,
            cityValue,
            '',
          );
        }
      }

      const logEntry: FixLogEntry = {
        rowId:         customer.id,
        bookingId:     customer.rows[0]?.bookingId || customer.id,
        sheetName:     customer.rows[0]?.sheetName || '',
        oldRouteCode:  customer.currentRouteCode,
        newRouteCode:  cityValue || customer.currentRouteCode,
        oldStreetName: customer.streetName,
        newStreetName: customer.streetName,
        cascadeCount:  0,
        timestamp:     new Date().toISOString(),
        type:          'fix',
      };

      const { newFixedRows } = await routeFinderSessionService.markRowFixed({
        sessionId:          session.id,
        rowId:              customer.id,
        logEntry,
        currentFixedRows:   session.fixedRows,
        cascadeResolvedIds: [],
      });

      setCustomers(prev => prev.map(c =>
        c.id === customer.id ? { ...c, pinColor: 'green' } : c
      ));
      setSession(prev => prev ? { ...prev, fixedRows: newFixedRows } : null);
      setSelectedCustomerId(null);
      showToast(cityValue ? `Route code set to "${cityValue}".` : 'Marked as handled.');

    } catch (e: any) {
      setError('Fix failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  }, [session, showToast]);

  const handleSkip = useCallback(() => setSelectedCustomerId(null), []);

  // ─── FIX ALL ──────────────────────────────────────────────────────────────
  const handleFixAll = useCallback(async () => {
    if (!session) return;

    const toFix = customers.filter(
      c => c.pinColor === 'orange' && !c.noRouteFound && !c.geocodeFailed
    );
    if (toFix.length === 0) return;

    if (!window.confirm(
      `Fix all ${toFix.length} flagged customers using their suggested routes?\n\nThis will update every year of service history for each customer.`
    )) return;

    setApplying(true);
    setError(null);
    setSelectedCustomerId(null);

    let fixedCount = 0;
    let currentFixedRows = session.fixedRows;

    for (const customer of toFix) {
      try {
        for (const row of customer.rows) {
          await routeFinderSheetsService.applyFix(
            row.spreadsheetId, row.sheetName, row.sheetRowNumber,
            row.routeCodeCol, row.streetNameCol,
            customer.suggestedRouteCode,
            customer.suggestedSegmentName || customer.streetName,
          );
        }

        const logEntry: FixLogEntry = {
          rowId:         customer.id,
          bookingId:     customer.rows[0]?.bookingId || customer.id,
          sheetName:     customer.rows[0]?.sheetName || '',
          oldRouteCode:  customer.currentRouteCode,
          newRouteCode:  customer.suggestedRouteCode,
          oldStreetName: customer.streetName,
          newStreetName: customer.suggestedSegmentName || customer.streetName,
          cascadeCount:  customer.rows.length - 1,
          timestamp:     new Date().toISOString(),
          type:          'fix',
        };

        const result = await routeFinderSessionService.markRowFixed({
          sessionId: session.id, rowId: customer.id, logEntry,
          currentFixedRows, cascadeResolvedIds: [],
        });
        currentFixedRows = result.newFixedRows;
        fixedCount++;

        setCustomers(prev => prev.map(c =>
          c.id === customer.id
            ? { ...c, pinColor: 'green', currentRouteCode: customer.suggestedRouteCode }
            : c
        ));
      } catch (e: any) {
        console.error('Fix All failed on', customer.id, e);
      }
    }

    setSession(prev => prev ? { ...prev, fixedRows: currentFixedRows } : null);
    setApplying(false);
    showToast(`Fixed ${fixedCount} customer${fixedCount === 1 ? '' : 's'}.`);

    const remaining = customers.filter(
      c => c.pinColor === 'orange' && !toFix.find(f => f.id === c.id)
    );
    if (remaining.length === 0) setTimeout(() => setPhase('complete'), 800);
  }, [session, customers, showToast]);

  // ─── FIX BOX SELECTION ────────────────────────────────────────────────────
  const handleFixBoxSelection = useCallback(async () => {
    if (!session || boxSelectedIds.size === 0) return;

    const toFix = customers.filter(
      c => boxSelectedIds.has(c.id) && c.pinColor === 'orange' && !c.noRouteFound && !c.geocodeFailed
    );
    if (toFix.length === 0) return;

    if (!window.confirm(
      `Fix ${toFix.length} selected customers using their suggested routes?\n\nThis will update every year of service history for each customer.`
    )) return;

    setApplying(true);
    setError(null);
    setSelectedCustomerId(null);

    let fixedCount = 0;
    let currentFixedRows = session.fixedRows;

    for (const customer of toFix) {
      try {
        for (const row of customer.rows) {
          await routeFinderSheetsService.applyFix(
            row.spreadsheetId, row.sheetName, row.sheetRowNumber,
            row.routeCodeCol, row.streetNameCol,
            customer.suggestedRouteCode,
            customer.suggestedSegmentName || customer.streetName,
          );
        }

        const logEntry: FixLogEntry = {
          rowId:         customer.id,
          bookingId:     customer.rows[0]?.bookingId || customer.id,
          sheetName:     customer.rows[0]?.sheetName || '',
          oldRouteCode:  customer.currentRouteCode,
          newRouteCode:  customer.suggestedRouteCode,
          oldStreetName: customer.streetName,
          newStreetName: customer.suggestedSegmentName || customer.streetName,
          cascadeCount:  customer.rows.length - 1,
          timestamp:     new Date().toISOString(),
          type:          'fix',
        };

        const result = await routeFinderSessionService.markRowFixed({
          sessionId: session.id, rowId: customer.id, logEntry,
          currentFixedRows, cascadeResolvedIds: [],
        });
        currentFixedRows = result.newFixedRows;
        fixedCount++;

        setCustomers(prev => prev.map(c =>
          c.id === customer.id
            ? { ...c, pinColor: 'green', currentRouteCode: customer.suggestedRouteCode }
            : c
        ));
      } catch (e: any) {
        console.error('Box fix failed on', customer.id, e);
      }
    }

    setSession(prev => prev ? { ...prev, fixedRows: currentFixedRows } : null);
    setApplying(false);
    showToast(`Fixed ${fixedCount} customer${fixedCount === 1 ? '' : 's'}.`);
    clearBoxSelection();

    const remaining = customers.filter(
      c => c.pinColor === 'orange' && !toFix.find(f => f.id === c.id)
    );
    if (remaining.length === 0) setTimeout(() => setPhase('complete'), 800);
  }, [session, boxSelectedIds, customers, showToast, clearBoxSelection]);

  // ─── RETRY GEOCODE ────────────────────────────────────────────────────────
  const handleRetryGeocode = useCallback(async (
    customerId: string,
    houseNum: string,
    streetName: string,
    city: string
  ) => {
    const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
    const geoResult = await geocodeAddress(houseNum, streetName, city, token);

    if (!geoResult) {
      throw new Error('Address not found. Try a different format or check spelling.');
    }

    const match = findClosestRoute(geoResult.lat, geoResult.lng, approvedRoutes);
    const customer = customers.find(c => c.id === customerId);

    let pinColor: GeoCustomer['pinColor'];
    let suggestedRouteCode   = '';
    let suggestedSegmentName = '';
    let distanceDeg          = 0;
    let noRouteFound         = false;

    if (match && match.distanceDeg <= MAX_ROUTE_DISTANCE_DEG) {
      suggestedRouteCode   = match.routeCode;
      suggestedSegmentName = match.segmentName;
      distanceDeg          = match.distanceDeg;
      const currentRC      = customer?.currentRouteCode || '';

      if (match.routeCode === currentRC) {
        pinColor = 'grey';
      } else {
        const assignedDist = distanceToRoute(geoResult.lat, geoResult.lng, currentRC, approvedRoutes);
        pinColor = assignedDist - match.distanceDeg < SAME_ROUTE_TOLERANCE_DEG ? 'grey' : 'orange';
      }
    } else {
      noRouteFound = true;
      pinColor = 'red';
    }

    setCustomers(prev => prev.map(c =>
      c.id === customerId ? {
        ...c,
        lat: geoResult.lat, lng: geoResult.lng,
        geocodeFailed: false,
        houseNum, streetName, city,
        pinColor, suggestedRouteCode, suggestedSegmentName,
        distanceDeg, noRouteFound,
      } : c
    ));

    // Update bounding box to include newly geocoded customer
    setCustomerBoundingBox(prev => {
      const newLat = geoResult.lat;
      const newLng = geoResult.lng;
      if (!prev) return { minLat: newLat, maxLat: newLat, minLng: newLng, maxLng: newLng };
      return {
        minLat: Math.min(prev.minLat, newLat),
        maxLat: Math.max(prev.maxLat, newLat),
        minLng: Math.min(prev.minLng, newLng),
        maxLng: Math.max(prev.maxLng, newLng),
      };
    });

    // Street name correction is written when the user confirms the orange/grey fix.
    // No silent write here — avoids quota flooding.
  }, [approvedRoutes, customers]);

  // ─── DRAW BOX mouse down ──────────────────────────────────────────────────
  const handleDrawMouseDown = useCallback((e: React.MouseEvent) => {
    if (!mapContainerRef.current) return;
    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    drawStartRef.current = { x, y };
    isMouseDownRef.current = true;
    setDrawRect({ x, y, w: 0, h: 0 });
  }, []);

  // ─── DERIVED VALUES ───────────────────────────────────────────────────────
  const selectedCustomer = selectedCustomerId
    ? customers.find(c => c.id === selectedCustomerId) ?? null
    : null;

  const geocodeFailedCustomers = customers.filter(c => c.geocodeFailed);
  const noRouteFoundCustomers  = customers.filter(c => c.noRouteFound && !c.geocodeFailed);
  const orangeCount = customers.filter(c => c.pinColor === 'orange').length;
  const greyCount   = customers.filter(c => c.pinColor === 'grey').length;
  const greenCount  = customers.filter(c => c.pinColor === 'green').length;
  const redCount    = customers.filter(c => c.pinColor === 'red').length;

  // ─── PHASE: AUTH ─────────────────────────────────────────────────────────
  const renderAuth = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center border border-gray-700">
        <MapPin className="text-blue-400" size={32} />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-white mb-1">Route Finder</h2>
        <p className="text-gray-400 text-sm">Connect to Google to access your call books</p>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        onClick={handleConnect}
        disabled={isAuthenticating}
        className="flex items-center gap-3 bg-white hover:bg-gray-100 text-gray-800 px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {isAuthenticating ? (
          <Loader className="animate-spin" size={20} />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        )}
        Connect to Google
      </button>
    </div>
  );

  // ─── PHASE: SETUP ────────────────────────────────────────────────────────
  const renderSetup = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 max-w-lg mx-auto">
      <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center border border-gray-700">
        <Navigation className="text-blue-400" size={32} />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-white mb-1">Map-Based Route Finder</h2>
        <p className="text-gray-400 text-sm">
          Pick a prefix, add one or both call books — customers will be geocoded and plotted on the map
        </p>
      </div>

      <div className="w-full space-y-5">
        {/* Prefix selector */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Route Prefix</label>
          {prefixesLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
              <Loader className="animate-spin" size={14} /> Loading approved routes...
            </div>
          ) : availablePrefixes.length === 0 ? (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 text-yellow-400 text-sm flex items-center gap-2">
              <AlertCircle size={15} />
              No approved routes found. Use Map Builder to create and approve routes first.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availablePrefixes.map(prefix => (
                <button
                  key={prefix}
                  onClick={() => setSelectedPrefix(prefix)}
                  className={`px-4 py-2 rounded-lg border font-mono font-bold text-sm transition-colors ${
                    selectedPrefix === prefix
                      ? 'bg-blue-700 border-blue-500 text-white shadow'
                      : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'
                  }`}
                >
                  {prefix}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Aeration book */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Aeration Call Book
            <span className="text-gray-500 font-normal ml-2 text-xs">optional</span>
          </label>
          <input
            type="text"
            value={aerationInput}
            onChange={e => setAerationInput(e.target.value)}
            placeholder="Paste Google Sheets URL or spreadsheet ID"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500"
          />
        </div>

        {/* Sealing book */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Sealing Call Book
            <span className="text-gray-500 font-normal ml-2 text-xs">optional</span>
          </label>
          <input
            type="text"
            value={sealingInput}
            onChange={e => setSealingInput(e.target.value)}
            placeholder="Paste Google Sheets URL or spreadsheet ID"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500"
          />
          <p className="text-xs text-gray-500 mt-1.5">
            All tabs in both books scanned for{' '}
            <strong className="text-gray-400">{selectedPrefix || '...'}</strong> routes.
            Customers merged across books by phone or address.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleStartScan}
          disabled={
            (!aerationInput.trim() && !sealingInput.trim()) ||
            !selectedPrefix || prefixesLoading || availablePrefixes.length === 0
          }
          className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Search size={18} />
          Scan {selectedPrefix || '...'} Routes
        </button>
      </div>
    </div>
  );

  // ─── PHASE: SCANNING ─────────────────────────────────────────────────────
  const renderScanning = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <Loader className="animate-spin text-blue-400" size={40} />
      <div className="text-center">
        <p className="text-white font-medium">{scanProgress.message || 'Preparing...'}</p>
        {scanProgress.total > 0 && (
          <p className="text-gray-400 text-sm mt-1">
            {scanProgress.current.toLocaleString()} of {scanProgress.total.toLocaleString()}
          </p>
        )}
      </div>
      {scanProgress.total > 0 && (
        <div className="w-72 bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-150"
            style={{ width: `${Math.min(100, (scanProgress.current / scanProgress.total) * 100)}%` }}
          />
        </div>
      )}
      <p className="text-xs text-gray-600 max-w-xs text-center">
        Each address is geocoded via Mapbox to determine its exact map position
      </p>
    </div>
  );

  // ─── PHASE: COMPLETE ─────────────────────────────────────────────────────
  const renderComplete = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <CheckCircle className="text-emerald-400" size={64} />
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">All Done!</h2>
        <p className="text-gray-400">
          {(session?.fixedRows || greenCount)} customers corrected on prefix{' '}
          <span className="font-mono text-white">{selectedPrefix}</span>.
        </p>
        {(geocodeFailedCustomers.length + noRouteFoundCustomers.length) > 0 && (
          <p className="text-yellow-400 text-sm mt-1">
            {geocodeFailedCustomers.length + noRouteFoundCustomers.length} customer
            {geocodeFailedCustomers.length + noRouteFoundCustomers.length === 1 ? '' : 's'}{' '}
            could not be fully resolved.
          </p>
        )}
      </div>
      <button
        onClick={() => {
          setPhase('setup');
          setCustomers([]);
          setSession(null);
          setSelectedCustomerId(null);
          setSessionKey('');
          setCustomerBoundingBox(null);
          clearBoxSelection();
        }}
        className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg transition-colors text-sm"
      >
        <RefreshCw size={15} /> Scan Another Prefix
      </button>
    </div>
  );

  // ─── PHASE: WORKING (MAP) ─────────────────────────────────────────────────
  const renderWorking = () => (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 57px)' }}>
      {/* Map area */}
      <div className="relative" style={{ flex: 1, height: '100%' }}>

        {/* Drawing overlay */}
        {isDrawingBox && (
          <div
            className="absolute inset-0 z-20 pointer-events-auto"
            style={{ cursor: 'crosshair' }}
            onMouseDown={handleDrawMouseDown}
          >
            {drawRect && drawRect.w > 3 && drawRect.h > 3 && (
              <div
                style={{
                  position: 'absolute',
                  left: drawRect.x, top: drawRect.y,
                  width: drawRect.w, height: drawRect.h,
                  border: '2px solid #F97316',
                  background: 'rgba(249, 115, 22, 0.1)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        )}

        {/* Dashed selection box after drawing */}
        {!isDrawingBox && drawRect && boxSelectedIds.size > 0 && (
          <div
            style={{
              position: 'absolute',
              left: drawRect.x, top: drawRect.y,
              width: drawRect.w, height: drawRect.h,
              border: '2px dashed #F97316',
              background: 'rgba(249, 115, 22, 0.05)',
              zIndex: 5,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Loading overlay */}
        {!mapLoaded && (
          <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center z-10">
            <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-5 py-4 border border-gray-700">
              <Loader size={18} className="animate-spin text-blue-400" />
              <span className="text-sm text-gray-300">Loading map...</span>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-gray-900/90 border border-gray-700 rounded-lg px-3 py-2.5 text-xs space-y-1.5 z-10 pointer-events-none">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: PIN_COLORS.orange }} />
            <span className="text-gray-300">{orangeCount} need review</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: PIN_COLORS.grey }} />
            <span className="text-gray-300">{greyCount} correct</span>
          </div>
          {greenCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: PIN_COLORS.green }} />
              <span className="text-gray-300">{greenCount} fixed</span>
            </div>
          )}
          {redCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: PIN_COLORS.red }} />
              <span className="text-gray-300">{redCount} no route (click to handle)</span>
            </div>
          )}
        </div>

        {/* Hint / status overlay */}
        {mapLoaded && !isDrawingBox && (
          <>
            {orangeCount > 0 && !selectedCustomer && boxSelectedIds.size === 0 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/80 border border-orange-700/50 rounded-lg px-4 py-2 text-xs text-orange-300 z-10 pointer-events-none">
                Click an orange pin to review · use Select Area to mass-fix
              </div>
            )}
          </>
        )}
        {isDrawingBox && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-orange-900/80 border border-orange-600 rounded-lg px-4 py-2 text-xs text-orange-200 z-20 pointer-events-none">
            Click and drag to draw a selection box
          </div>
        )}
      </div>

      {/* Right Panel */}
      <div className="w-80 border-l border-gray-700 bg-gray-800 flex flex-col overflow-hidden flex-shrink-0 pointer-events-auto">
        {selectedCustomer && (selectedCustomer.pinColor === 'orange' || selectedCustomer.pinColor === 'red') ? (
          <CustomerDetailPanel
            key={selectedCustomer.id}
            customer={selectedCustomer}
            applying={applying}
            error={error}
            onConfirm={handleConfirm}
            onConfirmCity={handleConfirmCity}
            onSkip={handleSkip}
          />
        ) : (
          <SidebarPanel
            prefix={selectedPrefix}
            orangeCount={orangeCount}
            greyCount={greyCount}
            greenCount={greenCount}
            redCount={redCount}
            geocodeFailedCustomers={geocodeFailedCustomers}
            noRouteFoundCustomers={noRouteFoundCustomers}
            session={session}
            applying={applying}
            boxSelectedCount={boxSelectedIds.size}
            approvedRoutes={approvedRoutes}
            customerBoundingBox={customerBoundingBox}
            onFixAll={handleFixAll}
            onFixBoxSelection={handleFixBoxSelection}
            onClearBoxSelection={clearBoxSelection}
            onRetryGeocode={handleRetryGeocode}
            standardizeProgress={standardizeProgress}
            onReset={() => {
              if (window.confirm('Re-scan from scratch? This will reset all session progress.')) {
                routeFinderSessionService.resetSession(sessionKey);
                setPhase('setup');
                setCustomers([]);
                setSession(null);
                clearBoxSelection();
                setCustomerBoundingBox(null);
              }
            }}
          />
        )}
      </div>
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="w-px h-5 bg-gray-700" />
          <Navigation size={18} className="text-blue-400" />
          <span className="font-bold text-white">Route Finder</span>
          {phase === 'working' && selectedPrefix && (
            <span className="text-xs bg-blue-900/40 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded font-mono font-bold">
              {selectedPrefix}
            </span>
          )}
        </div>

        {phase === 'working' && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {orangeCount} to fix · {greenCount} fixed
            </span>
            <button
              onClick={() => {
                if (isDrawingBox) {
                  setIsDrawingBox(false);
                  setDrawRect(null);
                } else {
                  clearBoxSelection();
                  setIsDrawingBox(true);
                }
              }}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                isDrawingBox
                  ? 'bg-orange-700/50 border-orange-600 text-orange-300'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'
              }`}
            >
              <Square size={11} />
              {isDrawingBox ? 'Cancel' : 'Select Area'}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col relative">
        {/* Map canvas — always in DOM */}
        <div
          ref={mapContainerRef}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            zIndex: phase === 'working' ? 0 : -1,
            visibility: phase === 'working' ? 'visible' : 'hidden',
          }}
        />

        {phase === 'auth'     && <div className="relative z-10 p-8 flex-1">{renderAuth()}</div>}
        {phase === 'setup'    && <div className="relative z-10 p-8 flex-1">{renderSetup()}</div>}
        {phase === 'scanning' && <div className="relative z-10 p-8 flex-1">{renderScanning()}</div>}
        {phase === 'complete' && <div className="relative z-10 p-8 flex-1">{renderComplete()}</div>}

        {phase === 'working' && (
          <div className="relative z-10 flex flex-1 overflow-hidden pointer-events-none">
            {renderWorking()}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 text-white text-sm px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2 z-50">
          <CheckCircle size={15} className="text-emerald-400 flex-shrink-0" />
          {toast}
        </div>
      )}
    </div>
  );
};

// ─── CUSTOMER DETAIL PANEL ────────────────────────────────────────────────────

interface CustomerDetailPanelProps {
  customer: GeoCustomer;
  applying: boolean;
  error: string | null;
  onConfirm: (customer: GeoCustomer, newRouteCode: string, newStreetName: string) => void;
  onConfirmCity: (customer: GeoCustomer) => void;
  onSkip: () => void;
}

const CustomerDetailPanel: React.FC<CustomerDetailPanelProps> = ({
  customer, applying, error, onConfirm, onConfirmCity, onSkip,
}) => {
  const [editRoute, setEditRoute]   = useState(customer.suggestedRouteCode);
  const [editStreet, setEditStreet] = useState(customer.streetName);
  const isRed = customer.pinColor === 'red';

  const distanceMeters = Math.round(customer.distanceDeg * 111_000);
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(
    [customer.houseNum, customer.streetName, customer.city].filter(Boolean).join(' ')
  )}`;
  const serviceHistory = [...customer.rows]
    .filter(r => r.year > 0)
    .sort((a, b) => b.year - a.year);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-start justify-between flex-shrink-0">
        <div className="min-w-0">
          <h3 className="font-bold text-white text-base truncate">
            {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown Customer'}
          </h3>
          <a
            href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-0.5"
          >
            <MapPin size={11} />
            <span className="truncate">
              {[customer.houseNum, customer.streetName, customer.city].filter(Boolean).join(', ')}
            </span>
          </a>
          {customer.phone && (
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{customer.phone}</p>
          )}
        </div>
        <button onClick={onSkip} className="text-gray-500 hover:text-white p-1 flex-shrink-0">
          <X size={15} />
        </button>
      </div>

      {isRed ? (
        /* ── Red pin: no nearby route — write city as route code ── */
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
              <p className="text-sm text-red-300 font-medium">No approved route found nearby</p>
              <p className="text-xs text-gray-500 mt-1">
                Confirming will replace the route code with the customer's city.
                Street name will not be changed.
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Current Route Code</p>
              <span className="font-mono text-red-300 bg-red-900/30 border border-red-700/50 px-2 py-1 rounded text-sm font-bold">
                {customer.currentRouteCode}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Will Be Replaced With</p>
              {customer.city ? (
                <span className="font-mono text-blue-300 bg-blue-900/30 border border-blue-700/50 px-2 py-1 rounded text-sm font-bold">
                  {customer.city}
                </span>
              ) : (
                <span className="text-xs text-gray-600 italic">No city on record — will only mark as handled</span>
              )}
            </div>
            {serviceHistory.length > 0 && (
              <div className="border-t border-gray-700 pt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Service History</p>
                <div className="space-y-1.5">
                  {serviceHistory.map((row, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 font-mono w-10">{row.year}</span>
                      <span className="text-gray-500 truncate flex-1 px-2">{row.sheetName}</span>
                      <span className="text-gray-600 font-mono">Row {row.sheetRowNumber}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2.5 text-red-400 text-xs">{error}</div>
            )}
          </div>
          <div className="p-4 border-t border-gray-700 space-y-2 flex-shrink-0">
            <button
              onClick={() => onConfirmCity(customer)}
              disabled={applying}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {applying ? <Loader size={15} className="animate-spin" /> : <CheckCircle size={15} />}
              {customer.city ? `Set Route to "${customer.city}"` : 'Mark as Handled'}
            </button>
            <button
              onClick={onSkip}
              disabled={applying}
              className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </>
      ) : (
        /* ── Orange pin: wrong route — apply suggested fix ── */
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Current Route</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-orange-300 bg-orange-900/30 border border-orange-700/50 px-2 py-1 rounded text-sm font-bold">
                  {customer.currentRouteCode}
                </span>
                <span className="text-gray-400 text-xs truncate">{customer.streetName}</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Proximity Suggests</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-blue-300 bg-blue-900/30 border border-blue-700/50 px-2 py-1 rounded text-sm font-bold">
                  {customer.suggestedRouteCode}
                </span>
                <span className="text-gray-400 text-xs truncate">{customer.suggestedSegmentName}</span>
              </div>
              <p className="text-xs text-gray-600 mt-1">{distanceMeters}m from nearest drawn segment</p>
            </div>
            <div className="border-t border-gray-700 pt-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Apply Fix</p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">New Route Code</label>
                  <input
                    type="text"
                    value={editRoute}
                    onChange={e => setEditRoute(e.target.value.toUpperCase())}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">New Street Name</label>
                  <input
                    type="text"
                    value={editStreet}
                    onChange={e => setEditStreet(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
            {serviceHistory.length > 0 && (
              <div className="border-t border-gray-700 pt-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Service History</p>
                <div className="space-y-1.5">
                  {serviceHistory.map((row, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 font-mono w-10">{row.year}</span>
                      <span className="text-gray-500 truncate flex-1 px-2">{row.sheetName}</span>
                      <span className="text-gray-600 font-mono">Row {row.sheetRowNumber}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {customer.rows.length > 1 && (
              <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-2.5 text-xs text-blue-300">
                This fix updates {customer.rows.length} rows ({customer.rows.length} years of service history)
              </div>
            )}
            {error && (
              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2.5 text-red-400 text-xs">{error}</div>
            )}
          </div>
          <div className="p-4 border-t border-gray-700 space-y-2 flex-shrink-0">
            <button
              onClick={() => onConfirm(customer, editRoute, editStreet)}
              disabled={applying || !editRoute.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {applying ? <Loader size={15} className="animate-spin" /> : <CheckCircle size={15} />}
              Confirm Fix
            </button>
            <button
              onClick={onSkip}
              disabled={applying}
              className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ─── UNRESOLVABLE CUSTOMER CARD ───────────────────────────────────────────────

interface UnresolvableCardProps {
  customer: GeoCustomer;
  approvedRoutes: ApprovedRoute[];
  customerBoundingBox: ReturnType<typeof getCustomerBoundingBox>;
  onRetryGeocode: (id: string, houseNum: string, street: string, city: string) => Promise<void>;
}

const UnresolvableCard: React.FC<UnresolvableCardProps> = ({
  customer, approvedRoutes, customerBoundingBox, onRetryGeocode,
}) => {
  const [editHouse, setEditHouse]   = useState(customer.houseNum);
  const [editStreet, setEditStreet] = useState(customer.streetName);
  const [editCity, setEditCity]     = useState(customer.city);
  const [isExpanded, setIsExpanded] = useState(false);
  const [retrying, setRetrying]     = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SegmentSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Derive reference point for geographic tiebreaking among equal-score matches:
  // - No-route-found customers already have real coords → use them
  // - Geocode-failed customers have no coords → use bounding box center
  const refLat = customer.lat ?? (customerBoundingBox
    ? (customerBoundingBox.minLat + customerBoundingBox.maxLat) / 2
    : undefined);
  const refLng = customer.lng ?? (customerBoundingBox
    ? (customerBoundingBox.minLng + customerBoundingBox.maxLng) / 2
    : undefined);

  // On mount: if there's a 100% fuzzy match, auto-geocode silently right away.
  // Uses geographic tiebreaking so the closest segment wins when multiple streets share the same name.
  useEffect(() => {
    if (!customerBoundingBox || !editStreet.trim()) return;
    let cancelled = false;
    (async () => {
      const results = fuzzyMatchSegmentName(
        editStreet.trim(), approvedRoutes, customerBoundingBox, 0.02, refLat, refLng
      );
      if (cancelled) return;
      const perfect = results.find(r => r.score >= 1.0);
      if (perfect) {
        setRetrying(true);
        setRetryError(null);
        try {
          await onRetryGeocode(customer.id, editHouse.trim(), perfect.segmentName, editCity.trim());
          if (!cancelled) setEditStreet(perfect.segmentName);
        } catch (e: any) {
          if (!cancelled) setRetryError(e?.message || 'Geocode failed.');
        } finally {
          if (!cancelled) setRetrying(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []); // intentionally runs once on mount only

  // Recompute fuzzy suggestions whenever editStreet changes while expanded (debounced 300ms).
  useEffect(() => {
    if (!isExpanded || !customerBoundingBox || !editStreet.trim()) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const results = fuzzyMatchSegmentName(
        editStreet.trim(), approvedRoutes, customerBoundingBox, 0.02, refLat, refLng
      );
      setSuggestions(results);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [editStreet, isExpanded, approvedRoutes, customerBoundingBox]);

  const handleExpand = () => setIsExpanded(v => !v);

  const applySuggestion = (suggestion: SegmentSuggestion) => {
    setEditStreet(suggestion.segmentName);
    setRetryError(null);
  };

  const handleRetry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetryGeocode(customer.id, editHouse.trim(), editStreet.trim(), editCity.trim());
    } catch (e: any) {
      setRetryError(e?.message || 'Geocode failed.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="px-4 py-3 border-b border-gray-700/40">
      {/* Summary row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-300 font-medium truncate">
            {[customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unknown'}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {[customer.houseNum, customer.streetName].filter(Boolean).join(' ')}
          </p>
          <p className="text-xs font-mono text-gray-600">{customer.currentRouteCode}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            customer.geocodeFailed
              ? 'bg-red-900/30 text-red-400'
              : 'bg-yellow-900/30 text-yellow-400'
          }`}>
            {customer.geocodeFailed ? 'No GPS' : 'No Route'}
          </span>
          <button
            onClick={handleExpand}
            className="text-gray-500 hover:text-white p-0.5 transition-colors"
            title={isExpanded ? 'Collapse' : 'Fix address'}
          >
            <Edit2 size={12} />
          </button>
        </div>
      </div>

      {/* Expanded: fuzzy suggestions + address editor */}
      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* Fuzzy suggestions — shown for both geocode failures and no-route-found */}
          {suggestions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
                <Zap size={10} className="text-yellow-400" />
                Nearby street suggestions
              </p>
              <div className="space-y-1">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => applySuggestion(s)}
                    className="w-full text-left bg-gray-700/50 hover:bg-gray-700 rounded px-2 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors"
                  >
                    <span className="text-gray-200 truncate">{s.segmentName}</span>
                    <span className="text-gray-500 font-mono flex-shrink-0">
                      {s.routeCode} · {Math.round(s.score * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {suggestions.length === 0 && isExpanded && (
            <p className="text-xs text-gray-600 italic">No nearby street suggestions found.</p>
          )}

          {/* Address editor */}
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <input
                value={editHouse}
                onChange={e => setEditHouse(e.target.value)}
                placeholder="House #"
                className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              <input
                value={editStreet}
                onChange={e => setEditStreet(e.target.value)}
                placeholder="Street name"
                className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <input
              value={editCity}
              onChange={e => setEditCity(e.target.value)}
              placeholder="City"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {retryError && (
            <p className="text-xs text-red-400">{retryError}</p>
          )}

          <button
            onClick={handleRetry}
            disabled={retrying || (!editStreet.trim())}
            className="w-full bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white py-1.5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
          >
            {retrying ? <Loader size={11} className="animate-spin" /> : <Search size={11} />}
            {retrying ? 'Geocoding...' : 'Retry Geocode'}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── SIDEBAR PANEL ────────────────────────────────────────────────────────────

interface SidebarPanelProps {
  prefix: string;
  orangeCount: number;
  greyCount: number;
  greenCount: number;
  redCount: number;
  geocodeFailedCustomers: GeoCustomer[];
  noRouteFoundCustomers: GeoCustomer[];
  session: RouteFinderSession | null;
  applying: boolean;
  boxSelectedCount: number;
  approvedRoutes: ApprovedRoute[];
  customerBoundingBox: ReturnType<typeof getCustomerBoundingBox>;
  standardizeProgress: { current: number; total: number } | null;
  onFixAll: () => void;
  onFixBoxSelection: () => void;
  onClearBoxSelection: () => void;
  onRetryGeocode: (id: string, houseNum: string, street: string, city: string) => Promise<void>;
  onReset: () => void;
}

const SidebarPanel: React.FC<SidebarPanelProps> = ({
  prefix, orangeCount, greyCount, greenCount, redCount,
  geocodeFailedCustomers, noRouteFoundCustomers,
  session, applying, boxSelectedCount,
  approvedRoutes, customerBoundingBox,
  standardizeProgress,
  onFixAll, onFixBoxSelection, onClearBoxSelection, onRetryGeocode, onReset,
}) => {
  const totalUnresolvable = geocodeFailedCustomers.length + noRouteFoundCustomers.length;

  return (
    <div className="flex flex-col h-full">
      {/* Stats */}
      <div className="p-4 border-b border-gray-700 flex-shrink-0">
        <h3 className="font-bold text-white text-sm mb-3">
          <span className="font-mono">{prefix}</span> Summary
        </h3>

        {/* Street standardization progress — shown while grey writes are running */}
        {standardizeProgress && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Standardizing street names...</span>
              <span>{standardizeProgress.current}/{standardizeProgress.total} books</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((standardizeProgress.current / standardizeProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <div className="space-y-2.5">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-xs text-gray-300">Need Review</span>
            </div>
            <span className="text-orange-400 font-bold">{orangeCount}</span>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <span className="text-xs text-gray-300">Correct</span>
            </div>
            <span className="text-gray-400 font-bold">{greyCount}</span>
          </div>
          {greenCount > 0 && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-xs text-gray-300">Fixed</span>
              </div>
              <span className="text-green-400 font-bold">{greenCount}</span>
            </div>
          )}
          {redCount > 0 && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-xs text-gray-300">No Route Found</span>
              </div>
              <span className="text-red-400 font-bold">{redCount}</span>
            </div>
          )}
        </div>

        {/* Box selection action */}
        {boxSelectedCount > 0 && (
          <div className="mt-4 space-y-1.5">
            <div className="text-xs text-orange-300 font-medium">
              {boxSelectedCount} customer{boxSelectedCount === 1 ? '' : 's'} selected
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={onFixBoxSelection}
                disabled={applying}
                className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white py-2 rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
              >
                {applying ? <Loader size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Fix Selected
              </button>
              <button
                onClick={onClearBoxSelection}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-2.5 py-2 rounded-lg text-xs transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Fix All button */}
        {orangeCount > 0 && boxSelectedCount === 0 && (
          <button
            onClick={onFixAll}
            disabled={applying}
            className="w-full mt-4 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {applying ? <Loader size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            {applying ? 'Fixing...' : `Fix All ${orangeCount}`}
          </button>
        )}

        {orangeCount === 0 && boxSelectedCount === 0 && (
          <p className="text-xs text-gray-600 mt-3">
            {redCount > 0 ? '← Click a red pin to handle it' : 'All clear!'}
          </p>
        )}
      </div>

      {/* Unresolvable list */}
      <div className="flex-1 overflow-y-auto">
        {totalUnresolvable === 0 ? (
          <div className="p-4 text-center text-xs text-gray-600">
            All customers could be located
          </div>
        ) : (
          <>
            {/* Geocode failed section */}
            {geocodeFailedCustomers.length > 0 && (
              <>
                <div className="px-4 py-2.5 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                    Geocode Failed ({geocodeFailedCustomers.length})
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Click the edit icon to fix address and retry
                  </p>
                </div>
                {geocodeFailedCustomers.map(c => (
                  <UnresolvableCard
                    key={c.id}
                    customer={c}
                    approvedRoutes={approvedRoutes}
                    customerBoundingBox={customerBoundingBox}
                    onRetryGeocode={onRetryGeocode}
                  />
                ))}
              </>
            )}

            {/* No route found section */}
            {noRouteFoundCustomers.length > 0 && (
              <>
                <div className="px-4 py-2.5 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                    No Route Found ({noRouteFoundCustomers.length})
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Edit the address and retry to re-geocode, or click the red pin on the map
                  </p>
                </div>
                {noRouteFoundCustomers.map(c => (
                  <UnresolvableCard
                    key={c.id}
                    customer={c}
                    approvedRoutes={approvedRoutes}
                    customerBoundingBox={customerBoundingBox}
                    onRetryGeocode={onRetryGeocode}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Session footer */}
      <div className="p-4 border-t border-gray-700 flex-shrink-0">
        {session?.updatedAt && (
          <p className="text-xs text-gray-600 mb-2">
            Last saved: {new Date(session.updatedAt).toLocaleTimeString()}
          </p>
        )}
        <button
          onClick={onReset}
          className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1"
        >
          <RefreshCw size={11} /> Reset &amp; re-scan
        </button>
      </div>
    </div>
  );
};

export default RouteFinderView;
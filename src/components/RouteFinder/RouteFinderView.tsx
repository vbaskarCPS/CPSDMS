// src/components/RouteFinder/RouteFinderView.tsx
//
// Map-based Route Finder.
// Flow:
//   1. Auth       — Connect to Google
//   2. Setup      — Pick route prefix (from approved routes in DB) + enter spreadsheet ID
//   3. Scanning   — Read all tabs, filter by prefix, geocode addresses, proximity match
//   4. Working    — Mapbox map with route lines + customer pins; click orange to fix
//   5. Complete   — All done screen
//
// Pin colours:
//   Grey   — customer is on the correct route (proximity confirms)
//   Orange — proximity suggests a different route
//   Green  — fixed this session
//   Sidebar — could not geocode OR no approved route found nearby
//

import React, { useState, useEffect, useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, MapPin, CheckCircle, Loader, RefreshCw,
  Search, X, AlertCircle, Navigation,
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
  MAX_ROUTE_DISTANCE_DEG,
  SAME_ROUTE_TOLERANCE_DEG,
  ApprovedRoute,
  GeoCustomer,
  CustomerRow,
} from '../../lib/routeFinder/routeFinderGeoService';

// Set Mapbox token
(mapboxgl as any).accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Phase = 'auth' | 'setup' | 'scanning' | 'working' | 'complete';

interface Props {
  onBack: () => void;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const PIN_COLORS = {
  grey:   '#6B7280',
  orange: '#F97316',
  green:  '#22C55E',
};

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

const RouteFinderView: React.FC<Props> = ({ onBack }) => {
  // ── Phase & navigation ─────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('auth');

  // ── Setup state ────────────────────────────────────────────────────────────
  const [spreadsheetInput, setSpreadsheetInput] = useState(
    () => routeFinderSessionService.getSavedSpreadsheetId()
  );
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [selectedPrefix, setSelectedPrefix] = useState('');
  const [availablePrefixes, setAvailablePrefixes] = useState<string[]>([]);
  const [approvedRoutes, setApprovedRoutes] = useState<ApprovedRoute[]>([]);
  const [prefixesLoading, setPrefixesLoading] = useState(false);

  // ── Working state ──────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<GeoCustomer[]>([]);
  const [session, setSession] = useState<RouteFinderSession | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // ── Scanning state ─────────────────────────────────────────────────────────
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, message: '' });

  // ── Map state ──────────────────────────────────────────────────────────────
  const [mapLoaded, setMapLoaded] = useState(false);

  // ── General ────────────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

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

  // ─── Initialize Mapbox when entering working phase ────────────────────────
  useEffect(() => {
    if (phase !== 'working') return;
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-79.870, 43.270],
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => setMapLoaded(true));

    // Click on orange customer pin → open detail panel
    map.on('click', 'customer-pins', e => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      if (!props) return;
      // Only orange pins are interactive
      if (props.pinColor !== 'orange') return;
      setSelectedCustomerId(props.id);
    });

    // Pointer cursor on orange pins only
    map.on('mousemove', 'customer-pins', e => {
      if (!e.features || e.features.length === 0) return;
      const pinColor = e.features[0].properties?.pinColor;
      map.getCanvas().style.cursor = pinColor === 'orange' ? 'pointer' : '';
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
  }, [phase]);

  // ─── Draw all approved route lines once map is loaded ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || approvedRoutes.length === 0) return;

    approvedRoutes.forEach(route => {
      if (!route.segments || route.segments.length === 0) return;

      const sourceId = `rf-route-src-${route.id}`;
      const lineId   = `rf-route-line-${route.id}`;

      // Remove if already drawn (e.g. re-entering working phase)
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      const features: GeoJSON.Feature[] = route.segments.map(seg => ({
        type: 'Feature',
        properties: { route_code: route.route_code },
        geometry: {
          type: 'LineString',
          coordinates: seg.coordinates,
        },
      }));

      map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': route.route_color,
          'line-width': 3,
          'line-opacity': 0.5,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });
    });
  }, [mapLoaded, approvedRoutes]);

  // ─── Draw / update customer pins whenever customers array changes ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const features: GeoJSON.Feature[] = customers
      .filter(c => c.lat !== null && c.lng !== null && !c.noRouteFound && !c.geocodeFailed)
      .map(c => ({
        type: 'Feature',
        properties: {
          id:       c.id,
          pinColor: c.pinColor,
          color:    PIN_COLORS[c.pinColor],
          name:     [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
          route:    c.currentRouteCode,
          suggested: c.suggestedRouteCode,
        },
        geometry: {
          type: 'Point',
          coordinates: [c.lng!, c.lat!],
        },
      }));

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    if (map.getSource('customer-pins')) {
      // Update existing source
      (map.getSource('customer-pins') as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      // First time — add source and layer
      map.addSource('customer-pins', { type: 'geojson', data: geojson });

      map.addLayer({
        id: 'customer-pins',
        type: 'circle',
        source: 'customer-pins',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': [
            'case',
            ['==', ['get', 'pinColor'], 'grey'], 4,
            6,
          ],
          'circle-stroke-width': [
            'case',
            ['==', ['get', 'pinColor'], 'grey'], 1,
            2,
          ],
          'circle-stroke-color': '#111827',
          'circle-opacity': [
            'case',
            ['==', ['get', 'pinColor'], 'grey'], 0.5,
            1,
          ],
        },
      });

      // Fit map to orange pins on first load
      const orangePins = features.filter(f => f.properties?.pinColor === 'orange');
      if (orangePins.length > 0) {
        const coords = orangePins.map(f => (f.geometry as GeoJSON.Point).coordinates as [number, number]);
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      } else if (features.length > 0) {
        const coords = features.map(f => (f.geometry as GeoJSON.Point).coordinates as [number, number]);
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new mapboxgl.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }
    }
  }, [mapLoaded, customers]);

  // ─── Toast helper ─────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
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
    const rawId = spreadsheetInput.trim();
    const idMatch = rawId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const resolvedId = idMatch ? idMatch[1] : rawId;

    if (!resolvedId) { setError('Please enter a spreadsheet ID or URL.'); return; }
    if (!selectedPrefix) { setError('Please select a route prefix.'); return; }

    setError(null);
    setPhase('scanning');

    try {
      // 1. Validate spreadsheet
      setScanProgress({ current: 0, total: 0, message: 'Validating spreadsheet...' });
      const validation = await routeFinderSheetsService.validateSpreadsheet(resolvedId);
      if (!validation.valid) {
        setError(validation.error || 'Cannot access spreadsheet.');
        setPhase('setup');
        return;
      }

      routeFinderSessionService.saveSpreadsheetId(resolvedId);
      setSpreadsheetId(resolvedId);

      // 2. Read all tabs
      setScanProgress({ current: 0, total: 0, message: 'Discovering sheet tabs...' });
      const tabNames = await routeFinderSheetsService.getCallBookTabs(resolvedId);

      const loadedSheets = await routeFinderSheetsService.readCallBookSheets(
        resolvedId,
        tabNames,
        (current, total, sheetName) =>
          setScanProgress({ current, total, message: `Reading ${sheetName}...` })
      );

      // 3. Load or create session
      setScanProgress({ current: 0, total: 0, message: 'Checking existing session...' });
      const existingSession = await routeFinderSessionService.loadSession(resolvedId);

      // 4. Build customer groups (all tabs, filter by prefix)
      setScanProgress({ current: 0, total: 0, message: 'Building customer groups...' });
      const customerMap = new Map<string, GeoCustomer>();

      for (const sheet of loadedSheets) {
        const { CI, rows, sheetName } = sheet;

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;

          // Filter to selected prefix only
          const routeCode = CI.routeCode >= 0
            ? String(row[CI.routeCode] ?? '').trim().toUpperCase()
            : '';
          const routePrefix = routeCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
          if (routePrefix !== selectedPrefix) continue;

          // Extract fields
          const phone      = CI.phone >= 0      ? normalizePhone(row[CI.phone]) : '';
          const houseNum   = CI.houseNum >= 0   ? String(row[CI.houseNum] ?? '').trim() : '';
          const streetName = CI.streetName >= 0 ? String(row[CI.streetName] ?? '').trim() : '';
          const city       = CI.city >= 0       ? String(row[CI.city] ?? '').trim() : '';
          const firstName  = CI.firstName >= 0  ? String(row[CI.firstName] ?? '').trim() : '';
          const lastName   = CI.lastName >= 0   ? String(row[CI.lastName] ?? '').trim() : '';
          const bookingId  = CI.bookingId >= 0  ? String(row[CI.bookingId] ?? '').trim() : '';
          const year       = CI.year >= 0       ? (parseInt(String(row[CI.year] ?? ''), 10) || 0) : 0;

          if (!phone && !houseNum && !streetName) continue;

          // Grouping key: phone first, address fallback
          const key = phone
            ? phone
            : `${houseNum}|${streetName.toLowerCase()}|${city.toLowerCase()}`;

          const customerRow: CustomerRow = {
            sheetName,
            sheetRowNumber: i + CI.headerRowIndex + 2, // 1-based sheet row
            routeCodeCol: CI.routeCode,
            streetNameCol: CI.streetName,
            bookingId,
            year,
          };

          if (customerMap.has(key)) {
            const existing = customerMap.get(key)!;
            existing.rows.push(customerRow);

            // Update display fields if this row is from a newer year
            if (year > 0) {
              const existingMaxYear = Math.max(...existing.rows.map(r => r.year));
              if (year >= existingMaxYear) {
                if (firstName) existing.firstName = firstName;
                if (lastName)  existing.lastName  = lastName;
                if (houseNum)  existing.houseNum  = houseNum;
                if (streetName) existing.streetName = streetName;
                if (city)      existing.city       = city;
                existing.currentRouteCode = routeCode;
              }
            }
          } else {
            customerMap.set(key, {
              id: key,
              rows: [customerRow],
              phone,
              firstName,
              lastName,
              houseNum,
              streetName,
              city,
              currentRouteCode: routeCode,
              lat: null,
              lng: null,
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

      // Filter out previously fixed/dismissed customers
      const allCustomers = Array.from(customerMap.values());
      let customersToProcess = allCustomers;
      let activeSession: RouteFinderSession;

      if (existingSession) {
        const dismissedSet = new Set(existingSession.fixLog.map(e => e.rowId));
        // Mark previously fixed as green instead of skipping them entirely
        for (const c of customersToProcess) {
          if (dismissedSet.has(c.id)) c.pinColor = 'green';
        }
        activeSession = existingSession;
      } else {
        activeSession = await routeFinderSessionService.createSession(
          resolvedId, [], allCustomers.length
        );
      }

      setSession(activeSession);

      // 5. Geocode each unique customer
      const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
      const geocodedCustomers: GeoCustomer[] = [];

      for (let i = 0; i < customersToProcess.length; i++) {
        const customer = customersToProcess[i];

        // Skip geocoding customers already fixed in a previous session
        if (customer.pinColor === 'green') {
          geocodedCustomers.push(customer);
          continue;
        }

        setScanProgress({
          current: i + 1,
          total: customersToProcess.length,
          message: `Geocoding ${i + 1} of ${customersToProcess.length}...`,
        });

        const geoResult = await geocodeAddress(
          customer.houseNum,
          customer.streetName,
          customer.city,
          token
        );

        if (geoResult) {
          customer.lat = geoResult.lat;
          customer.lng = geoResult.lng;

          // Proximity match against ALL approved routes
          const match = findClosestRoute(geoResult.lat, geoResult.lng, approvedRoutes);

          if (match && match.distanceDeg <= MAX_ROUTE_DISTANCE_DEG) {
            customer.suggestedRouteCode  = match.routeCode;
            customer.suggestedSegmentName = match.segmentName;
            customer.distanceDeg         = match.distanceDeg;

            if (match.routeCode === customer.currentRouteCode) {
              // Closest route matches assigned route → correct
              customer.pinColor = 'grey';
            } else {
              // Closest route is different — check how close the ASSIGNED route is
              const assignedDist = distanceToRoute(
                geoResult.lat, geoResult.lng,
                customer.currentRouteCode,
                approvedRoutes
              );

              // If assigned route is only slightly further away, don't flag it
              if (assignedDist - match.distanceDeg < SAME_ROUTE_TOLERANCE_DEG) {
                customer.pinColor = 'grey'; // borderline — don't flag
              } else {
                customer.pinColor = 'orange'; // clearly on wrong route
              }
            }
          } else {
            // No drawn route close enough to match
            customer.noRouteFound = true;
          }
        } else {
          customer.geocodeFailed = true;
        }

        geocodedCustomers.push(customer);

        // Yield to browser every 25 requests to keep UI responsive
        if (i % 25 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      setCustomers(geocodedCustomers);

      const hasIssues = geocodedCustomers.some(c => c.pinColor === 'orange');
      setPhase(hasIssues ? 'working' : 'complete');

    } catch (e: any) {
      console.error('Route Finder scan failed:', e);
      setError(e?.message || 'Scan failed. Please try again.');
      setPhase('setup');
    }
  };

  // ─── CONFIRM FIX ─────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async (
    customer: GeoCustomer,
    newRouteCode: string,
    newStreetName: string
  ) => {
    if (!session || !spreadsheetId) return;
    setApplying(true);
    setError(null);

    try {
      // Write fix to every row for this customer (all years/tabs)
      for (const row of customer.rows) {
        await routeFinderSheetsService.applyFix(
          spreadsheetId,
          row.sheetName,
          row.sheetRowNumber,
          row.routeCodeCol,
          row.streetNameCol,
          newRouteCode,
          newStreetName,
        );
      }

      // Save to session log
      const logEntry: FixLogEntry = {
        rowId:        customer.id,
        bookingId:    customer.rows[0]?.bookingId || customer.id,
        sheetName:    customer.rows[0]?.sheetName || '',
        oldRouteCode: customer.currentRouteCode,
        newRouteCode,
        oldStreetName: customer.streetName,
        newStreetName,
        cascadeCount:  customer.rows.length - 1,
        timestamp:     new Date().toISOString(),
        type:          'fix',
      };

      const { newFixedRows } = await routeFinderSessionService.markRowFixed({
        sessionId:         session.id,
        rowId:             customer.id,
        logEntry,
        currentFixedRows:  session.fixedRows,
        cascadeResolvedIds: [],
      });

      // Update customer in state — turn pin green
      setCustomers(prev => prev.map(c =>
        c.id === customer.id
          ? { ...c, pinColor: 'green', currentRouteCode: newRouteCode }
          : c
      ));

      setSession(prev => prev ? { ...prev, fixedRows: newFixedRows } : null);
      setSelectedCustomerId(null);

      const rowCount = customer.rows.length;
      showToast(rowCount > 1 ? `Fixed — updated ${rowCount} rows.` : 'Fixed.');

      // If no more orange pins, go to complete
      const remaining = customers.filter(
        c => c.id !== customer.id && c.pinColor === 'orange'
      );
      if (remaining.length === 0) {
        setTimeout(() => setPhase('complete'), 800);
      }

    } catch (e: any) {
      setError('Fix failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  }, [session, spreadsheetId, customers, showToast]);

  const handleSkip = useCallback(() => {
    setSelectedCustomerId(null);
  }, []);

  // ─── DERIVED VALUES ───────────────────────────────────────────────────────
  const selectedCustomer = selectedCustomerId
    ? customers.find(c => c.id === selectedCustomerId) ?? null
    : null;

  const unresolvableCustomers = customers.filter(c => c.noRouteFound || c.geocodeFailed);
  const orangeCount = customers.filter(c => c.pinColor === 'orange').length;
  const greyCount   = customers.filter(c => c.pinColor === 'grey').length;
  const greenCount  = customers.filter(c => c.pinColor === 'green').length;

  // ─── PHASE: AUTH ─────────────────────────────────────────────────────────
  const renderAuth = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center border border-gray-700">
        <MapPin className="text-blue-400" size={32} />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-white mb-1">Route Finder</h2>
        <p className="text-gray-400 text-sm">Connect to Google to access your call book</p>
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
          Pick a route prefix and your call book — customers will be geocoded and plotted on the map
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

        {/* Spreadsheet input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Call Book Spreadsheet</label>
          <input
            type="text"
            value={spreadsheetInput}
            onChange={e => setSpreadsheetInput(e.target.value)}
            placeholder="Paste Google Sheets URL or spreadsheet ID"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500"
          />
          <p className="text-xs text-gray-500 mt-1.5">
            All tabs will be scanned for customers on <strong className="text-gray-400">{selectedPrefix || '...'}</strong> routes
          </p>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleStartScan}
          disabled={!spreadsheetInput.trim() || !selectedPrefix || prefixesLoading || availablePrefixes.length === 0}
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
        {unresolvableCustomers.length > 0 && (
          <p className="text-yellow-400 text-sm mt-1">
            {unresolvableCustomers.length} customer{unresolvableCustomers.length === 1 ? '' : 's'} could not be resolved (no GPS or no nearby route).
          </p>
        )}
      </div>
      <button
        onClick={() => {
          setPhase('setup');
          setCustomers([]);
          setSession(null);
          setSelectedCustomerId(null);
          setSpreadsheetId('');
        }}
        className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg transition-colors text-sm"
      >
        <RefreshCw size={15} /> Scan Another Prefix
      </button>
    </div>
  );

  // ─── PHASE: WORKING (MAP) ─────────────────────────────────────────────────
  const renderWorking = () => (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Map ── */}
      <div className="flex-1 relative">
        <div
          ref={mapContainerRef}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />

        {/* Loading overlay */}
        {!mapLoaded && (
          <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center z-10">
            <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-5 py-4 border border-gray-700">
              <Loader size={18} className="animate-spin text-blue-400" />
              <span className="text-sm text-gray-300">Loading map...</span>
            </div>
          </div>
        )}

        {/* Legend — bottom left */}
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
          {unresolvableCustomers.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-600" />
              <span className="text-gray-400">{unresolvableCustomers.length} unresolvable</span>
            </div>
          )}
        </div>

        {/* Hint overlay when no pin selected */}
        {mapLoaded && orangeCount > 0 && !selectedCustomer && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-900/80 border border-orange-700/50 rounded-lg px-4 py-2 text-xs text-orange-300 z-10 pointer-events-none">
            Click an orange pin to review
          </div>
        )}
      </div>

      {/* ── Right Panel ── */}
      <div className="w-80 border-l border-gray-700 bg-gray-800 flex flex-col overflow-hidden flex-shrink-0">
        {selectedCustomer && selectedCustomer.pinColor === 'orange' ? (
          <CustomerDetailPanel
            key={selectedCustomer.id}
            customer={selectedCustomer}
            applying={applying}
            error={error}
            onConfirm={handleConfirm}
            onSkip={handleSkip}
          />
        ) : (
          <SidebarPanel
            prefix={selectedPrefix}
            orangeCount={orangeCount}
            greyCount={greyCount}
            greenCount={greenCount}
            unresolvables={unresolvableCustomers}
            session={session}
            onReset={() => {
              if (window.confirm('Re-scan from scratch? This will reset all session progress.')) {
                routeFinderSessionService.resetSession(spreadsheetId);
                setPhase('setup');
                setCustomers([]);
                setSession(null);
              }
            }}
          />
        )}
      </div>
    </div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-900 text-white relative">
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
          <div className="text-xs text-gray-500">
            {orangeCount} to fix · {greenCount} fixed
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {phase === 'auth'     && <div className="p-8 flex-1">{renderAuth()}</div>}
        {phase === 'setup'    && <div className="p-8 flex-1">{renderSetup()}</div>}
        {phase === 'scanning' && <div className="p-8 flex-1">{renderScanning()}</div>}
        {phase === 'working'  && renderWorking()}
        {phase === 'complete' && <div className="p-8 flex-1">{renderComplete()}</div>}
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
  onSkip: () => void;
}

const CustomerDetailPanel: React.FC<CustomerDetailPanelProps> = ({
  customer, applying, error, onConfirm, onSkip,
}) => {
  const [editRoute, setEditRoute]   = useState(customer.suggestedRouteCode);
  const [editStreet, setEditStreet] = useState(customer.streetName);

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
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Current route */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Current Route</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-orange-300 bg-orange-900/30 border border-orange-700/50 px-2 py-1 rounded text-sm font-bold">
              {customer.currentRouteCode}
            </span>
            <span className="text-gray-400 text-xs truncate">{customer.streetName}</span>
          </div>
        </div>

        {/* Suggested route */}
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

        {/* Editable fix inputs */}
        <div className="border-t border-gray-700 pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Apply Fix</p>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">New Route Code</label>
              <input
                type="text"
                value={editRoute}
                onChange={e => setEditRoute(e.target.value.toUpperCase())}
                placeholder="Route code"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">New Street Name</label>
              <input
                type="text"
                value={editStreet}
                onChange={e => setEditStreet(e.target.value)}
                placeholder="Street name"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg py-2 px-3 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Service history */}
        {serviceHistory.length > 0 && (
          <div className="border-t border-gray-700 pt-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Service History</p>
            <div className="space-y-1.5">
              {serviceHistory.map((row, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400 font-mono w-10">{row.year}</span>
                  <span className="text-gray-500 truncate flex-1 px-2">{row.sheetName}</span>
                  <span className="text-xs text-gray-600 font-mono">
                    Row {row.sheetRowNumber}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Multi-row notice */}
        {customer.rows.length > 1 && (
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-2.5 text-xs text-blue-300">
            This fix will update {customer.rows.length} rows ({customer.rows.length} years of service history)
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2.5 text-red-400 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-gray-700 space-y-2 flex-shrink-0">
        <button
          onClick={() => onConfirm(customer, editRoute, editStreet)}
          disabled={applying || !editRoute.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {applying ? (
            <Loader size={15} className="animate-spin" />
          ) : (
            <CheckCircle size={15} />
          )}
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
    </div>
  );
};

// ─── SIDEBAR PANEL ────────────────────────────────────────────────────────────

interface SidebarPanelProps {
  prefix: string;
  orangeCount: number;
  greyCount: number;
  greenCount: number;
  unresolvables: GeoCustomer[];
  session: RouteFinderSession | null;
  onReset: () => void;
}

const SidebarPanel: React.FC<SidebarPanelProps> = ({
  prefix, orangeCount, greyCount, greenCount, unresolvables, session, onReset,
}) => {
  return (
    <div className="flex flex-col h-full">
      {/* Stats */}
      <div className="p-4 border-b border-gray-700 flex-shrink-0">
        <h3 className="font-bold text-white text-sm mb-3">
          <span className="font-mono">{prefix}</span> Summary
        </h3>
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
          {unresolvables.length > 0 && (
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-600" />
                <span className="text-xs text-gray-300">Unresolvable</span>
              </div>
              <span className="text-red-400 font-bold">{unresolvables.length}</span>
            </div>
          )}
        </div>
        {orangeCount > 0 && (
          <p className="text-xs text-gray-600 mt-3">← Click an orange pin on the map</p>
        )}
      </div>

      {/* Unresolvable list */}
      <div className="flex-1 overflow-y-auto">
        {unresolvables.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-600">
            All customers could be located
          </div>
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-gray-700 sticky top-0 bg-gray-800">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">
                Unresolvable ({unresolvables.length})
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                Failed to geocode or no approved route nearby
              </p>
            </div>
            <div className="divide-y divide-gray-700/40">
              {unresolvables.map(c => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-300 font-medium truncate">
                        {[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {[c.houseNum, c.streetName].filter(Boolean).join(' ')}
                      </p>
                      <p className="text-xs font-mono text-gray-600">{c.currentRouteCode}</p>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                      c.geocodeFailed
                        ? 'bg-red-900/30 text-red-400'
                        : 'bg-yellow-900/30 text-yellow-400'
                    }`}>
                      {c.geocodeFailed ? 'No GPS' : 'No Route'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
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
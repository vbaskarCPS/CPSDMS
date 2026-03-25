// src/components/RouteFinder/RouteFinderV2View.tsx
//
// Full-scale Route Finder — processes entire call books across all prefixes.
//
// Phases:
//   setup      — enter spreadsheet IDs, check for existing session
//   scanning   — per-group geocoding + auto-fix with live progress
//   reviewing  — map view of queued customers for manual resolution
//   complete   — all done
//
// Key behaviours:
//   - Reads both aeration + sealing books, merges customers by phone/address
//   - Groups customers by call book prefix + city
//   - Auto-discovers which map prefix each group belongs to via geocode sampling
//   - Auto-fixes same-prefix oranges immediately (interleaved geocode+write)
//   - Queues different-prefix oranges and reds for manual review
//   - All state persists to Supabase — resume after browser close
//

import React, { useState, useEffect, useCallback, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowLeft, Navigation, Search, Loader, CheckCircle,
  RefreshCw, AlertCircle, Pause, Play, MapPin, X, ChevronRight,
} from 'lucide-react';

import { routeFinderSheetsService } from '../../lib/routeFinder/routeFinderSheetsService';
import { rfScanSessionService, RFScanSession, RFQueueEntry } from '../../lib/routeFinder/rfScanSessionService';
import { rfPrefixService, RFPrefixMapping } from '../../lib/routeFinder/rfPrefixService';
import { rfSegmentDirectoryService } from '../../lib/routeFinder/rfSegmentDirectoryService';
import { supabase } from '../../lib/supabase';
import { scanGroup, runQueuePostFilter } from '../../lib/routeFinder/rfScanEngine';
import {
  loadApprovedRoutes,
  getAvailablePrefixes,
  getRouteCentroid,
  geocodeAddress,
  findClosestRoute,
  normalizePhone,
  ApprovedRoute,
  GeoCustomer,
  CustomerRow,
} from '../../lib/routeFinder/routeFinderGeoService';

(mapboxgl as any).accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Phase = 'auth' | 'setup' | 'scanning' | 'reviewing' | 'complete';

interface CustomerGroup {
  callBookPrefix: string;
  city: string;
  mapPrefix: string | null;   // null until discovered
  customers: GeoCustomer[];
}

interface Props {
  onBack: () => void;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DISCOVERY_SAMPLE_SIZE = 20;
const PIN_COLORS = {
  orange: '#F97316',
  red:    '#EF4444',
  green:  '#22C55E',
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const RouteFinderV2View: React.FC<Props> = ({ onBack }) => {
  const [phase, setPhase] = useState<Phase>('auth');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Setup
  const [aerationInput, setAerationInput] = useState(() => localStorage.getItem('rfv2_aeration_id') || '');
  const [sealingInput, setSealingInput]   = useState(() => localStorage.getItem('rfv2_sealing_id') || '');
  const [existingSession, setExistingSession] = useState<RFScanSession | null>(null);
  const [checkingSession, setCheckingSession] = useState(false);
  const [scanMode, setScanMode] = useState<'full' | 'fuzzy'>('full');

  // Scan state
  const [session, setSession] = useState<RFScanSession | null>(null);
  const [approvedRoutes, setApprovedRoutes] = useState<ApprovedRoute[]>([]);
  const [prefixMappings, setPrefixMappings] = useState<RFPrefixMapping[]>([]);
  const [scanProgress, setScanProgress] = useState({
    current: 0, total: 0, message: '', fixed: 0, queued: 0, group: '',
  });
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  // Review state
  const [queueEntries, setQueueEntries] = useState<RFQueueEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<RFQueueEntry | null>(null);
  const [activePrefixFilter, setActivePrefixFilter] = useState<string | null>(null);
  const [pendingPrefixes, setPendingPrefixes] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, fixed: 0, skipped: 0, orange: 0, red: 0 });

  // General
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const scanAbortRef = useRef(false);

  // ─── Auth check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (routeFinderSheetsService.isAuthenticated()) setPhase('setup');
    else setPhase('auth');
  }, []);

  // ─── Check for existing session when inputs change ───────────────────────
  const checkForExistingSession = useCallback(async () => {
    const aId = aerationInput.trim();
    const sId = sealingInput.trim();
    if (!aId && !sId) { setExistingSession(null); return; }

    setCheckingSession(true);
    try {
      const sess = await rfScanSessionService.loadLatestSession(
        aId || null, sId || null
      );
      setExistingSession(sess);
    } catch {
      setExistingSession(null);
    } finally {
      setCheckingSession(false);
    }
  }, [aerationInput, sealingInput]);

  // ─── Initialize map once ─────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-79.870, 43.270],
      zoom: 11,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.on('load', () => { map.resize(); setMapLoaded(true); });
    map.on('click', 'review-pins', e => {
      if (!e.features?.length) return;
      const id = e.features[0].properties?.id;
      if (id) {
        const entry = queueEntries.find(q => q.id === id);
        if (entry) setSelectedEntry(entry);
      }
    });
    map.on('mousemove', 'review-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'review-pins', () => { map.getCanvas().style.cursor = ''; });
    mapRef.current = map;
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // ─── Resize map when reviewing ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'reviewing') return;
    const t = setTimeout(() => mapRef.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [phase]);

  // ─── Update review pins on map ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || phase !== 'reviewing') return;

    const visible = queueEntries.filter(q =>
      q.lat !== null && q.lng !== null && q.status === 'pending' &&
      (!activePrefixFilter || q.mapPrefix === activePrefixFilter)
    );

    const features: GeoJSON.Feature[] = visible.map(q => ({
      type: 'Feature',
      properties: {
        id:    q.id,
        color: q.pinColor === 'orange' ? PIN_COLORS.orange : PIN_COLORS.red,
        pinColor: q.pinColor,
      },
      geometry: { type: 'Point', coordinates: [q.lng!, q.lat!] },
    }));

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    if (map.getSource('review-pins')) {
      (map.getSource('review-pins') as mapboxgl.GeoJSONSource).setData(geojson);
    } else {
      map.addSource('review-pins', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'review-pins', type: 'circle', source: 'review-pins',
        paint: {
          'circle-color':        ['get', 'color'],
          'circle-radius':       6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#111827',
        },
      });
    }

    if (features.length > 0) {
      const coords = features.map(f => (f.geometry as GeoJSON.Point).coordinates as [number, number]);
      const bounds = coords.reduce(
        (b, c) => b.extend(c as mapboxgl.LngLatLike),
        new mapboxgl.LngLatBounds(coords[0] as mapboxgl.LngLatLike, coords[0] as mapboxgl.LngLatLike)
      );
      map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
    }
  }, [mapLoaded, queueEntries, activePrefixFilter, phase]);

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

  // ─── RESUME existing session ──────────────────────────────────────────────
  const handleResume = async () => {
    if (!existingSession) return;
    setSession(existingSession);
    setPhase('scanning');

    const routes = await loadApprovedRoutes();
    setApprovedRoutes(routes);

    // Run post-filter on all pending entries from the previous session
    // so anything like "Sommervile" gets caught before review loads
    const pendingPrefixes = await rfScanSessionService.getPendingPrefixes(existingSession.id);
    let totalResolved = 0;

    for (const prefix of pendingPrefixes) {
      setScanProgress(p => ({
        ...p,
        message: `Post-filtering ${prefix}...`,
        group: prefix,
        current: pendingPrefixes.indexOf(prefix) + 1,
        total: pendingPrefixes.length,
      }));

      const postResult = await runQueuePostFilter({
        sessionId: existingSession.id,
        approvedRoutes: routes,
        mapPrefix: prefix,
        onProgress: (current, total) => {
          setScanProgress(p => ({
            ...p,
            message: `Post-filtering ${prefix}: ${current} of ${total}...`,
          }));
        },
      });
      totalResolved += postResult.resolved;
    }

    if (totalResolved > 0) {
      await rfScanSessionService.updateSession(existingSession.id, {
        customersFixed: (existingSession.customersFixed || 0) + totalResolved,
        customersQueued: Math.max(0, (existingSession.customersQueued || 0) - totalResolved),
      });
    }

    const entries = await rfScanSessionService.loadPendingQueue(existingSession.id);
    setQueueEntries(entries);

    const counts = await rfScanSessionService.getQueueCounts(existingSession.id);
    setQueueCounts(counts);

    const prefixList = await rfScanSessionService.getPendingPrefixes(existingSession.id);
    setPendingPrefixes(prefixList);
    if (prefixList.length > 0) setActivePrefixFilter(prefixList[0]);

    if (existingSession.status === 'scanning') {
      continueScan(existingSession, routes);
    } else {
      setPhase('reviewing');
    }
  };

  // ─── START fresh scan ──────────────────────────────────────────────────────
  const handleStartScan = async () => {
    const resolveId = (raw: string) => {
      const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : raw.trim();
    };

    const aerationId = aerationInput.trim() ? resolveId(aerationInput) : null;
    const sealingId  = sealingInput.trim()  ? resolveId(sealingInput)  : null;

    if (!aerationId && !sealingId) {
      setError('Please enter at least one spreadsheet ID or URL.');
      return;
    }

    if (aerationId) localStorage.setItem('rfv2_aeration_id', aerationId);
    if (sealingId)  localStorage.setItem('rfv2_sealing_id',  sealingId);

    setError(null);
    setPhase('scanning');
    scanAbortRef.current = false;

    try {
      setScanProgress({ current: 0, total: 0, message: 'Loading route maps...', fixed: 0, queued: 0, group: '' });
      const [routes, areaPrefixData] = await Promise.all([
        loadApprovedRoutes(),
        supabase.from('area_prefixes').select('area_name, prefix, region').then(r => r.data || []),
      ]);
      setApprovedRoutes(routes);
      const areas = areaPrefixData as { area_name: string; prefix: string; region: string }[];

      // Load prefix mappings (paginated via service)
      setScanProgress(p => ({ ...p, message: 'Loading prefix mappings...' }));
      // We'll use West region for now — TODO: derive from routes
      // Load mappings for all regions
      const [mappingsWest, mappingsCentral, mappingsEast] = await Promise.all([
        rfPrefixService.loadMappings('West'),
        rfPrefixService.loadMappings('Central'),
        rfPrefixService.loadMappings('East'),
      ]);
      const mappings = [...mappingsWest, ...mappingsCentral, ...mappingsEast];
      setPrefixMappings(mappings);

      // Validate books
      const books = [
        aerationId ? { id: aerationId, label: 'Aeration' } : null,
        sealingId  ? { id: sealingId,  label: 'Sealing'  } : null,
      ].filter(Boolean) as { id: string; label: string }[];

      for (const book of books) {
        setScanProgress(p => ({ ...p, message: `Validating ${book.label} book...` }));
        const v = await routeFinderSheetsService.validateSpreadsheet(book.id);
        if (!v.valid) { setError(`${book.label}: ${v.error}`); setPhase('setup'); return; }
      }

      // Read all sheets and build customer groups
      setScanProgress(p => ({ ...p, message: 'Reading call books...' }));
      const groups = await buildCustomerGroups(books, routes, mappings);

      const totalCustomers = groups.reduce((s, g) => s + g.customers.length, 0);

      // Create session
      // Derive region from area_prefixes for groups that have a mapped prefix
      const regionCounts: Record<string, number> = { West: 0, Central: 0, East: 0 };
      for (const m of mappings) { regionCounts[m.region] = (regionCounts[m.region] || 0) + 1; }
      const knownRegion = (Object.entries(regionCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || 'West') as 'West' | 'Central' | 'East';

      const newSession = await rfScanSessionService.createSession({
        region:                knownRegion,
        aerationSpreadsheetId: aerationId,
        sealingSpreadsheetId:  sealingId,
        groupsTotal:           groups.length,
        customersTotal:        totalCustomers,
      });
      setSession(newSession);

      await runScan(newSession, groups, routes);

    } catch (e: any) {
      console.error('RF V2 scan failed:', e);
      setError(e?.message || 'Scan failed.');
      setPhase('setup');
    }
  };

  // ─── FUZZY ONLY (no Mapbox) ──────────────────────────────────────────────
  // Reads both call books, runs pre-pass fuzzy name normalization against
  // segment data, and writes corrections directly to the sheet.
  // No geocoding, no session required.
  const handleFuzzyOnly = async () => {
    setError(null);

    const resolveId = (raw: string) => {
      const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : raw.trim();
    };

    const aerationId = aerationInput.trim() ? resolveId(aerationInput) : null;
    const sealingId  = sealingInput.trim()  ? resolveId(sealingInput)  : null;

    if (!aerationId && !sealingId) {
      setError('Please enter at least one spreadsheet ID or URL.');
      return;
    }

    setPhase('scanning');
    setScanProgress({ current: 0, total: 0, message: 'Loading route maps...', fixed: 0, queued: 0, group: '' });

    try {
      const routes = await loadApprovedRoutes();
      setApprovedRoutes(routes);

      const [westMappings, centralMappings, eastMappings] = await Promise.all([
        rfPrefixService.loadMappings('West'),
        rfPrefixService.loadMappings('Central'),
        rfPrefixService.loadMappings('East'),
      ]);
      const mappings = [...westMappings, ...centralMappings, ...eastMappings];
      setPrefixMappings(westMappings);

      const books = [
        aerationId ? { id: aerationId, label: 'Aeration' } : null,
        sealingId  ? { id: sealingId,  label: 'Sealing'  } : null,
      ].filter(Boolean) as { id: string; label: string }[];

      // Read all call book sheets
      setScanProgress(p => ({ ...p, message: 'Reading call books...' }));
      const groups = await buildCustomerGroups(books, routes, mappings);

      let totalFixed = 0;
      let totalCustomers = 0;

      // Build segment lookup by map prefix
      const segmentsByPrefix = new Map<string, { name: string; routeCode: string; colIdx?: number }[]>();
      for (const route of routes) {
        const prefix = route.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
        if (!prefix) continue;
        if (!segmentsByPrefix.has(prefix)) segmentsByPrefix.set(prefix, []);
        for (const seg of route.segments || []) {
          if (seg.name) segmentsByPrefix.get(prefix)!.push({ name: seg.name, routeCode: route.route_code });
        }
      }

      const FUZZY_THRESHOLD = 0.75;

      console.log(`RF fuzzy: ${groups.length} groups loaded`);
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        // In fuzzy-only mode, the route code prefix IS the map prefix —
        // use callBookPrefix directly as the segment lookup key since
        // the data has already been processed through previous scans.
        const resolvedMapPrefix = group.mapPrefix || group.callBookPrefix;
        if (!resolvedMapPrefix) continue;
        group.mapPrefix = resolvedMapPrefix;

        const groupLabel = `${group.callBookPrefix} / ${group.city}`;
        const segments = segmentsByPrefix.get(effectiveMapPrefix.toUpperCase()) || [];
        console.log(`RF fuzzy: group ${groupLabel} mapPrefix=${effectiveMapPrefix} customers=${group.customers.length} segments=${segments.length}`);
        if (segments.length === 0) continue;

        setScanProgress({
          current: g + 1,
          total: groups.length,
          message: `Fuzzy fixing ${groupLabel}...`,
          fixed: totalFixed,
          queued: 0,
          group: groupLabel,
        });

        // Batch writes per spreadsheet
        const pendingWrites = new Map<string, { range: string; values: any[][] }[]>();

        for (const customer of group.customers) {
          // Fuzzy match street name against prefix segments
          const na = normalizeStreetForFuzzy(customer.streetName);
          let bestScore = 0;
          let bestName = '';
          let bestRouteCode = '';

          for (const seg of segments) {
            const nb = normalizeStreetForFuzzy(seg.name);
            if (!na || !nb) continue;
            const normScore = levenshteinSimilarity(na, nb);
            const rawScore  = levenshteinSimilarity(customer.streetName.toLowerCase(), seg.name.toLowerCase());
            const score = Math.max(normScore, rawScore);
            if (score > bestScore) { bestScore = score; bestName = seg.name; bestRouteCode = seg.routeCode; }
          }

          if (bestScore < FUZZY_THRESHOLD) continue;
          if (bestName.toLowerCase() === customer.streetName.toLowerCase() &&
              bestRouteCode === customer.currentRouteCode) continue;

          console.log(`RF fuzzy: MATCH "${customer.streetName}" → "${bestName}" (${bestScore.toFixed(3)}) route ${customer.currentRouteCode} → ${bestRouteCode}`);
          totalCustomers++;

          for (const row of customer.rows) {
            if (!pendingWrites.has(row.spreadsheetId)) pendingWrites.set(row.spreadsheetId, []);
            const updates = pendingWrites.get(row.spreadsheetId)!;

            if (row.routeCodeCol >= 0 && bestRouteCode) {
              const col = colLetter(row.routeCodeCol);
              updates.push({ range: `'${row.sheetName}'!${col}${row.sheetRowNumber}`, values: [[bestRouteCode]] });
            }
            if (row.streetNameCol >= 0 && bestName) {
              const col = colLetter(row.streetNameCol);
              updates.push({ range: `'${row.sheetName}'!${col}${row.sheetRowNumber}`, values: [[bestName]] });
            }
          }
          totalFixed++;
        }

        // Flush writes for this group
        for (const [spreadsheetId, updates] of pendingWrites) {
          if (updates.length === 0) continue;
          await routeFinderSheetsService.applyBatchStreetWrites(spreadsheetId, updates);
        }
      }

      showToast(`Fuzzy sweep complete — ${totalFixed} customers corrected across ${totalCustomers} rows.`);
      setPhase('complete');

    } catch (e: any) {
      console.error('RF fuzzy sweep failed:', e);
      setError(e?.message || 'Fuzzy sweep failed.');
      setPhase('setup');
    }
  };

  // Helpers for fuzzy-only mode
  function normalizeStreetForFuzzy(s: string): string {
    return s.toLowerCase()
      .replace(/(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|lane|ln|place|pl|circle|cir|way|trail|tr|parkway|pkwy|terrace|ter|close|square|sq)/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
  function levenshteinSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;
    const m = a.length, n = b.length;
    const dp = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, dp[j], dp[j-1]);
        prev = tmp;
      }
    }
    return 1 - dp[n] / Math.max(m, n);
  }
  function colLetter(idx: number): string {
    let s = '', c = idx + 1;
    while (c > 0) { c--; s = String.fromCharCode(65 + c % 26) + s; c = Math.floor(c / 26); }
    return s;
  }

  // ─── BUILD CUSTOMER GROUPS ────────────────────────────────────────────────
  async function buildCustomerGroups(
    books: { id: string; label: string }[],
    routes: ApprovedRoute[],
    mappings: RFPrefixMapping[]
  ): Promise<CustomerGroup[]> {
    const customerMap = new Map<string, GeoCustomer>();

    for (const book of books) {
      const tabNames = await routeFinderSheetsService.getCallBookTabs(book.id);
      const sheets   = await routeFinderSheetsService.readCallBookSheets(
        book.id, tabNames,
        (current, total, sheetName) =>
          setScanProgress(p => ({ ...p, message: `Reading ${book.label}: ${sheetName}...` }))
      );

      for (const sheet of sheets) {
        const { CI, rows, sheetName } = sheet;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;

          const routeCode = CI.routeCode >= 0 ? String(row[CI.routeCode] ?? '').trim().toUpperCase() : '';
          if (!routeCode) continue;

          const rawPhone   = CI.phone >= 0    ? String(row[CI.phone] ?? '').trim()    : '';
          const rawArea    = CI.areaCode >= 0 ? String(row[CI.areaCode] ?? '').trim() : '';
          const combinedDigits = (rawArea.replace(/\D/g, '') + rawPhone.replace(/\D/g, '')).slice(-10);
          const phone      = combinedDigits.length === 10 ? combinedDigits : normalizePhone(rawPhone);
          const houseNum   = CI.houseNum >= 0   ? String(row[CI.houseNum] ?? '').trim()   : '';
          const streetName = CI.streetName >= 0 ? String(row[CI.streetName] ?? '').trim() : '';
          const city       = CI.city >= 0       ? String(row[CI.city] ?? '').trim()       : '';
          const firstName  = CI.firstName >= 0  ? String(row[CI.firstName] ?? '').trim()  : '';
          const lastName   = CI.lastName >= 0   ? String(row[CI.lastName] ?? '').trim()   : '';
          const bookingId  = CI.bookingId >= 0  ? String(row[CI.bookingId] ?? '').trim()  : '';
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
              const maxYear = Math.max(...existing.rows.map(r => r.year));
              if (year >= maxYear) {
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

    // Group by call book prefix + city
    const groupMap = new Map<string, CustomerGroup>();
    for (const customer of customerMap.values()) {
      const callBookPrefix = customer.currentRouteCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
      const city = customer.city.trim() || 'Unknown';
      const groupKey = `${callBookPrefix}|${city}`;

      if (!groupMap.has(groupKey)) {
        const mapPrefix = rfPrefixService.resolveMapPrefix(callBookPrefix, city, mappings);
        groupMap.set(groupKey, { callBookPrefix, city, mapPrefix, customers: [] });
      }
      groupMap.get(groupKey)!.customers.push(customer);
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      `${a.callBookPrefix}${a.city}`.localeCompare(`${b.callBookPrefix}${b.city}`)
    );
  }

  // ─── RUN SCAN ─────────────────────────────────────────────────────────────
  async function runScan(sess: RFScanSession, groups: CustomerGroup[], routes: ApprovedRoute[]) {
    let totalFixed = 0;
    let totalQueued = 0;

    for (let g = 0; g < groups.length; g++) {
      if (scanAbortRef.current) break;

      const group = groups[g];
      const groupLabel = `${group.callBookPrefix} / ${group.city}`;

      // Discover map prefix if not already known
      let mapPrefix = group.mapPrefix;
      if (!mapPrefix) {
        mapPrefix = await discoverMapPrefix(group, routes);
        if (mapPrefix) {
          group.mapPrefix = mapPrefix;
          // Derive region from area_prefixes via approved routes
          const matchingRoute = routes.find(r =>
            r.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() === mapPrefix!.toUpperCase()
          );
          // Look up region from area_prefixes via the discovered map prefix
          const matchingArea = areas.find(a => a.prefix.toUpperCase() === mapPrefix.toUpperCase());
          const region = matchingArea?.region || 'West';
          await rfPrefixService.saveMapping({
            region,
            callBookPrefix: group.callBookPrefix,
            cityFilter:     group.city !== 'Unknown' ? group.city : null,
            mapPrefix,
          });
        }
      }

      if (!mapPrefix) {
        // Can't determine map prefix — skip this group
        setScanProgress(p => ({
          ...p,
          message: `Skipping ${groupLabel} — no map prefix found`,
          group: groupLabel,
        }));
        await rfScanSessionService.updateSession(sess.id, {
          groupsCompleted: g + 1,
        });
        continue;
      }

      await rfScanSessionService.updateSession(sess.id, {
        currentGroup: groupLabel,
        groupsCompleted: g,
      });

      const result = await scanGroup({
        sessionId: sess.id,
        mapPrefix,
        areaName: group.city,
        customers: group.customers,
        approvedRoutes: routes,
        mapboxToken: import.meta.env.VITE_MAPBOX_TOKEN as string,
        onProgress: ({ current, total, message, fixed, queued }) => {
          setScanProgress({
            current,
            total,
            message,
            fixed: totalFixed + fixed,
            queued: totalQueued + queued,
            group: groupLabel,
          });
        },
        isPaused: () => isPausedRef.current,
      });

      totalFixed  += result.fixed;
      totalQueued += result.queued;

      // Run post-filter immediately after this group — while mapPrefix is known
      // and before moving to the next group. Catches garbled street names that
      // the scan queued but can be resolved from local segment data.
      if (!result.paused) {
        setScanProgress(p => ({
          ...p,
          message: `Post-filtering ${groupLabel}...`,
          group: groupLabel,
        }));

        const postResult = await runQueuePostFilter({
          sessionId: sess.id,
          approvedRoutes: routes,
          mapPrefix,
          onProgress: (current, total) => {
            setScanProgress(p => ({
              ...p,
              message: `Post-filtering ${groupLabel}: ${current} of ${total}...`,
            }));
          },
        });

        totalFixed  += postResult.resolved;
        totalQueued -= postResult.resolved;
      }

      await rfScanSessionService.updateSession(sess.id, {
        groupsCompleted:  g + 1,
        customersFixed:   totalFixed,
        customersQueued:  totalQueued,
      });

      if (result.paused) {
        await rfScanSessionService.updateSession(sess.id, { status: 'scanning' });
        setIsPaused(true);
        return;
      }
    }

    await rfScanSessionService.updateSession(sess.id, {
      status:          'reviewing',
      currentGroup:    null,
      customersFixed:  totalFixed,
      customersQueued: totalQueued,
    });

    // Load review queue
    const entries  = await rfScanSessionService.loadPendingQueue(sess.id);
    const counts   = await rfScanSessionService.getQueueCounts(sess.id);
    const prefixes = await rfScanSessionService.getPendingPrefixes(sess.id);

    setQueueEntries(entries);
    setQueueCounts(counts);
    setPendingPrefixes(prefixes);
    if (prefixes.length > 0) setActivePrefixFilter(prefixes[0]);

    setPhase(entries.length > 0 ? 'reviewing' : 'complete');
  }

  async function continueScan(sess: RFScanSession, routes: ApprovedRoute[]) {
    // For resume: we'd need to rebuild groups from where we left off
    // For now just go to reviewing since queue is already built
    const entries  = await rfScanSessionService.loadPendingQueue(sess.id);
    const counts   = await rfScanSessionService.getQueueCounts(sess.id);
    const prefixes = await rfScanSessionService.getPendingPrefixes(sess.id);
    setQueueEntries(entries);
    setQueueCounts(counts);
    setPendingPrefixes(prefixes);
    if (prefixes.length > 0) setActivePrefixFilter(prefixes[0]);
    setPhase('reviewing');
  }

  // ─── AUTO-DISCOVER MAP PREFIX ─────────────────────────────────────────────
  async function discoverMapPrefix(
    group: CustomerGroup,
    routes: ApprovedRoute[]
  ): Promise<string | null> {
    const sample = group.customers.slice(0, DISCOVERY_SAMPLE_SIZE);
    const token  = import.meta.env.VITE_MAPBOX_TOKEN as string;
    const prefixVotes = new Map<string, number>();

    for (const customer of sample) {
      const result = await geocodeAddress(
        customer.houseNum, customer.streetName, customer.city, token
      );
      if (!result) continue;

      const match = findClosestRoute(result.lat, result.lng, routes);
      if (!match) continue;

      const prefix = match.routeCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
      if (prefix) prefixVotes.set(prefix, (prefixVotes.get(prefix) || 0) + 1);
    }

    if (prefixVotes.size === 0) return null;

    // Return the prefix with the most votes
    let bestPrefix = '';
    let bestCount  = 0;
    for (const [prefix, count] of prefixVotes) {
      if (count > bestCount) { bestCount = count; bestPrefix = prefix; }
    }

    return bestPrefix || null;
  }

  // ─── CONFIRM FIX (manual review) ─────────────────────────────────────────
  const handleConfirmFix = useCallback(async (
    entry: RFQueueEntry,
    newRouteCode: string,
    newStreetName: string
  ) => {
    if (!session) return;
    setApplying(true);
    setError(null);

    try {
      for (const row of entry.rows) {
        await routeFinderSheetsService.applyFix(
          row.spreadsheetId, row.sheetName, row.sheetRowNumber,
          row.routeCodeCol, row.streetNameCol,
          newRouteCode, newStreetName,
        );
      }

      await rfScanSessionService.markFixed({
        entryId: entry.id,
        newRouteCode,
        newStreetName,
        fixedBy: 'manual',
      });

      await rfScanSessionService.updateSession(session.id, {
        customersFixed: (session.customersFixed || 0) + 1,
      });

      setQueueEntries(prev => prev.filter(e => e.id !== entry.id));
      setSelectedEntry(null);
      setQueueCounts(prev => ({ ...prev, pending: prev.pending - 1, fixed: prev.fixed + 1 }));
      showToast(`Fixed — ${entry.rows.length} row${entry.rows.length > 1 ? 's' : ''} updated.`);

      const remaining = queueEntries.filter(e => e.id !== entry.id && e.status === 'pending');
      if (remaining.length === 0) setPhase('complete');

    } catch (e: any) {
      setError('Fix failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  }, [session, queueEntries, showToast]);

  // ─── CONFIRM CITY (red pins) ──────────────────────────────────────────────
  const handleConfirmCity = useCallback(async (
    entry: RFQueueEntry,
    addToDirectory: boolean
  ) => {
    if (!session) return;
    const cityValue = entry.city.trim();
    setApplying(true);
    setError(null);

    try {
      if (cityValue) {
        for (const row of entry.rows) {
          await routeFinderSheetsService.applyFix(
            row.spreadsheetId, row.sheetName, row.sheetRowNumber,
            row.routeCodeCol, -1,
            cityValue, '',
          );
        }
      }

      // Optionally add to segment directory
      if (addToDirectory && entry.streetName) {
        const added = await rfSegmentDirectoryService.addSegmentName({
          routeCode:    entry.currentRouteCode,
          segmentName:  entry.streetName,
          midpointLat:  entry.lat ?? undefined,
          midpointLng:  entry.lng ?? undefined,
        });

        if (added) {
          // Reload routes and re-match pending entries
          const freshRoutes = await rfSegmentDirectoryService.reloadRoutes();
          setApprovedRoutes(freshRoutes);

          const resolvable = await rfScanSessionService.findResolvableBySegmentName(
            session.id, entry.streetName, entry.mapPrefix
          );

          if (resolvable.length > 0) {
            showToast(`Added "${entry.streetName}" to directory — ${resolvable.length} other customer${resolvable.length > 1 ? 's' : ''} may now resolve.`);
          }
        }
      }

      await rfScanSessionService.markFixed({
        entryId:       entry.id,
        newRouteCode:  cityValue || entry.currentRouteCode,
        newStreetName: entry.streetName,
        fixedBy:       'manual',
      });

      setQueueEntries(prev => prev.filter(e => e.id !== entry.id));
      setSelectedEntry(null);
      setQueueCounts(prev => ({ ...prev, pending: prev.pending - 1, fixed: prev.fixed + 1 }));
      showToast(cityValue ? `Route code set to "${cityValue}".` : 'Marked as handled.');

    } catch (e: any) {
      setError('Fix failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setApplying(false);
    }
  }, [session, showToast]);

  const handleSkip = useCallback(async (entryId: string) => {
    await rfScanSessionService.markSkipped(entryId);
    setQueueEntries(prev => prev.filter(e => e.id !== entryId));
    setSelectedEntry(null);
    setQueueCounts(prev => ({ ...prev, pending: prev.pending - 1, skipped: prev.skipped + 1 }));
  }, []);

  const handlePause = useCallback(() => {
    isPausedRef.current = true;
    setIsPaused(true);
  }, []);

  // Filtered entries for current prefix
  const filteredEntries = activePrefixFilter
    ? queueEntries.filter(e => e.mapPrefix === activePrefixFilter)
    : queueEntries;

  // ─── RENDER: AUTH ─────────────────────────────────────────────────────────
  if (phase === 'auth') return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      <div className="flex items-center px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="w-px h-5 bg-gray-700 mx-3" />
        <Navigation size={18} className="text-blue-400 mr-2" />
        <span className="font-bold">Route Finder</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <MapPin className="text-blue-400" size={48} />
          <div className="text-center">
            <h2 className="text-xl font-bold mb-1">Route Finder</h2>
            <p className="text-gray-400 text-sm">Connect to Google to access your call books</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={handleConnect}
            disabled={isAuthenticating}
            className="flex items-center gap-3 bg-white hover:bg-gray-100 text-gray-800 px-6 py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {isAuthenticating ? <Loader className="animate-spin" size={20} /> : (
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
      </div>
    </div>
  );

  // ─── RENDER: SETUP ────────────────────────────────────────────────────────
  if (phase === 'setup') return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      <div className="flex items-center px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="w-px h-5 bg-gray-700 mx-3" />
        <Navigation size={18} className="text-blue-400 mr-2" />
        <span className="font-bold">Route Finder</span>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-bold mb-1">Full Route Scan</h2>
            <p className="text-gray-400 text-sm">
              Scans both call books across all prefixes. Auto-fixes same-prefix customers,
              queues everything else for review.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Aeration Call Book <span className="text-gray-500 font-normal text-xs">optional</span>
              </label>
              <input
                type="text"
                value={aerationInput}
                onChange={e => { setAerationInput(e.target.value); setExistingSession(null); }}
                onBlur={checkForExistingSession}
                placeholder="Paste Google Sheets URL or spreadsheet ID"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Sealing Call Book <span className="text-gray-500 font-normal text-xs">optional</span>
              </label>
              <input
                type="text"
                value={sealingInput}
                onChange={e => { setSealingInput(e.target.value); setExistingSession(null); }}
                onBlur={checkForExistingSession}
                placeholder="Paste Google Sheets URL or spreadsheet ID"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500"
              />
            </div>
          </div>

          {/* Existing session banner */}
          {checkingSession && (
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <Loader size={14} className="animate-spin" /> Checking for existing session...
            </div>
          )}
          {existingSession && !checkingSession && (
            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
              <p className="text-blue-300 font-medium text-sm mb-1">Existing session found</p>
              <p className="text-gray-400 text-xs mb-3">
                {existingSession.groupsCompleted} of {existingSession.groupsTotal} groups completed ·{' '}
                {existingSession.customersFixed} fixed · {existingSession.customersQueued} queued
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleResume}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Resume Session
                </button>
                <button
                  onClick={() => setExistingSession(null)}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors"
                >
                  Start Fresh
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {(!existingSession || checkingSession) && (
            <div className="space-y-3">
              <button
                onClick={handleStartScan}
                disabled={!aerationInput.trim() && !sealingInput.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Search size={18} /> Full Scan (Geocode + Fuzzy)
              </button>
              <button
                onClick={handleFuzzyOnly}
                disabled={!aerationInput.trim() && !sealingInput.trim()}
                className="w-full bg-indigo-700 hover:bg-indigo-600 text-white py-3 rounded-lg font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <RefreshCw size={18} /> Fuzzy Fix Only (No Geocoding)
              </button>
              <p className="text-xs text-gray-600 text-center">
                Fuzzy Fix sweeps the existing queue using street name matching — no Mapbox calls
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ─── RENDER: SCANNING ─────────────────────────────────────────────────────
  if (phase === 'scanning') return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center gap-3">
          <Navigation size={18} className="text-blue-400" />
          <span className="font-bold">Route Finder — Scanning</span>
        </div>
        <button
          onClick={handlePause}
          disabled={isPaused}
          className="flex items-center gap-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPaused ? <Play size={12} /> : <Pause size={12} />}
          {isPaused ? 'Paused' : 'Pause'}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md space-y-6 p-8">
          <div className="text-center">
            {isPaused ? (
              <Pause className="text-yellow-400 mx-auto mb-4" size={40} />
            ) : (
              <Loader className="animate-spin text-blue-400 mx-auto mb-4" size={40} />
            )}
            <p className="text-white font-medium">{scanProgress.message || 'Preparing...'}</p>
            {scanProgress.group && (
              <p className="text-gray-400 text-sm mt-1">{scanProgress.group}</p>
            )}
          </div>

          {scanProgress.total > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{scanProgress.current.toLocaleString()} of {scanProgress.total.toLocaleString()}</span>
                <span>{Math.round(scanProgress.current / scanProgress.total * 100)}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-150"
                  style={{ width: `${Math.min(100, scanProgress.current / scanProgress.total * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4 text-center border border-gray-700">
              <p className="text-2xl font-bold text-green-400">{scanProgress.fixed.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Auto-fixed</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 text-center border border-gray-700">
              <p className="text-2xl font-bold text-orange-400">{scanProgress.queued.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Queued for review</p>
            </div>
          </div>

          {isPaused && (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 text-center">
              <p className="text-yellow-300 text-sm font-medium">Scan paused</p>
              <p className="text-gray-500 text-xs mt-1">Progress saved. You can close and resume later.</p>
              <button
                onClick={() => setPhase('reviewing')}
                className="mt-3 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Go to Review Queue
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ─── RENDER: COMPLETE ─────────────────────────────────────────────────────
  if (phase === 'complete') return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      <div className="flex items-center px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm">
          <ArrowLeft size={16} /> Back
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-6 text-center">
          <CheckCircle className="text-emerald-400" size={64} />
          <div>
            <h2 className="text-2xl font-bold mb-2">All Done!</h2>
            <p className="text-gray-400">
              {queueCounts.fixed} customers fixed · {queueCounts.skipped} skipped
            </p>
          </div>
          <button
            onClick={() => { setPhase('setup'); setQueueEntries([]); setSession(null); }}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg text-sm"
          >
            <RefreshCw size={15} /> Start New Scan
          </button>
        </div>
      </div>
    </div>
  );

  // ─── RENDER: REVIEWING ────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="w-px h-5 bg-gray-700" />
          <Navigation size={18} className="text-blue-400" />
          <span className="font-bold">Route Finder — Review</span>
        </div>
        <div className="text-xs text-gray-500">
          {queueCounts.pending} pending · {queueCounts.fixed} fixed
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — prefix list + queue */}
        <div className="w-72 border-r border-gray-700 flex flex-col bg-gray-800 flex-shrink-0">
          {/* Prefix tabs */}
          <div className="p-3 border-b border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Areas</p>
            <div className="flex flex-wrap gap-1.5">
              {pendingPrefixes.map(prefix => (
                <button
                  key={prefix}
                  onClick={() => { setActivePrefixFilter(prefix); setSelectedEntry(null); }}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-colors ${
                    activePrefixFilter === prefix
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {prefix}
                </button>
              ))}
              <button
                onClick={() => { setActivePrefixFilter(null); setSelectedEntry(null); }}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  activePrefixFilter === null
                    ? 'bg-blue-700 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                All
              </button>
            </div>
          </div>

          {/* Queue list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-700/40">
            {filteredEntries.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-600">
                No pending items for this area
              </div>
            ) : (
              filteredEntries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => setSelectedEntry(entry)}
                  className={`w-full text-left px-3 py-3 transition-colors ${
                    selectedEntry?.id === entry.id
                      ? 'bg-gray-700'
                      : 'hover:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-200 font-medium truncate">
                        {[entry.firstName, entry.lastName].filter(Boolean).join(' ') || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {[entry.houseNum, entry.streetName].filter(Boolean).join(' ')}
                      </p>
                      <p className="text-xs font-mono text-gray-600">{entry.currentRouteCode}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: entry.pinColor === 'orange' ? PIN_COLORS.orange : PIN_COLORS.red }}
                      />
                      <ChevronRight size={12} className="text-gray-600" />
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Map */}
        <div className="relative flex-1">
          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', inset: 0 }}
          />
          {!mapLoaded && (
            <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center">
              <Loader size={18} className="animate-spin text-blue-400" />
            </div>
          )}
        </div>

        {/* Right panel — detail */}
        {selectedEntry && (
          <ReviewDetailPanel
            entry={selectedEntry}
            applying={applying}
            error={error}
            onConfirmFix={handleConfirmFix}
            onConfirmCity={handleConfirmCity}
            onSkip={() => handleSkip(selectedEntry.id)}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 text-white text-sm px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2 z-50">
          <CheckCircle size={15} className="text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
};

// ─── REVIEW DETAIL PANEL ─────────────────────────────────────────────────────

interface ReviewDetailPanelProps {
  entry: RFQueueEntry;
  applying: boolean;
  error: string | null;
  onConfirmFix: (entry: RFQueueEntry, newRouteCode: string, newStreetName: string) => void;
  onConfirmCity: (entry: RFQueueEntry, addToDirectory: boolean) => void;
  onSkip: () => void;
}

const ReviewDetailPanel: React.FC<ReviewDetailPanelProps> = ({
  entry, applying, error, onConfirmFix, onConfirmCity, onSkip,
}) => {
  const [editRoute, setEditRoute]   = useState(entry.suggestedRouteCode || entry.currentRouteCode);
  const [editStreet, setEditStreet] = useState(entry.streetName);
  const [addToDir, setAddToDir]     = useState(true);
  const isRed = entry.pinColor === 'red';

  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(
    [entry.houseNum, entry.streetName, entry.city].filter(Boolean).join(' ')
  )}`;

  const serviceHistory = [...(entry.rows || [])]
    .filter(r => r.year > 0)
    .sort((a, b) => b.year - a.year);

  return (
    <div className="w-80 border-l border-gray-700 bg-gray-800 flex flex-col overflow-hidden flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-start justify-between flex-shrink-0">
        <div className="min-w-0">
          <h3 className="font-bold text-white text-base truncate">
            {[entry.firstName, entry.lastName].filter(Boolean).join(' ') || 'Unknown'}
          </h3>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-0.5"
          >
            <MapPin size={11} />
            <span className="truncate">
              {[entry.houseNum, entry.streetName, entry.city].filter(Boolean).join(', ')}
            </span>
          </a>
          {entry.phone && <p className="text-xs text-gray-500 mt-0.5 font-mono">{entry.phone}</p>}
        </div>
        <button onClick={onSkip} className="text-gray-500 hover:text-white p-1">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isRed ? (
          <>
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
              <p className="text-sm text-red-300 font-medium">No approved route found nearby</p>
              <p className="text-xs text-gray-500 mt-1">
                Confirming writes city as route code.
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Current Route</p>
              <span className="font-mono text-red-300 bg-red-900/30 border border-red-700/50 px-2 py-1 rounded text-sm font-bold">
                {entry.currentRouteCode}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Will Be Replaced With</p>
              {entry.city ? (
                <span className="font-mono text-blue-300 bg-blue-900/30 border border-blue-700/50 px-2 py-1 rounded text-sm font-bold">
                  {entry.city}
                </span>
              ) : (
                <span className="text-xs text-gray-600 italic">No city — will only mark as handled</span>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={addToDir}
                onChange={e => setAddToDir(e.target.checked)}
                className="rounded"
              />
              Add "{entry.streetName}" to segment directory
            </label>
          </>
        ) : (
          <>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Current Route</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-orange-300 bg-orange-900/30 border border-orange-700/50 px-2 py-1 rounded text-sm font-bold">
                  {entry.currentRouteCode}
                </span>
                <span className="text-gray-400 text-xs">{entry.streetName}</span>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Proximity Suggests</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-blue-300 bg-blue-900/30 border border-blue-700/50 px-2 py-1 rounded text-sm font-bold">
                  {entry.suggestedRouteCode}
                </span>
                <span className="text-gray-400 text-xs">{entry.suggestedSegmentName}</span>
              </div>
              {entry.distanceDeg > 0 && (
                <p className="text-xs text-gray-600 mt-1">
                  {Math.round(entry.distanceDeg * 111000)}m from nearest drawn segment
                </p>
              )}
            </div>
            <div className="border-t border-gray-700 pt-4 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Apply Fix</p>
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
          </>
        )}

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

        {entry.rows.length > 1 && (
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-2.5 text-xs text-blue-300">
            Updates {entry.rows.length} rows across {entry.rows.length} years of history
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2.5 text-red-400 text-xs">
            {error}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-700 space-y-2 flex-shrink-0">
        {isRed ? (
          <button
            onClick={() => onConfirmCity(entry, addToDir)}
            disabled={applying}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {applying ? <Loader size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            {entry.city ? `Set Route to "${entry.city}"` : 'Mark as Handled'}
          </button>
        ) : (
          <button
            onClick={() => onConfirmFix(entry, editRoute, editStreet)}
            disabled={applying || !editRoute.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {applying ? <Loader size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            Confirm Fix
          </button>
        )}
        <button
          onClick={onSkip}
          disabled={applying}
          className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
};

export default RouteFinderV2View;
// src/components/RouteFinder/RouteFinderV2View.tsx
//
// Route Finder — suggestion writer.
//
// Phases:
//   auth      — connect to Google
//   setup     — enter aeration spreadsheet ID
//   scanning  — geocoding + fuzzy matching with live progress
//   complete  — done, counts shown
//
// What it does:
//   - Reads the aeration call book across all tabs
//   - Groups customers by call book prefix + city
//   - Runs 3-pass geocoding to find the best route for each customer
//   - Inserts "Suggested RC" and "Suggested Street" columns next to the
//     originals (or clears them if they already exist from a prior run)
//   - Writes suggestions with colour coding:
//       green  = same route, spelling standardization only
//       yellow = different route found via geocode
//       orange = geocode failed, fuzzy street-name match used
//       red    = no match found at all
//

import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Navigation, Search, Loader, CheckCircle, RefreshCw,
} from 'lucide-react';

import { routeFinderSheetsService } from '../../lib/routeFinder/routeFinderSheetsService';
import { rfPrefixService, RFPrefixMapping } from '../../lib/routeFinder/rfPrefixService';
import { scanGroup, SuggestionEntry } from '../../lib/routeFinder/rfScanEngine';
import {
  loadApprovedRoutes,
  getRouteCentroid,
  geocodeAddress,
  findClosestRoute,
  normalizePhone,
  ApprovedRoute,
  GeoCustomer,
  CustomerRow,
} from '../../lib/routeFinder/routeFinderGeoService';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Phase = 'auth' | 'setup' | 'scanning' | 'complete';

interface CustomerGroup {
  callBookPrefix: string;
  city: string;
  mapPrefix: string | null;
  customers: GeoCustomer[];
}

interface Props {
  onBack: () => void;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const DISCOVERY_SAMPLE_SIZE = 20;

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const RouteFinderV2View: React.FC<Props> = ({ onBack }) => {
  const [phase, setPhase]                 = useState<Phase>('auth');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [aerationInput, setAerationInput] = useState(() => localStorage.getItem('rfv2_aeration_id') || '');
  const [error, setError]                 = useState<string | null>(null);

  const [scanProgress, setScanProgress] = useState({
    current: 0, total: 0, message: '', group: '',
    green: 0, yellow: 0, orange: 0, red: 0,
  });

  const [completeCounts, setCompleteCounts] = useState({
    green: 0, yellow: 0, orange: 0, red: 0,
  });

  // ─── Auth check ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (routeFinderSheetsService.isAuthenticated()) setPhase('setup');
    else setPhase('auth');
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

  // ─── MAIN SCAN ────────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    const resolveId = (raw: string) => {
      const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : raw.trim();
    };

    const aerationId = aerationInput.trim() ? resolveId(aerationInput) : null;
    if (!aerationId) {
      setError('Please enter a spreadsheet ID or URL.');
      return;
    }

    localStorage.setItem('rfv2_aeration_id', aerationId);
    setError(null);
    setPhase('scanning');

    try {
      // 1. Load routes + prefix mappings
      setScanProgress({ current: 0, total: 0, message: 'Loading route maps...', group: '', green: 0, yellow: 0, orange: 0, red: 0 });
      const routes = await loadApprovedRoutes();

      setScanProgress(p => ({ ...p, message: 'Loading prefix mappings...' }));
      const [mW, mC, mE] = await Promise.all([
        rfPrefixService.loadMappings('West'),
        rfPrefixService.loadMappings('Central'),
        rfPrefixService.loadMappings('East'),
      ]);
      const mappings = [...mW, ...mC, ...mE];

      // 2. Validate spreadsheet
      setScanProgress(p => ({ ...p, message: 'Validating spreadsheet...' }));
      const v = await routeFinderSheetsService.validateSpreadsheet(aerationId);
      if (!v.valid) { setError(v.error || 'Invalid spreadsheet.'); setPhase('setup'); return; }

      // 3. Get tab names with numeric sheet IDs (needed for column operations)
      setScanProgress(p => ({ ...p, message: 'Getting sheet info...' }));
      const tabsWithIds = await routeFinderSheetsService.getCallBookTabsWithIds(aerationId);
      const sheetIdByName = new Map<string, number>();
      for (const t of tabsWithIds) sheetIdByName.set(t.title, t.sheetId);

      // 4. Read call book sheets + capture column positions per tab
      setScanProgress(p => ({ ...p, message: 'Reading call book...' }));
      const sheetColumnMap = new Map<string, {
        routeCodeCol: number;
        streetNameCol: number;
        headerRowIndex: number;
      }>();

      const groups = await buildCustomerGroups(
        [{ id: aerationId, label: 'Aeration' }],
        routes,
        mappings,
        sheetColumnMap
      );

      // 5. Set up "Suggested RC" / "Suggested Street" columns per tab
      setScanProgress(p => ({ ...p, message: 'Setting up suggestion columns...' }));
      const suggestedColBySheet = new Map<string, {
        suggestedRCCol: number;
        suggestedStreetCol: number;
      }>();

      for (const [sheetName, colInfo] of sheetColumnMap) {
        if (colInfo.routeCodeCol < 0 || colInfo.streetNameCol < 0) continue;
        const sheetId = sheetIdByName.get(sheetName);
        if (sheetId === undefined) continue;

        setScanProgress(p => ({ ...p, message: `Setting up columns: ${sheetName}...` }));
        const result = await routeFinderSheetsService.setupSuggestedColumns(
          aerationId, sheetId, sheetName,
          colInfo.routeCodeCol, colInfo.streetNameCol, colInfo.headerRowIndex
        );
        suggestedColBySheet.set(sheetName, result);
      }

      // 6. Scan all customer groups
      const allSuggestions: SuggestionEntry[] = [];
      let totalGreen = 0, totalYellow = 0, totalOrange = 0, totalRed = 0;

      for (let g = 0; g < groups.length; g++) {
        const group      = groups[g];
        const groupLabel = `${group.callBookPrefix} / ${group.city}`;

        // Discover map prefix if not already known
        let mapPrefix = group.mapPrefix;
        if (!mapPrefix) {
          setScanProgress(p => ({
            ...p,
            message: `Discovering map prefix for ${groupLabel}...`,
            group: groupLabel,
          }));
          mapPrefix = await discoverMapPrefix(group, routes);
          if (mapPrefix) {
            group.mapPrefix = mapPrefix;
            await rfPrefixService.saveMapping({
              region:         'West',
              callBookPrefix: group.callBookPrefix,
              cityFilter:     group.city !== 'Unknown' ? group.city : null,
              mapPrefix,
            });
          }
        }

        if (!mapPrefix) {
          setScanProgress(p => ({
            ...p,
            message: `Skipping ${groupLabel} — no map prefix found`,
            group: groupLabel,
          }));
          continue;
        }

        const result = await scanGroup({
          mapPrefix,
          customers:     group.customers,
          approvedRoutes: routes,
          mapboxToken:   import.meta.env.VITE_MAPBOX_TOKEN as string,
          onProgress:    ({ current, total, message, green, yellow, orange, red }) => {
            setScanProgress({
              current,
              total,
              message,
              group: groupLabel,
              green:  totalGreen  + green,
              yellow: totalYellow + yellow,
              orange: totalOrange + orange,
              red:    totalRed    + red,
            });
          },
        });

        allSuggestions.push(...result.suggestions);
        totalGreen  += result.green;
        totalYellow += result.yellow;
        totalOrange += result.orange;
        totalRed    += result.red;
      }

      // 7. Write suggestions per sheet tab
      // Group suggestions by sheet name (single spreadsheet — aeration only)
      const suggestionsBySheet = new Map<string, SuggestionEntry[]>();
      for (const s of allSuggestions) {
        if (!suggestionsBySheet.has(s.sheetName)) suggestionsBySheet.set(s.sheetName, []);
        suggestionsBySheet.get(s.sheetName)!.push(s);
      }

      let writtenSheets = 0;
      for (const [sheetName, sheetSuggestions] of suggestionsBySheet) {
        writtenSheets++;
        const sheetId = sheetIdByName.get(sheetName);
        const colInfo = suggestedColBySheet.get(sheetName);
        if (sheetId === undefined || !colInfo) continue;

        setScanProgress(p => ({
          ...p,
          message: `Writing suggestions: ${sheetName} (${writtenSheets} of ${suggestionsBySheet.size})...`,
        }));

        await routeFinderSheetsService.writeSuggestionsBatch(
          aerationId, sheetId, sheetSuggestions,
          colInfo.suggestedRCCol, colInfo.suggestedStreetCol
        );
      }

      setCompleteCounts({ green: totalGreen, yellow: totalYellow, orange: totalOrange, red: totalRed });
      setPhase('complete');

    } catch (e: any) {
      console.error('RF scan failed:', e);
      setError(e?.message || 'Scan failed.');
      setPhase('setup');
    }
  };

  // ─── BUILD CUSTOMER GROUPS ────────────────────────────────────────────────
  async function buildCustomerGroups(
    books: { id: string; label: string }[],
    routes: ApprovedRoute[],
    mappings: RFPrefixMapping[],
    sheetColumnMap: Map<string, { routeCodeCol: number; streetNameCol: number; headerRowIndex: number }>
  ): Promise<CustomerGroup[]> {
    const customerMap = new Map<string, GeoCustomer>();

    for (const book of books) {
      const tabNames = await routeFinderSheetsService.getCallBookTabs(book.id);
      const sheets   = await routeFinderSheetsService.readCallBookSheets(
        book.id, tabNames,
        (_current, _total, sheetName) =>
          setScanProgress(p => ({ ...p, message: `Reading ${book.label}: ${sheetName}...` }))
      );

      for (const sheet of sheets) {
        const { CI, rows, sheetName } = sheet;

        // Capture column positions for this tab (used later in setupSuggestedColumns)
        sheetColumnMap.set(sheetName, {
          routeCodeCol:   CI.routeCode,
          streetNameCol:  CI.streetName,
          headerRowIndex: CI.headerRowIndex,
        });

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[0]) continue;

          const routeCode = CI.routeCode >= 0 ? String(row[CI.routeCode] ?? '').trim().toUpperCase() : '';
          if (!routeCode) continue;

          const rawPhone  = CI.phone >= 0    ? String(row[CI.phone]    ?? '').trim() : '';
          const rawArea   = CI.areaCode >= 0 ? String(row[CI.areaCode] ?? '').trim() : '';
          const combined  = (rawArea.replace(/\D/g, '') + rawPhone.replace(/\D/g, '')).slice(-10);
          const phone     = combined.length === 10 ? combined : normalizePhone(rawPhone);

          const houseNum   = CI.houseNum   >= 0 ? String(row[CI.houseNum]   ?? '').trim() : '';
          const streetName = CI.streetName >= 0 ? String(row[CI.streetName] ?? '').trim() : '';
          const city       = CI.city       >= 0 ? String(row[CI.city]       ?? '').trim() : '';
          const firstName  = CI.firstName  >= 0 ? String(row[CI.firstName]  ?? '').trim() : '';
          const lastName   = CI.lastName   >= 0 ? String(row[CI.lastName]   ?? '').trim() : '';
          const bookingId  = CI.bookingId  >= 0 ? String(row[CI.bookingId]  ?? '').trim() : '';
          const year       = CI.year       >= 0 ? (parseInt(String(row[CI.year] ?? ''), 10) || 0) : 0;

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
              suggestedRouteCode:   routeCode,
              suggestedSegmentName: '',
              distanceDeg: 0,
              noRouteFound: false,
            });
          }
        }
      }
    }

    // Group customers by call book prefix + city
    const groupMap = new Map<string, CustomerGroup>();
    for (const customer of customerMap.values()) {
      const callBookPrefix = customer.currentRouteCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
      const city           = customer.city.trim() || 'Unknown';
      const key            = `${callBookPrefix}|${city}`;

      if (!groupMap.has(key)) {
        const mapPrefix = rfPrefixService.resolveMapPrefix(callBookPrefix, city, mappings);
        groupMap.set(key, { callBookPrefix, city, mapPrefix, customers: [] });
      }
      groupMap.get(key)!.customers.push(customer);
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      `${a.callBookPrefix}${a.city}`.localeCompare(`${b.callBookPrefix}${b.city}`)
    );
  }

  // ─── AUTO-DISCOVER MAP PREFIX ─────────────────────────────────────────────
  async function discoverMapPrefix(
    group: CustomerGroup,
    routes: ApprovedRoute[]
  ): Promise<string | null> {
    const sample = group.customers.slice(0, DISCOVERY_SAMPLE_SIZE);
    const token  = import.meta.env.VITE_MAPBOX_TOKEN as string;
    const votes  = new Map<string, number>();

    for (const customer of sample) {
      const geo = await geocodeAddress(customer.houseNum, customer.streetName, customer.city, token);
      if (!geo) continue;
      const match = findClosestRoute(geo.lat, geo.lng, routes);
      if (!match) continue;
      const prefix = match.routeCode.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase() || '';
      if (prefix) votes.set(prefix, (votes.get(prefix) || 0) + 1);
    }

    if (votes.size === 0) return null;

    let bestPrefix = '', bestCount = 0;
    for (const [prefix, count] of votes) {
      if (count > bestCount) { bestCount = count; bestPrefix = prefix; }
    }
    return bestPrefix || null;
  }

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
          <Navigation className="text-blue-400" size={48} />
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
            <h2 className="text-xl font-bold mb-1">Route Suggestion Scan</h2>
            <p className="text-gray-400 text-sm">
              Scans your aeration call book and writes colour-coded route suggestions
              directly into the spreadsheet for you to review and approve.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Aeration Call Book
            </label>
            <input
              type="text"
              value={aerationInput}
              onChange={e => setAerationInput(e.target.value)}
              placeholder="Paste Google Sheets URL or spreadsheet ID"
              className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500"
            />
          </div>

          {/* Colour legend */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Suggestion colours</p>
            {[
              { color: '#22C55E', label: 'Green',  desc: 'Same route — spelling standardization only' },
              { color: '#EAB308', label: 'Yellow', desc: 'Different route found via geocode' },
              { color: '#F97316', label: 'Orange', desc: 'Geocode failed — fuzzy street match used' },
              { color: '#EF4444', label: 'Red',    desc: 'No match found' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                <span className="text-xs text-gray-300">
                  <span className="font-medium">{item.label}</span>
                  {' — '}{item.desc}
                </span>
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleStartScan}
            disabled={!aerationInput.trim()}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Search size={18} /> Start Scan
          </button>
        </div>
      </div>
    </div>
  );

  // ─── RENDER: SCANNING ─────────────────────────────────────────────────────
  if (phase === 'scanning') return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900 text-white">
      <div className="flex items-center px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <Navigation size={18} className="text-blue-400 mr-2" />
        <span className="font-bold">Route Finder — Scanning</span>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md space-y-6 p-8">
          <div className="text-center">
            <Loader className="animate-spin text-blue-400 mx-auto mb-4" size={40} />
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

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
              <p className="text-xl font-bold text-green-400">{scanProgress.green.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Same route</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
              <p className="text-xl font-bold text-yellow-400">{scanProgress.yellow.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Re-routed</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
              <p className="text-xl font-bold text-orange-400">{scanProgress.orange.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Fuzzy match</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
              <p className="text-xl font-bold text-red-400">{scanProgress.red.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Not found</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── RENDER: COMPLETE ─────────────────────────────────────────────────────
  return (
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
            <h2 className="text-2xl font-bold mb-2">Scan Complete!</h2>
            <p className="text-gray-400 mb-6">
              Suggestions written to your spreadsheet. Review and approve them there.
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm max-w-xs mx-auto">
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <p className="text-2xl font-bold text-green-400">{completeCounts.green.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">Same route</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <p className="text-2xl font-bold text-yellow-400">{completeCounts.yellow.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">Re-routed</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <p className="text-2xl font-bold text-orange-400">{completeCounts.orange.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">Fuzzy match</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <p className="text-2xl font-bold text-red-400">{completeCounts.red.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">Not found</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setPhase('setup');
              setCompleteCounts({ green: 0, yellow: 0, orange: 0, red: 0 });
            }}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg text-sm"
          >
            <RefreshCw size={15} /> Scan Again
          </button>
        </div>
      </div>
    </div>
  );
};

export default RouteFinderV2View;
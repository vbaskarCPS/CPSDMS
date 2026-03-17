// src/components/RouteFinder/RouteFinderView.tsx
//
// Main Route Finder UI.
// Features:
//   - Click current route/street to populate suggested inputs
//   - Street picker: view all streets on original route (Listings + learned), click to pick
//   - Google Maps button: opens maps search for current address
//   - Group fix popup: same contractor+date+route+street batched into one confirm
//   - Signal popup: click signal to see all rows for that contractor+date
//   - Leave: permanent dismissal, no sheet write, never resurfaces
//   - Accept as-is: learns current values into Listings, no sheet write
//

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft, MapPin, CheckCircle, SkipForward,
  Loader, ChevronDown, ChevronUp, RefreshCw,
  Layers, Zap, Users, Search, X, List,
} from 'lucide-react';

import { routeFinderSheetsService } from '../../lib/routeFinder/routeFinderSheetsService';
import {
  routeFinderSessionService, RouteFinderSession, FixLogEntry,
} from '../../lib/routeFinder/routeFinderSessionService';
import {
  runMatchEngineForSheet, cascadeCheck, normalizeStreetForMatch,
  RouteFinderRow, MatchColor, ListingsData, CallBookSheet, CandidateRoute,
} from '../../lib/routeFinder/routeFinderEngine';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type Phase = 'auth' | 'setup' | 'scanning' | 'working' | 'complete';
type ColorFilter = 'all' | 'phone_group' | 'orange' | 'yellow' | 'red';

interface Props { onBack: () => void; }

interface GroupFixPopupState {
  triggerRow: RouteFinderRow;
  matches: RouteFinderRow[];
  finalRoute: string;
  finalStreet: string;
}

interface SignalPopupRow {
  bookingId: string;
  houseNum: string;
  streetName: string;
  routeCode: string;
  isFlagged: boolean;
}

interface SignalPopupState {
  contractorName: string;
  serviceDate: string;
  rows: SignalPopupRow[];
}

interface StreetPickerState {
  rowId: string;
  routeCode: string;
  streets: string[];
}

const COLOR_CONFIG: Record<MatchColor, { label: string; border: string; badge: string; bg: string }> = {
  phone_group: { label: 'Phone Match', border: 'border-l-4 border-l-emerald-500', badge: 'bg-emerald-900/40 text-emerald-300 border-emerald-700', bg: 'hover:bg-emerald-950/20' },
  orange:      { label: 'Typo',        border: 'border-l-4 border-l-orange-500',  badge: 'bg-orange-900/40 text-orange-300 border-orange-700',   bg: 'hover:bg-orange-950/20' },
  yellow:      { label: 'Wrong Route', border: 'border-l-4 border-l-yellow-500',  badge: 'bg-yellow-900/40 text-yellow-300 border-yellow-700',   bg: 'hover:bg-yellow-950/20' },
  red:         { label: 'No Match',    border: 'border-l-4 border-l-red-500',     badge: 'bg-red-900/40 text-red-300 border-red-700',            bg: 'hover:bg-red-950/20' },
};

const PAGE_SIZE = 100;

// ─── COMPONENT ────────────────────────────────────────────────────────────────

const RouteFinderView: React.FC<Props> = ({ onBack }) => {
  const [phase, setPhase]                 = useState<Phase>('auth');
  const [spreadsheetId, setSpreadsheetId] = useState(() => routeFinderSessionService.getSavedSpreadsheetId());
  const [spreadsheetInput, setSpreadsheetInput] = useState(() => routeFinderSessionService.getSavedSpreadsheetId());
  const [session, setSession]             = useState<RouteFinderSession | null>(null);
  const [listingsData, setListingsData]   = useState<ListingsData | null>(null);
  const [sheets, setSheets]               = useState<CallBookSheet[]>([]);
  const [queue, setQueue]                 = useState<RouteFinderRow[]>([]);
  const [visibleCount, setVisibleCount]   = useState(PAGE_SIZE);
  const [scanProgress, setScanProgress]   = useState({ current: 0, total: 0, sheet: '' });
  const [editedValues, setEditedValues]   = useState<Record<string, { routeCode: string; streetName: string }>>({});
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, number>>({});
  const [expandedCandidates, setExpandedCandidates] = useState<Set<string>>(new Set());
  const [colorFilter, setColorFilter]     = useState<ColorFilter>('all');
  const [applying, setApplying]           = useState<Set<string>>(new Set());
  const [toast, setToast]                 = useState<string | null>(null);
  const [error, setError]                 = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [bulkApplying, setBulkApplying]   = useState(false);
  const [searchTerm, setSearchTerm]       = useState('');
  const [groupFixPopup, setGroupFixPopup] = useState<GroupFixPopupState | null>(null);
  const [signalPopup, setSignalPopup]     = useState<SignalPopupState | null>(null);
  const [streetPicker, setStreetPicker]   = useState<StreetPickerState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (routeFinderSheetsService.isAuthenticated()) setPhase('setup');
    else setPhase('auth');
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Connect Google ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const ok = await routeFinderSheetsService.authenticate();
      if (ok) setPhase('setup');
      else setError('Failed to connect. Please try again.');
    } catch (e: any) { setError(e?.message || 'Auth failed.'); }
    finally { setIsAuthenticating(false); }
  };

  // ── Scan ───────────────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    const rawId = spreadsheetInput.trim();
    const idMatch = rawId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const resolvedId = idMatch ? idMatch[1] : rawId;
    if (!resolvedId) { setError('Please enter a spreadsheet ID or URL.'); return; }

    setError(null);
    setPhase('scanning');
    setScanProgress({ current: 0, total: 0, sheet: 'Validating...' });

    try {
      const validation = await routeFinderSheetsService.validateSpreadsheet(resolvedId);
      if (!validation.valid) { setError(validation.error || 'Cannot access spreadsheet.'); setPhase('setup'); return; }

      const hasListings = await routeFinderSheetsService.hasListingsTab(resolvedId);
      if (!hasListings) { setError('No "Listings" tab found.'); setPhase('setup'); return; }

      routeFinderSessionService.saveSpreadsheetId(resolvedId);
      setSpreadsheetId(resolvedId);

      setScanProgress({ current: 0, total: 0, sheet: 'Checking for existing session...' });
      const existingSession = await routeFinderSessionService.loadSession(resolvedId);

      setScanProgress({ current: 0, total: 0, sheet: 'Loading Listings tab...' });
      const listings = await routeFinderSheetsService.readListingsTab(resolvedId);
      setListingsData(listings);

      const tabNames = await routeFinderSheetsService.getCallBookTabs(resolvedId);
      setScanProgress({ current: 0, total: tabNames.length, sheet: '' });

      const loadedSheets = await routeFinderSheetsService.readCallBookSheets(
        resolvedId, tabNames,
        (current, total, sheetName) => setScanProgress({ current, total, sheet: `Loading ${sheetName}...` })
      );
      setSheets(loadedSheets);

      const learnedStreets        = existingSession?.learnedStreets || {};
      const learnedStreetsOriginal = existingSession?.learnedStreetsOriginal || {};
      const allQueueRows: RouteFinderRow[] = [];
      let totalScannedCount = 0;

      for (let i = 0; i < loadedSheets.length; i++) {
        const sheet = loadedSheets[i];
        const { rows: sheetRows, scanned } = await runMatchEngineForSheet(
          { sheet, listingsData: listings, learnedStreets, learnedStreetsOriginal },
          (pct) => setScanProgress({ current: i + pct, total: loadedSheets.length, sheet: `Analysing ${sheet.sheetName}... (${Math.round(pct * 100)}%)` })
        );
        allQueueRows.push(...sheetRows);
        totalScannedCount += scanned;
        setScanProgress({ current: i + 1, total: loadedSheets.length, sheet: `Done: ${sheet.sheetName}` });
      }

      setScanProgress({ current: loadedSheets.length, total: loadedSheets.length, sheet: `Found ${allQueueRows.length} rows to review. Saving session...` });
      await new Promise(resolve => setTimeout(resolve, 50));

      let finalQueue: RouteFinderRow[];
      let activeSession: RouteFinderSession;

      if (existingSession) {
        const dismissedSet = new Set(existingSession.fixLog.map(e => e.rowId));
        finalQueue = allQueueRows.filter(r => !dismissedSet.has(r.id));
        activeSession = existingSession;
      } else {
        finalQueue = allQueueRows;
        activeSession = await routeFinderSessionService.createSession(resolvedId, allQueueRows, totalScannedCount);
      }

      await new Promise(resolve => setTimeout(resolve, 50));
      setQueue(finalQueue);
      setSession(activeSession);
      setVisibleCount(PAGE_SIZE);
      if (finalQueue.length === 0) setPhase('complete');
      else setPhase('working');

    } catch (e: any) {
      console.error('Scan failed:', e);
      setError(e?.message || 'Scan failed. Please try again.');
      setPhase('setup');
    }
  };

  // ── Edit helpers ───────────────────────────────────────────────────────────
  const getEditValues = (row: RouteFinderRow) => {
    const edited = editedValues[row.id];
    const candidateIdx = selectedCandidates[row.id] ?? 0;
    const candidate = row.candidates[candidateIdx];
    return {
      routeCode:  edited?.routeCode  ?? candidate?.routeCode  ?? row.suggestedRouteCode,
      streetName: edited?.streetName ?? candidate?.streetName ?? row.suggestedStreetName,
    };
  };

  const setEditForRow = useCallback((rowId: string, field: 'routeCode' | 'streetName', value: string) => {
    setEditedValues(prev => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || { routeCode: '', streetName: '' }), [field]: value },
    }));
  }, []);

  // ── Street picker ──────────────────────────────────────────────────────────
  const handleOpenStreetPicker = useCallback((row: RouteFinderRow) => {
    if (!listingsData || !session) return;
    const rc = row.currentRouteCode.toUpperCase();

    // Listings streets for this route (original display values)
    const listingsStreets = listingsData.routeMapOriginal.get(rc) || [];

    // Learned streets for this route
    const learnedStreets = session.learnedStreetsOriginal[rc] || [];

    // Merge, deduplicate by normalized value
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const s of [...listingsStreets, ...learnedStreets]) {
      const norm = normalizeStreetForMatch(s);
      if (!seen.has(norm)) { seen.add(norm); merged.push(s); }
    }

    setStreetPicker({ rowId: row.id, routeCode: rc, streets: merged });
  }, [listingsData, session]);

  // ── Core write logic ───────────────────────────────────────────────────────
  const executefix = useCallback(async (
    row: RouteFinderRow,
    finalRoute: string,
    finalStreet: string,
    currentQueue: RouteFinderRow[],
    currentSession: RouteFinderSession,
    currentListings: ListingsData,
    extraRowIds: string[] = []
  ): Promise<{ resolvedIds: Set<string>; newFixedRows: number; updatedLearned: Record<string, string[]>; updatedLearnedOriginal: Record<string, string[]> }> => {
    const sheet = sheets.find(s => s.sheetName === row.sheetName);
    if (!sheet) throw new Error(`Sheet "${row.sheetName}" not found.`);

    await routeFinderSheetsService.applyFix(
      spreadsheetId, row.sheetName, row.sheetRowNumber,
      sheet.CI.routeCode, sheet.CI.streetName, finalRoute, finalStreet
    );

    for (const extraId of extraRowIds) {
      const extraRow = currentQueue.find(r => r.id === extraId);
      if (!extraRow) continue;
      const extraSheet = sheets.find(s => s.sheetName === extraRow.sheetName);
      if (!extraSheet) continue;
      await routeFinderSheetsService.applyFix(
        spreadsheetId, extraRow.sheetName, extraRow.sheetRowNumber,
        extraSheet.CI.routeCode, extraSheet.CI.streetName, finalRoute, finalStreet
      );
    }

    let updatedLearned         = currentSession.learnedStreets;
    let updatedLearnedOriginal = currentSession.learnedStreetsOriginal;

    const isNewStreet =
      !currentSession.learnedStreets[finalRoute.toUpperCase()]?.includes(normalizeStreetForMatch(finalStreet)) &&
      !currentListings.routeMap.get(finalRoute.toUpperCase())?.includes(normalizeStreetForMatch(finalStreet));

    if (isNewStreet && finalStreet && finalRoute) {
      await routeFinderSheetsService.appendLearnedStreet(spreadsheetId, finalRoute, finalStreet);
      const result = await routeFinderSessionService.addLearnedStreet({
        sessionId: currentSession.id, routeCode: finalRoute, originalStreet: finalStreet,
        currentLearned: updatedLearned, currentLearnedOriginal: updatedLearnedOriginal,
      });
      updatedLearned         = result.learned;
      updatedLearnedOriginal = result.learnedOriginal;

      const rc   = finalRoute.toUpperCase();
      const norm = normalizeStreetForMatch(finalStreet);
      if (!currentListings.routeMap.has(rc)) currentListings.routeMap.set(rc, []);
      if (!currentListings.routeMap.get(rc)!.includes(norm)) {
        currentListings.routeMap.get(rc)!.push(norm);
        currentListings.routeMapOriginal.get(rc)?.push(finalStreet);
      }
    }

    const cascadeIds = cascadeCheck(finalRoute, finalStreet, currentQueue, currentListings, updatedLearned);
    const allResolvedIds = new Set([row.id, ...extraRowIds, ...cascadeIds]);

    const logEntry: FixLogEntry = {
      rowId: row.id, bookingId: row.bookingId, sheetName: row.sheetName,
      oldRouteCode: row.currentRouteCode, newRouteCode: finalRoute,
      oldStreetName: row.currentStreetName, newStreetName: finalStreet,
      cascadeCount: allResolvedIds.size - 1,
      timestamp: new Date().toISOString(), type: 'fix',
    };

    const { newFixedRows } = await routeFinderSessionService.markRowFixed({
      sessionId: currentSession.id, rowId: row.id, logEntry,
      currentFixedRows: currentSession.fixedRows,
      cascadeResolvedIds: [...extraRowIds, ...cascadeIds],
    });

    return { resolvedIds: allResolvedIds, newFixedRows, updatedLearned, updatedLearnedOriginal };
  }, [sheets, spreadsheetId]);

  // ── Accept — checks for group matches first ────────────────────────────────
  const handleAccept = useCallback(async (row: RouteFinderRow) => {
    if (!session || !listingsData) return;
    const { routeCode: finalRoute, streetName: finalStreet } = getEditValues(row);

    const groupMatches = queue.filter(r =>
      r.id !== row.id &&
      r.contractorName === row.contractorName &&
      r.serviceDate === row.serviceDate &&
      r.currentRouteCode === row.currentRouteCode &&
      r.currentStreetName === row.currentStreetName
    );

    if (groupMatches.length > 0) {
      setGroupFixPopup({ triggerRow: row, matches: groupMatches, finalRoute, finalStreet });
      return;
    }

    await commitFix(row, finalRoute, finalStreet, []);
  }, [session, listingsData, queue, editedValues, selectedCandidates]);

  // ── Commit fix ─────────────────────────────────────────────────────────────
  const commitFix = useCallback(async (
    row: RouteFinderRow,
    finalRoute: string,
    finalStreet: string,
    extraRowIds: string[]
  ) => {
    if (!session || !listingsData) return;

    setApplying(prev => new Set(prev).add(row.id));
    setError(null);
    setGroupFixPopup(null);

    try {
      const { resolvedIds, newFixedRows, updatedLearned, updatedLearnedOriginal } =
        await executefix(row, finalRoute, finalStreet, queue, session, listingsData, extraRowIds);

      setQueue(prev => prev.filter(r => !resolvedIds.has(r.id)));
      setSession(prev => prev ? {
        ...prev, fixedRows: newFixedRows,
        learnedStreets: updatedLearned, learnedStreetsOriginal: updatedLearnedOriginal,
        fixLog: [...prev.fixLog, {
          rowId: row.id, bookingId: row.bookingId, sheetName: row.sheetName,
          oldRouteCode: row.currentRouteCode, newRouteCode: finalRoute,
          oldStreetName: row.currentStreetName, newStreetName: finalStreet,
          cascadeCount: resolvedIds.size - 1, timestamp: new Date().toISOString(), type: 'fix',
        }],
      } : null);

      showToast(resolvedIds.size > 1 ? `Fixed ${resolvedIds.size} rows.` : 'Fixed.');
      if (queue.filter(r => !resolvedIds.has(r.id)).length === 0) setPhase('complete');

    } catch (e: any) {
      setError(`Fix failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setApplying(prev => { const n = new Set(prev); n.delete(row.id); return n; });
    }
  }, [session, listingsData, queue, executefix, showToast]);

  // ── Leave ─────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async (row: RouteFinderRow) => {
    if (!session) return;
    setApplying(prev => new Set(prev).add(row.id));
    try {
      const entry: FixLogEntry = {
        rowId: row.id, bookingId: row.bookingId, sheetName: row.sheetName,
        oldRouteCode: row.currentRouteCode, newRouteCode: row.currentRouteCode,
        oldStreetName: row.currentStreetName, newStreetName: row.currentStreetName,
        cascadeCount: 0, timestamp: new Date().toISOString(), type: 'leave',
      };
      const { newFixedRows } = await routeFinderSessionService.markRowsDismissed({
        sessionId: session.id, entries: [entry], currentFixedRows: session.fixedRows,
      });
      setQueue(prev => prev.filter(r => r.id !== row.id));
      setSession(prev => prev ? { ...prev, fixedRows: newFixedRows, fixLog: [...prev.fixLog, entry] } : null);
      showToast('Left — will not resurface.');
    } catch (e: any) { setError(`Leave failed: ${e?.message}`); }
    finally { setApplying(prev => { const n = new Set(prev); n.delete(row.id); return n; }); }
  }, [session, showToast]);

  // ── Accept as-is ──────────────────────────────────────────────────────────
  const handleAcceptAsIs = useCallback(async (row: RouteFinderRow) => {
    if (!session || !listingsData) return;
    setApplying(prev => new Set(prev).add(row.id));
    try {
      await routeFinderSheetsService.appendLearnedStreet(spreadsheetId, row.currentRouteCode, row.currentStreetName);
      const result = await routeFinderSessionService.addLearnedStreet({
        sessionId: session.id, routeCode: row.currentRouteCode, originalStreet: row.currentStreetName,
        currentLearned: session.learnedStreets, currentLearnedOriginal: session.learnedStreetsOriginal,
      });

      const rc   = row.currentRouteCode.toUpperCase();
      const norm = normalizeStreetForMatch(row.currentStreetName);
      if (!listingsData.routeMap.has(rc)) listingsData.routeMap.set(rc, []);
      if (!listingsData.routeMap.get(rc)!.includes(norm)) {
        listingsData.routeMap.get(rc)!.push(norm);
        listingsData.routeMapOriginal.get(rc)?.push(row.currentStreetName);
      }

      // Run cascade — other rows with same street+route now match and should drop
      const cascadeIds = cascadeCheck(
        row.currentRouteCode, row.currentStreetName, queue, listingsData, result.learned
      );
      const resolvedSet = new Set([row.id, ...cascadeIds]);

      const entry: FixLogEntry = {
        rowId: row.id, bookingId: row.bookingId, sheetName: row.sheetName,
        oldRouteCode: row.currentRouteCode, newRouteCode: row.currentRouteCode,
        oldStreetName: row.currentStreetName, newStreetName: row.currentStreetName,
        cascadeCount: cascadeIds.length, timestamp: new Date().toISOString(), type: 'accept_as_is',
      };

      // Build log entries for cascade-resolved rows too
      const cascadeEntries: FixLogEntry[] = cascadeIds.map(cId => ({
        ...entry, rowId: cId, bookingId: cId, cascadeCount: 0,
        timestamp: new Date().toISOString(),
      }));

      const { newFixedRows } = await routeFinderSessionService.markRowsDismissed({
        sessionId: session.id, entries: [entry, ...cascadeEntries], currentFixedRows: session.fixedRows,
      });
      setQueue(prev => prev.filter(r => !resolvedSet.has(r.id)));
      setSession(prev => prev ? {
        ...prev, fixedRows: newFixedRows,
        learnedStreets: result.learned, learnedStreetsOriginal: result.learnedOriginal,
        fixLog: [...prev.fixLog, entry, ...cascadeEntries],
      } : null);

      const total = resolvedSet.size;
      showToast(total > 1
        ? `Accepted as-is — learned into Listings. ${total - 1} other row${total === 2 ? '' : 's'} auto-resolved.`
        : 'Accepted as-is — learned into Listings.'
      );
    } catch (e: any) { setError(`Accept as-is failed: ${e?.message}`); }
    finally { setApplying(prev => { const n = new Set(prev); n.delete(row.id); return n; }); }
  }, [session, listingsData, spreadsheetId, showToast]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const handleSkip = useCallback((row: RouteFinderRow) => {
    setQueue(prev => [...prev.filter(r => r.id !== row.id), row]);
  }, []);

  // ── Signal popup ───────────────────────────────────────────────────────────
  const handleSignalClick = useCallback((row: RouteFinderRow) => {
    if (!row.contractorName || !row.serviceDate) return;
    const flaggedIds = new Set(queue.map(r => r.id));
    const results: SignalPopupRow[] = [];
    for (const sheet of sheets) {
      const { CI, rows } = sheet;
      if (CI.contractorName < 0 || CI.date < 0) continue;
      for (const rawRow of rows) {
        if (!rawRow || !rawRow[0]) continue;
        const contractor = String(rawRow[CI.contractorName] ?? '').trim();
        const date       = String(rawRow[CI.date] ?? '').trim();
        if (contractor !== row.contractorName || date !== row.serviceDate) continue;
        const bookingId  = CI.bookingId >= 0  ? String(rawRow[CI.bookingId] ?? '').trim()  : '—';
        const houseNum   = CI.houseNum >= 0   ? String(rawRow[CI.houseNum] ?? '').trim()   : '—';
        const streetName = CI.streetName >= 0 ? String(rawRow[CI.streetName] ?? '').trim() : '—';
        const routeCode  = CI.routeCode >= 0  ? String(rawRow[CI.routeCode] ?? '').trim()  : '—';
        if (!bookingId) continue;
        const rowId = `${sheet.sheetName}:${bookingId}`;
        results.push({ bookingId, houseNum, streetName, routeCode, isFlagged: flaggedIds.has(rowId) });
      }
    }
    setSignalPopup({ contractorName: row.contractorName, serviceDate: row.serviceDate, rows: results });
  }, [queue, sheets]);

  // ── Bulk actions ───────────────────────────────────────────────────────────
  const handleBulkAcceptOrange = async () => {
    const rows = filteredQueue.filter(r => r.color === 'orange');
    if (!rows.length) return;
    if (!window.confirm(`Accept all ${rows.length} orange (typo) rows?`)) return;
    setBulkApplying(true);
    for (const row of rows) await commitFix(row, getEditValues(row).routeCode, getEditValues(row).streetName, []);
    setBulkApplying(false);
  };

  const handleBulkAcceptCluster = async () => {
    const rows = filteredQueue.filter(r => r.candidates[0]?.isClusterPrimary);
    if (!rows.length) return;
    if (!window.confirm(`Accept all ${rows.length} cluster-confirmed rows?`)) return;
    setBulkApplying(true);
    for (const row of rows) await commitFix(row, getEditValues(row).routeCode, getEditValues(row).streetName, []);
    setBulkApplying(false);
  };

  const handleCandidateSelect = (rowId: string, idx: number, candidate: CandidateRoute) => {
    setSelectedCandidates(prev => ({ ...prev, [rowId]: idx }));
    setEditedValues(prev => ({ ...prev, [rowId]: { routeCode: candidate.routeCode, streetName: candidate.streetName } }));
  };

  const filteredQueue = useMemo(() => {
    let rows = queue;
    if (colorFilter !== 'all') rows = rows.filter(r => r.color === colorFilter);
    if (searchTerm.trim()) {
      const t = searchTerm.toLowerCase();
      rows = rows.filter(r =>
        r.bookingId.toLowerCase().includes(t) ||
        r.currentStreetName.toLowerCase().includes(t) ||
        r.currentRouteCode.toLowerCase().includes(t) ||
        r.sheetName.toLowerCase().includes(t)
      );
    }
    return rows;
  }, [queue, colorFilter, searchTerm]);

  const counters = useMemo(() => ({
    phone_group: queue.filter(r => r.color === 'phone_group').length,
    orange:      queue.filter(r => r.color === 'orange').length,
    yellow:      queue.filter(r => r.color === 'yellow').length,
    red:         queue.filter(r => r.color === 'red').length,
    total:       queue.length,
  }), [queue]);

  // ─── PHASE RENDERS ─────────────────────────────────────────────────────────

  const renderAuth = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center border border-gray-700"><MapPin className="text-blue-400" size={32} /></div>
      <div className="text-center"><h2 className="text-xl font-bold text-white mb-1">Route Finder</h2><p className="text-gray-400 text-sm">Connect to Google to access your call book</p></div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button onClick={handleConnect} disabled={isAuthenticating} className="flex items-center gap-3 bg-white hover:bg-gray-100 text-gray-800 px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50">
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
  );

  const renderSetup = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6 max-w-lg mx-auto">
      <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center border border-gray-700"><MapPin className="text-blue-400" size={32} /></div>
      <div className="text-center"><h2 className="text-xl font-bold text-white mb-1">Route Finder</h2><p className="text-gray-400 text-sm">Paste your call book spreadsheet URL or ID</p></div>
      <div className="w-full space-y-3">
        <input type="text" value={spreadsheetInput} onChange={e => setSpreadsheetInput(e.target.value)} placeholder="Paste Google Sheets URL or spreadsheet ID"
          className="w-full bg-gray-800 border border-gray-600 rounded-lg py-3 px-4 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-gray-500" />
        <p className="text-xs text-gray-500">The spreadsheet must have a tab called <strong className="text-gray-400">"Listings"</strong> containing the East Listings data.</p>
        {error && <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-red-400 text-sm">{error}</div>}
        <button onClick={handleStartScan} disabled={!spreadsheetInput.trim()} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          <Search size={18} /> Scan Call Book
        </button>
      </div>
    </div>
  );

  const renderScanning = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <Loader className="animate-spin text-blue-400" size={40} />
      <div className="text-center">
        <p className="text-white font-medium">{scanProgress.sheet || 'Preparing...'}</p>
        {scanProgress.total > 0 && <p className="text-gray-400 text-sm mt-1">Sheet {Math.ceil(scanProgress.current)} of {scanProgress.total}</p>}
      </div>
      {scanProgress.total > 0 && (
        <div className="w-64 bg-gray-700 rounded-full h-2">
          <div className="bg-blue-500 h-2 rounded-full transition-all duration-150" style={{ width: `${Math.min(100, (scanProgress.current / scanProgress.total) * 100)}%` }} />
        </div>
      )}
    </div>
  );

  const renderComplete = () => (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-6">
      <CheckCircle className="text-emerald-400" size={64} />
      <div className="text-center"><h2 className="text-2xl font-bold text-white mb-2">All Done!</h2><p className="text-gray-400">{session?.fixedRows || 0} rows fixed. Your call book is clean.</p></div>
      <button onClick={() => { setPhase('setup'); setSpreadsheetInput(''); }} className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-5 py-2 rounded-lg transition-colors text-sm">
        <RefreshCw size={16} /> Start New Scan
      </button>
    </div>
  );

  const renderWorking = () => {
    const fixedTotal  = session?.fixedRows || 0;
    const grandTotal  = session?.totalRows || 0;
    const pct         = grandTotal > 0 ? Math.round((fixedTotal / grandTotal) * 100) : 0;
    const visibleRows = filteredQueue.slice(0, visibleCount);
    const remaining   = filteredQueue.length - visibleCount;

    return (
      <div className="flex h-full gap-0">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Filter bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 bg-gray-800/50 flex-wrap">
            <div className="relative flex-shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input type="text" placeholder="Search booking, street, route..." value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setVisibleCount(PAGE_SIZE); }}
                className="bg-gray-900 border border-gray-600 rounded-lg py-1.5 pl-8 pr-3 text-sm text-white focus:ring-1 focus:ring-blue-500 focus:outline-none w-52" />
            </div>
            {(['all', 'phone_group', 'orange', 'yellow', 'red'] as ColorFilter[]).map(f => {
              const label = f === 'all' ? `All (${counters.total})` : f === 'phone_group' ? `🟢 ${counters.phone_group}` : f === 'orange' ? `🟠 ${counters.orange}` : f === 'yellow' ? `🟡 ${counters.yellow}` : `🔴 ${counters.red}`;
              return (
                <button key={f} onClick={() => { setColorFilter(f); setVisibleCount(PAGE_SIZE); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${colorFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Headers */}
          <div className="grid text-xs text-gray-500 font-medium uppercase tracking-wider px-4 py-2 border-b border-gray-700 bg-gray-900/30"
            style={{ gridTemplateColumns: '5px 75px 85px 1fr auto 1fr 160px 160px' }}>
            <div /><div>Sheet</div><div>Booking</div><div>Current</div>
            <div className="px-2" /><div>Suggested</div><div>Signal</div>
            <div className="text-right">Actions</div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {filteredQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-500 gap-2">
                <Layers size={32} className="opacity-30" /><p className="text-sm">No rows match the current filter</p>
              </div>
            ) : (
              <>
                {visibleRows.map(row => (
                  <RouteRow key={row.id} row={row}
                    editValues={getEditValues(row)}
                    selectedCandidateIdx={selectedCandidates[row.id] ?? 0}
                    isExpanded={expandedCandidates.has(row.id)}
                    isApplying={applying.has(row.id)}
                    onRouteCodeChange={v => setEditForRow(row.id, 'routeCode', v)}
                    onStreetNameChange={v => setEditForRow(row.id, 'streetName', v)}
                    onCandidateSelect={(idx, c) => handleCandidateSelect(row.id, idx, c)}
                    onToggleExpand={() => setExpandedCandidates(prev => { const n = new Set(prev); n.has(row.id) ? n.delete(row.id) : n.add(row.id); return n; })}
                    onAccept={() => handleAccept(row)}
                    onLeave={() => handleLeave(row)}
                    onAcceptAsIs={() => handleAcceptAsIs(row)}
                    onSkip={() => handleSkip(row)}
                    onSignalClick={() => handleSignalClick(row)}
                    onOpenStreetPicker={() => handleOpenStreetPicker(row)}
                    onPopulateCurrentRoute={() => setEditForRow(row.id, 'routeCode', row.currentRouteCode)}
                    onPopulateCurrentStreet={() => setEditForRow(row.id, 'streetName', row.currentStreetName)}
                  />
                ))}
                {remaining > 0 && (
                  <div className="flex justify-center py-5">
                    <button onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
                      Show {Math.min(PAGE_SIZE, remaining)} more <span className="ml-2 text-gray-500">({remaining} remaining)</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-60 border-l border-gray-700 bg-gray-800/30 flex flex-col p-4 gap-5 overflow-y-auto flex-shrink-0">
          <div>
            <div className="text-3xl font-bold text-white mb-1">{counters.total.toLocaleString()}</div>
            <div className="text-xs text-gray-400 mb-3">rows remaining</div>
            <div className="w-full bg-gray-700 rounded-full h-1.5 mb-1">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="text-xs text-gray-500">{pct}% complete · {fixedTotal.toLocaleString()} fixed</div>
          </div>
          <div className="space-y-2">
            {([['phone_group','🟢',counters.phone_group,'emerald'],['orange','🟠',counters.orange,'orange'],['yellow','🟡',counters.yellow,'yellow'],['red','🔴',counters.red,'red']] as const).map(([color, emoji, count, hue]) => (
              <div key={color} className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{emoji} {COLOR_CONFIG[color].label}</span>
                <span className={`text-sm font-bold text-${hue}-400`}>{count}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2 pt-2 border-t border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Bulk Actions</p>
            <button onClick={handleBulkAcceptOrange} disabled={bulkApplying || counters.orange === 0}
              className="w-full text-left px-3 py-2 bg-orange-900/20 hover:bg-orange-900/40 border border-orange-800/50 rounded-lg text-xs text-orange-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
              {bulkApplying ? <Loader size={12} className="animate-spin" /> : <Zap size={12} />} Accept all {counters.orange} orange
            </button>
            <button onClick={handleBulkAcceptCluster} disabled={bulkApplying || filteredQueue.filter(r => r.candidates[0]?.isClusterPrimary).length === 0}
              className="w-full text-left px-3 py-2 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-800/50 rounded-lg text-xs text-blue-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
              {bulkApplying ? <Loader size={12} className="animate-spin" /> : <Users size={12} />} Accept cluster-confirmed
            </button>
          </div>
          <div className="space-y-1 pt-2 border-t border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Session</p>
            {session?.updatedAt && <p className="text-xs text-gray-500">Last saved: {new Date(session.updatedAt).toLocaleTimeString()}</p>}
            <button onClick={() => { if (window.confirm('Re-scan from scratch? This will reset all progress.')) { routeFinderSessionService.resetSession(spreadsheetId); setPhase('setup'); } }}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1 mt-2">
              <RefreshCw size={11} /> Reset &amp; re-scan
            </button>
          </div>
          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-2 text-red-400 text-xs">
              {error}<button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">x</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"><ArrowLeft size={16} /> Back</button>
          <div className="w-px h-5 bg-gray-700" />
          <MapPin size={18} className="text-blue-400" />
          <span className="font-bold text-white">Route Finder</span>
          {phase === 'working' && spreadsheetId && <span className="text-xs text-gray-500 font-mono truncate max-w-[200px]">{spreadsheetId.slice(0, 20)}...</span>}
        </div>
        {phase === 'working' && <div className="text-xs text-gray-500">{counters.total} left · {session?.fixedRows || 0} fixed</div>}
      </div>

      <div className="flex-1 overflow-hidden">
        {phase === 'auth'     && <div className="p-8">{renderAuth()}</div>}
        {phase === 'setup'    && <div className="p-8">{renderSetup()}</div>}
        {phase === 'scanning' && <div className="p-8">{renderScanning()}</div>}
        {phase === 'working'  && renderWorking()}
        {phase === 'complete' && <div className="p-8">{renderComplete()}</div>}
      </div>

      {/* ── Group Fix Popup ── */}
      {groupFixPopup && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl max-w-lg w-full">
            <div className="flex items-center justify-between p-5 border-b border-gray-700">
              <h3 className="font-bold text-white text-lg">Group Fix Detected</h3>
              <button onClick={() => setGroupFixPopup(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-900/60 rounded-lg p-3 text-sm space-y-1">
                <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Applying fix</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-orange-300 bg-orange-900/30 px-2 py-0.5 rounded text-xs">{groupFixPopup.triggerRow.currentRouteCode}</span>
                  <span className="text-gray-500 text-xs">{groupFixPopup.triggerRow.currentStreetName}</span>
                  <span className="text-gray-600">→</span>
                  <span className="font-mono text-emerald-300 bg-emerald-900/30 px-2 py-0.5 rounded text-xs">{groupFixPopup.finalRoute}</span>
                  <span className="text-gray-300 text-xs">{groupFixPopup.finalStreet}</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-2">{groupFixPopup.matches.length + 1} rows match — same contractor, date, route, and street:</div>
                <div className="bg-gray-900/40 rounded-lg divide-y divide-gray-700/50 max-h-48 overflow-y-auto">
                  <div className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="text-blue-400 font-medium w-20 truncate">{groupFixPopup.triggerRow.bookingId}</span>
                    <span className="text-gray-400 truncate flex-1">{groupFixPopup.triggerRow.sheetName}</span>
                    <span className="text-gray-300">{groupFixPopup.triggerRow.houseNum}</span>
                    <span className="text-xs bg-blue-900/40 text-blue-300 px-1.5 rounded">this row</span>
                  </div>
                  {groupFixPopup.matches.map(m => (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <span className="text-gray-300 font-medium w-20 truncate">{m.bookingId}</span>
                      <span className="text-gray-400 truncate flex-1">{m.sheetName}</span>
                      <span className="text-gray-300">{m.houseNum}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t border-gray-700">
              <button onClick={() => commitFix(groupFixPopup.triggerRow, groupFixPopup.finalRoute, groupFixPopup.finalStreet, groupFixPopup.matches.map(m => m.id))}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg font-bold text-sm transition-colors">
                Fix all {groupFixPopup.matches.length + 1} rows
              </button>
              <button onClick={() => commitFix(groupFixPopup.triggerRow, groupFixPopup.finalRoute, groupFixPopup.finalStreet, [])}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 py-2.5 rounded-lg font-medium text-sm transition-colors">
                Fix this row only
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Signal Popup ── */}
      {signalPopup && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
              <div><h3 className="font-bold text-white">{signalPopup.contractorName}</h3><p className="text-xs text-gray-400 mt-0.5">{signalPopup.serviceDate} · {signalPopup.rows.length} rows</p></div>
              <button onClick={() => setSignalPopup(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              <div className="grid text-xs text-gray-500 font-medium uppercase tracking-wider px-4 py-2 border-b border-gray-700 bg-gray-900/30 sticky top-0"
                style={{ gridTemplateColumns: '90px 60px 1fr 80px 70px' }}>
                <div>Booking</div><div>House #</div><div>Street</div><div>Route</div><div>Status</div>
              </div>
              {signalPopup.rows.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-8">No rows found.</div>
              ) : signalPopup.rows.map((r, i) => (
                <div key={i} className={`grid items-center px-4 py-2 text-xs border-b border-gray-700/50 gap-2 ${r.isFlagged ? 'bg-yellow-900/10' : 'opacity-50'}`}
                  style={{ gridTemplateColumns: '90px 60px 1fr 80px 70px' }}>
                  <span className="font-mono text-gray-300 truncate">{r.bookingId}</span>
                  <span className="text-gray-400">{r.houseNum}</span>
                  <span className="text-gray-300 truncate">{r.streetName}</span>
                  <span className="font-mono text-gray-300">{r.routeCode}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${r.isFlagged ? 'bg-yellow-900/40 text-yellow-400' : 'bg-gray-700 text-gray-500'}`}>{r.isFlagged ? 'Flagged' : 'Clean'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Street Picker Popup ── */}
      {streetPicker && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl max-w-sm w-full max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
              <div>
                <h3 className="font-bold text-white text-sm">Streets on <span className="font-mono text-blue-300">{streetPicker.routeCode}</span></h3>
                <p className="text-xs text-gray-400 mt-0.5">{streetPicker.streets.length} streets — click to populate</p>
              </div>
              <button onClick={() => setStreetPicker(null)} className="text-gray-500 hover:text-white"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {streetPicker.streets.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-6">No streets found for this route.</p>
              ) : streetPicker.streets.map((street, i) => (
                <button key={i} onClick={() => { setEditForRow(streetPicker.rowId, 'streetName', street); setStreetPicker(null); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors">
                  {street}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 text-white text-sm px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2 z-50">
          <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />{toast}
        </div>
      )}
    </div>
  );
};

// ─── ROW COMPONENT ────────────────────────────────────────────────────────────

interface RouteRowProps {
  row: RouteFinderRow;
  editValues: { routeCode: string; streetName: string };
  selectedCandidateIdx: number;
  isExpanded: boolean;
  isApplying: boolean;
  onRouteCodeChange: (v: string) => void;
  onStreetNameChange: (v: string) => void;
  onCandidateSelect: (idx: number, c: CandidateRoute) => void;
  onToggleExpand: () => void;
  onAccept: () => void;
  onLeave: () => void;
  onAcceptAsIs: () => void;
  onSkip: () => void;
  onSignalClick: () => void;
  onOpenStreetPicker: () => void;
  onPopulateCurrentRoute: () => void;
  onPopulateCurrentStreet: () => void;
}

const RouteRow: React.FC<RouteRowProps> = ({
  row, editValues, selectedCandidateIdx, isExpanded, isApplying,
  onRouteCodeChange, onStreetNameChange, onCandidateSelect, onToggleExpand,
  onAccept, onLeave, onAcceptAsIs, onSkip, onSignalClick,
  onOpenStreetPicker, onPopulateCurrentRoute, onPopulateCurrentStreet,
}) => {
  const cc      = COLOR_CONFIG[row.color];
  const top3    = row.candidates.slice(0, 3);
  const hasMore = row.candidates.length > 3;
  const hasSignal = !!(row.clusterSignal || row.phoneGroupSignal);

  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(
    [row.houseNum, row.currentStreetName, row.city].filter(Boolean).join(' ')
  )}`;

  return (
    <div className={`${cc.border} ${cc.bg} border-b border-gray-800/60 transition-colors`}>
      <div className="grid items-start px-4 py-2.5 gap-2 text-sm"
        style={{ gridTemplateColumns: '5px 75px 85px 1fr auto 1fr 160px 160px' }}>
        <div />

        {/* Sheet */}
        <div className="text-gray-400 text-xs truncate pt-1" title={row.sheetName}>
          {row.sheetName.replace(/\s*\(.*?\)/, '').trim()}
        </div>

        {/* Booking */}
        <div className="text-gray-300 text-xs font-mono truncate pt-1">{row.bookingId}</div>

        {/* Current — route code and street are clickable to populate suggested */}
        <div className="min-w-0 pt-0.5 space-y-1">
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={onPopulateCurrentRoute} title="Click to copy to suggested"
              className={`text-xs px-1.5 py-0.5 rounded border font-mono transition-opacity hover:opacity-70 ${cc.badge}`}>
              {row.currentRouteCode || '—'}
            </button>
            {row.isORSuffix && <span className="text-xs bg-purple-900/30 text-purple-400 border border-purple-700 px-1 rounded">OR</span>}
            {/* Google Maps button */}
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              title="Look up on Google Maps"
              className="text-gray-600 hover:text-blue-400 transition-colors"
              onClick={e => e.stopPropagation()}>
              <MapPin size={11} />
            </a>
          </div>
          <button onClick={onPopulateCurrentStreet} title="Click to copy to suggested"
            className="text-gray-300 text-xs truncate block text-left hover:text-white hover:underline transition-colors max-w-full">
            {row.currentStreetName || '—'}
          </button>
        </div>

        {/* Arrow */}
        <div className="text-gray-600 text-base px-1 pt-1">→</div>

        {/* Suggested */}
        <div className="min-w-0 space-y-1">
          {/* Candidate quick-fill buttons */}
          {row.candidates.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {top3.map((c, idx) => (
                <button key={`${c.routeCode}-${idx}`} onClick={() => onCandidateSelect(idx, c)}
                  className={`text-xs px-2 py-0.5 rounded border font-mono transition-colors ${selectedCandidateIdx === idx ? 'bg-blue-700 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'}`}>
                  {c.isClusterPrimary && <span className="mr-1">⚡</span>}{c.routeCode}
                </button>
              ))}
              {hasMore && (
                <button onClick={onToggleExpand} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-0.5">
                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}+{row.candidates.length - 3}
                </button>
              )}
            </div>
          )}
          {isExpanded && row.candidates.slice(3).map((c, i) => (
            <button key={`extra-${i}`} onClick={() => onCandidateSelect(i + 3, c)}
              className="text-xs px-2 py-0.5 rounded border font-mono bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400 mr-1">
              {c.routeCode}
            </button>
          ))}
          {/* Editable inputs */}
          <input type="text" value={editValues.routeCode} onChange={e => onRouteCodeChange(e.target.value)}
            placeholder="Route code"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs font-mono text-white focus:ring-1 focus:ring-blue-500 focus:outline-none" />
          <div className="flex items-center gap-1">
            <input type="text" value={editValues.streetName} onChange={e => onStreetNameChange(e.target.value)}
              placeholder="Street name"
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-white focus:ring-1 focus:ring-blue-500 focus:outline-none min-w-0" />
            {/* Street picker button */}
            <button onClick={onOpenStreetPicker} title="Browse streets on this route"
              className="flex-shrink-0 p-1 text-gray-500 hover:text-blue-400 hover:bg-gray-700 rounded transition-colors">
              <List size={12} />
            </button>
          </div>
        </div>

        {/* Signal — clickable */}
        <div className="text-xs text-gray-500 space-y-0.5 pt-1 min-w-0">
          {row.phoneGroupSignal && (
            <button onClick={onSignalClick} className="truncate text-emerald-500/80 hover:text-emerald-400 text-left w-full transition-colors" title={row.phoneGroupSignal}>
              {row.phoneGroupSignal}
            </button>
          )}
          {row.clusterSignal && (
            <button onClick={onSignalClick} className="truncate text-blue-500/80 hover:text-blue-400 text-left w-full transition-colors" title={row.clusterSignal}>
              {row.clusterSignal}
            </button>
          )}
          {!hasSignal && <span className="text-gray-600">—</span>}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 items-end pt-0.5">
          <div className="flex items-center gap-1">
            <button onClick={onAccept} disabled={isApplying}
              className="flex items-center gap-1 px-2 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium transition-colors disabled:opacity-50">
              {isApplying ? <Loader size={11} className="animate-spin" /> : <CheckCircle size={11} />} Accept
            </button>
            <button onClick={onSkip} disabled={isApplying} className="p-1 text-gray-500 hover:text-gray-300 transition-colors rounded" title="Skip">
              <SkipForward size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onLeave} disabled={isApplying}
              className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white rounded text-xs transition-colors disabled:opacity-50"
              title="Permanently dismiss — no changes, never resurfaces">
              Leave
            </button>
            <button onClick={onAcceptAsIs} disabled={isApplying}
              className="px-2 py-0.5 bg-gray-700 hover:bg-blue-800 text-gray-400 hover:text-blue-300 rounded text-xs transition-colors disabled:opacity-50"
              title="Accept current values — learns into Listings, no sheet write">
              As-is
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RouteFinderView;
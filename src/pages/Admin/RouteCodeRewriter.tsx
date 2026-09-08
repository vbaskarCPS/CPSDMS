// src/pages/Admin/RouteCodeRewriter.tsx
//
// ROUTE CODE REWRITER — fix Route # in the Master Bookings "Bookings" tab from
// geocodes.
//
// The office files a booking under whichever route the caller thinks the
// street belongs to. Sometimes that's wrong, and the RM only finds out when
// the pin lands on the far side of the map. This tool takes a range of rows
// from the Bookings tab, geocodes each address (house + street + city), and
// asks the approved route geometry which route's segment OF THAT STREET the
// point sits on — the same street-name-plus-40-metres rule the RM map uses,
// so the two never disagree.
//
// A row whose existing code already passes is left alone. A row that matches a
// different route is written IMMEDIATELY, per Vijay: the new code goes into
// column D, and the old one is appended to Notes (column P) as "was XX" so
// nothing is lost. Rows that won't geocode, or match no route, are reported
// and untouched.
//
// Layout of the Bookings tab (headers on row 2, data from row 3):
//   A Booked By · B Date · C Time · D Route # · E First · F Last · G House #
//   H Street · I Call 1st · J Phone · K Email · L Service · M PP · N AMT
//   O City · P Notes

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft, Loader, AlertCircle, Check, X, Play, Square, RefreshCw,
  MapPin, FileSpreadsheet,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { googleSheetsService } from '../../lib/googleSheetsService';

interface Props {
  onBack: () => void;
}

// Only a route whose segment OF THE SAME STREET passes this close counts.
const MAX_METERS = 40;
const BOOKINGS_TAB = 'Bookings';

type RowStatus =
  | 'pending'     // loaded, not yet examined
  | 'skipped'     // no usable address on the row
  | 'ok'          // existing code already matches
  | 'changed'     // rewritten in the sheet
  | 'nomatch'     // geocoded, but no route's street is close enough
  | 'nogeo'       // address would not geocode
  | 'error';      // sheet write failed

  interface RowState {
    rowNumber: number;      // sheet row, as Google shows it
    currentCode: string;
    name: string;
    house: string;
    street: string;
    address: string;        // "236 Jamieson St" — house + street, for display
    city: string;
    notes: string;
    status: RowStatus;
    newCode?: string;
    distance?: number;
    detail?: string;
    // Manual fix for a failed row: the fields being edited, and whether a retry
    // is in flight. Cleared once the retry has run.
    editing?: boolean;
    draft?: { house: string; street: string; city: string };
    retrying?: boolean;
  }

interface RouteGeom {
  routeCode: string;
  segments: Array<{ name: string; coordinates: [number, number][] }>;
}

// ─── ADDRESS NORMALISATION ────────────────────────────────────────────────────
// Mirrors the map's cache key: lower-case, punctuation dropped, common street
// type abbreviations folded so "Addley Cr" and "Addley Crescent" compare equal.

const STREET_TYPE_ALIASES: Record<string, string> = {
  st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive',
  cr: 'crescent', cres: 'crescent', crt: 'court', ct: 'court', blvd: 'boulevard',
  pl: 'place', ln: 'lane', tr: 'trail', trl: 'trail', cir: 'circle',
  pkwy: 'parkway', gdns: 'gardens', hts: 'heights', sq: 'square', terr: 'terrace',
  hwy: 'highway',
};

function normalise(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(tok => STREET_TYPE_ALIASES[tok] || tok)
    .join(' ');
}

function distToSegmentMeters(
  lat: number, lng: number,
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * cosLat;
  const px = (lng - lng1) * mPerDegLng;
  const py = (lat - lat1) * mPerDegLat;
  const bx = (lng2 - lng1) * mPerDegLng;
  const by = (lat2 - lat1) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.sqrt((px - t * bx) ** 2 + (py - t * by) ** 2);
}

// For each route, the nearest distance from the point to any segment whose
// street name matches. Routes with no segment of that street are absent.
function matchingStreetDistances(
  lat: number, lng: number, streetName: string, geoms: RouteGeom[],
): Map<string, number> {
  const out = new Map<string, number>();
  const streetKey = normalise(streetName);
  if (!streetKey) return out;
  for (const g of geoms) {
    for (const seg of g.segments || []) {
      const segKey = normalise(seg.name);
      if (!segKey || segKey !== streetKey) continue;
      const coords = seg.coordinates || [];
      let dist = Infinity;
      if (coords.length === 1) {
        const [cLng, cLat] = coords[0];
        dist = distToSegmentMeters(lat, lng, cLat, cLng, cLat, cLng);
      } else {
        for (let i = 0; i < coords.length - 1; i++) {
          const [lng1, lat1] = coords[i];
          const [lng2, lat2] = coords[i + 1];
          const d = distToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2);
          if (d < dist) dist = d;
        }
      }
      const prev = out.get(g.routeCode);
      if (prev === undefined || dist < prev) out.set(g.routeCode, dist);
    }
  }
  return out;
}

async function geocode(address: string, city: string): Promise<{ lat: number; lng: number } | null> {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
  const parts = [address, city, 'Ontario', 'Canada'].filter(Boolean);
  const q = encodeURIComponent(parts.join(', '));
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?access_token=${token}&limit=1&country=ca&types=address`;
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

const STATUS_STYLE: Record<RowStatus, { label: string; cls: string }> = {
  pending: { label: 'waiting',    cls: 'bg-gray-800 text-gray-400 border-gray-700' },
  skipped: { label: 'no address', cls: 'bg-gray-800 text-gray-500 border-gray-700' },
  ok:      { label: 'correct',    cls: 'bg-green-900/30 text-green-300 border-green-800' },
  changed: { label: 'rewritten',  cls: 'bg-teal-900/40 text-teal-200 border-teal-700' },
  nomatch: { label: 'no match',   cls: 'bg-amber-900/30 text-amber-300 border-amber-800' },
  nogeo:   { label: 'no geocode', cls: 'bg-red-900/30 text-red-300 border-red-800' },
  error:   { label: 'write failed', cls: 'bg-red-900/50 text-red-200 border-red-700' },
};

const RouteCodeRewriter: React.FC<Props> = ({ onBack }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(googleSheetsService.isAuthenticated());
  const [connecting, setConnecting] = useState(false);

  const [geoms, setGeoms] = useState<RouteGeom[]>([]);
  const [geomsLoading, setGeomsLoading] = useState(true);

  const [fromRow, setFromRow] = useState('3');
  const [toRow, setToRow] = useState('');
  const [rows, setRows] = useState<RowState[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);
  const mountedRef = useRef(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Every approved route's geometry, paged. Route codes are unique across the
  // company, so there's no area filter — a booking filed under the wrong
  // town's route still gets found.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all: RouteGeom[] = [];
        const BATCH = 1000;
        let from = 0;
        while (true) {
          const { data, error: e } = await supabase
            .from('route_maps')
            .select('route_code, segments')
            .eq('status', 'approved')
            .range(from, from + BATCH - 1);
          if (e) throw new Error(e.message);
          if (!data || data.length === 0) break;
          data.forEach((r: any) => all.push({ routeCode: r.route_code, segments: r.segments || [] }));
          if (data.length < BATCH) break;
          from += BATCH;
        }
        if (!cancelled) setGeoms(all);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load route geometry.');
      } finally {
        if (!cancelled) setGeomsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const ok = await googleSheetsService.authenticate();
      setIsAuthenticated(ok);
      if (!ok) setError('Google sign-in was not completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleLoad = async () => {
    setError(null);
    const from = parseInt(fromRow, 10);
    const to = parseInt(toRow, 10);
    if (!isFinite(from) || !isFinite(to) || from < 3 || to < from) {
      setError('Enter a valid row range — first row 3 or later, last row not before the first.');
      return;
    }
    if (to - from > 1000) {
      setError('That is more than 1,000 rows. Work in smaller ranges.');
      return;
    }
    setLoadingRows(true);
    setRows([]);
    try {
      await googleSheetsService.ensureToken();
      const data = await googleSheetsService.readBookingsRows(BOOKINGS_TAB, from, to);
      const list: RowState[] = [];
      for (let i = 0; i <= to - from; i++) {
        const r = data[i] || [];
        const cell = (idx: number) => String(r[idx] ?? '').trim();
        const house = cell(6);
        const street = cell(7);
        const address = `${house} ${street}`.trim();
        list.push({
            rowNumber: from + i,
            currentCode: cell(3),
            name: `${cell(4)} ${cell(5)}`.trim(),
            house,
            street,
            address,
            city: cell(14),
            notes: cell(15),
            status: house && street ? 'pending' : 'skipped',
          });
      }
      setRows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the Bookings tab.');
    } finally {
      setLoadingRows(false);
    }
  };

  const patchRow = (rowNumber: number, patch: Partial<RowState>) => {
    if (!mountedRef.current) return;
    setRows(prev => prev.map(r => (r.rowNumber === rowNumber ? { ...r, ...patch } : r)));
  };

  const handleRun = async () => {
    const work = rows.filter(r => r.status === 'pending');
    if (work.length === 0) return;
    setError(null);
    stopRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: work.length });

    try {
      await googleSheetsService.ensureToken();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google token could not be refreshed.');
      setRunning(false);
      return;
    }

    for (let i = 0; i < work.length; i++) {
        if (stopRef.current || !mountedRef.current) break;
        await processRow(work[i]);
        if (mountedRef.current) setProgress({ done: i + 1, total: work.length });
        if (i < work.length - 1) await new Promise(r => setTimeout(r, 80));
      }
  
      if (mountedRef.current) setRunning(false);
    };
  
    // Geocode one row, decide, and write if it moved. Used by the run loop and
    // by a manual retry. Returns true when the address geocoded at all, so the
    // retry knows whether a corrected address is worth writing back.
    const processRow = async (row: RowState): Promise<boolean> => {
      const coord = await geocode(row.address, row.city);
      if (!coord) {
        patchRow(row.rowNumber, { status: 'nogeo' });
        return false;
      }
      const dists = matchingStreetDistances(coord.lat, coord.lng, row.street, geoms);
      const currentDist = dists.get(row.currentCode);
      if (currentDist !== undefined && currentDist <= MAX_METERS) {
        patchRow(row.rowNumber, { status: 'ok', distance: currentDist, detail: undefined });
        return true;
      }
      let best: { routeCode: string; dist: number } | null = null;
      for (const [rc, dist] of dists) {
        if (rc === row.currentCode || dist > MAX_METERS) continue;
        if (!best || dist < best.dist) best = { routeCode: rc, dist };
      }
      if (!best) {
        patchRow(row.rowNumber, { status: 'nomatch', detail: currentDist !== undefined ? `own route ${Math.round(currentDist)}m away` : undefined });
        return true;
      }
      // Write straight away — Vijay's call. The old code goes to Notes.
      const oldLabel = row.currentCode || '(blank)';
      const newNotes = row.notes ? `${row.notes} | was ${oldLabel}` : `was ${oldLabel}`;
      try {
        await googleSheetsService.writeBookingRouteAndNotes(BOOKINGS_TAB, row.rowNumber, best.routeCode, newNotes);
        patchRow(row.rowNumber, { status: 'changed', newCode: best.routeCode, distance: best.dist, notes: newNotes, detail: undefined });
      } catch (err) {
        patchRow(row.rowNumber, { status: 'error', newCode: best.routeCode, detail: err instanceof Error ? err.message : 'write failed' });
      }
      return true;
    };
  
    // --- MANUAL FIX: edit a failed row's address and retry it alone ---
  
    const startEdit = (row: RowState) =>
      patchRow(row.rowNumber, { editing: true, draft: { house: row.house, street: row.street, city: row.city } });
  
    const cancelEdit = (row: RowState) =>
      patchRow(row.rowNumber, { editing: false, draft: undefined });
  
    const updateDraft = (row: RowState, patch: Partial<{ house: string; street: string; city: string }>) =>
      patchRow(row.rowNumber, { draft: { ...(row.draft || { house: row.house, street: row.street, city: row.city }), ...patch } });
  
    const handleRetry = async (row: RowState) => {
      if (!row.draft || row.retrying) return;
      const house = row.draft.house.trim();
      const street = row.draft.street.trim();
      const city = row.draft.city.trim();
      if (!house || !street) { setError('A house number and street are needed to retry.'); return; }
      setError(null);
  
      const changedAddress = house !== row.house || street !== row.street || city !== row.city;
      const corrected: RowState = { ...row, house, street, city, address: `${house} ${street}`, retrying: true, editing: false, draft: undefined };
      patchRow(row.rowNumber, { house, street, city, address: corrected.address, retrying: true, editing: false, draft: undefined });
  
      try {
        await googleSheetsService.ensureToken();
        const geocoded = await processRow(corrected);
        // The corrected spelling goes back to the sheet once it has proven
        // itself by geocoding — not before, so a typo can't land in the sheet.
        if (geocoded && changedAddress) {
          try {
            await googleSheetsService.writeBookingAddress(BOOKINGS_TAB, row.rowNumber, house, street, city);
          } catch (err) {
            patchRow(row.rowNumber, { status: 'error', detail: `address write failed: ${err instanceof Error ? err.message : 'unknown'}` });
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Retry failed.');
      } finally {
        patchRow(row.rowNumber, { retrying: false });
      }
    };

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { pending: 0, skipped: 0, ok: 0, changed: 0, nomatch: 0, nogeo: 0, error: 0 };
    rows.forEach(r => { c[r.status]++; });
    return c;
  }, [rows]);

  const canRun = isAuthenticated && !geomsLoading && !running && counts.pending > 0;

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} disabled={running} className="p-2 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <MapPin size={18} className="text-amber-400" />
              Route Code Rewriter
            </h1>
            <p className="text-xs text-gray-400 truncate">
              {geomsLoading
                ? 'Loading route geometry…'
                : `${geoms.length} approved routes loaded · matches on street name within ${MAX_METERS} m`}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle size={16} /> {error}
            <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
          </div>
        )}

        {/* CONNECT */}
        {!isAuthenticated && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-3">
            <FileSpreadsheet size={18} className="text-green-400" />
            <div className="text-sm text-gray-300 flex-1">Connect Google Sheets to read and write the Bookings tab.</div>
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-3 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-xs font-bold flex items-center gap-2"
            >
              {connecting ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              Connect
            </button>
          </div>
        )}

        {/* RANGE + CONTROLS */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">First row</label>
              <input
                type="number" min={3} value={fromRow} onChange={e => setFromRow(e.target.value)} disabled={running}
                className="w-28 bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-white text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Last row</label>
              <input
                type="number" min={3} value={toRow} onChange={e => setToRow(e.target.value)} disabled={running} placeholder="e.g. 150"
                className="w-28 bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-white text-sm placeholder-gray-600 focus:ring-2 focus:ring-amber-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleLoad}
              disabled={!isAuthenticated || loadingRows || running}
              className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-xs font-bold flex items-center gap-2"
            >
              {loadingRows ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Load rows
            </button>
            {!running ? (
              <button
                onClick={handleRun}
                disabled={!canRun}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-xs font-bold flex items-center gap-2"
              >
                <Play size={12} /> Geocode &amp; rewrite {counts.pending > 0 ? `(${counts.pending})` : ''}
              </button>
            ) : (
              <button
                onClick={() => { stopRef.current = true; }}
                className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-bold flex items-center gap-2"
              >
                <Square size={12} /> Stop after this row
              </button>
            )}
            {running && (
              <span className="text-xs text-gray-400 flex items-center gap-2">
                <Loader size={12} className="animate-spin text-amber-400" />
                {progress.done} / {progress.total}
              </span>
            )}
          </div>

          <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
            Rows are written to the sheet the moment they match a different route — there is no undo beyond the
            "was XX" note left in column P. Rows whose current code already matches are not touched.
          </p>

          {rows.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {(['changed', 'ok', 'nomatch', 'nogeo', 'error', 'skipped', 'pending'] as RowStatus[])
                .filter(s => counts[s] > 0)
                .map(s => (
                  <span key={s} className={`px-2 py-0.5 rounded border ${STATUS_STYLE[s].cls}`}>
                    {counts[s]} {STATUS_STYLE[s].label}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* ROWS */}
        {rows.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[56px_1fr_1fr_90px_90px_110px] gap-2 px-3 py-2 bg-gray-700/50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <span>Row</span><span>Name / address</span><span>Notes</span><span>Was</span><span>Now</span><span>Result</span>
            </div>
            <div className="divide-y divide-gray-700/70 max-h-[60vh] overflow-y-auto">
              {rows.map(r => (
                <div key={r.rowNumber} className="grid grid-cols-[56px_1fr_1fr_90px_90px_110px] gap-2 px-3 py-2 items-center text-xs">
                  <span className="font-mono text-gray-500">{r.rowNumber}</span>
                  <div className="min-w-0">
                    <div className="font-bold text-white truncate">{r.name || '(no name)'}</div>
                    {r.editing && r.draft ? (
                      <div className="mt-1 space-y-1">
                        <div className="flex gap-1">
                          <input
                            value={r.draft.house}
                            onChange={e => updateDraft(r, { house: e.target.value })}
                            placeholder="No."
                            className="w-16 bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-white text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                          />
                          <input
                            value={r.draft.street}
                            onChange={e => updateDraft(r, { street: e.target.value })}
                            placeholder="Street name"
                            className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-white text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                          />
                        </div>
                        <div className="flex gap-1">
                          <input
                            value={r.draft.city}
                            onChange={e => updateDraft(r, { city: e.target.value })}
                            placeholder="City"
                            className="flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded px-1.5 py-1 text-white text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
                          />
                          <button
                            onClick={() => handleRetry(r)}
                            disabled={running}
                            className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-[11px] font-bold"
                          >Retry</button>
                          <button
                            onClick={() => cancelEdit(r)}
                            className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-[11px]"
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-400 truncate flex items-center gap-2">
                        <span className="truncate">{r.address}{r.city ? `, ${r.city}` : ''}</span>
                        {r.retrying ? (
                          <Loader size={11} className="animate-spin text-amber-400 flex-shrink-0" />
                        ) : (r.status === 'nogeo' || r.status === 'nomatch' || r.status === 'error') && !running ? (
                          <button
                            onClick={() => startEdit(r)}
                            className="text-[10px] text-amber-400 hover:text-amber-300 underline flex-shrink-0"
                          >fix &amp; retry</button>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="text-gray-400 truncate" title={r.notes}>{r.notes}</div>
                  <span className="font-mono text-gray-300">{r.currentCode || '—'}</span>
                  <span className={`font-mono font-bold ${r.status === 'changed' ? 'text-teal-300' : 'text-gray-500'}`}>
                    {r.newCode || (r.status === 'ok' ? r.currentCode : '—')}
                  </span>
                  <div className="min-w-0">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${STATUS_STYLE[r.status].cls}`}>
                      {STATUS_STYLE[r.status].label}
                    </span>
                    {r.distance !== undefined && (
                      <span className="ml-1 text-[10px] text-gray-500">{Math.round(r.distance)} m</span>
                    )}
                    {r.detail && <div className="text-[10px] text-gray-500 truncate" title={r.detail}>{r.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RouteCodeRewriter;
// src/lib/pclCacheService.ts
//
// PCL Cache Service
//
// Reads callbook spreadsheet data using a pre-authenticated Google OAuth token
// (the admin's token, already live from the session upload flow), groups clients
// by address (same logic as dmbPclService), and caches the result in the
// pcl_cache Supabase table.
//
// Workers read from Supabase — no OAuth popup needed on their end.
//

import { supabase } from './supabase';
import { ManagerMappingConfig } from '../types';
import {
  ApprovedRouteMap,
  getApprovedRouteMapsByCodes,
  bboxForRouteMaps,
  nearestRouteForPoint,
  geocodeAddressInBbox,
} from './managerMappingService';

// Re-declared here rather than imported so the map loader below doesn't depend
// on the Session Command Center path continuing to exist.
export interface MapGeoPos { lat: number; lng: number }

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface PCLHistoryEntry {
  year: number;
  price: string;
  serviceType: string;
  contractor: string;
}

export interface PCLClientGroup {
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  phone: string;
  history: PCLHistoryEntry[];
  // Resolved once at load time and stored WITH the client. This is what makes
  // the attachment permanent: the map no longer has to geocode a PCL address at
  // all, and a client cannot drift onto a different route between sessions
  // because the coordinate that placed it there travels with it.
  // Optional so rows cached before this existed still parse.
  lat?: number;
  lng?: number;
  city?: string;
}

// ─── INTERNAL RAW ROW TYPE ────────────────────────────────────────────────────

interface RawCallbookRow {
  routeCode: string;
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  phone: string;
  fo: string;
  price: string;
  contractor: string;
  year: number;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function cellVal(row: any[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  const v = row[col];
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  return s;
}

function normalizePhone(raw: string): string {
  let s = String(raw ?? '').trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function formatPhone(digits: string): string {
  if (digits.length === 10) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return digits;
}

function interpretService(foVal: string): string {
  const v = foVal.toUpperCase();
  if (v === 'X' || v === 'FO') return 'FO';
  if (v === 'BO') return 'BO';
  return 'FP';
}

// Sealing: the SERVICE column holds raw codes (SS, SSP, SSF, ...). Show them
// verbatim — no FO/BO/FP interpretation. Blank stays blank (no placeholder).
function interpretServiceSealing(serviceVal: string): string {
  return (serviceVal || '').trim();
}

function formatPrice(raw: string): string {
  if (!raw) return '';
  const n = parseFloat(raw.replace(/[,$]/g, ''));
  if (isNaN(n)) return raw;
  return '$' + n.toFixed(2);
}

function parseHouseNum(val: string): number {
  const n = parseInt(val.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function normalizeStreet(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ─── HEADER RESOLUTION ───────────────────────────────────────────────────────

function findHeaderRow(rawData: any[][]): number | null {
  const limit = Math.min(10, rawData.length);
  for (let r = 0; r < limit; r++) {
    for (let c = 0; c < (rawData[r]?.length || 0); c++) {
      const h = String(rawData[r][c] ?? '').trim().toUpperCase();
      if (h === 'PHONE' || h === 'PHONE #' || h === 'PHONE#') return r;
    }
  }
  return null;
}

interface ColumnIndices {
  ROUTE_CODE: number; FIRST: number; LAST: number; HOUSE: number;
  STREET: number; PHONE: number; FO: number; PRICE: number;
  CONTRACTOR: number; YEAR: number;
}

function resolveColumns(headers: any[]): ColumnIndices {
  const CI: ColumnIndices = {
    ROUTE_CODE: -1, FIRST: -1, LAST: -1, HOUSE: -1, STREET: -1,
    PHONE: -1, FO: -1, PRICE: -1, CONTRACTOR: -1, YEAR: -1,
  };
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;
    if (['ROUTE CODE', 'ROUTE_CODE', 'ROUTECODE'].includes(h) && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if (['FIRST NAME', 'FIRST_NAME', 'FIRSTNAME', 'FIRST'].includes(h) && CI.FIRST < 0) CI.FIRST = i;
    else if (['LAST NAME', 'LAST_NAME', 'LASTNAME', 'LAST'].includes(h) && CI.LAST < 0) CI.LAST = i;
    else if (['HOUSE #', 'HOUSE#', 'HOUSE NUM', 'HOUSE_NUM', 'PREFIX', 'HOUSE'].includes(h) && CI.HOUSE < 0) CI.HOUSE = i;
    else if (['STREET NAME', 'STREET_NAME', 'STREETNAME', 'STREET'].includes(h) && CI.STREET < 0) CI.STREET = i;
    else if (['PHONE', 'PHONE #', 'PHONE#'].includes(h) && CI.PHONE < 0) CI.PHONE = i;
    else if (h === 'FO' && CI.FO < 0) CI.FO = i;
    else if (['PREVIOUS PRICE', 'PREVIOUS_PRICE', 'PREV PRICE', 'PRICE', 'SERVICE AMT', 'SERVICE_AMT'].includes(h) && CI.PRICE < 0) CI.PRICE = i;
    else if (['CONTRACTOR NAME', 'CONTRACTOR_NAME', 'CONTRACTORNAME', 'CONTRACTOR'].includes(h) && CI.CONTRACTOR < 0) CI.CONTRACTOR = i;
    else if (h === 'YEAR' && CI.YEAR < 0) CI.YEAR = i;
  }
  return CI;
}

// Sealing column resolver. The sealing callbook (in the master bookings sheet)
// is laid out differently from the aeration callbook:
//   - Service lives in a column headed SERVICE (raw codes SS/SSP/SSF), not FO.
//   - Price is the column headed exactly PRICE — NOT 'Sold Price',
//     'Black Friday Price', or 'Spring-26 Renewal', which also exist here.
// Everything else (ROUTE CODE, FIRST, LAST, HOUSE #, STREET, PHONE, CONTRACTOR,
// YEAR) matches the same header names aeration uses. The FO field on the
// returned ColumnIndices is repurposed to carry the SERVICE column index;
// loadAndCachePCL reads it via interpretServiceSealing in sealing mode.
function resolveColumnsSealing(headers: any[]): ColumnIndices {
  const CI: ColumnIndices = {
    ROUTE_CODE: -1, FIRST: -1, LAST: -1, HOUSE: -1, STREET: -1,
    PHONE: -1, FO: -1, PRICE: -1, CONTRACTOR: -1, YEAR: -1,
  };
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;
    if (['ROUTE CODE', 'ROUTE_CODE', 'ROUTECODE'].includes(h) && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if (['FIRST NAME', 'FIRST_NAME', 'FIRSTNAME', 'FIRST'].includes(h) && CI.FIRST < 0) CI.FIRST = i;
    else if (['LAST NAME', 'LAST_NAME', 'LASTNAME', 'LAST'].includes(h) && CI.LAST < 0) CI.LAST = i;
    else if (['HOUSE #', 'HOUSE#', 'HOUSE NUM', 'HOUSE_NUM', 'PREFIX', 'HOUSE'].includes(h) && CI.HOUSE < 0) CI.HOUSE = i;
    else if (['STREET NAME', 'STREET_NAME', 'STREETNAME', 'STREET'].includes(h) && CI.STREET < 0) CI.STREET = i;
    else if (['PHONE', 'PHONE #', 'PHONE#'].includes(h) && CI.PHONE < 0) CI.PHONE = i;
    // SERVICE column carried in the FO slot (sealing reads it verbatim).
    else if (h === 'SERVICE' && CI.FO < 0) CI.FO = i;
    // Price is ONLY the column headed exactly PRICE here.
    else if (h === 'PRICE' && CI.PRICE < 0) CI.PRICE = i;
    else if (['CONTRACTOR NAME', 'CONTRACTOR_NAME', 'CONTRACTORNAME', 'CONTRACTOR'].includes(h) && CI.CONTRACTOR < 0) CI.CONTRACTOR = i;
    else if (h === 'YEAR' && CI.YEAR < 0) CI.YEAR = i;
  }
  return CI;
}

// ─── CLIENT GROUPING (same logic as dmbPclService) ───────────────────────────

function groupClientsByAddress(rows: RawCallbookRow[], sealingMode: boolean = false): PCLClientGroup[] {
  const addrMap = new Map<string, RawCallbookRow[]>();

  for (const row of rows) {
    const key = `${row.houseNum.toLowerCase()}|${normalizeStreet(row.streetName)}`;
    if (!addrMap.has(key)) addrMap.set(key, []);
    addrMap.get(key)!.push(row);
  }

  const groups: PCLClientGroup[] = [];

  for (const addrRows of addrMap.values()) {
    addrRows.sort((a, b) => b.year - a.year);

    const nameCounts = new Map<string, { count: number; year: number; first: string; last: string }>();
    for (const r of addrRows) {
      const nk = `${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}`;
      const ex = nameCounts.get(nk);
      if (ex) {
        ex.count++;
        if (r.year > ex.year) { ex.year = r.year; ex.first = r.firstName; ex.last = r.lastName; }
      } else {
        nameCounts.set(nk, { count: 1, year: r.year, first: r.firstName, last: r.lastName });
      }
    }
    let bestName = { first: addrRows[0].firstName, last: addrRows[0].lastName };
    let bestCount = 0; let bestYear = 0;
    for (const e of nameCounts.values()) {
      if (e.count > bestCount || (e.count === bestCount && e.year > bestYear)) {
        bestCount = e.count; bestYear = e.year; bestName = { first: e.first, last: e.last };
      }
    }

    const phoneCounts = new Map<string, { count: number; year: number }>();
    for (const r of addrRows) {
      if (!r.phone) continue;
      const ex = phoneCounts.get(r.phone);
      if (ex) { ex.count++; if (r.year > ex.year) ex.year = r.year; }
      else phoneCounts.set(r.phone, { count: 1, year: r.year });
    }
    let bestPhone = ''; let bpCount = 0; let bpYear = 0;
    for (const [ph, e] of phoneCounts) {
      if (e.count > bpCount || (e.count === bpCount && e.year > bpYear)) {
        bpCount = e.count; bpYear = e.year; bestPhone = ph;
      }
    }

    groups.push({
      firstName: bestName.first,
      lastName: bestName.last,
      houseNum: addrRows[0].houseNum,
      streetName: addrRows[0].streetName,
      phone: formatPhone(bestPhone),
      history: addrRows.map(r => ({
        year: r.year,
        price: formatPrice(r.price),
        // Sealing already stored the verbatim SERVICE code in r.fo; aeration
        // still needs the FO→FO/BO/FP interpretation here.
        serviceType: sealingMode ? r.fo : interpretService(r.fo),
        contractor: r.contractor,
      })),
    });
  }

  groups.sort((a, b) => {
    const stCmp = normalizeStreet(a.streetName).localeCompare(normalizeStreet(b.streetName));
    if (stCmp !== 0) return stCmp;
    return parseHouseNum(a.houseNum) - parseHouseNum(b.houseNum);
  });

  return groups;
}

// ─── SHEETS API (direct fetch using the passed-in token) ─────────────────────

async function sheetsGetRaw(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<any[][]> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Failed to fetch sheet data');
  }
  const data = await response.json();
  return data.values || [];
}

async function getCallbookTabNames(
  accessToken: string,
  spreadsheetId: string,
  sealingMode: boolean = false,
): Promise<string[]> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title)`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return [];
  const data = await response.json();
  const titles = (data.sheets || []).map((s: any) => s.properties.title as string);

  // Sealing: PCL lives in the master bookings sheet, in tabs whose title ends
  // in the literal "Callbooks" (e.g. "Hamilton Callbooks", "Ottawa Callbooks").
  // Case-sensitive, exact suffix.
  if (sealingMode) {
    return titles.filter((name: string) => name.endsWith('Callbooks'));
  }

  // Non-sealing: every tab except the ccd/managers control tabs.
  const excludeNames = new Set(['ccd', 'managers']);
  return titles.filter((name: string) => !excludeNames.has(name.toLowerCase()));
}

// ─── MAIN LOAD & CACHE ───────────────────────────────────────────────────────

/**
 * Reads the callbook spreadsheet using the admin's live OAuth token,
 * groups previous clients by address per route code, and writes the result
 * into the pcl_cache Supabase table.
 *
 * Called non-blocking at the end of uploadDailySession — any failure is
 * caught and logged without interrupting the session upload.
 */
export async function loadAndCachePCL(
  callbookSheetId: string,
  routeCodes: string[],
  accessToken: string,
  ccId: string,
  sealingMode: boolean = false,
): Promise<void> {
  if (!callbookSheetId || !accessToken || routeCodes.length === 0) return;

  const routeCodeSet = new Set(routeCodes);
  const routeRowsMap = new Map<string, RawCallbookRow[]>();

  // Fetch tab names
  let tabs: string[];
  try {
    tabs = await getCallbookTabNames(accessToken, callbookSheetId, sealingMode);
  } catch (err) {
    console.warn('[PCL Cache] Could not fetch callbook tabs:', err);
    return;
  }

  // Read each tab and collect rows matching our route codes
  for (const tabName of tabs) {
    let rawData: any[][];
    try {
      rawData = await sheetsGetRaw(accessToken, callbookSheetId, `'${tabName}'`);
    } catch {
      continue;
    }
    if (!rawData || rawData.length < 2) continue;

    const headerIdx = findHeaderRow(rawData);
    if (headerIdx === null) continue;

    const CI = sealingMode
      ? resolveColumnsSealing(rawData[headerIdx])
      : resolveColumns(rawData[headerIdx]);
    if (CI.PHONE < 0 || CI.ROUTE_CODE < 0) continue;

    for (const row of rawData.slice(headerIdx + 1)) {
      if (!row) continue;
      const rc = cellVal(row, CI.ROUTE_CODE);
      if (!rc || !routeCodeSet.has(rc)) continue;

      const year = parseInt(cellVal(row, CI.YEAR), 10);
      if (isNaN(year) || year < 2000) continue;

      // Sealing carries the raw SERVICE code in the FO slot and shows it
      // verbatim; aeration runs the FO value through interpretService later.
      const serviceRaw = sealingMode
        ? interpretServiceSealing(cellVal(row, CI.FO))
        : cellVal(row, CI.FO);

      const cbRow: RawCallbookRow = {
        routeCode: rc,
        firstName: cellVal(row, CI.FIRST),
        lastName: cellVal(row, CI.LAST),
        houseNum: cellVal(row, CI.HOUSE),
        streetName: cellVal(row, CI.STREET),
        phone: normalizePhone(cellVal(row, CI.PHONE)),
        fo: serviceRaw,
        price: cellVal(row, CI.PRICE),
        contractor: cellVal(row, CI.CONTRACTOR),
        year,
      };

      if (!routeRowsMap.has(rc)) routeRowsMap.set(rc, []);
      routeRowsMap.get(rc)!.push(cbRow);
    }
  }

  // Build upsert rows — one per route code (even if no history found)
  const upsertRows = routeCodes.map(rc => {
    const rows = routeRowsMap.get(rc) || [];
    return {
      command_center_id: ccId,
      route_code: rc,
      clients: rows.length > 0 ? groupClientsByAddress(rows, sealingMode) : [],
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from('pcl_cache')
    .upsert(upsertRows, { onConflict: 'command_center_id,route_code' });

  if (error) {
    console.warn('[PCL Cache] Failed to write to Supabase:', error.message);
  } else {
    console.log(`[PCL Cache] Cached PCL for ${upsertRows.length} routes`);
  }
}

// ─── PER-MANAGER PREFIX LOAD (Sealing, non-mapping CCs) ──────────────────────

/**
 * PCL loader for a manager carrying a per-manager digital mapping config
 * (users.metadata.digitalMapping — see ManagerMappingConfig).
 *
 * Differences from loadAndCachePCL:
 *   - Callbook rows carry the BARE map prefix (e.g. "WASA") instead of a
 *     numbered route code, so rows match on route code === config.prefix.
 *   - Each matched row's address is geocoded (Mapbox, hard-constrained to the
 *     bounding box of the manager's chosen routes) and bucketed into whichever
 *     route has the nearest map segment.
 *   - Rows whose address can't be geocoded are DROPPED, with a console count.
 *   - Every geocode is saved to the session's geocode_cache so RMMapTab's PCL
 *     phase hydrates from cache instead of re-paying for the same lookups.
 *
 * Reuses the sealing resolver and the "…Callbooks" tab filter as-is. Same
 * non-blocking caller contract as loadAndCachePCL: callers catch + log.
 */
// ─── PERMANENT PCL GEOCODE CACHE ─────────────────────────────────────────────
//
// geocode_cache is keyed by address + command centre + SESSION DATE, so every
// new session pays for the same few thousand Mapbox lookups all over again. At
// the pacing this loader must keep, that is several minutes of work — and when
// a run is interrupted, the rows it never reached are silently dropped and
// those clients quietly detach from their routes.
//
// pcl_geocode_cache carries no date. Once an address is resolved for a command
// centre it stays resolved, so a preload run in February still holds in April
// and the bucketing lands the same clients on the same routes every time.

export interface GeoPos { lat: number; lng: number }

async function loadPermanentGeocodes(ccId: string): Promise<Map<string, GeoPos>> {
  const out = new Map<string, GeoPos>();
  // Batched: a busy command centre holds far more than Supabase's 1000-row
  // default page, and a silent truncation here means re-paying for addresses
  // we already own.
  const BATCH = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('pcl_geocode_cache')
      .select('address_key, lat, lng')
      .eq('command_center_id', ccId)
      .range(from, from + BATCH - 1);
    if (error) {
      console.warn('[PCL Geocode] Permanent cache read failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    data.forEach((r: any) => out.set(r.address_key, { lat: r.lat, lng: r.lng }));
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return out;
}

async function savePermanentGeocodes(
  ccId: string,
  entries: Array<{ key: string; pos: GeoPos }>,
): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map(e => ({
    command_center_id: ccId,
    address_key: e.key,
    lat: e.pos.lat,
    lng: e.pos.lng,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('pcl_geocode_cache')
    .upsert(rows, { onConflict: 'command_center_id,address_key' });
  if (error) console.warn('[PCL Geocode] Permanent cache write failed:', error.message);
}

// Progress reporting for the Session Command Center's preload panel. Geocoding
// thousands of addresses at Mapbox's tolerated pace takes minutes and otherwise
// looks exactly like a hang.
export interface PCLPreloadProgress {
  phase: 'reading_sheets' | 'geocoding' | 'bucketing' | 'done';
  prefix: string;
  current: number;
  total: number;
  message?: string;
}
export type PCLProgressFn = (p: PCLPreloadProgress) => void;

export async function loadAndCachePCLByPrefix(
  masterbookingsSheetId: string,
  config: ManagerMappingConfig,
  accessToken: string,
  ccId: string,
  // NULL means "no live session" — a deliberate preload. The permanent geocode
  // cache is written either way; the session-scoped one only when a date exists.
  sessionDate: string | null,
  onProgress?: PCLProgressFn,
): Promise<void> {
  if (!masterbookingsSheetId || !accessToken) return;
  if (!config?.prefix || !config.routeCodes || config.routeCodes.length === 0) return;
  const report = (p: Omit<PCLPreloadProgress, 'prefix'>) =>
    onProgress?.({ ...p, prefix: config.prefix });
  report({ phase: 'reading_sheets', current: 0, total: 0 });

  // 1. Route geometry — needed for the geocode bbox AND the bucketing.
  let routeMaps: ApprovedRouteMap[];
  try {
    routeMaps = await getApprovedRouteMapsByCodes(config.routeCodes);
  } catch (err) {
    console.warn('[PCL Prefix] Failed to load route geometry:', err);
    return;
  }
  if (routeMaps.length === 0) {
    console.warn(`[PCL Prefix] No approved route_maps rows for prefix "${config.prefix}" — skipping.`);
    return;
  }
  const bbox = bboxForRouteMaps(routeMaps);

  // 2. Read the sealing callbook tabs; keep rows whose route code is the bare prefix.
  let tabs: string[];
  try {
    tabs = await getCallbookTabNames(accessToken, masterbookingsSheetId, true);
  } catch (err) {
    console.warn('[PCL Prefix] Could not fetch callbook tabs:', err);
    return;
  }

  const matchedRows: RawCallbookRow[] = [];
  for (const tabName of tabs) {
    let rawData: any[][];
    try {
      rawData = await sheetsGetRaw(accessToken, masterbookingsSheetId, `'${tabName}'`);
    } catch {
      continue;
    }
    if (!rawData || rawData.length < 2) continue;

    const headerIdx = findHeaderRow(rawData);
    if (headerIdx === null) continue;

    const CI = resolveColumnsSealing(rawData[headerIdx]);
    if (CI.PHONE < 0 || CI.ROUTE_CODE < 0) continue;

    for (const row of rawData.slice(headerIdx + 1)) {
      if (!row) continue;
      const rc = cellVal(row, CI.ROUTE_CODE);
      if (rc !== config.prefix) continue;

      const year = parseInt(cellVal(row, CI.YEAR), 10);
      if (isNaN(year) || year < 2000) continue;

      matchedRows.push({
        routeCode: rc,
        firstName: cellVal(row, CI.FIRST),
        lastName: cellVal(row, CI.LAST),
        houseNum: cellVal(row, CI.HOUSE),
        streetName: cellVal(row, CI.STREET),
        phone: normalizePhone(cellVal(row, CI.PHONE)),
        fo: interpretServiceSealing(cellVal(row, CI.FO)),
        price: cellVal(row, CI.PRICE),
        contractor: cellVal(row, CI.CONTRACTOR),
        year,
      });
    }
  }

  console.log(`[PCL Prefix] ${matchedRows.length} callbook rows carry prefix "${config.prefix}".`);

  // 3. Geocode unique addresses. Hydrate from the session geocode_cache first
  //    so re-runs (and addresses shared with other map layers) cost nothing.
  //    Key normalization matches sessionService.normalizeAddressKey.
  const normKey = (addr: string) => addr.toLowerCase().replace(/\s+/g, ' ').trim();
  // PERMANENT cache first — this is the one that makes preloading worth doing.
  const geo = await loadPermanentGeocodes(ccId);
  // Then the session cache, if we're inside a live session: it may already hold
  // addresses resolved today by other map layers that we haven't met yet.
  if (sessionDate) {
    try {
      const { data } = await supabase
        .from('geocode_cache')
        .select('address_key, lat, lng')
        .eq('command_center_id', ccId)
        .eq('session_date', sessionDate);
      (data || []).forEach((r: any) => {
        if (!geo.has(r.address_key)) geo.set(r.address_key, { lat: r.lat, lng: r.lng });
      });
    } catch {
      // Best-effort — geocoding below still works without it.
    }
  }

  const uniqueAddrs: string[] = [];
  const seenAddr = new Set<string>();
  for (const r of matchedRows) {
    const addr = `${r.houseNum} ${r.streetName}`.trim();
    if (!addr) continue;
    const key = normKey(addr);
    if (!seenAddr.has(key)) {
      seenAddr.add(key);
      uniqueAddrs.push(addr);
    }
  }

  let processed = 0;
  // New coordinates go to the permanent cache in batches rather than one row at
  // a time. A round trip per address nearly doubles the wall-clock cost of the
  // run and, worse, an interrupted run leaves the work half-saved.
  let pendingSaves: Array<{ key: string; pos: GeoPos }> = [];
  const SAVE_EVERY = 25;

  report({ phase: 'geocoding', current: 0, total: uniqueAddrs.length });

  for (const addr of uniqueAddrs) {
    const key = normKey(addr);
    processed++;

    if (geo.has(key)) {
      // Already known — no lookup and no pause. This is what makes a second run
      // over a warmed cache finish in seconds rather than minutes.
      if (processed % 25 === 0) report({ phase: 'geocoding', current: processed, total: uniqueAddrs.length });
      continue;
    }

    const pos = await geocodeAddressInBbox(addr, bbox);
    if (pos) {
      geo.set(key, pos);
      pendingSaves.push({ key, pos });
      // The session-scoped cache still gets its copy when a session exists, so
      // today's map hydrates without reaching for the permanent table.
      if (sessionDate) {
        const { error: gcError } = await supabase
          .from('geocode_cache')
          .upsert({
            address_key: key,
            command_center_id: ccId,
            session_date: sessionDate,
            lat: pos.lat,
            lng: pos.lng,
          }, { onConflict: 'address_key,command_center_id,session_date' });
        if (gcError) console.warn('[PCL Prefix] geocode_cache save failed:', gcError.message);
      }
    }

    if (pendingSaves.length >= SAVE_EVERY) {
      await savePermanentGeocodes(ccId, pendingSaves);
      pendingSaves = [];
    }

    if (processed % 25 === 0) {
      console.log(`[PCL Prefix] Geocoded ${processed}/${uniqueAddrs.length} addresses…`);
      report({ phase: 'geocoding', current: processed, total: uniqueAddrs.length });
    }
    // Gentle pacing to stay under Mapbox's per-minute geocoding limit.
    await new Promise(res => setTimeout(res, 120));
  }

  // Flush whatever's left in the batch before we move on.
  await savePermanentGeocodes(ccId, pendingSaves);
  report({ phase: 'bucketing', current: uniqueAddrs.length, total: uniqueAddrs.length });

  // 4. Bucket each row into the nearest route; drop rows with no geocode.
  const rowsByRoute = new Map<string, RawCallbookRow[]>();
  let dropped = 0;
  for (const r of matchedRows) {
    const addr = `${r.houseNum} ${r.streetName}`.trim();
    const pos = addr ? geo.get(normKey(addr)) : undefined;
    if (!pos) { dropped++; continue; }
    const nearest = nearestRouteForPoint(pos.lat, pos.lng, routeMaps);
    if (!nearest) { dropped++; continue; }
    // Stamp the resolved numbered code onto the row for display consistency.
    const resolved: RawCallbookRow = { ...r, routeCode: nearest.routeCode };
    if (!rowsByRoute.has(nearest.routeCode)) rowsByRoute.set(nearest.routeCode, []);
    rowsByRoute.get(nearest.routeCode)!.push(resolved);
  }
  if (dropped > 0) {
    console.warn(`[PCL Prefix] Dropped ${dropped} of ${matchedRows.length} rows — address could not be geocoded.`);
  }

  // 5. One pcl_cache row per chosen route (empty allowed, so stale rows from a
  //    previous session can't linger under these codes).
  const upsertRows = config.routeCodes.map(rc => {
    const rows = rowsByRoute.get(rc) || [];
    return {
      command_center_id: ccId,
      route_code: rc,
      clients: rows.length > 0 ? groupClientsByAddress(rows, true) : [],
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from('pcl_cache')
    .upsert(upsertRows, { onConflict: 'command_center_id,route_code' });

    if (error) {
      console.warn('[PCL Prefix] Failed to write to Supabase:', error.message);
      report({ phase: 'done', current: 0, total: 0, message: `failed to save — ${error.message}` });
    } else {
      console.log(`[PCL Prefix] Cached ${matchedRows.length - dropped} clients across ${upsertRows.length} routes for "${config.prefix}"`);
      report({
        phase: 'done',
        current: matchedRows.length - dropped,
        total: matchedRows.length,
        message: `${matchedRows.length - dropped} clients across ${upsertRows.length} routes`
          + (dropped > 0 ? ` · ${dropped} dropped, no geocode` : ''),
      });
    }
  }

// ─── MAP-SCOPED PCL LOAD (Map Builder) ───────────────────────────────────────
//
// Scoped to the MAP, not to a command centre: writes to map_pcl_cache, keyed by
// route code alone, so any centre that later runs the map inherits the PCLs.
//
// IMPORTANT — work is grouped by PREFIX, not by area. Several areas legitimately
// share one prefix (AJAX NORTH #1 and #2 are both "AN"). Processing them
// separately would geocode every AN address once per area, and because each
// area's bounding box carries a 2 km pad the two boxes overlap — so a house near
// the boundary would resolve in BOTH and end up cached on a route in each.
// Instead we pool every route belonging to the prefix, geocode each address once
// against the combined box, and let nearest-route decide which area it lands in.
// One address, one route, no duplicates, half the lookups.
//
// Coordinates are stored on each client. A re-run rehydrates from what's already
// cached, so a second pass costs no geocoding at all — which matters when the
// sheet holds twenty thousand rows and Mapbox must be paced.

export interface MapPCLProgress {
  phase: 'reading_sheet' | 'area' | 'geocoding' | 'saving' | 'done';
  areaName: string;      // the prefix group's label, e.g. "AN · Ajax North #1, #2"
  areaIndex: number;
  areaTotal: number;
  current: number;
  total: number;
  message?: string;
}
export type MapPCLProgressFn = (p: MapPCLProgress) => void;

interface MapAreaRow { area_name: string; prefix: string; region: string }

// route_maps rows shaped for the geometry helpers. Queried by area rather than
// by code list, because the Map Builder thinks in areas.
async function approvedMapsForArea(areaName: string): Promise<ApprovedRouteMap[]> {
  const { data, error } = await supabase
    .from('route_maps')
    .select('*')
    .eq('area_name', areaName)
    .eq('status', 'approved');
  if (error) {
    console.warn('[Map PCL] route_maps read failed for', areaName, error.message);
    return [];
  }
  return (data || []).map((r: any) => ({
    id: r.id,
    areaName: r.area_name,
    routeNumber: r.route_number,
    routeCode: r.route_code,
    routeColor: r.route_color,
    segments: Array.isArray(r.segments) ? r.segments : [],
  }));
}

/**
 * Load callbook PCLs for every area in a region from one spreadsheet.
 *
 * The sheet is read ONCE and bucketed by prefix in memory — re-reading twenty
 * thousand rows per area would be the slowest part of the job by a wide margin.
 */
export async function loadAndCacheMapPCL(
  spreadsheetId: string,
  accessToken: string,
  region: string,
  onProgress?: MapPCLProgressFn,
): Promise<{ areasProcessed: number; clientsCached: number; dropped: number }> {
  const report = (p: Partial<MapPCLProgress> & { phase: MapPCLProgress['phase'] }) =>
    onProgress?.({
      areaName: '', areaIndex: 0, areaTotal: 0, current: 0, total: 0, ...p,
    } as MapPCLProgress);

  report({ phase: 'reading_sheet', message: 'Loading areas…' });

  const { data: areaData, error: areaErr } = await supabase
    .from('area_prefixes')
    .select('area_name, prefix, region')
    .eq('region', region)
    .order('area_name');
  if (areaErr) throw new Error(`Could not read areas: ${areaErr.message}`);
  const areas = (areaData || []) as MapAreaRow[];
  if (areas.length === 0) {
    return { areasProcessed: 0, clientsCached: 0, dropped: 0 };
  }

  // Group areas by PREFIX — this, not the area, is the unit of work. Pooling the
  // group's routes and letting nearest-route arbitrate is what keeps AJAX NORTH
  // #1 and #2 from both claiming the same boundary houses.
  const groups = new Map<string, MapAreaRow[]>();
  for (const a of areas) {
    if (!a.prefix) continue;
    if (!groups.has(a.prefix)) groups.set(a.prefix, []);
    groups.get(a.prefix)!.push(a);
  }
  const prefixes = Array.from(groups.keys());

  // --- read the sheet once, bucket rows by prefix ---
  report({ phase: 'reading_sheet', message: 'Reading callbook tabs…' });
  const wantedPrefixes = new Set(prefixes);
  const rowsByPrefix = new Map<string, RawCallbookRow[]>();
  const cityByAddrKey = new Map<string, string>();
  const normKey = (addr: string) => addr.toLowerCase().replace(/\s+/g, ' ').trim();

  const tabs = await getCallbookTabNames(accessToken, spreadsheetId, true);
  if (tabs.length === 0) {
    throw new Error('No tab whose name ends in "Callbooks" was found in that spreadsheet.');
  }

  for (const tabName of tabs) {
    let rawData: any[][];
    try {
      rawData = await sheetsGetRaw(accessToken, spreadsheetId, `'${tabName}'`);
    } catch (err) {
      console.warn('[Map PCL] Could not read tab', tabName, err);
      continue;
    }
    if (!rawData || rawData.length < 2) continue;

    const headerIdx = findHeaderRow(rawData);
    if (headerIdx === null) continue;
    const CI = resolveColumnsSealing(rawData[headerIdx]);
    if (CI.PHONE < 0 || CI.ROUTE_CODE < 0) continue;

    // CITY isn't part of the shared resolver, but this sheet carries one and it
    // materially improves geocoding — "49 Addley Cr, Ajax" beats "49 Addley Cr".
    let cityIdx = -1;
    const headers = rawData[headerIdx];
    for (let i = 0; i < headers.length; i++) {
      if (String(headers[i] ?? '').trim().toUpperCase() === 'CITY') { cityIdx = i; break; }
    }

    for (const row of rawData.slice(headerIdx + 1)) {
      if (!row) continue;
      const rc = cellVal(row, CI.ROUTE_CODE);
      if (!rc || !wantedPrefixes.has(rc)) continue;

      const year = parseInt(cellVal(row, CI.YEAR), 10);
      if (isNaN(year) || year < 2000) continue;

      const houseNum = cellVal(row, CI.HOUSE);
      const streetName = cellVal(row, CI.STREET);
      const cbRow: RawCallbookRow = {
        routeCode: rc,
        firstName: cellVal(row, CI.FIRST),
        lastName: cellVal(row, CI.LAST),
        houseNum,
        streetName,
        phone: normalizePhone(cellVal(row, CI.PHONE)),
        fo: interpretServiceSealing(cellVal(row, CI.FO)),
        price: cellVal(row, CI.PRICE),
        contractor: cellVal(row, CI.CONTRACTOR),
        year,
      };
      if (cityIdx >= 0) {
        const addr = `${houseNum} ${streetName}`.trim();
        const city = cellVal(row, cityIdx);
        if (addr && city) cityByAddrKey.set(normKey(addr), city);
      }
      if (!rowsByPrefix.has(rc)) rowsByPrefix.set(rc, []);
      rowsByPrefix.get(rc)!.push(cbRow);
    }
  }

  let clientsCached = 0;
  let droppedTotal = 0;
  let areasProcessed = 0;

  // --- one PREFIX GROUP at a time ---
  for (let gi = 0; gi < prefixes.length; gi++) {
    const prefix = prefixes[gi];
    const groupAreas = groups.get(prefix)!;
    const label = `${prefix} · ${groupAreas.map(a => a.area_name).join(', ')}`;
    const matchedRows = rowsByPrefix.get(prefix) || [];
    report({
      phase: 'area', areaName: label, areaIndex: gi + 1, areaTotal: prefixes.length,
      message: `${matchedRows.length} callbook rows across ${groupAreas.length} area${groupAreas.length === 1 ? '' : 's'}`,
    });
    if (matchedRows.length === 0) continue;

    // Pool every approved route across every area sharing this prefix, and keep
    // note of which area each route came from so the cache row is stamped right.
    const routeMaps: ApprovedRouteMap[] = [];
    const areaByRouteCode = new Map<string, MapAreaRow>();
    for (const a of groupAreas) {
      const maps = await approvedMapsForArea(a.area_name);
      maps.forEach(m => { routeMaps.push(m); areaByRouteCode.set(m.routeCode, a); });
    }
    if (routeMaps.length === 0) {
      report({
        phase: 'area', areaName: label, areaIndex: gi + 1, areaTotal: prefixes.length,
        message: 'skipped — no approved routes drawn yet',
      });
      continue;
    }
    // Combined box over the whole group. Wider than a single area's, but the
    // nearest-route step below is what actually decides the assignment.
    const bbox = bboxForRouteMaps(routeMaps);

    // Rehydrate coordinates from what this area already has cached, so a second
    // run costs nothing. This is why the coordinates live on the client rows.
    const geo = new Map<string, GeoPos>();
    try {
      const { data: cached } = await supabase
        .from('map_pcl_cache')
        .select('clients')
        .eq('prefix', prefix);
      (cached || []).forEach((r: any) => {
        (r.clients || []).forEach((c: any) => {
          if (typeof c.lat === 'number' && typeof c.lng === 'number') {
            geo.set(normKey(`${c.houseNum} ${c.streetName}`.trim()), { lat: c.lat, lng: c.lng });
          }
        });
      });
    } catch {
      // Best-effort; we simply re-geocode without it.
    }

    // Unique addresses for this area.
    const uniqueAddrs: string[] = [];
    const seenAddr = new Set<string>();
    for (const r of matchedRows) {
      const addr = `${r.houseNum} ${r.streetName}`.trim();
      if (!addr) continue;
      const k = normKey(addr);
      if (!seenAddr.has(k)) { seenAddr.add(k); uniqueAddrs.push(addr); }
    }

    let processed = 0;
    for (const addr of uniqueAddrs) {
      const key = normKey(addr);
      processed++;
      if (geo.has(key)) {
        if (processed % 25 === 0) {
          report({ phase: 'geocoding', areaName: label, areaIndex: gi + 1, areaTotal: prefixes.length, current: processed, total: uniqueAddrs.length });
        }
        continue;
      }
      const city = cityByAddrKey.get(key);
      const pos = await geocodeAddressInBbox(city ? `${addr}, ${city}` : addr, bbox);
      if (pos) geo.set(key, pos);
      if (processed % 25 === 0) {
        report({ phase: 'geocoding', areaName: label, areaIndex: gi + 1, areaTotal: prefixes.length, current: processed, total: uniqueAddrs.length });
      }
      // Pacing to stay inside Mapbox's per-minute geocoding limit.
      await new Promise(res => setTimeout(res, 120));
    }

    // Bucket onto the nearest route; rows with no coordinate are dropped.
    const rowsByRoute = new Map<string, RawCallbookRow[]>();
    const posByAddrKey = new Map<string, GeoPos>();
    let dropped = 0;
    for (const r of matchedRows) {
      const addr = `${r.houseNum} ${r.streetName}`.trim();
      const pos = addr ? geo.get(normKey(addr)) : undefined;
      if (!pos) { dropped++; continue; }
      const nearest = nearestRouteForPoint(pos.lat, pos.lng, routeMaps);
      if (!nearest) { dropped++; continue; }
      posByAddrKey.set(normKey(addr), pos);
      const resolved: RawCallbookRow = { ...r, routeCode: nearest.routeCode };
      if (!rowsByRoute.has(nearest.routeCode)) rowsByRoute.set(nearest.routeCode, []);
      rowsByRoute.get(nearest.routeCode)!.push(resolved);
    }
    droppedTotal += dropped;

    report({ phase: 'saving', areaName: label, areaIndex: gi + 1, areaTotal: prefixes.length });

    // One row per approved route in the GROUP — empty ones included, so a route
    // that lost all its clients can't keep showing an old list. Each row is
    // stamped with the area that actually owns that route, so two areas sharing
    // a prefix still report their own counts on their own cards.
    const upsertRows = routeMaps.map(rm => {
      const rows = rowsByRoute.get(rm.routeCode) || [];
      const groupsForRoute = rows.length > 0 ? groupClientsByAddress(rows, true) : [];
      // Stamp each client with the coordinate that placed it here.
      groupsForRoute.forEach(g => {
        const k = normKey(`${g.houseNum} ${g.streetName}`.trim());
        const p = posByAddrKey.get(k);
        if (p) { g.lat = p.lat; g.lng = p.lng; }
        const c = cityByAddrKey.get(k);
        if (c) g.city = c;
      });
      clientsCached += groupsForRoute.length;
      const owningArea = areaByRouteCode.get(rm.routeCode);
      return {
        route_code: rm.routeCode,
        area_name: owningArea?.area_name || rm.areaName,
        region: owningArea?.region || region,
        prefix,
        clients: groupsForRoute,
        client_count: groupsForRoute.length,
        updated_at: new Date().toISOString(),
      };
    });

    const { error: upErr } = await supabase
      .from('map_pcl_cache')
      .upsert(upsertRows, { onConflict: 'route_code' });
    if (upErr) console.warn('[Map PCL] Save failed for', label, upErr.message);
    else areasProcessed += groupAreas.length;
  }

  report({ phase: 'done', areaIndex: prefixes.length, areaTotal: prefixes.length, message: 'complete' });
  return { areasProcessed, clientsCached, dropped: droppedTotal };
}

/** Client counts per AREA, for the Map Builder cards. */
export async function getMapPCLCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const BATCH = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('map_pcl_cache')
      .select('area_name, client_count')
      .range(from, from + BATCH - 1);
    if (error) { console.warn('[Map PCL] Count read failed:', error.message); break; }
    if (!data || data.length === 0) break;
    data.forEach((r: any) => out.set(r.area_name, (out.get(r.area_name) || 0) + (r.client_count || 0)));
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return out;
}

// ─── RECALIBRATE (re-bucket cached PCLs against every route in a region) ─────
//
// Why this exists. The loader trusts the callbook's ROUTE CODE prefix: rows
// marked AUR are geocoded inside Aurora's bounding box and bucketed onto the
// nearest AURORA route. But that box carries a 2 km pad and reaches into
// neighbouring towns, and nearest-route has no distance ceiling — so a Copper
// Hills address labelled AUR resolves fine, finds no Aurora route anywhere near
// it, and gets pinned to whichever Aurora route is least far away. On the map it
// sits miles off any Aurora line, in the middle of Newmarket's routes.
//
// The prefix in the sheet is not authoritative. The geography is.
//
// Recalibrate throws the prefix away and re-decides purely on position: for
// every cached client, the nearest route across EVERY area in the region wins.
// It reads no spreadsheet and calls no geocoder — the coordinates are already
// stored on the clients — so it costs a minute rather than an hour, and it's
// worth re-running every time another area gets drawn.

export interface RecalibrateProgress {
  phase: 'loading_routes' | 'loading_clients' | 'matching' | 'saving' | 'done';
  current: number;
  total: number;
  message?: string;
}
export type RecalibrateProgressFn = (p: RecalibrateProgress) => void;

// A ~1.1 km grid over the region's route coordinates. Without it, matching each
// client against every segment of every route in East is billions of distance
// calculations and the tab dies. With it we test a handful of nearby routes.
const RECAL_CELL = 0.01;
const recalCell = (lat: number, lng: number) =>
  `${Math.floor(lat / RECAL_CELL)}:${Math.floor(lng / RECAL_CELL)}`;

export async function recalibrateMapPCL(
  region: string,
  onProgress?: RecalibrateProgressFn,
): Promise<{ moved: number; unchanged: number; far: number; routesWritten: number; clients: number }> {
  const report = (p: Partial<RecalibrateProgress> & { phase: RecalibrateProgress['phase'] }) =>
    onProgress?.({ current: 0, total: 0, ...p } as RecalibrateProgress);

  // 1. Areas in this region.
  report({ phase: 'loading_routes', message: 'Loading areas…' });
  const { data: areaData, error: areaErr } = await supabase
    .from('area_prefixes')
    .select('area_name, prefix, region')
    .eq('region', region);
  if (areaErr) throw new Error(`Could not read areas: ${areaErr.message}`);
  const areaRows = (areaData || []) as Array<{ area_name: string; prefix: string; region: string }>;
  if (areaRows.length === 0) throw new Error(`No areas found in ${region}.`);
  const areaMeta = new Map(areaRows.map(a => [a.area_name, a]));
  const areaNames = areaRows.map(a => a.area_name);

  // 2. Every approved route in the region. We keep ONLY the coordinates —
  //    the rest of each row is discarded as we go, because holding the full
  //    jsonb for a whole region is what would run the tab out of memory.
  const routeCodes: string[] = [];
  const routeAreas: string[] = [];
  const routeSegs: Array<Array<[number, number][]>> = [];

  const CHUNK = 40;   // area names per query — a 180-name IN list is asking for trouble
  for (let i = 0; i < areaNames.length; i += CHUNK) {
    const slice = areaNames.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('route_maps')
      .select('area_name, route_code, segments')
      .in('area_name', slice)
      .eq('status', 'approved');
    if (error) { console.warn('[Recalibrate] route_maps read failed:', error.message); continue; }
    (data || []).forEach((r: any) => {
      const segs: Array<[number, number][]> = (Array.isArray(r.segments) ? r.segments : [])
        .map((s: any) => (Array.isArray(s.coordinates) ? s.coordinates : []))
        .filter((c: any[]) => c.length > 0);
      if (segs.length === 0) return;
      routeCodes.push(r.route_code);
      routeAreas.push(r.area_name);
      routeSegs.push(segs);
    });
    report({
      phase: 'loading_routes',
      current: Math.min(i + CHUNK, areaNames.length),
      total: areaNames.length,
      message: `${routeCodes.length} routes loaded`,
    });
  }
  if (routeCodes.length === 0) throw new Error(`No approved routes drawn in ${region} yet.`);

  // 3. Grid index: cell → the routes that pass through it.
  const grid = new Map<string, Set<number>>();
  for (let ri = 0; ri < routeSegs.length; ri++) {
    for (const seg of routeSegs[ri]) {
      for (const c of seg) {
        const k = recalCell(c[1], c[0]);
        let s = grid.get(k);
        if (!s) { s = new Set<number>(); grid.set(k, s); }
        s.add(ri);
      }
    }
  }

  // 4. Every cached client in the region.
  report({ phase: 'loading_clients', message: 'Loading cached PCLs…' });
  interface Held { client: any; oldRoute: string }
  const held: Held[] = [];
  let withoutCoords = 0;
  {
    const BATCH = 500;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('map_pcl_cache')
        .select('route_code, clients')
        .eq('region', region)
        .range(from, from + BATCH - 1);
      if (error) throw new Error(`Could not read cached PCLs: ${error.message}`);
      if (!data || data.length === 0) break;
      data.forEach((row: any) => {
        (row.clients || []).forEach((c: any) => {
          if (typeof c.lat === 'number' && typeof c.lng === 'number') {
            held.push({ client: c, oldRoute: row.route_code });
          } else {
            withoutCoords++;
          }
        });
      });
      report({ phase: 'loading_clients', current: held.length, total: held.length, message: `${held.length} clients` });
      if (data.length < BATCH) break;
      from += BATCH;
    }
  }
  if (withoutCoords > 0) {
    console.warn(`[Recalibrate] ${withoutCoords} clients have no stored coordinate and cannot be moved.`);
  }
  if (held.length === 0) {
    return { moved: 0, unchanged: 0, far: 0, routesWritten: 0, clients: 0 };
  }

  // 5. Re-decide each client on position alone.
  const byRoute = new Map<string, any[]>();
  let moved = 0, unchanged = 0, far = 0;

  for (let ci = 0; ci < held.length; ci++) {
    const { client, oldRoute } = held[ci];
    const lat = client.lat as number;
    const lng = client.lng as number;

    // Candidates from the grid, widening until something turns up.
    let candidates = new Set<number>();
    for (const radius of [1, 3, 8, 20]) {
      const baseLat = Math.floor(lat / RECAL_CELL);
      const baseLng = Math.floor(lng / RECAL_CELL);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const s = grid.get(`${baseLat + dy}:${baseLng + dx}`);
          if (s) s.forEach(v => candidates.add(v));
        }
      }
      if (candidates.size > 0) break;
    }
    // Nothing within ~22 km — fall back to the whole region rather than drop it.
    if (candidates.size === 0) {
      candidates = new Set(routeSegs.map((_, i) => i));
    }

    let bestIdx = -1;
    let bestDist = Infinity;
    candidates.forEach(ri => {
      for (const seg of routeSegs[ri]) {
        if (seg.length === 1) {
          const d = distToSegmentMetersLocal(lat, lng, seg[0][1], seg[0][0], seg[0][1], seg[0][0]);
          if (d < bestDist) { bestDist = d; bestIdx = ri; }
          continue;
        }
        for (let i = 0; i < seg.length - 1; i++) {
          const d = distToSegmentMetersLocal(lat, lng, seg[i][1], seg[i][0], seg[i + 1][1], seg[i + 1][0]);
          if (d < bestDist) { bestDist = d; bestIdx = ri; }
        }
      }
    });

    if (bestIdx < 0) { unchanged++; continue; }
    const newRoute = routeCodes[bestIdx];
    if (bestDist > 500) far++;
    if (newRoute === oldRoute) unchanged++; else moved++;

    if (!byRoute.has(newRoute)) byRoute.set(newRoute, []);
    byRoute.get(newRoute)!.push(client);

    if (ci % 200 === 0) {
      report({ phase: 'matching', current: ci, total: held.length, message: `${moved} moved so far` });
    }
  }

  // 6. Write every route in the region — including the ones that emptied out,
  //    or a client that moved away would still be listed on its old route.
  report({ phase: 'saving', current: 0, total: routeCodes.length });
  const rows = routeCodes.map((code, i) => {
    const list = byRoute.get(code) || [];
    const meta = areaMeta.get(routeAreas[i]);
    return {
      route_code: code,
      area_name: routeAreas[i],
      region,
      prefix: meta?.prefix || null,
      clients: list,
      client_count: list.length,
      updated_at: new Date().toISOString(),
    };
  });

  const WRITE = 200;
  for (let i = 0; i < rows.length; i += WRITE) {
    const { error } = await supabase
      .from('map_pcl_cache')
      .upsert(rows.slice(i, i + WRITE), { onConflict: 'route_code' });
    if (error) console.warn('[Recalibrate] Save failed:', error.message);
    report({ phase: 'saving', current: Math.min(i + WRITE, rows.length), total: rows.length });
  }

  report({ phase: 'done', current: held.length, total: held.length, message: 'complete' });
  return { moved, unchanged, far, routesWritten: rows.length, clients: held.length };
}

// Local copy of the point-to-segment distance. managerMappingService keeps its
// version private, and duplicating twelve lines beats exporting internals just
// so this file can borrow them.
function distToSegmentMetersLocal(
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

// ─── READ FOR WORKER ─────────────────────────────────────────────────────────

/**
 * Fetches cached PCL client groups for a set of route codes.
 * Returns a map of routeCode → PCLClientGroup[].
 * Workers call this — no Google OAuth required.
 *
 * IMPORTANT: throws on Supabase errors so callers can distinguish a real
 * failure (worth retrying) from a clean empty result (no rows exist).
 */
export async function getWorkerPCL(
  routeCodes: string[],
  ccId: string,
): Promise<Map<string, PCLClientGroup[]>> {
  const result = new Map<string, PCLClientGroup[]>();
  if (routeCodes.length === 0) return result;

  const { data, error } = await supabase
    .from('pcl_cache')
    .select('route_code, clients')
    .eq('command_center_id', ccId)
    .in('route_code', routeCodes);

  if (error) {
    throw new Error(`[PCL Cache] Supabase read failed: ${error.message}`);
  }

  // The command centre's own rows, held aside rather than used immediately.
  const ccByRoute = new Map<string, PCLClientGroup[]>();
  for (const row of data || []) {
    const list = (row.clients || []) as PCLClientGroup[];
    if (list.length > 0) ccByRoute.set(row.route_code, list);
  }

  // THE MAP'S PCLs WIN.
  //
  // Two tables hold callbook clients. pcl_cache is filled by the per-session
  // callbook load and keyed to a command centre; its clients carry names and
  // history but NO coordinates, because only the Map Builder loader ever stored
  // them. map_pcl_cache is filled in Map Builder, keyed by route code alone, and
  // every client carries the coordinate that placed it on its route.
  //
  // This used to prefer the command centre's rows, which meant a mapped centre
  // that also had its own callbook load never saw the geocoded set — and the RM
  // map re-geocoded every client, one at a time, on every load. The map's rows
  // are the maintained ones: resolved once, permanently attached, re-bucketed by
  // recalibrate. They take precedence, and the centre's own rows fill the gaps
  // for centres with no map loaded.
  const mapByRoute = new Map<string, PCLClientGroup[]>();
  {
    // Chunked — a worker on a large split area can ask for more codes than is
    // comfortable in a single IN list.
    const CHUNK = 100;
    for (let i = 0; i < routeCodes.length; i += CHUNK) {
      const slice = routeCodes.slice(i, i + CHUNK);
      const { data: mapRows, error: mapErr } = await supabase
        .from('map_pcl_cache')
        .select('route_code, clients')
        .in('route_code', slice);
      if (mapErr) {
        // Non-fatal — the centre's own rows are already in hand.
        console.warn('[PCL Cache] map_pcl_cache read failed:', mapErr.message);
        break;
      }
      for (const row of mapRows || []) {
        const list = (row.clients || []) as PCLClientGroup[];
        if (list.length > 0) mapByRoute.set(row.route_code, list);
      }
    }
  }

  let fromMap = 0;
  let fromCC = 0;
  for (const rc of routeCodes) {
    const fromMapList = mapByRoute.get(rc);
    if (fromMapList) { result.set(rc, fromMapList); fromMap++; continue; }
    const fromCcList = ccByRoute.get(rc);
    if (fromCcList) { result.set(rc, fromCcList); fromCC++; }
  }
  if (fromMap > 0 || fromCC > 0) {
    console.log(`[PCL Cache] ${fromMap} routes from the map cache (with coordinates), ${fromCC} from this command center (no coordinates — these will geocode).`);
  }

  return result;
}

// ─── ERROR LOGGING (worker-side diagnostics) ─────────────────────────────────

/**
 * Payload for logPCLError. Mirrors the pcl_error_log table schema.
 */
export interface PCLErrorLogInput {
  commandCenterId: string | null;
  workerUserId: string;
  routeCodes: string[];
  errorMessage: string;
  errorStack: string | null;
  userAgent: string | null;
}

/**
 * Writes a row to the pcl_error_log Supabase table. Used by WorkerPCLTab
 * when both its initial load and silent retry both fail.
 *
 * Fire-and-forget by design — never throws. If the insert itself fails,
 * we just console.warn it; we never want diagnostic logging to break the
 * already-broken UI.
 */
export async function logPCLError(input: PCLErrorLogInput): Promise<void> {
  try {
    const { error } = await supabase.from('pcl_error_log').insert({
      command_center_id: input.commandCenterId,
      worker_user_id: input.workerUserId,
      route_codes: input.routeCodes,
      error_message: input.errorMessage,
      error_stack: input.errorStack,
      user_agent: input.userAgent,
    });
    if (error) {
      console.warn('[PCL Cache] Failed to write error log:', error.message);
    }
  } catch (err) {
    console.warn('[PCL Cache] Exception writing error log:', err);
  }
}
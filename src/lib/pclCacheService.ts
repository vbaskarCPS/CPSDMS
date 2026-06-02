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
      if (!row || !row[0]) continue;
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

  for (const row of data || []) {
    result.set(row.route_code, row.clients as PCLClientGroup[]);
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
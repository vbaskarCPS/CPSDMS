// src/lib/routeFinderUpdaterService.ts
//
// Route Finder Updater (digital mapping only)
//
// Reads a row-range from the Route Finder sheet's "Hamilton Callbooks" tab
// (which carries the extra "Suggested RC" / "Suggested Street" columns), builds
// an address -> {suggested route code, suggested street} map, then writes those
// suggestions into the Master Bookings sheet:
//   - the "Hamilton Callbooks" tab (every row at a matched address), and
//   - the "Bookings" tab (header on row 2; matches on original OR suggested street).
//
// Match key is HOUSE # + STREET, normalized. City is deliberately ignored.
// The previous value of any cell that changes is preserved as a cell NOTE
// (appended beneath any existing note). Only cells whose value actually changes
// are touched. Addresses whose range rows disagree on the suggested route code
// or street are skipped and reported.
//
// Self-contained on purpose: it takes explicit spreadsheet IDs and a live OAuth
// access token (same shape as pclCacheService), so it never touches the
// command-center-scoped googleSheetsService config.

// ─── TAB NAMES (confirmed exact) ──────────────────────────────────────────────
const RF_CALLBOOK_TAB = 'Hamilton Callbooks';   // Route Finder sheet, has Suggested columns
const MB_CALLBOOK_TAB = 'Hamilton Callbooks';   // Master sheet, live callbook
const MB_BOOKINGS_TAB = 'Bookings';             // Master sheet, header on row 2

// ─── PUBLIC TYPES ─────────────────────────────────────────────────────────────

export interface RouteFinderUpdateOptions {
  masterSheetId: string;
  routeFinderSheetId: string;
  startRow: number;          // literal spreadsheet row on the RF "Hamilton Callbooks" tab (>=2)
  endRow: number;
  accessToken: string;
  includeCityFyi?: boolean;  // optional: list matched addresses carrying 2+ city labels
  onProgress?: (msg: string) => void;
}

export interface TabResult {
  rowsMatched: number;          // master rows that sat at a matched address
  routeCodeCellsChanged: number;
  streetCellsChanged: number;
}

export interface ConflictEntry {
  address: string;              // human-readable "house + street"
  suggestedRCs: string[];
  suggestedStreets: string[];
}

export interface RouteFinderUpdateReport {
  rangeRowsRead: number;        // data rows read from the chosen range
  addressesInMap: number;       // distinct addresses with a usable suggestion
  skippedConflicts: ConflictEntry[];
  callbook: TabResult;
  bookings: TabResult;
  addressesUnmatched: number;   // map addresses that matched zero master rows anywhere
  cityFyi?: Array<{ address: string; cities: string[] }>;
}

// ─── NORMALIZERS ──────────────────────────────────────────────────────────────

function normHouse(h: any): string {
  let s = String(h ?? '').trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return s.toLowerCase();
}
function normStreet(s: any): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function normCity(c: any): string {
  return String(c ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function makeKey(house: any, street: any): string {
  return `${normHouse(house)}|${normStreet(street)}`;
}
function cell(row: any[], idx: number): string {
  if (idx < 0 || !row || idx >= row.length) return '';
  return String(row[idx] ?? '').trim();
}
function colLetter(idx0: number): string {
  let n = idx0 + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ─── LOW-LEVEL SHEETS CALLS (direct fetch with passed-in token) ───────────────

async function sheetsGet(token: string, spreadsheetId: string, range: string): Promise<any[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `Failed to read ${range}`);
  }
  const data = await res.json();
  return data.values || [];
}

// Numeric tab id (sheetId) by title — needed for note/value writes.
async function getTabIds(token: string, spreadsheetId: string): Promise<Map<string, number>> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || 'Failed to read master sheet metadata');
  }
  const data = await res.json();
  const m = new Map<string, number>();
  for (const s of (data.sheets || [])) m.set(s.properties.title, s.properties.sheetId);
  return m;
}

// Existing notes for specific columns of a tab -> Map<colIndex, Map<rowNumber, note>>.
async function getExistingNotes(
  token: string, spreadsheetId: string, tab: string, colIndices: number[],
): Promise<Map<number, Map<number, string>>> {
  const out = new Map<number, Map<number, string>>();
  colIndices.forEach(ci => out.set(ci, new Map()));
  if (colIndices.length === 0) return out;

  const ranges = colIndices.map(ci => `'${tab}'!${colLetter(ci)}:${colLetter(ci)}`);
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${qs}` +
    `&fields=${encodeURIComponent('sheets.data.rowData.values.note')}&includeGridData=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    // Non-fatal: if we can't read notes we simply won't be able to append; treat as empty.
    return out;
  }
  const data = await res.json();
  const dataBlocks = data.sheets?.[0]?.data || [];
  for (let k = 0; k < colIndices.length; k++) {
    const ci = colIndices[k];
    const rowData = dataBlocks[k]?.rowData || [];
    const map = out.get(ci)!;
    for (let i = 0; i < rowData.length; i++) {
      const note = rowData[i]?.values?.[0]?.note;
      if (note) map.set(i + 1, String(note)); // column range starts at row 1
    }
  }
  return out;
}

// Send updateCells requests, chunked.
async function sendRequests(token: string, spreadsheetId: string, requests: any[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < requests.length; i += CHUNK) {
    const chunk = requests.slice(i, i + CHUNK);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: chunk }),
      },
    );
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || 'Failed to write updates to the master sheet');
    }
  }
}

// One updateCells request setting a cell's value + (appended) note together.
function buildCellRequest(
  sheetId: number, rowNumber: number, colIndex: number, newValue: string, note: string,
): any {
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1, endRowIndex: rowNumber,
        startColumnIndex: colIndex, endColumnIndex: colIndex + 1,
      },
      rows: [{ values: [{ userEnteredValue: { stringValue: newValue }, note }] }],
      fields: 'userEnteredValue,note',
    },
  };
}

// ─── HEADER RESOLUTION ────────────────────────────────────────────────────────

function findCol(header: any[], names: string[]): number {
  const wanted = names.map(n => n.toUpperCase());
  for (let i = 0; i < header.length; i++) {
    const h = String(header[i] ?? '').trim().toUpperCase();
    if (h && wanted.includes(h)) return i;
  }
  return -1;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export async function runRouteFinderUpdate(
  opts: RouteFinderUpdateOptions,
): Promise<RouteFinderUpdateReport> {
  const { masterSheetId, routeFinderSheetId, startRow, endRow, accessToken, includeCityFyi } = opts;
  const log = opts.onProgress || (() => {});

  if (!masterSheetId) throw new Error('Master Bookings sheet ID is missing.');
  if (!routeFinderSheetId) throw new Error('Route Finder sheet ID is missing.');
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow) || startRow < 2 || endRow < startRow) {
    throw new Error('Start/end rows are invalid. Start must be 2 or more (row 1 is the header) and end must be ≥ start.');
  }

  // ── 1. Read the Route Finder range (header + up to endRow), then slice the chunk
  log('Reading Route Finder range…');
  const rfBlock = await sheetsGet(accessToken, routeFinderSheetId, `'${RF_CALLBOOK_TAB}'!A1:AZ${endRow}`);
  if (rfBlock.length === 0) throw new Error(`Couldn't read "${RF_CALLBOOK_TAB}" on the Route Finder sheet.`);
  const rfHeader = rfBlock[0];
  const rfHouse  = findCol(rfHeader, ['HOUSE #', 'HOUSE#', 'HOUSE']);
  const rfStreet = findCol(rfHeader, ['STREET', 'STREET NAME']);
  const rfSugRC  = findCol(rfHeader, ['SUGGESTED RC', 'SUGGESTED ROUTE CODE']);
  const rfSugSt  = findCol(rfHeader, ['SUGGESTED STREET']);
  if (rfSugRC < 0 || rfSugSt < 0) {
    throw new Error('Could not find "Suggested RC" / "Suggested Street" columns on the Route Finder sheet — are the two sheet URLs in the right boxes?');
  }
  if (rfHouse < 0 || rfStreet < 0) {
    throw new Error('Could not find HOUSE # / STREET columns on the Route Finder sheet.');
  }

  // ── 2. Build address -> suggestion map, detecting conflicts
  type Sug = { rc: Set<string>; street: Set<string>; display: string };
  const map = new Map<string, Sug>();
  let rangeRowsRead = 0;
  for (let r = startRow; r <= endRow; r++) {
    const row = rfBlock[r - 1]; // array index = rowNumber - 1
    if (!row) continue;
    const house = cell(row, rfHouse);
    const street = cell(row, rfStreet);
    if (!house && !street) continue;
    rangeRowsRead++;
    const key = makeKey(house, street);
    const sugRC = cell(row, rfSugRC);
    const sugSt = cell(row, rfSugSt);
    if (!sugRC && !sugSt) continue; // nothing to apply from this row
    if (!map.has(key)) map.set(key, { rc: new Set(), street: new Set(), display: `${house} ${street}`.trim() });
    const e = map.get(key)!;
    if (sugRC) e.rc.add(sugRC);
    if (sugSt) e.street.add(sugSt);
  }

  // Resolve each address to a single answer, or flag a conflict.
  const resolved = new Map<string, { rc: string | null; street: string | null }>();
  const skippedConflicts: ConflictEntry[] = [];
  for (const [key, e] of map) {
    if (e.rc.size > 1 || e.street.size > 1) {
      skippedConflicts.push({
        address: e.display,
        suggestedRCs: Array.from(e.rc),
        suggestedStreets: Array.from(e.street),
      });
      continue;
    }
    resolved.set(key, {
      rc: e.rc.size === 1 ? Array.from(e.rc)[0] : null,
      street: e.street.size === 1 ? Array.from(e.street)[0] : null,
    });
  }
  log(`Built ${resolved.size} address mappings (${skippedConflicts.length} conflicts skipped).`);

  // Track which addresses actually hit a master row, for the unmatched count.
  const matchedKeys = new Set<string>();
  const cityLabels = new Map<string, Set<string>>(); // key -> raw city labels (for FYI)

  // Secondary index: HOUSE # + SUGGESTED street -> answer. Lets a master row
  // that already holds the CLEAN street spelling still match an address keyed
  // on its ORIGINAL street (e.g. "Euston Rd" in the finder vs "Euston Road" in
  // the master). Carries origKey so matched-address tracking stays correct.
  const bySuggested = new Map<string, { rc: string | null; street: string | null; origKey: string }>();
  for (const [k, ans] of resolved) {
    if (ans.street) {
      const house = k.split('|')[0];
      bySuggested.set(`${house}|${normStreet(ans.street)}`, { ...ans, origKey: k });
    }
  }

  // ── 3. Master tab ids + existing notes
  log('Reading master sheet structure…');
  const tabIds = await getTabIds(accessToken, masterSheetId);
  const cbSheetId = tabIds.get(MB_CALLBOOK_TAB);
  const bkSheetId = tabIds.get(MB_BOOKINGS_TAB);
  if (cbSheetId === undefined) throw new Error(`"${MB_CALLBOOK_TAB}" tab not found on the Master sheet.`);

  const requests: any[] = [];

  // ── 4. Master "Hamilton Callbooks" — update every row at a matched address
  log('Scanning master Hamilton Callbooks…');
  const cbRows = await sheetsGet(accessToken, masterSheetId, `'${MB_CALLBOOK_TAB}'!A1:AZ`);
  const cbHeader = cbRows[0] || [];
  const cbRC     = findCol(cbHeader, ['ROUTE CODE', 'ROUTE_CODE', 'ROUTECODE']);
  const cbHouse  = findCol(cbHeader, ['HOUSE #', 'HOUSE#', 'HOUSE']);
  const cbStreet = findCol(cbHeader, ['STREET', 'STREET NAME']);
  const cbCity   = findCol(cbHeader, ['CITY']);
  if (cbRC < 0 || cbHouse < 0 || cbStreet < 0) {
    throw new Error('Could not find ROUTE CODE / HOUSE # / STREET columns on the master Hamilton Callbooks tab.');
  }

  const cbNotes = await getExistingNotes(accessToken, masterSheetId, MB_CALLBOOK_TAB, [cbRC, cbStreet]);
  const cbResult: TabResult = { rowsMatched: 0, routeCodeCellsChanged: 0, streetCellsChanged: 0 };

  for (let i = 1; i < cbRows.length; i++) {
    const row = cbRows[i];
    if (!row) continue;
    const key = makeKey(cell(row, cbHouse), cell(row, cbStreet));
    const direct = resolved.get(key);
    const viaSug = direct ? null : bySuggested.get(key);
    const ans = direct || viaSug;
    if (!ans) continue;
    const matchKey = direct ? key : viaSug!.origKey;
    matchedKeys.add(matchKey);
    cbResult.rowsMatched++;
    const rowNumber = i + 1;

    if (includeCityFyi && cbCity >= 0) {
      const c = normCity(cell(row, cbCity));
      if (c) { if (!cityLabels.has(matchKey)) cityLabels.set(matchKey, new Set()); cityLabels.get(matchKey)!.add(cell(row, cbCity).trim()); }
    }

    if (ans.rc) {
      const old = cell(row, cbRC);
      if (old !== ans.rc) {
        const base = cbNotes.get(cbRC)!.get(rowNumber);
        const note = (base ? base + '\n' : '') + `Was: ${old || '(blank)'}`;
        requests.push(buildCellRequest(cbSheetId, rowNumber, cbRC, ans.rc, note));
        cbResult.routeCodeCellsChanged++;
      }
    }
    if (ans.street) {
      const old = cell(row, cbStreet);
      if (old !== ans.street) {
        const base = cbNotes.get(cbStreet)!.get(rowNumber);
        const note = (base ? base + '\n' : '') + `Was: ${old || '(blank)'}`;
        requests.push(buildCellRequest(cbSheetId, rowNumber, cbStreet, ans.street, note));
        cbResult.streetCellsChanged++;
      }
    }
  }
  log(`Callbook: ${cbResult.rowsMatched} rows matched, ${cbResult.routeCodeCellsChanged + cbResult.streetCellsChanged} cells to change.`);

  // ── 5. Master "Bookings" — header on row 2; match on original OR suggested street
  const bkResult: TabResult = { rowsMatched: 0, routeCodeCellsChanged: 0, streetCellsChanged: 0 };
  if (bkSheetId !== undefined) {
    log('Scanning master Bookings…');
    const bkRows = await sheetsGet(accessToken, masterSheetId, `'${MB_BOOKINGS_TAB}'!A1:AX`);
    // Find the header row (the one containing "STREET NAME" or "ROUTE #").
    let bkHeaderIdx = -1;
    for (let i = 0; i < Math.min(10, bkRows.length); i++) {
      const hr = bkRows[i] || [];
      if (findCol(hr, ['STREET NAME', 'STREET']) >= 0 && findCol(hr, ['ROUTE #', 'ROUTE CODE', 'ROUTE']) >= 0) {
        bkHeaderIdx = i; break;
      }
    }
    if (bkHeaderIdx >= 0) {
      const bkHeader = bkRows[bkHeaderIdx];
      const bkRC     = findCol(bkHeader, ['ROUTE #', 'ROUTE CODE', 'ROUTE']);
      const bkHouse  = findCol(bkHeader, ['HOUSE #', 'HOUSE#', 'HOUSE']);
      const bkStreet = findCol(bkHeader, ['STREET NAME', 'STREET']);

      if (bkRC >= 0 && bkHouse >= 0 && bkStreet >= 0) {
        const bkNotes = await getExistingNotes(accessToken, masterSheetId, MB_BOOKINGS_TAB, [bkRC, bkStreet]);
        for (let i = bkHeaderIdx + 1; i < bkRows.length; i++) {
          const row = bkRows[i];
          if (!row) continue;
          const house = cell(row, bkHouse);
          const street = cell(row, bkStreet);
          if (!house && !street) continue;
          const origKey = makeKey(house, street);
          const direct = resolved.get(origKey);
          const viaSug = direct ? null : bySuggested.get(origKey);
          const ans = direct || viaSug;
          if (!ans) continue;
          matchedKeys.add(direct ? origKey : viaSug!.origKey);
          bkResult.rowsMatched++;
          const rowNumber = i + 1;

          if (ans.rc) {
            const old = cell(row, bkRC);
            if (old !== ans.rc) {
              const base = bkNotes.get(bkRC)!.get(rowNumber);
              const note = (base ? base + '\n' : '') + `Was: ${old || '(blank)'}`;
              requests.push(buildCellRequest(bkSheetId, rowNumber, bkRC, ans.rc, note));
              bkResult.routeCodeCellsChanged++;
            }
          }
          if (ans.street) {
            const old = cell(row, bkStreet);
            if (old !== ans.street) {
              const base = bkNotes.get(bkStreet)!.get(rowNumber);
              const note = (base ? base + '\n' : '') + `Was: ${old || '(blank)'}`;
              requests.push(buildCellRequest(bkSheetId, rowNumber, bkStreet, ans.street, note));
              bkResult.streetCellsChanged++;
            }
          }
        }
      }
    }
  }
  log(`Bookings: ${bkResult.rowsMatched} rows matched, ${bkResult.routeCodeCellsChanged + bkResult.streetCellsChanged} cells to change.`);

  // ── 6. Write everything
  if (requests.length > 0) {
    log(`Writing ${requests.length} cell update(s)…`);
    await sendRequests(accessToken, masterSheetId, requests);
  }

  // ── 7. Build report
  let addressesUnmatched = 0;
  for (const key of resolved.keys()) if (!matchedKeys.has(key)) addressesUnmatched++;

  let cityFyi: Array<{ address: string; cities: string[] }> | undefined;
  if (includeCityFyi) {
    cityFyi = [];
    for (const [key, cities] of cityLabels) {
      if (cities.size > 1) cityFyi.push({ address: map.get(key)?.display || key, cities: Array.from(cities) });
    }
  }

  return {
    rangeRowsRead,
    addressesInMap: resolved.size,
    skippedConflicts,
    callbook: cbResult,
    bookings: bkResult,
    addressesUnmatched,
    cityFyi,
  };
}

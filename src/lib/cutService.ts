// src/lib/cutService.ts
//
// CUT Service — transfers booked rows (AER = x) from a callbook spreadsheet
// into the "Bookings" tab of a designated master bookings spreadsheet.
//
// Designed to be run multiple times without creating duplicates:
// - Booking IDs already in the Supabase `cut_bookings` table are skipped.
// - The UNIQUE(book_id, booking_id) DB constraint is a safety net.
//
// Column mapping (Callbook → Master Bookings "Bookings" tab):
//   Booked By    ← CPS REP
//   Date Booked  ← DATE.1
//   Time Booked  ← TIME
//   Route #      ← Route Code
//   First Name   ← FIRST NAME (fallback: NAME)
//   Last Name    ← LAST NAME
//   House #      ← HOUSE #
//   Street Name  ← STREET NAME
//   Call 1st     ← BOOKING NOTES + " SS" if SPRINK=x + " LG" if GATE=x
//   Phone #      ← PHONE
//   E-Mail       ← E-MAIL
//   Service Type ← FO column: X→"FO", BO→"BO", else→"FP"
//   PP           ← PP
//   AER. AMT     ← AMT (with 13% tax if divisible by 5, fallback to col I)
//   City         ← CITY
//   Notes        ← BOOKING NOTES
//

import { dialerSheetsService } from './dialerSheetsService';
import { campaignService, extractSheetId } from './campaignService';
import type { CampaignBook } from './campaignService';

// =============================================================================
// TYPES
// =============================================================================

export interface CutProgress {
  phase: string;
  detail: string;
  percent: number;
}

export interface CutResult {
  success: boolean;
  newBookings: number;
  skippedBookings: number;
  totalScanned: number;
  tabsScanned: number;
  errorMessage?: string;
  /** Per-tab breakdown: tab name → number of AER rows found */
  tabCounts?: Record<string, number>;
}

// =============================================================================
// HEADER RESOLUTION (lightweight — only the columns CUT needs)
// =============================================================================

interface CutColumnIndices {
  BOOKING_ID: number;
  ROUTE_CODE: number;
  FIRST_NAME: number;
  LAST_NAME: number;
  HOUSE_NUM: number;
  STREET_NAME: number;
  CITY: number;
  FO: number;
  PHONE: number;
  AER: number;
  PP: number;
  AMT: number;
  DATE1: number;
  TIME: number;
  NAME: number;
  EMAIL: number;
  CPS_REP: number;
  GATE: number;
  SPRINK: number;
  BOOKING_NOTES: number;
}

function resolveCutHeaders(headers: any[]): CutColumnIndices {
  const CI: CutColumnIndices = {
    BOOKING_ID: -1, ROUTE_CODE: -1, FIRST_NAME: -1, LAST_NAME: -1,
    HOUSE_NUM: -1, STREET_NAME: -1, CITY: -1, FO: -1, PHONE: -1,
    AER: -1, PP: -1, AMT: -1, DATE1: -1, TIME: -1, NAME: -1,
    EMAIL: -1, CPS_REP: -1, GATE: -1, SPRINK: -1, BOOKING_NOTES: -1,
  };

  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] ?? '').trim().toUpperCase();
    if (!h) continue;

    if ((h === 'BOOKING ID' || h === 'BOOKING_ID' || h === 'BOOKINGID') && CI.BOOKING_ID < 0) CI.BOOKING_ID = i;
    else if ((h === 'ROUTE CODE' || h === 'ROUTE_CODE' || h === 'ROUTECODE') && CI.ROUTE_CODE < 0) CI.ROUTE_CODE = i;
    else if ((h === 'FIRST NAME' || h === 'FIRST_NAME' || h === 'FIRSTNAME') && CI.FIRST_NAME < 0) CI.FIRST_NAME = i;
    else if ((h === 'LAST NAME' || h === 'LAST_NAME' || h === 'LASTNAME') && CI.LAST_NAME < 0) CI.LAST_NAME = i;
    else if ((h === 'HOUSE #' || h === 'HOUSE#' || h === 'HOUSE NUM' || h === 'HOUSE_NUM' || h === 'PREFIX' || h === 'HOUSE') && CI.HOUSE_NUM < 0) CI.HOUSE_NUM = i;
    else if ((h === 'STREET NAME' || h === 'STREET_NAME' || h === 'STREETNAME' || h === 'STREET') && CI.STREET_NAME < 0) CI.STREET_NAME = i;
    else if (h === 'CITY' && CI.CITY < 0) CI.CITY = i;
    else if (h === 'FO' && CI.FO < 0) CI.FO = i;
    else if (h === 'PHONE' && CI.PHONE < 0) CI.PHONE = i;
    else if (h === 'AER' && CI.AER < 0) CI.AER = i;
    else if (h === 'PP' && CI.PP < 0) CI.PP = i;
    else if ((h === 'AMT' || h === 'AMOUNT') && CI.AMT < 0) CI.AMT = i;
    else if ((h === 'DATE.1' || h === 'DATE1' || h === 'DATE 1') && CI.DATE1 < 0) CI.DATE1 = i;
    else if (h === 'TIME' && CI.TIME < 0) CI.TIME = i;
    else if (h === 'NAME' && CI.NAME < 0) CI.NAME = i;
    else if ((h === 'E-MAIL' || h === 'EMAIL' || h === 'E_MAIL') && CI.EMAIL < 0) CI.EMAIL = i;
    else if ((h === 'CPS REP' || h === 'CPS_REP' || h === 'CPSREP' || h === 'REP') && CI.CPS_REP < 0) CI.CPS_REP = i;
    else if (h === 'GATE' && CI.GATE < 0) CI.GATE = i;
    else if ((h === 'SPRINK' || h === 'SPRINKLER') && CI.SPRINK < 0) CI.SPRINK = i;
    else if ((h === 'BOOKING NOTES' || h === 'BOOKING_NOTES') && CI.BOOKING_NOTES < 0) CI.BOOKING_NOTES = i;
  }

  return CI;
}

/**
 * Scan up to 10 rows to find the header row (first row containing PHONE).
 */
function findHeaderRow(rawData: any[][]): { headerRowIndex: number; CI: CutColumnIndices } | null {
  const scanLimit = Math.min(10, rawData.length);
  for (let r = 0; r < scanLimit; r++) {
    const CI = resolveCutHeaders(rawData[r]);
    if (CI.PHONE >= 0) {
      return { headerRowIndex: r, CI };
    }
  }
  return null;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Read a cell value as trimmed string, empty if null/undefined. */
function cell(row: any[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  const v = row[col];
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  // Strip trailing .0 from numeric values (phone numbers, house numbers)
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  return s;
}

/** Check if a cell value means "x" / checked. */
function isX(row: any[], col: number): boolean {
  const v = cell(row, col).toUpperCase();
  return v === 'X' || v === 'YES' || v === 'Y';
}

/** Check if AER column indicates a booking. */
function hasAER(row: any[], aerCol: number): boolean {
  const v = cell(row, aerCol).toUpperCase();
  return v === 'X' || v === 'AER' || v === 'YES' || v === 'Y';
}

/** Interpret the FO column into the service type string. */
function interpretServiceType(row: any[], foCol: number): string {
  const v = cell(row, foCol).toUpperCase();
  if (v === 'X' || v === 'FO') return 'FO';
  if (v === 'BO') return 'BO';
  return 'FP';
}

/** Format phone: strip non-digits, take last 10. */
function formatPhone(raw: string): string {
  let s = raw;
  if (s.endsWith('.0') && s.length > 2) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** Build the "Call 1st" column: booking notes + SS/LG flags. */
function buildCallFirst(row: any[], CI: CutColumnIndices): string {
  let result = cell(row, CI.BOOKING_NOTES);
  const flags: string[] = [];
  if (isX(row, CI.SPRINK)) flags.push('SS');
  if (isX(row, CI.GATE)) flags.push('LG');
  if (flags.length > 0) {
    result = result ? (result + ' ' + flags.join(' ')) : flags.join(' ');
  }
  return result;
}

/**
 * Resolve the AMT value for a row, applying 13% tax if the amount is divisible by 5.
 *
 * Priority:
 *   1. AMT column (by header name)
 *   2. Column I (index 8, zero-based) as fallback when AMT is empty
 *
 * Tax rule: if the numeric value is divisible by 5 → multiply by 1.13,
 * round to 2 decimal places. Otherwise write the value as-is.
 * If the value is empty or unparseable → return empty string.
 */
function resolveAmt(row: any[], amtCol: number): string {
  // Step 1: try the AMT column by header
  let raw = amtCol >= 0 ? cell(row, amtCol) : '';

  // Step 2: fall back to column I (index 8) if AMT is empty
  if (!raw) {
    const colI = row.length > 8 ? String(row[8] ?? '').trim() : '';
    // Strip trailing .0 so "70.0" parses cleanly
    raw = colI.endsWith('.0') && colI.length > 2 ? colI.slice(0, -2) : colI;
  }

  if (!raw) return '';

  const num = parseFloat(raw);
  if (isNaN(num)) return raw; // not numeric — pass through unchanged

  // Apply 13% tax if divisible by 5
  if (num % 5 === 0) {
    return (Math.round(num * 1.13 * 100) / 100).toFixed(2);
  }

  return raw;
}

// =============================================================================
// MAP A CALLBOOK ROW → MASTER BOOKINGS ROW (16 columns)
// =============================================================================

/**
 * Maps a single callbook data row to the 16-column master Bookings format.
 *
 * Master columns (in order):
 * [0]  Booked By     [1]  Date Booked   [2]  Time Booked   [3]  Route #
 * [4]  First Name    [5]  Last Name     [6]  House #       [7]  Street Name
 * [8]  Call 1st      [9]  Phone #       [10] E-Mail        [11] Service Type
 * [12] PP            [13] AER. AMT      [14] City          [15] Notes
 */
function mapRowToMaster(row: any[], CI: CutColumnIndices): any[] {
  // First name: prefer FIRST NAME column, fall back to NAME column
  let firstName = cell(row, CI.FIRST_NAME);
  if (!firstName) firstName = cell(row, CI.NAME);

  return [
    cell(row, CI.CPS_REP),                 // Booked By
    cell(row, CI.DATE1),                    // Date Booked
    cell(row, CI.TIME),                     // Time Booked
    cell(row, CI.ROUTE_CODE),               // Route #
    firstName,                              // First Name
    cell(row, CI.LAST_NAME),                // Last Name
    cell(row, CI.HOUSE_NUM),                // House #
    cell(row, CI.STREET_NAME),              // Street Name
    buildCallFirst(row, CI),                // Call 1st
    formatPhone(cell(row, CI.PHONE)),       // Phone #
    cell(row, CI.EMAIL),                    // E-Mail
    interpretServiceType(row, CI.FO),       // Service Type
    cell(row, CI.PP),                       // PP
    resolveAmt(row, CI.AMT),                // AER. AMT (with tax if flat price)
    cell(row, CI.CITY),                     // City
    cell(row, CI.BOOKING_NOTES),            // Notes
  ];
}

// =============================================================================
// MAIN CUT FUNCTION
// =============================================================================

/**
 * Execute the CUT operation for a specific campaign book.
 *
 * 1. Reads all data tabs from the callbook spreadsheet (skips Managers, CCD).
 *    If selectedTabs is provided, only those tabs are scanned.
 * 2. Finds all rows where AER = x.
 * 3. Deduplicates against the Supabase cut_bookings table.
 * 4. Maps new booking rows to the 16-column master Bookings format.
 * 5. Appends them to the "Bookings" tab of the master spreadsheet.
 * 6. Records the newly cut Booking IDs in Supabase.
 *
 * @param book          The CampaignBook to cut from.
 * @param onProgress    Optional callback for progress updates.
 * @param selectedTabs  Optional list of tab names to scan. If omitted, all tabs are scanned.
 * @returns CutResult with counts of new/skipped bookings.
 */
export async function executeCut(
  book: CampaignBook,
  onProgress?: (progress: CutProgress) => void,
  selectedTabs?: string[]
): Promise<CutResult> {
  // --- Validate prerequisites ---
  if (!book.masterSpreadsheetId) {
    return {
      success: false, newBookings: 0, skippedBookings: 0,
      totalScanned: 0, tabsScanned: 0,
      errorMessage: 'No master bookings spreadsheet configured for this book. Edit the book and add a Master Bookings URL.',
    };
  }

  // --- Ensure Google Sheets authentication ---
  if (!dialerSheetsService.isAuthenticated()) {
    onProgress?.({ phase: 'Authenticating', detail: 'Connecting to Google Sheets...', percent: 2 });
    try {
      const authed = await dialerSheetsService.authenticate();
      if (!authed) {
        return {
          success: false, newBookings: 0, skippedBookings: 0,
          totalScanned: 0, tabsScanned: 0,
          errorMessage: 'Google Sheets authentication was cancelled or failed. Please try again.',
        };
      }
    } catch (err: any) {
      return {
        success: false, newBookings: 0, skippedBookings: 0,
        totalScanned: 0, tabsScanned: 0,
        errorMessage: 'Google Sheets authentication failed: ' + (err.message || 'Unknown error'),
      };
    }
  }

  const callbookId = book.spreadsheetId;
  const masterId = book.masterSpreadsheetId;

  // --- Step 1: Get tab list ---
  onProgress?.({ phase: 'Loading', detail: 'Fetching tab list...', percent: 5 });

  let allTabs: string[];
  try {
    allTabs = await dialerSheetsService.getCallbookTabs(callbookId);
  } catch (err: any) {
    return {
      success: false, newBookings: 0, skippedBookings: 0,
      totalScanned: 0, tabsScanned: 0,
      errorMessage: 'Failed to read callbook tabs: ' + (err.message || 'Unknown error'),
    };
  }

  if (allTabs.length === 0) {
    return {
      success: false, newBookings: 0, skippedBookings: 0,
      totalScanned: 0, tabsScanned: 0,
      errorMessage: 'No data tabs found in the callbook spreadsheet.',
    };
  }

  // Filter to only selected tabs if the caller specified them
  const tabs = selectedTabs && selectedTabs.length > 0
    ? allTabs.filter((t) => selectedTabs.includes(t))
    : allTabs;

  if (tabs.length === 0) {
    return {
      success: false, newBookings: 0, skippedBookings: 0,
      totalScanned: 0, tabsScanned: 0,
      errorMessage: 'None of the selected tabs were found in the callbook spreadsheet.',
    };
  }

  // --- Step 2: Get already-cut IDs from Supabase ---
  onProgress?.({ phase: 'Loading', detail: 'Checking previously cut bookings...', percent: 10 });

  const alreadyCut = await campaignService.getCutBookingIds(book.id);

  // --- Step 3: Scan all tabs and collect AER=x rows ---
  const newRows: { bookingId: string; masterRow: any[] }[] = [];
  let totalScanned = 0;
  let skippedCount = 0;
  const tabCounts: Record<string, number> = {};

  for (let t = 0; t < tabs.length; t++) {
    const tabName = tabs[t];
    const pct = 15 + Math.round((t / tabs.length) * 60);
    onProgress?.({ phase: 'Scanning', detail: `Reading "${tabName}"...`, percent: pct });

    let rawData: any[][];
    try {
      rawData = await dialerSheetsService.sheetsGet(callbookId, `'${tabName}'`);
    } catch {
      // Skip tabs that fail to load
      tabCounts[tabName] = -1; // -1 indicates load failure
      continue;
    }

    if (!rawData || rawData.length < 2) {
      tabCounts[tabName] = -2; // -2 indicates no data
      continue;
    }

    const headerResult = findHeaderRow(rawData);
    if (!headerResult) {
      tabCounts[tabName] = -3; // -3 indicates no headers found
      continue;
    }

    const { headerRowIndex, CI } = headerResult;

    // Must have AER and BOOKING_ID columns
    if (CI.AER < 0 || CI.BOOKING_ID < 0) {
      tabCounts[tabName] = -4; // -4 indicates missing AER or BOOKING_ID column
      continue;
    }

    const dataRows = rawData.slice(headerRowIndex + 1);
    let tabAerCount = 0;

    for (const row of dataRows) {
      // Skip empty rows
      if (!row[0]) continue;

      // Only rows where AER = x
      if (!hasAER(row, CI.AER)) continue;

      tabAerCount++;
      totalScanned++;

      const bookingId = cell(row, CI.BOOKING_ID);
      if (!bookingId) continue;

      // Dedup: skip if already cut
      if (alreadyCut.has(bookingId)) {
        skippedCount++;
        continue;
      }

      // Map to master format
      const masterRow = mapRowToMaster(row, CI);
      newRows.push({ bookingId, masterRow });
    }

    tabCounts[tabName] = tabAerCount;
  }

  // --- Step 4: Write new rows into master bookings (row 3+ to preserve formatting) ---
  if (newRows.length > 0) {
    onProgress?.({ phase: 'Writing', detail: `Preparing ${newRows.length} bookings...`, percent: 75 });

    // Find the next empty row in the Bookings tab.
    // Row 1 = summary formula, Row 2 = headers, data starts at Row 3.
    let nextRow = 3;
    try {
      const existingData = await dialerSheetsService.sheetsGet(masterId, "'Bookings'!A:A");
      if (existingData && existingData.length >= 3) {
        // Find the last row that has data in column A (starting from row 3 = index 2)
        for (let r = existingData.length - 1; r >= 2; r--) {
          const val = String(existingData[r]?.[0] ?? '').trim();
          if (val !== '') {
            nextRow = r + 2; // +1 for 1-based, +1 for next empty row
            break;
          }
        }
        // If we didn't find any data rows, start at row 3
        if (nextRow < 3) nextRow = 3;
      }
    } catch {
      // If reading fails, default to row 3 (may overwrite but safe fallback)
      nextRow = 3;
    }

    // Write in batches of 500 rows to avoid Google Sheets API payload limits
    const WRITE_BATCH = 500;
    const allRows = newRows.map((r) => r.masterRow);
    const totalBatches = Math.ceil(allRows.length / WRITE_BATCH);

    for (let b = 0; b < totalBatches; b++) {
      const batchStart = b * WRITE_BATCH;
      const batchRows = allRows.slice(batchStart, batchStart + WRITE_BATCH);
      const writeStartRow = nextRow + batchStart;
      const writeEndRow = writeStartRow + batchRows.length - 1;
      const writeRange = `'Bookings'!A${writeStartRow}:P${writeEndRow}`;

      const pct = 78 + Math.round(((b + 1) / totalBatches) * 10);
      onProgress?.({
        phase: 'Writing',
        detail: `Batch ${b + 1}/${totalBatches} — rows ${writeStartRow}-${writeEndRow}...`,
        percent: pct,
      });

      try {
        await dialerSheetsService.sheetsUpdate(masterId, writeRange, batchRows);
      } catch (err: any) {
        return {
          success: false,
          newBookings: batchStart, // partial success — some batches may have written
          skippedBookings: skippedCount,
          totalScanned, tabsScanned: tabs.length,
          errorMessage: `Failed writing batch ${b + 1}/${totalBatches} to master bookings: ` + (err.message || 'Unknown error'),
        };
      }
    }

    // --- Step 5: Record in Supabase ---
    onProgress?.({ phase: 'Saving', detail: 'Recording cut bookings...', percent: 90 });

    const newBookingIds = newRows.map((r) => r.bookingId);
    await campaignService.recordCutBookings(book.id, newBookingIds);
  }

  onProgress?.({ phase: 'Done', detail: 'Complete', percent: 100 });

  return {
    success: true,
    newBookings: newRows.length,
    skippedBookings: skippedCount,
    totalScanned,
    tabsScanned: tabs.length,
    tabCounts,
  };
}
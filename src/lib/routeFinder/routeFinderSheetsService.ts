// src/lib/routeFinder/routeFinderSheetsService.ts
//
// All Google Sheets operations for the Route Finder.
// Wraps dialerSheetsService exclusively — no new OAuth, no second login.
// Excluded tabs (never scanned as call book data): Listings, CCD, Managers
//

import { dialerSheetsService } from '../dialerSheetsService';
import type { SuggestionEntry } from './rfScanEngine';
import {
  parseListingsTab,
  resolveSheetColumns,
  findHeaderRow,
  ListingsData,
  CallBookSheet,
  SheetColumnIndices,
} from './routeFinderEngine';

const EXCLUDED_TABS = new Set([
  'listings', 'ccd', 'managers', 'rf_session', 'rf_log',
]);

// Background colors for suggestion cells
const SUGGESTION_COLORS: Record<string, { red: number; green: number; blue: number }> = {
  green:  { red: 0.714, green: 0.843, blue: 0.659 },
  yellow: { red: 1.0,   green: 0.949, blue: 0.600 },
  orange: { red: 0.976, green: 0.796, blue: 0.518 },
  red:    { red: 0.918, green: 0.600, blue: 0.600 },
};

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

// ─── CLEAR HELPER ─────────────────────────────────────────────────────────────

/**
 * Clear values AND background colour from a single column (skipping the header row).
 * Uses repeatCell so one API call handles both value and format reset.
 */
async function clearSuggestedColumn(
  spreadsheetId: string,
  sheetId: number,
  headerRowIndex: number,
  colIdx: number
): Promise<void> {
  const CLEAR_ROWS = 2000;
  await dialerSheetsService.sheetsFormatBatch(spreadsheetId, [
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex:    headerRowIndex + 1, // 0-based, skip header
          endRowIndex:      headerRowIndex + 1 + CLEAR_ROWS,
          startColumnIndex: colIdx,
          endColumnIndex:   colIdx + 1,
        },
        cell: {
          userEnteredValue:  { stringValue: '' },
          userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } },
        },
        fields: 'userEnteredValue,userEnteredFormat.backgroundColor',
      },
    },
  ]);
}

// ─── SERVICE ──────────────────────────────────────────────────────────────────

export const routeFinderSheetsService = {

  // ── Auth (delegates entirely to dialerSheetsService) ─────────────────────

  async authenticate(): Promise<boolean> {
    return dialerSheetsService.authenticate();
  },

  isAuthenticated(): boolean {
    return dialerSheetsService.isAuthenticated();
  },

  // ── Tab discovery ─────────────────────────────────────────────────────────

  async getCallBookTabs(spreadsheetId: string): Promise<string[]> {
    const allTabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
    return allTabs
      .map(t => t.title)
      .filter(name => !EXCLUDED_TABS.has(name.toLowerCase()));
  },

  /** Returns tab names AND their numeric sheet IDs, excluding system tabs. */
  async getCallBookTabsWithIds(
    spreadsheetId: string
  ): Promise<{ sheetId: number; title: string }[]> {
    const allTabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
    return allTabs.filter(t => !EXCLUDED_TABS.has(t.title.toLowerCase()));
  },

  async hasListingsTab(spreadsheetId: string): Promise<boolean> {
    const allTabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
    return allTabs.some(t => t.title.toLowerCase() === 'listings');
  },

  // ── Read Listings tab → ListingsData ─────────────────────────────────────

  async readListingsTab(spreadsheetId: string): Promise<ListingsData> {
    const raw = await dialerSheetsService.sheetsGet(spreadsheetId, "'Listings'");
    return parseListingsTab(raw);
  },

  // ── Read call book sheets ─────────────────────────────────────────────────

  async readCallBookSheets(
    spreadsheetId: string,
    sheetNames: string[],
    onProgress?: (current: number, total: number, sheetName: string) => void
  ): Promise<CallBookSheet[]> {
    const sheets: CallBookSheet[] = [];

    for (let i = 0; i < sheetNames.length; i++) {
      const sheetName = sheetNames[i];
      onProgress?.(i, sheetNames.length, sheetName);

      try {
        const raw = await dialerSheetsService.sheetsGet(spreadsheetId, `'${sheetName}'`);
        if (!raw || raw.length < 2) continue;

        const { headerRowIndex, headers } = findHeaderRow(raw);
        const ci = resolveSheetColumns(headers);
        const CI: SheetColumnIndices = { ...ci, headerRowIndex };

        const rows = raw.slice(headerRowIndex + 1);
        sheets.push({ sheetName, CI, rows });
      } catch (err) {
        console.warn(`Route Finder: failed to read sheet "${sheetName}":`, err);
      }
    }

    onProgress?.(sheetNames.length, sheetNames.length, '');
    return sheets;
  },

  // ── Suggested column setup ────────────────────────────────────────────────
  //
  // Checks whether "Suggested RC" and "Suggested Street" columns already exist
  // on the header row. If they do, clears their values and colours so we start
  // fresh. If they don't, inserts two new columns immediately to the right of
  // the Route Code and Street Name columns respectively, then writes the headers.
  //
  // Returns the final 0-based column indices for both suggested columns.

  async setupSuggestedColumns(
    spreadsheetId: string,
    sheetId: number,
    sheetName: string,
    routeCodeColIdx: number,
    streetNameColIdx: number,
    headerRowIndex: number
  ): Promise<{ suggestedRCCol: number; suggestedStreetCol: number }> {
    // Read the header row (1-based row number = headerRowIndex + 1)
    const headerRowNum = headerRowIndex + 1;
    const raw = await dialerSheetsService.sheetsGet(
      spreadsheetId,
      `'${sheetName}'!${headerRowNum}:${headerRowNum}`
    );
    const headers = (raw[0] || []).map((h: any) => String(h ?? '').trim());

    const existingRC     = headers.findIndex(h => h === 'Suggested RC');
    const existingStreet = headers.findIndex(h => h === 'Suggested Street');

    if (existingRC >= 0 && existingStreet >= 0) {
      // Both columns already exist — clear them and return their positions
      await clearSuggestedColumn(spreadsheetId, sheetId, headerRowIndex, existingRC);
      await clearSuggestedColumn(spreadsheetId, sheetId, headerRowIndex, existingStreet);
      return { suggestedRCCol: existingRC, suggestedStreetCol: existingStreet };
    }

    // Insert columns. To avoid index-shift confusion, always insert the
    // higher-indexed column first so the lower-index insertion is unaffected.
    let finalRCCol: number;
    let finalStreetCol: number;

    if (streetNameColIdx > routeCodeColIdx) {
      // Insert Suggested Street first (higher index) then Suggested RC (lower index)
      await dialerSheetsService.sheetsFormatBatch(spreadsheetId, [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: streetNameColIdx + 1,
            endIndex:   streetNameColIdx + 2,
          },
          inheritFromBefore: true,
        },
      }]);
      await dialerSheetsService.sheetsFormatBatch(spreadsheetId, [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: routeCodeColIdx + 1,
            endIndex:   routeCodeColIdx + 2,
          },
          inheritFromBefore: true,
        },
      }]);
      // After inserting at routeCodeColIdx+1, the street col shifted +1
      // so Suggested Street is now at streetNameColIdx + 2
      finalRCCol     = routeCodeColIdx + 1;
      finalStreetCol = streetNameColIdx + 2;
    } else {
      // Insert Suggested RC first (higher index) then Suggested Street (lower index)
      await dialerSheetsService.sheetsFormatBatch(spreadsheetId, [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: routeCodeColIdx + 1,
            endIndex:   routeCodeColIdx + 2,
          },
          inheritFromBefore: true,
        },
      }]);
      await dialerSheetsService.sheetsFormatBatch(spreadsheetId, [{
        insertDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: streetNameColIdx + 1,
            endIndex:   streetNameColIdx + 2,
          },
          inheritFromBefore: true,
        },
      }]);
      // After inserting at streetNameColIdx+1, the RC col shifted +1
      // so Suggested RC is now at routeCodeColIdx + 2
      finalRCCol     = routeCodeColIdx + 2;
      finalStreetCol = streetNameColIdx + 1;
    }

    // Write the header labels
    const rcLetter     = columnIndexToLetter(finalRCCol);
    const streetLetter = columnIndexToLetter(finalStreetCol);
    await dialerSheetsService.sheetsBatchUpdate(spreadsheetId, [
      { range: `'${sheetName}'!${rcLetter}${headerRowNum}`,     values: [['Suggested RC']]     },
      { range: `'${sheetName}'!${streetLetter}${headerRowNum}`, values: [['Suggested Street']] },
    ]);

    return { suggestedRCCol: finalRCCol, suggestedStreetCol: finalStreetCol };
  },

  // ── Write suggestion values + colours ─────────────────────────────────────
  //
  // Takes all SuggestionEntry objects for one sheet tab and writes both the
  // text value and background colour to the two suggested columns in a single
  // spreadsheets:batchUpdate call (chunked to stay within request-size limits).

  async writeSuggestionsBatch(
    spreadsheetId: string,
    sheetId: number,
    suggestions: SuggestionEntry[],
    suggestedRCCol: number,
    suggestedStreetCol: number
  ): Promise<void> {
    if (suggestions.length === 0) return;

    const requests: any[] = [];

    for (const s of suggestions) {
      const rowIndex = s.sheetRowNumber - 1; // convert to 0-based
      const bg = SUGGESTION_COLORS[s.color] ?? SUGGESTION_COLORS.red;

      // Suggested RC cell
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex:    rowIndex,
            endRowIndex:      rowIndex + 1,
            startColumnIndex: suggestedRCCol,
            endColumnIndex:   suggestedRCCol + 1,
          },
          rows: [{
            values: [{
              userEnteredValue:  { stringValue: s.suggestedRouteCode },
              userEnteredFormat: { backgroundColor: bg },
            }],
          }],
          fields: 'userEnteredValue,userEnteredFormat.backgroundColor',
        },
      });

      // Suggested Street cell
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex:    rowIndex,
            endRowIndex:      rowIndex + 1,
            startColumnIndex: suggestedStreetCol,
            endColumnIndex:   suggestedStreetCol + 1,
          },
          rows: [{
            values: [{
              userEnteredValue:  { stringValue: s.suggestedStreetName },
              userEnteredFormat: { backgroundColor: bg },
            }],
          }],
          fields: 'userEnteredValue,userEnteredFormat.backgroundColor',
        },
      });
    }

    // Send in chunks of 500 requests per API call
    const CHUNK = 500;
    for (let i = 0; i < requests.length; i += CHUNK) {
      await dialerSheetsService.sheetsFormatBatch(spreadsheetId, requests.slice(i, i + CHUNK));
    }
  },

  // ── Write a fix back to the call book ────────────────────────────────────

  async applyFix(
    spreadsheetId: string,
    sheetName: string,
    sheetRowNumber: number,
    routeCodeColIndex: number,
    streetNameColIndex: number,
    newRouteCode: string,
    newStreetName: string
  ): Promise<void> {
    const updates: { range: string; values: any[][] }[] = [];

    if (routeCodeColIndex >= 0 && newRouteCode) {
      const col = columnIndexToLetter(routeCodeColIndex);
      updates.push({
        range:  `'${sheetName}'!${col}${sheetRowNumber}`,
        values: [[newRouteCode]],
      });
    }

    if (streetNameColIndex >= 0 && newStreetName) {
      const col = columnIndexToLetter(streetNameColIndex);
      updates.push({
        range:  `'${sheetName}'!${col}${sheetRowNumber}`,
        values: [[newStreetName]],
      });
    }

    if (updates.length > 0) {
      await dialerSheetsService.sheetsBatchUpdate(spreadsheetId, updates);
    }
  },

  // ── Batch write corrected street names ────────────────────────────────────

  async applyBatchStreetWrites(
    spreadsheetId: string,
    updates: { range: string; values: any[][] }[]
  ): Promise<void> {
    if (updates.length === 0) return;
    await dialerSheetsService.sheetsBatchUpdate(spreadsheetId, updates);
  },

  // ── Append a learned street to the Listings tab ───────────────────────────

  async appendLearnedStreet(
    spreadsheetId: string,
    routeCode: string,
    newStreet: string
  ): Promise<void> {
    const raw = await dialerSheetsService.sheetsGet(spreadsheetId, "'Listings'");
    if (!raw || raw.length < 2) return;

    let headerIdx = 0;
    for (let r = 0; r < Math.min(5, raw.length); r++) {
      if (raw[r].some((h: any) => String(h ?? '').trim().toUpperCase() === 'RT #')) {
        headerIdx = r;
        break;
      }
    }

    const headers       = raw[headerIdx];
    const rtCol         = headers.findIndex((h: any) => String(h ?? '').trim().toUpperCase() === 'RT #');
    const streetListCol = headers.findIndex((h: any) => String(h ?? '').trim().toUpperCase() === 'STREET_LIST');

    if (rtCol < 0 || streetListCol < 0) return;

    const targetRoute = routeCode.toUpperCase();

    for (let r = headerIdx + 1; r < raw.length; r++) {
      const rowRoute = String(raw[r][rtCol] ?? '').trim().toUpperCase();
      if (rowRoute !== targetRoute) continue;

      const currentList = String(raw[r][streetListCol] ?? '').trim();
      const existing    = currentList.split(',').map(s => s.trim()).filter(Boolean);
      if (existing.some(s => s.toLowerCase() === newStreet.toLowerCase())) return;

      const newList = currentList ? `${currentList}, ${newStreet}` : newStreet;
      const col     = columnIndexToLetter(streetListCol);
      const sheetRow = r + 1;

      await dialerSheetsService.sheetsBatchUpdate(spreadsheetId, [{
        range:  `'Listings'!${col}${sheetRow}`,
        values: [[newList]],
      }]);
      return;
    }

    const streetListColLetter = columnIndexToLetter(streetListCol);
    const rtColLetter         = columnIndexToLetter(rtCol);
    const newRow              = new Array(headers.length).fill('');
    newRow[rtCol]         = routeCode;
    newRow[streetListCol] = newStreet;

    await dialerSheetsService.sheetsAppend(
      spreadsheetId,
      "'Listings'!A1",
      [newRow]
    );
  },

  // ── Validate that a spreadsheet ID is accessible ──────────────────────────

  async validateSpreadsheet(spreadsheetId: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const tabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
      if (!tabs || tabs.length === 0) {
        return { valid: false, error: 'Spreadsheet found but has no tabs.' };
      }
      return { valid: true };
    } catch (err: any) {
      return {
        valid: false,
        error: err?.message || 'Cannot access spreadsheet. Check the ID and permissions.',
      };
    }
  },
};
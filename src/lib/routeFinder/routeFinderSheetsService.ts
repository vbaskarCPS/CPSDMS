// src/lib/routeFinder/routeFinderSheetsService.ts
//
// All Google Sheets operations for the Route Finder.
// Wraps dialerSheetsService exclusively — no new OAuth, no second login.
// Excluded tabs (never scanned as call book data): Listings, CCD, Managers
//

import { dialerSheetsService } from '../dialerSheetsService';
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

function columnIndexToLetter(colIndex: number): string {
  // colIndex is 0-based
  let s = '';
  let c = colIndex + 1; // convert to 1-based
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

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

        // Data rows only (exclude the header row itself)
        const rows = raw.slice(headerRowIndex + 1);

        sheets.push({ sheetName, CI, rows });
      } catch (err) {
        console.warn(`Route Finder: failed to read sheet "${sheetName}":`, err);
      }
    }

    onProgress?.(sheetNames.length, sheetNames.length, '');
    return sheets;
  },

  // ── Write a fix back to the call book ────────────────────────────────────

  async applyFix(
    spreadsheetId: string,
    sheetName: string,
    sheetRowNumber: number,    // 1-based actual sheet row
    routeCodeColIndex: number, // 0-based column index
    streetNameColIndex: number, // 0-based column index
    newRouteCode: string,
    newStreetName: string
  ): Promise<void> {
    const updates: { range: string; values: any[][] }[] = [];

    if (routeCodeColIndex >= 0 && newRouteCode) {
      const col = columnIndexToLetter(routeCodeColIndex);
      updates.push({
        range: `'${sheetName}'!${col}${sheetRowNumber}`,
        values: [[newRouteCode]],
      });
    }

    if (streetNameColIndex >= 0 && newStreetName) {
      const col = columnIndexToLetter(streetNameColIndex);
      updates.push({
        range: `'${sheetName}'!${col}${sheetRowNumber}`,
        values: [[newStreetName]],
      });
    }

    if (updates.length > 0) {
      await dialerSheetsService.sheetsBatchUpdate(spreadsheetId, updates);
    }
  },

  // ── Append a learned street to the Listings tab ───────────────────────────
  // Finds the row for the given routeCode and appends the new street
  // to its Street_List comma-separated column.

  async appendLearnedStreet(
    spreadsheetId: string,
    routeCode: string,
    newStreet: string
  ): Promise<void> {
    const raw = await dialerSheetsService.sheetsGet(spreadsheetId, "'Listings'");
    if (!raw || raw.length < 2) return;

    // Find header row
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
      // Avoid duplicate entries
      const existing = currentList.split(',').map(s => s.trim()).filter(Boolean);
      if (existing.some(s => s.toLowerCase() === newStreet.toLowerCase())) return;

      const newList = currentList ? `${currentList}, ${newStreet}` : newStreet;
      const col     = columnIndexToLetter(streetListCol);
      const sheetRow = r + 1; // 1-based

      await dialerSheetsService.sheetsBatchUpdate(spreadsheetId, [{
        range: `'Listings'!${col}${sheetRow}`,
        values: [[newList]],
      }]);
      return;
    }

    // Route not found in Listings — add a new row
    // Infer Region/Route Name from adjacent data if possible; use blanks otherwise
    const streetListColLetter = columnIndexToLetter(streetListCol);
    const rtColLetter         = columnIndexToLetter(rtCol);

    // Build a minimal row matching the listings columns
    const newRow = new Array(headers.length).fill('');
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
      return { valid: false, error: err?.message || 'Cannot access spreadsheet. Check the ID and permissions.' };
    }
  },
};
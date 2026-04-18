// src/lib/workerbookRunService.ts
//
// Manual single-row move operation. Replaces the old RunLogic.gs Web App
// approach that took 30-90 seconds. This version uses Google Sheets native
// `copyPaste` + `deleteDimension` in a single atomic batchUpdate call and
// completes in 1-2 seconds.
//
// Behavior:
// 1. Look up source tab sheetId and destination tab sheetId (1 API call,
//    cached per session so subsequent moves are faster)
// 2. Read destination tab column B to find first empty row (1 API call)
// 3. Submit ONE batchUpdate with:
//    - copyPaste source row A:S → destination row A:S (PASTE_NORMAL preserves
//      values, formulas, formatting, data validation, merges)
//    - deleteDimension to remove source row (rows shift up)
//    These run atomically — if either sub-request fails, neither applies.
//
// Single-flight guard: only one move per CC can be in-flight at a time,
// enforced via an in-memory Map. This prevents double-tap races.

import { dialerSheetsService } from './dialerSheetsService';

/** Tracks which CC has an in-flight move, by CC ID */
const activeRuns = new Map<string, boolean>();

/**
 * Per-spreadsheet sheet-ID cache. Tab names → numeric sheetId.
 * Cleared when the user reloads the page. Cache is fine because sheetIds
 * don't change unless someone renames or deletes the tab.
 */
const sheetIdCache = new Map<string, Map<string, number>>();

export interface RunResult {
  success: boolean;
  error?: string;
  message?: string;
  tabName?: string;
}

/**
 * Is there currently a move in flight for this command center?
 */
export function isRunInFlight(commandCenterId: string): boolean {
  return activeRuns.get(commandCenterId) === true;
}

/**
 * Look up the numeric sheetId for a tab, using the per-spreadsheet cache.
 */
async function getSheetId(spreadsheetId: string, tabName: string): Promise<number | null> {
  let map = sheetIdCache.get(spreadsheetId);

  // If the tab isn't in cache, fetch all tabs and cache them
  if (!map || !map.has(tabName)) {
    const tabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
    map = new Map();
    for (const t of tabs) map.set(t.title, t.sheetId);
    sheetIdCache.set(spreadsheetId, map);
  }

  return map.get(tabName) ?? null;
}

/**
 * Find the first empty row on a destination tab.
 * "Empty" means column B (CN#) is blank.
 * Returns a 1-indexed row number (matches how users see rows in the sheet).
 */
async function findFirstEmptyRow(spreadsheetId: string, tabName: string): Promise<number> {
  const rows = await dialerSheetsService.sheetsGet(
    spreadsheetId,
    "'" + tabName + "'!B3:B1000",
  );

  // Scan for first row where column B is blank
  for (let i = 0; i < rows.length; i++) {
    const cn = String(rows[i]?.[0] ?? '').trim();
    if (!cn) return i + 3; // rows start at 3 (1-indexed sheet row)
  }

  // No empty row found in first 1000 — append at the end
  return rows.length + 3;
}

/**
 * Move a single contractor row from one tab to another.
 *
 * @param commandCenterId  Used to enforce single-flight
 * @param spreadsheetId    The workerbook spreadsheet ID
 * @param sourceTabName    Tab the contractor is currently on (e.g. "Apr17" or "NS")
 * @param sourceRow        1-indexed row number on the source tab
 * @param destTabName      Tab to move to (e.g. "Apr18" or "NS" or "WDR")
 */
export async function moveContractorRow(
  commandCenterId: string,
  spreadsheetId: string,
  sourceTabName: string,
  sourceRow: number,
  destTabName: string,
): Promise<RunResult> {
  if (!sourceTabName) return { success: false, error: 'Source tab name missing.' };
  if (!destTabName) return { success: false, error: 'Destination tab name missing.' };
  if (sourceRow < 3) return { success: false, error: 'Invalid source row number.' };

  if (sourceTabName === destTabName) {
    return { success: false, error: 'Source and destination are the same tab.' };
  }

  // Single-flight check
  if (activeRuns.get(commandCenterId)) {
    return {
      success: false,
      error: 'Another move is already running. Please wait for it to finish.',
    };
  }

  activeRuns.set(commandCenterId, true);

  try {
    // 1. Look up both sheetIds (usually 1 API call total, or 0 if already cached)
    const sourceSheetId = await getSheetId(spreadsheetId, sourceTabName);
    const destSheetId = await getSheetId(spreadsheetId, destTabName);

    if (sourceSheetId === null) {
      return { success: false, error: 'Could not find source tab "' + sourceTabName + '" in the spreadsheet.' };
    }
    if (destSheetId === null) {
      return { success: false, error: 'Could not find destination tab "' + destTabName + '" in the spreadsheet.' };
    }

    // 2. Find the first empty row on the destination tab (1 API call)
    const destRow = await findFirstEmptyRow(spreadsheetId, destTabName);

    // 3. Build the atomic batchUpdate payload:
    //    - copyPaste: source A:S → destination A:S (preserves everything)
    //    - deleteDimension: remove source row (rows shift up)
    //
    // Sheets API uses 0-indexed rows in grid ranges, so sourceRow becomes
    // (sourceRow - 1). A:S spans columns 0..18 inclusive, so endColumnIndex
    // is 19 (exclusive).
    //
    // PASTE_NORMAL is critical — it preserves values, formulas, formatting,
    // borders, merges, and data validation, all in one shot.

    const sourceRowZeroIdx = sourceRow - 1;
    const destRowZeroIdx = destRow - 1;

    const requests = [
      {
        copyPaste: {
          source: {
            sheetId:          sourceSheetId,
            startRowIndex:    sourceRowZeroIdx,
            endRowIndex:      sourceRowZeroIdx + 1,
            startColumnIndex: 0,
            endColumnIndex:   19,
          },
          destination: {
            sheetId:          destSheetId,
            startRowIndex:    destRowZeroIdx,
            endRowIndex:      destRowZeroIdx + 1,
            startColumnIndex: 0,
            endColumnIndex:   19,
          },
          pasteType:        'PASTE_NORMAL',
          pasteOrientation: 'NORMAL',
        },
      },
      {
        deleteDimension: {
          range: {
            sheetId:    sourceSheetId,
            dimension:  'ROWS',
            startIndex: sourceRowZeroIdx,
            endIndex:   sourceRowZeroIdx + 1,
          },
        },
      },
    ];

    await dialerSheetsService.sheetsFormatBatch(spreadsheetId, requests);

    return {
      success: true,
      tabName: destTabName,
      message: 'Moved to ' + destTabName,
    };

  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to move row.',
    };
  } finally {
    activeRuns.delete(commandCenterId);
  }
}

/**
 * Clear the cached sheet-ID lookup for a spreadsheet. Call this if a tab
 * has been renamed or added and the cache is now stale.
 */
export function clearSheetIdCache(spreadsheetId?: string): void {
  if (spreadsheetId) {
    sheetIdCache.delete(spreadsheetId);
  } else {
    sheetIdCache.clear();
  }
}
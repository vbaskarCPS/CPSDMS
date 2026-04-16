// src/lib/workerbookStatusRosterService.ts
//
// Loads contractor rosters from status tabs: NS, WDR, Q, F.
// These tabs have the same column layout as dated tabs.

import { dialerSheetsService } from './dialerSheetsService';

export type StatusTabName = 'NS' | 'WDR' | 'Q' | 'F';

export interface StatusContractor {
  rowNum: number;      // actual row in the sheet (for writing back to column L)
  shuttle: string;
  cnId: string;
  firstName: string;
  lastName: string;
  cellPhone: string;
  altPhone: string;
  email: string;
  manager: string;
  team: string;
  nextDay: string;     // col L — destination for a pending move-back
  days: number;
  ns: number;
  notes: string;
}

/**
 * Load the full roster of a status tab (NS, WDR, Q, F).
 * Rows are returned in sheet order (no sorting).
 */
export async function loadStatusRoster(
  spreadsheetId: string,
  tabName: StatusTabName,
): Promise<StatusContractor[]> {
  const rows = await dialerSheetsService.sheetsGet(
    spreadsheetId,
    "'" + tabName + "'!A3:S500",
  );

  return rows
    .map((row, idx) => ({
      rowNum:    idx + 3,
      shuttle:   String(row[0]  ?? '').trim(),
      cnId:      String(row[1]  ?? '').trim(),
      firstName: String(row[2]  ?? '').trim(),
      lastName:  String(row[3]  ?? '').trim(),
      cellPhone: String(row[4]  ?? '').trim(),
      altPhone:  String(row[16] ?? '').trim(),
      email:     String(row[17] ?? '').trim(),
      manager:   String(row[7]  ?? '').trim(),
      team:      String(row[8]  ?? '').trim(),
      nextDay:   String(row[11] ?? '').trim(),
      days:      parseInt(String(row[14] ?? '0'), 10) || 0,
      ns:        parseInt(String(row[15] ?? '0'), 10) || 0,
      notes:     String(row[18] ?? '').trim(),
    }))
    .filter(c => c.cnId);
}

/**
 * Get the count of rows on a status tab (for showing "NS: 73" on landing page).
 * Uses a lightweight B-column-only read so we don't pull emails / phones.
 */
export async function loadStatusRosterCount(
  spreadsheetId: string,
  tabName: StatusTabName,
): Promise<number> {
  try {
    const rows = await dialerSheetsService.sheetsGet(
      spreadsheetId,
      "'" + tabName + "'!B3:B500",
    );
    return rows.filter(r => {
      const cn = String(r[0] ?? '').trim();
      return cn.length > 0;
    }).length;
  } catch {
    return 0;
  }
}

/**
 * Batch-load counts for multiple status tabs in parallel.
 */
export async function loadAllStatusCounts(
  spreadsheetId: string,
  tabNames: StatusTabName[] = ['NS', 'WDR', 'Q', 'F'],
): Promise<Record<StatusTabName, number>> {
  const results = await Promise.all(
    tabNames.map(async (name) => [name, await loadStatusRosterCount(spreadsheetId, name)] as const),
  );
  const record: Record<string, number> = {};
  for (const [name, count] of results) record[name] = count;
  return record as Record<StatusTabName, number>;
}
// src/lib/dialer/dialerDispositions.ts
//
// Disposition logic for the AutoSniper dialer.
// Unlike the GS version which writes directly to SpreadsheetApp,
// this builds arrays of cell updates to be sent via Sheets API batch update.
//
// Ported from Dialer.gs: applyDialerDisposition, dialerWriteYes_.
//

import { ColumnIndices } from './dialerHeaders';
import { normalizePhone, parseYear } from './dialerUtils';

// --- Types ---

export type DispositionType = 'NA' | 'CTS' | 'WN/NIS' | 'NO' | 'REMOVE' | 'COMPLETE' | 'PREPAY';

export interface CellUpdate {
  /** Sheet row (1-based) */
  row: number;
  /** Column index (0-based) */
  col: number;
  /** Value to write */
  value: string | number;
}

export interface DispositionExtra {
  price?: string;
  name?: string;
  lastName?: string;
  houseNum?: string;
  streetName?: string;
  email?: string;
  gate?: boolean;
  sprinkler?: boolean;
  notes?: string;
  foValue?: string;       // 'FO' | 'BO' | 'FP'
}

export interface DispositionResult {
  updates: CellUpdate[];
  /** If WN/NIS found an alternate phone, redial with this phone instead of advancing */
  redial?: { newPhone: string };
}

// --- Helpers ---

/**
 * Convert CellUpdate[] into Sheets API batchUpdate data format.
 * Groups by range for efficiency.
 */
export function cellUpdatesToSheetsData(
  sheetName: string,
  updates: CellUpdate[]
): { range: string; values: any[][] }[] {
  return updates.map((u) => {
    const colLetter = columnToLetter(u.col + 1); // 1-based for A1 notation
    const range = `'${sheetName}'!${colLetter}${u.row}`;
    return { range, values: [[u.value]] };
  });
}

function columnToLetter(col: number): string {
  let s = '';
  let c = col;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

// --- Disposition Builders ---

/**
 * Build cell updates for a disposition.
 *
 * @param disposition Type of disposition
 * @param all         Full data array (no header)
 * @param CI          Column indices
 * @param groupDataIndices 0-based data indices for the group
 * @param dataStartRow 1-based sheet row of first data row
 * @param phone       The phone number being dialed
 * @param repCode     Current rep code
 * @param extra       Additional booking data (for YES/PREPAY)
 */
export function buildDispositionUpdates(
  disposition: DispositionType,
  all: any[][],
  CI: ColumnIndices,
  groupDataIndices: number[],
  dataStartRow: number,
  phone: string,
  repCode: string,
  extra: DispositionExtra = {}
): DispositionResult {
  const groupSheetRows = groupDataIndices.map((r) => r + dataStartRow);

  switch (disposition) {
    case 'NA':
      return buildNA(all, CI, groupDataIndices, dataStartRow, phone);
    case 'CTS':
      return buildCTS(all, CI, groupDataIndices, dataStartRow, phone);
    case 'WN/NIS':
      return buildWN(all, CI, groupDataIndices, dataStartRow, phone);
    case 'NO':
      return buildGroupWide(CI, groupSheetRows, 'NO');
    case 'REMOVE':
      return buildGroupWide(CI, groupSheetRows, 'REMOVE');
    case 'COMPLETE':
      return buildYes(all, CI, groupDataIndices, dataStartRow, phone, repCode, extra, false);
    case 'PREPAY':
      return buildYes(all, CI, groupDataIndices, dataStartRow, phone, repCode, extra, true);
    default:
      return { updates: [] };
  }
}

// --- NA: Phone-scoped ---
// Increment NA on rows matching the dialed phone. Clear YES/NO/WN/REMOVE on those rows.
function buildNA(
  all: any[][],
  CI: ColumnIndices,
  groupDataIndices: number[],
  dataStartRow: number,
  phone: string
): DispositionResult {
  const updates: CellUpdate[] = [];

  // Find max NA across ALL group rows
  let maxNA = 0;
  for (const r of groupDataIndices) {
    if (CI.NA >= 0) {
      const v = parseInt(String(all[r][CI.NA] ?? '0'), 10) || 0;
      if (v > maxNA) maxNA = v;
    }
  }
  const newNA = maxNA + 1;

  // Only update rows matching the dialed phone
  for (const r of groupDataIndices) {
    const rowPhone = CI.PHONE >= 0 ? normalizePhone(String(all[r][CI.PHONE] ?? '')) : '';
    if (rowPhone !== phone) continue;

    const sheetRow = r + dataStartRow;
    if (CI.NA >= 0) updates.push({ row: sheetRow, col: CI.NA, value: newNA });
    if (CI.YES >= 0) updates.push({ row: sheetRow, col: CI.YES, value: '' });
    if (CI.NO >= 0) updates.push({ row: sheetRow, col: CI.NO, value: '' });
    if (CI.WN >= 0) updates.push({ row: sheetRow, col: CI.WN, value: '' });
    if (CI.REMOVE >= 0) updates.push({ row: sheetRow, col: CI.REMOVE, value: '' });
  }

  return { updates };
}

// --- CTS: Closer To Spring — writes "CTS" in the NA column ---
// Same logic as NA (phone-scoped, clears other dispositions) but writes the
// string "CTS" instead of incrementing the NA counter.
function buildCTS(
  all: any[][],
  CI: ColumnIndices,
  groupDataIndices: number[],
  dataStartRow: number,
  phone: string
): DispositionResult {
  const updates: CellUpdate[] = [];

  // Only update rows matching the dialed phone
  for (const r of groupDataIndices) {
    const rowPhone = CI.PHONE >= 0 ? normalizePhone(String(all[r][CI.PHONE] ?? '')) : '';
    if (rowPhone !== phone) continue;

    const sheetRow = r + dataStartRow;
    if (CI.NA >= 0) updates.push({ row: sheetRow, col: CI.NA, value: 'CTS' });
    if (CI.YES >= 0) updates.push({ row: sheetRow, col: CI.YES, value: '' });
    if (CI.NO >= 0) updates.push({ row: sheetRow, col: CI.NO, value: '' });
    if (CI.WN >= 0) updates.push({ row: sheetRow, col: CI.WN, value: '' });
    if (CI.REMOVE >= 0) updates.push({ row: sheetRow, col: CI.REMOVE, value: '' });
  }

  return { updates };
}

// --- WN/NIS: Phone-scoped ---
// Mark WN on rows matching current phone. Check for alternate non-WN phone.
function buildWN(
  all: any[][],
  CI: ColumnIndices,
  groupDataIndices: number[],
  dataStartRow: number,
  phone: string
): DispositionResult {
  const updates: CellUpdate[] = [];

  // Mark WN on matching phone rows, clear YES/NO/REMOVE/NA
  for (const r of groupDataIndices) {
    const rowPhone = CI.PHONE >= 0 ? normalizePhone(String(all[r][CI.PHONE] ?? '')) : '';
    if (rowPhone !== phone) continue;

    const sheetRow = r + dataStartRow;
    if (CI.WN >= 0) updates.push({ row: sheetRow, col: CI.WN, value: 'x' });
    if (CI.YES >= 0) updates.push({ row: sheetRow, col: CI.YES, value: '' });
    if (CI.NO >= 0) updates.push({ row: sheetRow, col: CI.NO, value: '' });
    if (CI.REMOVE >= 0) updates.push({ row: sheetRow, col: CI.REMOVE, value: '' });
    if (CI.NA >= 0) updates.push({ row: sheetRow, col: CI.NA, value: '' });
  }

  // Check for remaining non-WN phones
  // Need to simulate the state after this WN is applied:
  // existing WN'd phones + the phone we just WN'd
  const newlyWnd = new Set<string>([phone]);
  const remaining: string[] = [];
  const seen = new Set<string>();

  for (const r of groupDataIndices) {
    if (CI.PHONE < 0) continue;
    const rowPhone = normalizePhone(String(all[r][CI.PHONE] ?? ''));
    if (!rowPhone || seen.has(rowPhone)) continue;
    seen.add(rowPhone);

    if (newlyWnd.has(rowPhone)) continue;

    // Check if this phone was already WN'd in the sheet
    const existingWN = CI.WN >= 0 ? String(all[r][CI.WN] ?? '').trim() : '';
    if (existingWN !== '') continue;

    remaining.push(rowPhone);
  }

  if (remaining.length > 0) {
    return { updates, redial: { newPhone: remaining[0] } };
  }

  return { updates };
}

// --- NO / REMOVE: Group-wide ---
// Mark disposition on ALL group rows, clear others.
function buildGroupWide(
  CI: ColumnIndices,
  groupSheetRows: number[],
  markDisp: 'NO' | 'REMOVE'
): DispositionResult {
  const updates: CellUpdate[] = [];
  const dispCols = [
    { col: CI.YES, name: 'YES' },
    { col: CI.NO, name: 'NO' },
    { col: CI.WN, name: 'WN' },
    { col: CI.REMOVE, name: 'REMOVE' },
  ];

  for (const sheetRow of groupSheetRows) {
    for (const d of dispCols) {
      if (d.col >= 0) {
        updates.push({
          row: sheetRow,
          col: d.col,
          value: d.name === markDisp ? 'x' : '',
        });
      }
    }
    if (CI.NA >= 0) updates.push({ row: sheetRow, col: CI.NA, value: '' });
  }

  return { updates };
}

// --- YES (COMPLETE / PREPAY): Group-wide mark + phone-scoped detail write ---
function buildYes(
  all: any[][],
  CI: ColumnIndices,
  groupDataIndices: number[],
  dataStartRow: number,
  phone: string,
  repCode: string,
  extra: DispositionExtra,
  isPrepay: boolean
): DispositionResult {
  const updates: CellUpdate[] = [];
  const now = new Date();

  // --- Find most-recent-year row matching the phone being called ---
  let bestIdx = groupDataIndices[0];
  let bestYear = 0;
  let globalBestIdx = groupDataIndices[0];
  let globalBestYear = 0;

  if (CI.YEAR >= 0) {
    for (const r of groupDataIndices) {
      const yr = parseYear(all[r][CI.YEAR]);

      // Track global best
      if (yr > globalBestYear) {
        globalBestYear = yr;
        globalBestIdx = r;
      }

      // Track best for this phone
      if (CI.PHONE >= 0) {
        const rowPh = normalizePhone(String(all[r][CI.PHONE] ?? ''));
        if (rowPh === phone && yr > bestYear) {
          bestYear = yr;
          bestIdx = r;
        }
      }
    }
  }

  // Fall back to global best if no phone match found
  const detailIdx = bestYear > 0 ? bestIdx : globalBestIdx;
  const detailRow = detailIdx + dataStartRow;

  // --- Mark YES on ALL rows, clear NO/WN/REMOVE/NA ---
  for (const r of groupDataIndices) {
    const sheetRow = r + dataStartRow;
    if (CI.YES >= 0) updates.push({ row: sheetRow, col: CI.YES, value: 'x' });
    if (CI.NO >= 0) updates.push({ row: sheetRow, col: CI.NO, value: '' });
    if (CI.WN >= 0) updates.push({ row: sheetRow, col: CI.WN, value: '' });
    if (CI.REMOVE >= 0) updates.push({ row: sheetRow, col: CI.REMOVE, value: '' });
    if (CI.NA >= 0) updates.push({ row: sheetRow, col: CI.NA, value: '' });
  }

  // --- Write booking details to the selected detail row ---
  if (CI.AER >= 0) updates.push({ row: detailRow, col: CI.AER, value: 'x' });

  const dateStr = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  if (CI.DATE1 >= 0) updates.push({ row: detailRow, col: CI.DATE1, value: dateStr });

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  const timeStr = `${h12}:${minutes < 10 ? '0' + minutes : minutes} ${ampm}`;
  if (CI.TIME >= 0) updates.push({ row: detailRow, col: CI.TIME, value: timeStr });

  if (CI.CPS_REP >= 0) updates.push({ row: detailRow, col: CI.CPS_REP, value: repCode });
  if (CI.NAME >= 0 && extra.name) updates.push({ row: detailRow, col: CI.NAME, value: extra.name });
  if (CI.AMT >= 0) updates.push({ row: detailRow, col: CI.AMT, value: extra.price ?? '' });
  if (CI.GATE >= 0) updates.push({ row: detailRow, col: CI.GATE, value: extra.gate ? 'x' : '' });
  if (CI.SPRINK >= 0) updates.push({ row: detailRow, col: CI.SPRINK, value: extra.sprinkler ? 'x' : '' });
  if (CI.BOOKING_NOTES >= 0 && extra.notes) updates.push({ row: detailRow, col: CI.BOOKING_NOTES, value: extra.notes });
  if (CI.EMAIL >= 0 && extra.email) updates.push({ row: detailRow, col: CI.EMAIL, value: extra.email });

  // PMT TYPE: 'Prepaid' for prepay, blank for complete
  if (CI.PMT_TYPE >= 0) updates.push({ row: detailRow, col: CI.PMT_TYPE, value: isPrepay ? 'Prepaid' : '' });

  // FO: FO→X, BO→BO, FP→clear
  if (CI.FO >= 0 && extra.foValue !== undefined && extra.foValue !== '') {
    let foWrite = '';
    if (extra.foValue === 'FO') foWrite = 'X';
    else if (extra.foValue === 'BO') foWrite = 'BO';
    updates.push({ row: detailRow, col: CI.FO, value: foWrite });
  }

  // PP column for prepay
  if (isPrepay && CI.PP >= 0) {
    updates.push({ row: detailRow, col: CI.PP, value: 'x' });
  }

  return { updates };
}
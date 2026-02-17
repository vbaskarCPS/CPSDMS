// src/lib/dialer/dialerGroupBuilder.ts
//
// Client-side union-find group builder for the AutoSniper dialer.
// Ported from Dialer.gs: dialerBuildGroups_, dialerFilterAvailable_,
// dialerApplyOrdering_, dialerFindNext_.
//

import { ColumnIndices } from './dialerHeaders';
import { normalizePhone, normalizeStreet } from './dialerUtils';

// --- Types ---

export type Direction = 'down' | 'up' | 'scatter';

export interface ClientGroup {
  /** 0-based data-array indices of rows in this group */
  rows: number[];
  /** Sheet row number of the first row (1-based: dataIndex + dataStartRow) */
  firstRow: number;
}

// --- Union-Find ---

function makeUF(n: number) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path compression
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  return { find, union };
}

// --- Group Building ---

/**
 * Build client groups from all data rows using union-find.
 * Merges rows by shared phone number and by shared address (HOUSE# + STREET).
 *
 * @param all        2D array of cell values (data rows only, no header). Index 0 = first data row.
 * @param CI         Resolved column indices.
 * @param hiddenRows Set of 1-based sheet row numbers that are hidden.
 * @param dataStartRow 1-based sheet row number of the first data row (typically 2).
 * @returns Array of ClientGroup sorted by firstRow ascending.
 */
export function buildGroups(
  all: any[][],
  CI: ColumnIndices,
  hiddenRows: Set<number>,
  dataStartRow: number
): ClientGroup[] {
  const n = all.length;
  const uf = makeUF(n);

  // --- Merge by phone ---
  const phoneMap: Record<string, number> = {};
  for (let r = 0; r < n; r++) {
    const sheetRow = r + dataStartRow;
    if (hiddenRows.has(sheetRow)) continue;
    if (CI.PHONE < 0) continue;
    const phone = normalizePhone(String(all[r][CI.PHONE] ?? ''));
    if (!phone) continue;
    if (phoneMap[phone] !== undefined) {
      uf.union(phoneMap[phone], r);
    } else {
      phoneMap[phone] = r;
    }
  }

  // --- Merge by address ---
  if (CI.STREET >= 0 && CI.PREFIX >= 0) {
    const addrMap: Record<string, number> = {};
    for (let r = 0; r < n; r++) {
      const sheetRow = r + dataStartRow;
      if (hiddenRows.has(sheetRow)) continue;
      const street = String(all[r][CI.STREET] ?? '').trim().toUpperCase();
      const prefix = String(all[r][CI.PREFIX] ?? '').trim().toUpperCase();
      if (!street || !prefix) continue;
      const addrKey = prefix + '|' + street;
      if (addrMap[addrKey] !== undefined) {
        uf.union(addrMap[addrKey], r);
      } else {
        addrMap[addrKey] = r;
      }
    }
  }

  // --- Collect groups ---
  const groupMap: Record<number, number[]> = {};
  for (let r = 0; r < n; r++) {
    const sheetRow = r + dataStartRow;
    if (hiddenRows.has(sheetRow)) continue;
    if (CI.PHONE >= 0) {
      const phone = normalizePhone(String(all[r][CI.PHONE] ?? ''));
      if (!phone) continue;
    }
    const root = uf.find(r);
    if (!groupMap[root]) groupMap[root] = [];
    groupMap[root].push(r);
  }

  const groups: ClientGroup[] = [];
  for (const root in groupMap) {
    const rows = groupMap[root];
    rows.sort((a, b) => a - b);
    groups.push({
      rows,
      firstRow: rows[0] + dataStartRow,
    });
  }

  groups.sort((a, b) => a.firstRow - b.firstRow);
  return groups;
}

// --- Available Group Filtering ---

/**
 * Filter groups to only those that are still dialable:
 * - At least one row without YES/NO/REMOVE
 * - At least one non-WN phone that is a valid 10-digit number
 */
export function filterAvailable(
  groups: ClientGroup[],
  all: any[][],
  CI: ColumnIndices
): ClientGroup[] {
  return groups.filter((group) => {
    // Check for undispositioned rows (YES/NO/REMOVE mark a row as done; WN alone does NOT)
    let hasUndispositioned = false;
    for (const r of group.rows) {
      let hasDisp = false;
      if (CI.YES >= 0 && String(all[r][CI.YES] ?? '').trim() !== '') hasDisp = true;
      if (!hasDisp && CI.NO >= 0 && String(all[r][CI.NO] ?? '').trim() !== '') hasDisp = true;
      if (!hasDisp && CI.REMOVE >= 0 && String(all[r][CI.REMOVE] ?? '').trim() !== '') hasDisp = true;
      if (!hasDisp) { hasUndispositioned = true; break; }
    }
    if (!hasUndispositioned) return false;

    // Check for a dialable phone on a non-WN row
    if (CI.PHONE < 0) return false;
    for (const r of group.rows) {
      const wnVal = CI.WN >= 0 ? String(all[r][CI.WN] ?? '').trim() : '';
      if (wnVal !== '') continue; // skip WN'd rows
      const ph = normalizePhone(String(all[r][CI.PHONE] ?? ''));
      if (ph.length === 10) return true;
    }
    return false;
  });
}

// --- Direction Ordering ---

/**
 * Get the max NA count for a group (used by scatter mode).
 */
function groupMaxNA(group: ClientGroup, all: any[][], naCol: number): number {
  if (naCol < 0) return 0;
  let maxNA = 0;
  for (const r of group.rows) {
    const val = parseInt(String(all[r][naCol] ?? '0'), 10) || 0;
    if (val > maxNA) maxNA = val;
  }
  return maxNA;
}

/**
 * Apply ordering to available groups based on direction mode.
 * Returns a NEW array (does not mutate input).
 *
 * - down: natural order (ascending firstRow) — already sorted
 * - up: reversed order (descending firstRow)
 * - scatter: sorted by lowest NA count first, then ascending row
 */
export function applyOrdering(
  available: ClientGroup[],
  all: any[][],
  CI: ColumnIndices,
  direction: Direction
): ClientGroup[] {
  const ordered = [...available];

  if (direction === 'scatter') {
    ordered.sort((a, b) => {
      const naA = groupMaxNA(a, all, CI.NA);
      const naB = groupMaxNA(b, all, CI.NA);
      if (naA !== naB) return naA - naB;
      return a.firstRow - b.firstRow;
    });
    return ordered;
  }

  if (direction === 'up') {
    ordered.reverse();
    return ordered;
  }

  // 'down' — already in ascending firstRow order
  return ordered;
}

/**
 * Find the next group to dial from the ordered list, starting after `afterRow`.
 *
 * - down: first group with firstRow >= afterRow
 * - up: first group (in reversed list) with firstRow < afterRow
 * - scatter: always returns ordered[0] (the lowest NA group), but removes already-dialed
 */
export function findNextGroup(
  ordered: ClientGroup[],
  afterRow: number,
  direction: Direction
): ClientGroup | null {
  if (ordered.length === 0) return null;

  if (direction === 'up') {
    for (const g of ordered) {
      if (g.firstRow < afterRow) return g;
    }
    return null;
  }

  if (direction === 'scatter') {
    return ordered[0] ?? null;
  }

  // 'down'
  for (const g of ordered) {
    if (g.firstRow >= afterRow) return g;
  }
  return null;
}

/**
 * Calculate the afterRow value for advancing to the next group after disposition.
 */
export function nextAfterRow(groupSheetRows: number[], direction: Direction): number {
  if (!groupSheetRows || groupSheetRows.length === 0) return 2;
  if (direction === 'up') {
    return Math.min(...groupSheetRows);
  }
  return Math.max(...groupSheetRows) + 1;
}
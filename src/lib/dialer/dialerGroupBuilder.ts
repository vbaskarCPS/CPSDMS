// src/lib/dialer/dialerGroupBuilder.ts
//
// Client-side union-find group builder for the AutoSniper dialer.
// Ported from Utilities.gs: buildClientGroups_, and Sniper.gs: executeSniper.
//
// Group building: merges rows by shared phone number and by shared address
// (route prefix + normalized house+street), matching Sniper.gs behavior.
//
// Sniper filtering: post-group-building filter that removes groups based on
// campaign config (years, prepaid-only, min entries, link shot, hide CTS).
//
// Direction modes:
//   ambush    — start at user-defined Booking ID, call down, wrap to top, full loop
//   infiltrate — find 20-raw-row window with lowest avg NA, call down, wrap to window top
//   siege     — call all blanks top-to-bottom, then 1s, then 2s, etc. Mission complete when done.
//

import { ColumnIndices } from './dialerHeaders';
import {
  normalizePhone,
  normalizeAddr,
  getRoutePrefix,
  buildStreetKey,
  parseYear,
  isPrepaid,
  hasAER,
  isCTS,
} from './dialerUtils';
import type { SniperConfig } from '../campaignService';

// --- Types ---

export type Direction = 'ambush' | 'infiltrate' | 'siege';

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
 *
 * Merge rules (matching Sniper.gs executeSniper):
 * 1. Phone: rows with same normalized 10-digit phone merge.
 * 2. Address: rows with same ROUTE_PREFIX|normalizeAddr(HOUSE#, STREET) merge.
 *    This scopes address matching by route area so "123 Main St" in ACE
 *    stays separate from "123 Main St" in BS.
 *
 * @param all        2D array of cell values (data rows only, no header). Index 0 = first data row.
 * @param CI         Resolved column indices.
 * @param hiddenRows Set of 1-based sheet row numbers that are hidden (pass empty set for no hiding).
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

  // --- Merge by address: ROUTE_PREFIX | normalizeAddr(HOUSE#, STREET) ---
  if (CI.PREFIX >= 0 && CI.STREET >= 0 && CI.ROUTE_CODE >= 0) {
    const addrMap: Record<string, number> = {};
    for (let r = 0; r < n; r++) {
      const sheetRow = r + dataStartRow;
      if (hiddenRows.has(sheetRow)) continue;

      const house = String(all[r][CI.PREFIX] ?? '').trim();
      const street = String(all[r][CI.STREET] ?? '').trim();
      const routeCode = String(all[r][CI.ROUTE_CODE] ?? '').trim();
      const prefix = getRoutePrefix(routeCode);

      if (!house && !street) continue;
      if (!prefix) continue;

      const addr = normalizeAddr(house, street);
      if (!addr) continue;

      const addrKey = prefix + '|' + addr;
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

    // Must have a valid phone to be part of a group
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

// =============================================================================
// SNIPER FILTER — post-group-building filter based on campaign config
// =============================================================================

/**
 * Filter groups based on Sniper configuration.
 * Runs AFTER buildGroups() and BEFORE filterAvailable().
 *
 * Filters applied:
 * 1. Years: group must have ≥1 row with YEAR matching any selected year.
 * 2. Prepaid Only: group must have ≥1 row with PMT TYPE = prepaid.
 * 3. Min Entries: group must have ≥ minEntries rows.
 * 4. Link Shot: group must be on a street that has at least one AER anywhere in the sheet.
 * 5. Hide CTS: skip groups where any row has "CTS" in the NA column.
 * 6. BLACKLIST (maxNA): skip groups where max NA value across rows >= maxNA threshold.
 *
 * @param groups  All groups from buildGroups().
 * @param all     Full data array (no header row).
 * @param CI      Resolved column indices.
 * @param config  Sniper configuration from the campaign.
 * @returns Filtered array of ClientGroup.
 */
export function sniperFilterGroups(
  groups: ClientGroup[],
  all: any[][],
  CI: ColumnIndices,
  config: SniperConfig
): ClientGroup[] {
  // Pre-compute: which streets have AER (for linkShot filter)
  const aerStreets = new Set<string>();
  if (config.linkShot && CI.AER >= 0 && CI.STREET >= 0 && CI.ROUTE_CODE >= 0) {
    for (let r = 0; r < all.length; r++) {
      if (hasAER(all[r][CI.AER])) {
        const rc = String(all[r][CI.ROUTE_CODE] ?? '').trim();
        const st = String(all[r][CI.STREET] ?? '').trim();
        const key = buildStreetKey(rc, st);
        if (key && key !== '|') aerStreets.add(key);
      }
    }
  }

  const targetYears = config.years.length > 0 ? config.years : [2025];

  return groups.filter((group) => {
    // --- 1. Year filter ---
    if (CI.YEAR >= 0) {
      let hasMatchingYear = false;
      for (const r of group.rows) {
        const yr = parseYear(all[r][CI.YEAR]);
        if (yr > 0 && targetYears.includes(yr)) {
          hasMatchingYear = true;
          break;
        }
      }
      if (!hasMatchingYear) return false;
    }

    // --- 2. Prepaid Only ---
    if (config.ppOnly && CI.PMT_TYPE >= 0) {
      let hasPP = false;
      for (const r of group.rows) {
        if (isPrepaid(all[r][CI.PMT_TYPE])) {
          hasPP = true;
          break;
        }
      }
      if (!hasPP) return false;
    }

    // --- 3. Min Entries ---
    if (config.minEntries > 1 && group.rows.length < config.minEntries) {
      return false;
    }

    // --- 4. Link Shot ---
    if (config.linkShot && CI.STREET >= 0 && CI.ROUTE_CODE >= 0) {
      let onAerStreet = false;
      for (const r of group.rows) {
        const rc = String(all[r][CI.ROUTE_CODE] ?? '').trim();
        const st = String(all[r][CI.STREET] ?? '').trim();
        const key = buildStreetKey(rc, st);
        if (key && aerStreets.has(key)) {
          onAerStreet = true;
          break;
        }
      }
      if (!onAerStreet) return false;
    }

    // --- 5. Hide CTS ---
    if (config.hideCTS && CI.NA >= 0) {
      let hasCTS = false;
      for (const r of group.rows) {
        if (isCTS(all[r][CI.NA])) {
          hasCTS = true;
          break;
        }
      }
      if (hasCTS) return false;
    }

    // --- 6. BLACKLIST ---
    if ((config.maxNA ?? 0) > 0 && CI.NA >= 0) {
      let maxNAVal = 0;
      for (const r of group.rows) {
        const raw = String(all[r][CI.NA] ?? '').trim();
        const val = parseInt(raw, 10);
        if (!isNaN(val) && val > maxNAVal) maxNAVal = val;
      }
      if (maxNAVal >= config.maxNA) return false;
    }

    return true;
  });
}

// =============================================================================
// AVAILABLE GROUP FILTERING — unchanged
// =============================================================================

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
    let hasUndispositioned = false;
    for (const r of group.rows) {
      let hasDisp = false;
      if (CI.YES >= 0 && String(all[r][CI.YES] ?? '').trim() !== '') hasDisp = true;
      if (!hasDisp && CI.NO >= 0 && String(all[r][CI.NO] ?? '').trim() !== '') hasDisp = true;
      if (!hasDisp && CI.REMOVE >= 0 && String(all[r][CI.REMOVE] ?? '').trim() !== '') hasDisp = true;
      if (!hasDisp) { hasUndispositioned = true; break; }
    }
    if (!hasUndispositioned) return false;

    if (CI.PHONE < 0) return false;
    for (const r of group.rows) {
      const wnVal = CI.WN >= 0 ? String(all[r][CI.WN] ?? '').trim() : '';
      if (wnVal !== '') continue;
      const ph = normalizePhone(String(all[r][CI.PHONE] ?? ''));
      if (ph.length === 10) return true;
    }
    return false;
  });
}

// =============================================================================
// NA HELPERS
// =============================================================================

/**
 * Get the NA count for a group — blank/non-numeric = 0.
 * Used by Infiltrate (window scoring) and Siege (tier ordering).
 */
function groupNA(group: ClientGroup, all: any[][], naCol: number): number {
  if (naCol < 0) return 0;
  // Use the NA value from the first (primary) row of the group
  const raw = String(all[group.rows[0]][naCol] ?? '').trim();
  const val = parseInt(raw, 10);
  return isNaN(val) ? 0 : val;
}

// =============================================================================
// INFILTRATE — window finder
// =============================================================================

/**
 * Find the best 20-raw-row window in the full data array (all rows, not just
 * available groups) with the lowest average NA count.
 *
 * "NA count" for a raw row: numeric value in CI.NA column; blank/non-numeric = 0.
 * Only rows that belong to available groups are considered when computing the
 * average — rows with no valid group are ignored (they're already dispositioned
 * or filtered out).
 *
 * Returns the firstRow (1-based sheet row) of the available group at or after
 * the start of the best window. If tied, picks the earliest window.
 *
 * @param available   Already-filtered available groups (sorted by firstRow asc).
 * @param all         Full raw data array.
 * @param CI          Column indices.
 * @param dataStartRow 1-based sheet row of first data row.
 * @returns 1-based sheet row to start calling from, or the first available group's firstRow as fallback.
 */
export function findInfiltrateStart(
  available: ClientGroup[],
  all: any[][],
  CI: ColumnIndices,
  dataStartRow: number
): number {
  if (available.length === 0) return dataStartRow;

  const WINDOW = 20;
  const totalRows = all.length;

  // Build a lookup: dataIndex → group (for available groups only)
  const rowToGroup = new Map<number, ClientGroup>();
  for (const g of available) {
    for (const r of g.rows) {
      rowToGroup.set(r, g);
    }
  }

  if (totalRows < WINDOW) {
    // Sheet is smaller than window — just start at the first available group
    return available[0].firstRow;
  }

  let bestWindowStart = 0;  // 0-based data index
  let bestAvgNA = Infinity;

  for (let winStart = 0; winStart <= totalRows - WINDOW; winStart++) {
    let naSum = 0;
    let rowCount = 0;

    for (let r = winStart; r < winStart + WINDOW; r++) {
      const group = rowToGroup.get(r);
      if (!group) continue; // not an available group row — skip
      const raw = String(all[r][CI.NA >= 0 ? CI.NA : -1] ?? '').trim();
      const val = CI.NA >= 0 ? (parseInt(raw, 10) || 0) : 0;
      naSum += val;
      rowCount++;
    }

    // If no available group rows in this window, treat avg as Infinity
    const avgNA = rowCount > 0 ? naSum / rowCount : Infinity;

    if (avgNA < bestAvgNA) {
      bestAvgNA = avgNA;
      bestWindowStart = winStart;
    }
  }

  // Find the first available group at or after bestWindowStart
  const windowSheetRow = bestWindowStart + dataStartRow;
  for (const g of available) {
    if (g.firstRow >= windowSheetRow) return g.firstRow;
  }

  // Fallback: first available group
  return available[0].firstRow;
}

// =============================================================================
// ORDERING
// =============================================================================

/**
 * Apply ordering to available groups based on direction mode.
 * Returns a NEW array (does not mutate input).
 *
 * - ambush:    natural order (ascending firstRow) — wrap logic handled by engine
 * - infiltrate: natural order — start point + wrap handled by engine
 * - siege:     sorted by NA tier (0/blank first, then 1s, then 2s…), then firstRow within tier
 */
export function applyOrdering(
  available: ClientGroup[],
  all: any[][],
  CI: ColumnIndices,
  direction: Direction
): ClientGroup[] {
  const ordered = [...available];

  if (direction === 'siege') {
    ordered.sort((a, b) => {
      const naA = groupNA(a, all, CI.NA);
      const naB = groupNA(b, all, CI.NA);
      if (naA !== naB) return naA - naB;
      return a.firstRow - b.firstRow;
    });
    return ordered;
  }

  // ambush and infiltrate both walk in natural (ascending firstRow) order.
  // The engine controls where they start and how they wrap.
  return ordered;
}

// =============================================================================
// NAVIGATION
// =============================================================================

/**
 * Find the next group to dial from the ordered list.
 *
 * ambush / infiltrate:
 *   Returns the first group with firstRow >= afterRow.
 *   Returns null when no such group exists (engine handles wrap).
 *
 * siege:
 *   Returns the group at position afterIndex in the tier-sorted list.
 *   afterIndex is a list index (not a row number) — this is the fix for the
 *   bug where row-based lookup would skip earlier tiers after dispositioning
 *   a group at a high row number.
 *   Returns null when afterIndex >= list length (mission complete — no wrap).
 */
export function findNextGroup(
  ordered: ClientGroup[],
  afterRow: number,
  direction: Direction,
  siegeIndex?: number
): ClientGroup | null {
  if (ordered.length === 0) return null;

  if (direction === 'siege') {
    // Use list index for Siege — never skip tiers due to row position
    const idx = siegeIndex ?? 0;
    return idx < ordered.length ? ordered[idx] : null;
  }

  // ambush / infiltrate: find first group at or after afterRow in row-sorted list
  for (const g of ordered) {
    if (g.firstRow >= afterRow) return g;
  }

  return null;
}

/**
 * For Siege resume: given a sheet row number, find the closest matching
 * list index in the tier-sorted ordered array. Used to restore position
 * after a session resume.
 *
 * Returns 0 if not found (safe fallback — restart from top of tier list).
 */
export function findSiegeIndexByRow(
  ordered: ClientGroup[],
  afterRow: number
): number {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].firstRow >= afterRow) return i;
  }
  return 0;
}

/**
 * Calculate the afterRow value for advancing to the next group after disposition.
 * All three modes advance forward (downward in the sheet).
 * For Siege the engine uses the index directly, but afterRow is still stored
 * for resume purposes and used by ambush/infiltrate.
 */
export function nextAfterRow(groupSheetRows: number[], direction: Direction): number {
  if (!groupSheetRows || groupSheetRows.length === 0) return 2;
  // Always advance past the last row of the current group
  return Math.max(...groupSheetRows) + 1;
}
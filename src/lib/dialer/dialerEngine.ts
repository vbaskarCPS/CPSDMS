// src/lib/dialer/dialerEngine.ts
//
// Main dialer engine orchestrator. Ties together:
// - Sheet data fetching (via dialerSheetsService)
// - Header resolution
// - Union-find group building
// - Sniper filtering (client-side, replaces Apps Script Sniper.gs)
// - Direction-aware navigation
// - Disposition application (builds updates, writes to sheet)
// - Phone highlighting via Google Sheets API (replaces Apps Script bridge)
// - Gamification processing
//
// This is the single entry point for the DialerPage UI.
//

import { resolveHeaders, findHeaders, ColumnIndices } from './dialerHeaders';
import {
  buildGroups,
  sniperFilterGroups,
  filterAvailable,
  applyOrdering,
  findNextGroup,
  nextAfterRow,
  Direction,
  ClientGroup,
} from './dialerGroupBuilder';
import {
  buildState,
  countStreetAER,
  DialerState,
  DialerStateResult,
} from './dialerStateBuilder';
import {
  buildDispositionUpdates,
  cellUpdatesToSheetsData,
  DispositionType,
  DispositionExtra,
} from './dialerDispositions';
import { buildCCDRow, detectCardType, StagedCard, CCDWriteData } from './dialerCCD';
import { normalizePhone, parseHiddenRows, buildStreetKey } from './dialerUtils';
import {
  GamificationSession,
  createFreshSession,
  getCurrentRank,
} from './gamificationDefs';
import {
  processDisposition as processGamification,
  getActiveMultipliers,
  DispositionContext,
  ProcessResult as GamificationResult,
} from './gamificationEngine';
import { dialerSheetsService } from '../dialerSheetsService';
import type { SniperConfig } from '../campaignService';
import { DEFAULT_SNIPER_CONFIG } from '../campaignService';

// =============================================================================
// TYPES
// =============================================================================

export interface EngineConfig {
  spreadsheetId: string;
  sheetName: string;
  direction: Direction;
  startRow: number;         // 1-based row to start from (or afterRow for subsequent calls)
  repCode: string;
  sniperConfig?: SniperConfig;  // Sniper filtering config (replaces Apps Script hidden rows)
  startBookingId?: string;      // Optional: start from specific booking ID
}

export interface EngineSnapshot {
  /** Current group state */
  state: DialerState;
  /** Prefetched next group state (if available) */
  prefetchState: DialerState | null;
  /** Gamification session */
  session: GamificationSession;
  /** All groups in the sheet (for progress tracking) */
  totalGroups: number;
  availableGroups: number;
}

export interface PrepayPending {
  sheetName: string;
  groupDataIndices: number[];
  phone: string;
  extra: DispositionExtra;
  dataStartRow: number;
}

// =============================================================================
// ENGINE STATE — in-memory cache of sheet data + groups
// =============================================================================

interface CachedSheetData {
  spreadsheetId: string;
  sheetName: string;
  sniperConfigHash: string; // Serialized config to detect changes
  headers: any[];
  CI: ColumnIndices;
  dataStartRow: number;     // 1-based sheet row of first data row
  all: any[][];             // All data rows (no header)
  groups: ClientGroup[];    // All groups (after sniper filter)
  available: ClientGroup[]; // Groups that are still dialable
  sheetTabId: number;       // Numeric tab ID for formatting API calls
  timestamp: number;
}

let cachedSheet: CachedSheetData | null = null;
let pendingPrepay: PrepayPending | null = null;

// Track highlighted rows so we can clear them on next advance
let highlightedRows: { current: number[]; next: number[] } = { current: [], next: [] };

// =============================================================================
// DATA LOADING
// =============================================================================

/**
 * Fetch all rows from the sheet and build groups.
 * Caches the result so subsequent calls (disposition, navigation) don't re-fetch.
 */
async function loadSheetData(
  spreadsheetId: string,
  sheetName: string,
  sniperConfig?: SniperConfig
): Promise<CachedSheetData> {
  // Serialize config for cache comparison
  const configHash = JSON.stringify(sniperConfig || DEFAULT_SNIPER_CONFIG);

  // Return cache if fresh (< 30 seconds for same sheet + same config)
  if (
    cachedSheet &&
    cachedSheet.spreadsheetId === spreadsheetId &&
    cachedSheet.sheetName === sheetName &&
    cachedSheet.sniperConfigHash === configHash &&
    Date.now() - cachedSheet.timestamp < 30000
  ) {
    return cachedSheet;
  }

  // Fetch all data from the sheet
  const range = `'${sheetName}'`;
  const rawData = await dialerSheetsService.sheetsGet(spreadsheetId, range);
  if (!rawData || rawData.length < 2) {
    throw new Error(`Sheet "${sheetName}" has no data rows.`);
  }

  // Find headers (may not be row 1)
  const { headerRowIndex, CI } = findHeaders(rawData);
  if (CI.PHONE < 0) {
    throw new Error('No PHONE column found in headers.');
  }

  const headers = rawData[headerRowIndex];
  const dataStartRow = headerRowIndex + 2; // 1-based sheet row (headerRowIndex is 0-based in rawData)
  const all = rawData.slice(headerRowIndex + 1); // Data rows only

  // Build groups with NO hidden rows — all rows participate
  const emptyHidden = new Set<number>();
  const allGroups = buildGroups(all, CI, emptyHidden, dataStartRow);

  // Apply sniper filter
  const config = sniperConfig || DEFAULT_SNIPER_CONFIG;
  const sniperFiltered = sniperFilterGroups(allGroups, all, CI, config);

  // Filter to dialable groups
  const available = filterAvailable(sniperFiltered, all, CI);

  // Get the numeric sheet tab ID for formatting API calls
  let sheetTabId = 0;
  try {
    const tabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
    const tab = tabs.find((t) => t.title === sheetName);
    if (tab) sheetTabId = tab.sheetId;
  } catch {
    // Non-critical — highlighting will be skipped if we can't get the tab ID
  }

  cachedSheet = {
    spreadsheetId,
    sheetName,
    sniperConfigHash: configHash,
    headers,
    CI,
    dataStartRow,
    all,
    groups: sniperFiltered,
    available,
    sheetTabId,
    timestamp: Date.now(),
  };

  return cachedSheet;
}

/**
 * Force a full refresh of cached sheet data on next call.
 */
export function invalidateCache(): void {
  cachedSheet = null;
}

// =============================================================================
// PHONE HIGHLIGHTING — via Google Sheets API (replaces Apps Script bridge)
// =============================================================================

/**
 * Highlight the PHONE column cells for the current and next group.
 * Yellow (#FFD600) = current group, Blue (#00B0FF) = next group.
 * Clears the previous highlight first.
 */
async function highlightPhones(
  sheet: CachedSheetData,
  currentRows: number[],
  nextRows: number[]
): Promise<void> {
  if (sheet.CI.PHONE < 0) return;

  const phoneCol = sheet.CI.PHONE; // 0-based column index

  // Build batch update requests
  const requests: any[] = [];

  // 1. Clear previous highlights (set background to no color)
  const allPrevRows = [...highlightedRows.current, ...highlightedRows.next];
  for (const row of allPrevRows) {
    const dataIdx = row - sheet.dataStartRow; // convert 1-based sheet row to 0-based
    if (dataIdx < 0) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheet.sheetTabId,
          startRowIndex: row - 1, // 0-based for API
          endRowIndex: row,
          startColumnIndex: phoneCol,
          endColumnIndex: phoneCol + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1, green: 1, blue: 1 }, // white (reset)
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // 2. Highlight current group rows — yellow (#FFD600)
  for (const row of currentRows) {
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheet.sheetTabId,
          startRowIndex: row - 1,
          endRowIndex: row,
          startColumnIndex: phoneCol,
          endColumnIndex: phoneCol + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1, green: 0.839, blue: 0 }, // #FFD600
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // 3. Highlight next group rows — blue (#00B0FF)
  for (const row of nextRows) {
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheet.sheetTabId,
          startRowIndex: row - 1,
          endRowIndex: row,
          startColumnIndex: phoneCol,
          endColumnIndex: phoneCol + 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0, green: 0.69, blue: 1 }, // #00B0FF
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  if (requests.length === 0) return;

  // Track for next clear
  highlightedRows = { current: [...currentRows], next: [...nextRows] };

  try {
    await dialerSheetsService.sheetsFormatBatch(sheet.spreadsheetId, requests);
  } catch {
    // Silent fail — highlighting is non-critical
  }
}

// =============================================================================
// INITIAL LOAD — Get first group and set up engine
// =============================================================================

/**
 * Initialize the dialer engine: load data, find the starting group.
 */
export async function initialize(config: EngineConfig): Promise<EngineSnapshot | null> {
  const sheet = await loadSheetData(
    config.spreadsheetId,
    config.sheetName,
    config.sniperConfig
  );

  if (sheet.available.length === 0) {
    return null;
  }

  // Determine starting afterRow
  let afterRow = config.startRow;

  // If startBookingId is provided, find that group instead
  if (config.startBookingId && sheet.CI.BOOKING_ID >= 0) {
    const bid = config.startBookingId.trim();
    for (let r = 0; r < sheet.all.length; r++) {
      const rowBid = String(sheet.all[r][sheet.CI.BOOKING_ID] ?? '').trim();
      if (rowBid === bid) {
        afterRow = r + sheet.dataStartRow;
        break;
      }
    }
  }

  // Apply ordering and find first group
  const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
  const group = findNextGroup(ordered, afterRow, config.direction);

  if (!group) return null;

  // Find group index in full list
  let currentGroupIndex = 0;
  for (let i = 0; i < sheet.groups.length; i++) {
    if (sheet.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  const state = buildState(
    group.rows,
    sheet.all,
    sheet.CI,
    config.sheetName,
    currentGroupIndex,
    sheet.groups.length,
    sheet.dataStartRow
  );

  // Load or create gamification session
  const session = loadOrCreateSession(config.repCode);
  if (session.sessionStartTime === 0) {
    session.sessionStartTime = Date.now();
  }

  // Prefetch next group
  const prefetchState = getPrefetchState(sheet, state, config.direction);

  // Highlight phones in the sheet
  highlightPhones(
    sheet,
    state.rows,
    prefetchState?.rows || []
  );

  return {
    state,
    prefetchState,
    session,
    totalGroups: sheet.groups.length,
    availableGroups: sheet.available.length,
  };
}

// =============================================================================
// NAVIGATION — Get specific group
// =============================================================================

/**
 * Navigate to the next group after the given afterRow.
 */
export async function getNextState(
  config: EngineConfig,
  afterRow: number
): Promise<DialerStateResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig);

  const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
  const group = findNextGroup(ordered, afterRow, config.direction);

  if (!group) {
    return { found: false, message: `No more groups in ${config.direction} direction from row ${afterRow}.` };
  }

  let currentGroupIndex = 0;
  for (let i = 0; i < sheet.groups.length; i++) {
    if (sheet.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  return buildState(
    group.rows,
    sheet.all,
    sheet.CI,
    config.sheetName,
    currentGroupIndex,
    sheet.groups.length,
    sheet.dataStartRow
  );
}

/**
 * Find a group by booking ID.
 */
export async function findGroupByBookingId(
  config: EngineConfig,
  bookingId: string
): Promise<DialerStateResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig);

  if (sheet.CI.BOOKING_ID < 0) {
    return { found: false, message: 'No Booking ID column found.' };
  }

  for (let r = 0; r < sheet.all.length; r++) {
    const bid = String(sheet.all[r][sheet.CI.BOOKING_ID] ?? '').trim();
    if (bid === bookingId) {
      const afterRow = r + sheet.dataStartRow;
      return getNextState(config, afterRow);
    }
  }

  return { found: false, message: `Booking ID "${bookingId}" not found.` };
}

/**
 * Find a group by phone number.
 */
export async function findGroupByPhone(
  config: EngineConfig,
  phone: string
): Promise<DialerStateResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig);
  const normalized = normalizePhone(phone);
  if (!normalized) return { found: false, message: 'Invalid phone number.' };

  if (sheet.CI.PHONE < 0) return { found: false, message: 'No PHONE column found.' };

  for (let r = 0; r < sheet.all.length; r++) {
    const p = normalizePhone(String(sheet.all[r][sheet.CI.PHONE] ?? ''));
    if (p === normalized) {
      const afterRow = r + sheet.dataStartRow;
      return getNextState(config, afterRow);
    }
  }

  return { found: false, message: `Phone "${phone}" not found.` };
}

// =============================================================================
// PREFETCH — Get next group state without highlight
// =============================================================================

function getPrefetchState(
  sheet: CachedSheetData,
  currentState: DialerState,
  direction: Direction
): DialerState | null {
  const afterRow = nextAfterRow(currentState.rows, direction);
  const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, direction);
  const group = findNextGroup(ordered, afterRow, direction);

  if (!group) return null;

  let currentGroupIndex = 0;
  for (let i = 0; i < sheet.groups.length; i++) {
    if (sheet.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  return buildState(
    group.rows,
    sheet.all,
    sheet.CI,
    sheet.sheetName,
    currentGroupIndex,
    sheet.groups.length,
    sheet.dataStartRow
  );
}

// =============================================================================
// DISPOSITION — Apply and advance
// =============================================================================

export interface DispositionResult {
  /** Next group state (or redial state) */
  nextState: DialerStateResult;
  /** Updated gamification result */
  gamification: GamificationResult | null;
  /** If WN/NIS found alternate phone, the new phone to redial */
  redialPhone?: string;
}

/**
 * Apply a disposition to the current group and advance to the next.
 */
export async function applyDisposition(
  config: EngineConfig,
  state: DialerState,
  disposition: DispositionType,
  phone: string,
  session: GamificationSession,
  extra: DispositionExtra = {},
  yesStartTime?: number
): Promise<DispositionResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig);

  // Build disposition updates
  const dispResult = buildDispositionUpdates(
    disposition,
    sheet.all,
    sheet.CI,
    state.dataIndices,
    sheet.dataStartRow,
    phone,
    config.repCode,
    extra
  );

  // Write updates to sheet
  if (dispResult.updates.length > 0) {
    const sheetsData = cellUpdatesToSheetsData(config.sheetName, dispResult.updates);
    await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);

    // Update local cache with the written values
    for (const u of dispResult.updates) {
      const dataIdx = u.row - sheet.dataStartRow;
      if (dataIdx >= 0 && dataIdx < sheet.all.length) {
        sheet.all[dataIdx][u.col] = u.value;
      }
    }
  }

  // If WN/NIS found a redial phone, return it without advancing
  if (dispResult.redial) {
    const gamCtx = buildGamificationContext(state, disposition, extra, yesStartTime);
    const gamResult = processGamification(session, disposition, gamCtx);
    saveSession(config.repCode, session);

    return {
      nextState: { found: true, ...state, phone: dispResult.redial.newPhone } as DialerState,
      gamification: gamResult,
      redialPhone: dispResult.redial.newPhone,
    };
  }

  // Process gamification
  const gamCtx = buildGamificationContext(state, disposition, extra, yesStartTime);
  let gamResult: GamificationResult | null = null;

  if (disposition === 'COMPLETE' || disposition === 'PREPAY') {
    gamResult = processGamification(session, disposition, gamCtx);
  } else {
    gamResult = processGamification(session, disposition, gamCtx);
  }
  saveSession(config.repCode, session);

  // For PREPAY disposition, we don't advance yet — stage the card entry
  if (disposition === 'PREPAY') {
    pendingPrepay = {
      sheetName: config.sheetName,
      groupDataIndices: state.dataIndices,
      phone,
      extra,
      dataStartRow: sheet.dataStartRow,
    };
    return {
      nextState: state,
      gamification: gamResult,
    };
  }

  // Rebuild available groups (dispositions change availability)
  sheet.available = filterAvailable(sheet.groups, sheet.all, sheet.CI);
  sheet.timestamp = Date.now();

  // Advance to next group
  const afterRow = nextAfterRow(state.rows, config.direction);
  const nextStateResult = await getNextState(config, afterRow);

  // Highlight phones in sheet
  if (nextStateResult.found) {
    const ns = nextStateResult as DialerState;
    const prefetch = getPrefetchState(sheet, ns, config.direction);
    highlightPhones(
      sheet,
      ns.rows,
      prefetch?.rows || []
    );
  }

  return {
    nextState: nextStateResult,
    gamification: gamResult,
  };
}

// =============================================================================
// PREPAY FLOW
// =============================================================================

/**
 * Stage card data for a pending prepay.
 */
export function stageCardData(cardNum: string, expiry: string, cvv: string, amount: string): StagedCard {
  const cleanCard = cardNum.replace(/[\s-]/g, '');
  return {
    cardType: detectCardType(cleanCard),
    cardNumber: cleanCard,
    expiry,
    cvv,
    amount: amount.trim(),
  };
}

/**
 * Finalize a prepay: write YES disposition + CCD row.
 */
export async function finalizePrepay(
  config: EngineConfig,
  cardData: StagedCard,
  session: GamificationSession
): Promise<DispositionResult> {
  if (!pendingPrepay) {
    return {
      nextState: { found: false, message: 'No pending prepay to finalize.' },
      gamification: null,
    };
  }

  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig);
  const pp = pendingPrepay;

  // If card amount differs from original, use submitted amount
  if (cardData.amount) {
    pp.extra.price = cardData.amount;
  }

  // Step 1: Write YES disposition to callbook
  const dispResult = buildDispositionUpdates(
    'PREPAY',
    sheet.all,
    sheet.CI,
    pp.groupDataIndices,
    pp.dataStartRow,
    pp.phone,
    config.repCode,
    pp.extra
  );

  if (dispResult.updates.length > 0) {
    const sheetsData = cellUpdatesToSheetsData(config.sheetName, dispResult.updates);
    await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);

    // Update local cache
    for (const u of dispResult.updates) {
      const dataIdx = u.row - sheet.dataStartRow;
      if (dataIdx >= 0 && dataIdx < sheet.all.length) {
        sheet.all[dataIdx][u.col] = u.value;
      }
    }
  }

  // Step 2: Find the detail row (most-recent-year matching phone) for CCD copy
  let detailIdx = pp.groupDataIndices[0];
  let bestYear = 0;
  let globalBestIdx = pp.groupDataIndices[0];
  let globalBestYear = 0;

  if (sheet.CI.YEAR >= 0) {
    for (const r of pp.groupDataIndices) {
      const yr = parseInt(String(sheet.all[r]?.[sheet.CI.YEAR] ?? '0'), 10) || 0;
      if (yr > globalBestYear) { globalBestYear = yr; globalBestIdx = r; }
      if (sheet.CI.PHONE >= 0) {
        const rowPh = normalizePhone(String(sheet.all[r]?.[sheet.CI.PHONE] ?? ''));
        if (rowPh === pp.phone && yr > bestYear) { bestYear = yr; detailIdx = r; }
      }
    }
  }
  if (bestYear === 0) detailIdx = globalBestIdx;

  // Step 3: Write to CCD tab
  try {
    const ccdRange = `'CCD'!1:1`;
    const ccdHeaderData = await dialerSheetsService.sheetsGet(config.spreadsheetId, ccdRange);
    if (ccdHeaderData && ccdHeaderData.length > 0) {
      const ccdHeaders = ccdHeaderData[0];
      const sourceRow = sheet.all[detailIdx];

      const ccdWrite = buildCCDRow(
        sourceRow,
        sheet.headers,
        ccdHeaders,
        cardData,
        config.repCode,
        { email: pp.extra.email, name: pp.extra.name, price: pp.extra.price }
      );

      await dialerSheetsService.sheetsAppend(
        config.spreadsheetId,
        `'CCD'!A1`,
        [ccdWrite.rowValues]
      );
    }
  } catch (err) {
    console.warn('CCD write failed (CCD tab may not exist):', err);
  }

  // Clear pending prepay
  pendingPrepay = null;

  // Rebuild available groups
  sheet.available = filterAvailable(sheet.groups, sheet.all, sheet.CI);
  sheet.timestamp = Date.now();

  // Advance to next group
  const afterRow = nextAfterRow(
    pp.groupDataIndices.map((r) => r + pp.dataStartRow),
    config.direction
  );
  const nextStateResult = await getNextState(config, afterRow);

  // Highlight
  if (nextStateResult.found) {
    const ns = nextStateResult as DialerState;
    const prefetch = getPrefetchState(sheet, ns, config.direction);
    highlightPhones(
      sheet,
      ns.rows,
      prefetch?.rows || []
    );
  }

  return {
    nextState: nextStateResult,
    gamification: {
      session,
      newBadges: [],
      pointBreakdown: null,
      activeMultipliers: getActiveMultipliers(session),
      rank: getCurrentRank(session),
    },
  };
}

/**
 * Cancel a pending prepay.
 */
export function cancelPrepay(): void {
  pendingPrepay = null;
}

/**
 * Check if there's a pending prepay.
 */
export function hasPendingPrepay(): boolean {
  return pendingPrepay !== null;
}

// =============================================================================
// STREET CLEARED CHECK (for Scorched Earth)
// =============================================================================

/**
 * Check if all groups on a street have been dispositioned.
 */
export function checkStreetCleared(
  state: DialerState
): { cleared: boolean; visibleGroupCount: number } {
  if (!cachedSheet) return { cleared: false, visibleGroupCount: 0 };

  const sheet = cachedSheet;
  const streetKey = state.streetKey;
  if (!streetKey) return { cleared: false, visibleGroupCount: 0 };

  const streetGroups: ClientGroup[] = [];
  for (const group of sheet.groups) {
    let inStreet = false;
    for (const r of group.rows) {
      const s = sheet.CI.STREET >= 0 ? String(sheet.all[r]?.[sheet.CI.STREET] ?? '').trim() : '';
      const rc = sheet.CI.ROUTE_CODE >= 0 ? String(sheet.all[r]?.[sheet.CI.ROUTE_CODE] ?? '').trim() : '';
      const key = buildStreetKey(rc, s);
      if (key === streetKey) { inStreet = true; break; }
    }
    if (inStreet) streetGroups.push(group);
  }

  if (streetGroups.length === 0) return { cleared: false, visibleGroupCount: 0 };

  let allCleared = true;
  for (const group of streetGroups) {
    let hasDisposition = false;
    for (const r of group.rows) {
      if (sheet.CI.YES >= 0 && String(sheet.all[r]?.[sheet.CI.YES] ?? '').trim() !== '') { hasDisposition = true; break; }
      if (sheet.CI.NO >= 0 && String(sheet.all[r]?.[sheet.CI.NO] ?? '').trim() !== '') { hasDisposition = true; break; }
      if (sheet.CI.WN >= 0 && String(sheet.all[r]?.[sheet.CI.WN] ?? '').trim() !== '') { hasDisposition = true; break; }
      if (sheet.CI.REMOVE >= 0 && String(sheet.all[r]?.[sheet.CI.REMOVE] ?? '').trim() !== '') { hasDisposition = true; break; }
    }
    if (!hasDisposition) { allCleared = false; break; }
  }

  return { cleared: allCleared, visibleGroupCount: streetGroups.length };
}

// =============================================================================
// YEAR DISCOVERY — scan sheet for available years (for Sniper Settings UI)
// =============================================================================

/**
 * Scan all data rows to find unique YEAR values present in the sheet.
 * Returns sorted descending (most recent first).
 */
export async function discoverAvailableYears(
  spreadsheetId: string,
  sheetName: string
): Promise<number[]> {
  const sheet = cachedSheet && cachedSheet.spreadsheetId === spreadsheetId && cachedSheet.sheetName === sheetName
    ? cachedSheet
    : await loadSheetData(spreadsheetId, sheetName);

  if (sheet.CI.YEAR < 0) return [];

  const yearSet = new Set<number>();
  for (let r = 0; r < sheet.all.length; r++) {
    const yr = parseInt(String(sheet.all[r][sheet.CI.YEAR] ?? ''), 10);
    if (!isNaN(yr) && yr >= 2000 && yr <= 2100) {
      yearSet.add(yr);
    }
  }

  return Array.from(yearSet).sort((a, b) => b - a);
}

// =============================================================================
// GAMIFICATION CONTEXT BUILDER
// =============================================================================

function buildGamificationContext(
  state: DialerState,
  disposition: string,
  extra: DispositionExtra,
  yesStartTime?: number
): DispositionContext {
  const ctx: DispositionContext = {
    timestamp: Date.now(),
    street: state.streetKey,
    streetAerCount: state.streetAerCount,
    mostRecentYear: state.mostRecentYear,
    sheetName: state.sheetName,
  };

  if (disposition === 'COMPLETE' || disposition === 'PREPAY') {
    ctx.price = parseFloat(extra.price || '0') || 0;
    ctx.yesStartTime = yesStartTime;

    if (cachedSheet) {
      const { cleared, visibleGroupCount } = checkStreetCleared(state);
      ctx.streetFullyCleared = cleared;
      ctx.streetVisibleGroupCount = visibleGroupCount;
    }

    if (disposition === 'PREPAY') {
      const hasPriorPrepay = state.serviceHistory.some(
        (h) => h.pmtType === 'Prepaid'
      );
      ctx.isFirstTimePrepay = !hasPriorPrepay;
    }
  }

  return ctx;
}

// =============================================================================
// SESSION PERSISTENCE (localStorage for now)
// =============================================================================

function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
}

function loadOrCreateSession(repCode: string): GamificationSession {
  const dateStr = getTodayDateStr();
  const key = `DIALER_SESSION_${repCode}_${dateStr}`;

  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.date === dateStr) {
        return migrateSession(parsed, repCode, dateStr);
      }
    }
  } catch {}

  const fresh = createFreshSession(repCode, dateStr);
  fresh.sessionStartTime = Date.now();
  return fresh;
}

function saveSession(repCode: string, session: GamificationSession): void {
  const dateStr = getTodayDateStr();
  const key = `DIALER_SESSION_${repCode}_${dateStr}`;
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    console.warn('Session save to localStorage failed');
  }
}

function migrateSession(
  loaded: GamificationSession,
  repCode: string,
  dateStr: string
): GamificationSession {
  const fresh = createFreshSession(repCode, dateStr);

  for (const key of Object.keys(fresh) as (keyof GamificationSession)[]) {
    if ((loaded as any)[key] === undefined) {
      (loaded as any)[key] = (fresh as any)[key];
    }
  }

  if (!loaded.multipliers) loaded.multipliers = fresh.multipliers;
  for (const mKey of Object.keys(fresh.multipliers) as (keyof typeof fresh.multipliers)[]) {
    if (!(loaded.multipliers as any)[mKey]) {
      (loaded.multipliers as any)[mKey] = (fresh.multipliers as any)[mKey];
    } else {
      const freshSub = (fresh.multipliers as any)[mKey];
      const loadedSub = (loaded.multipliers as any)[mKey];
      for (const sKey of Object.keys(freshSub)) {
        if (loadedSub[sKey] === undefined) {
          loadedSub[sKey] = freshSub[sKey];
        }
      }
    }
  }

  return loaded;
}

// =============================================================================
// EXPORTS — Re-export key types for consumers
// =============================================================================

export type { DialerState, DialerStateResult } from './dialerStateBuilder';
export type { Direction } from './dialerGroupBuilder';
export type { DispositionType, DispositionExtra } from './dialerDispositions';
export type { GamificationSession } from './gamificationDefs';
export type { GamificationResult, MultiplierSnapshot } from './gamificationEngine';
export { getCurrentRank } from './gamificationDefs';
export { getActiveMultipliers } from './gamificationEngine';
export { formatPhoneDisplay } from './dialerUtils';
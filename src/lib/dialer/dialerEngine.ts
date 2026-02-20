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
// Direction modes:
//   ambush    — start at user Booking ID, call down, wrap to top, full loop
//   infiltrate — find best 20-raw-row window (lowest avg NA), call down, wrap to window top
//   siege     — tier-sorted (blanks → 1s → 2s…), no wrap, mission complete when exhausted
//
// Session persistence: Supabase dialer_sessions table.
// One row per manager per day (EST date). State is written after every
// disposition so stats survive browser clears, tab switches, and device changes.
//

import { resolveHeaders, findHeaders, ColumnIndices } from './dialerHeaders';
import {
  buildGroups,
  sniperFilterGroups,
  filterAvailable,
  applyOrdering,
  findNextGroup,
  findInfiltrateStart,
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
import { campaignService, getTodayEST } from '../campaignService';
import type { SniperConfig } from '../campaignService';
import { DEFAULT_SNIPER_CONFIG } from '../campaignService';

// =============================================================================
// TYPES
// =============================================================================

export interface EngineConfig {
  spreadsheetId: string;
  sheetName: string;
  direction: Direction;
  startRow: number;         // 1-based row to start from
  repCode: string;
  managerId: string;
  campaignId: string;
  sniperConfig?: SniperConfig;
  startBookingId?: string;  // Required for Ambush; used as hint for Infiltrate resume
}

export interface EngineSnapshot {
  state: DialerState;
  prefetchState: DialerState | null;
  session: GamificationSession;
  totalGroups: number;
  availableGroups: number;
}

export interface PrepayPending {
  sheetName: string;
  groupDataIndices: number[];
  phone: string;
  extra: DispositionExtra;
  dataStartRow: number;
  gamContext: DispositionContext;
  yesStartTime: number;
}

// =============================================================================
// ENGINE STATE
// =============================================================================

interface CachedSheetData {
  spreadsheetId: string;
  sheetName: string;
  sniperConfigHash: string;
  headers: any[];
  CI: ColumnIndices;
  dataStartRow: number;
  all: any[][];
  groups: ClientGroup[];
  available: ClientGroup[];
  sheetTabId: number;
  timestamp: number;
  // Infiltrate: the firstRow of the window we started from — used for wrap
  infiltrateWindowStart: number;
  // Ambush: the firstRow we started from — used to detect full loop completion
  ambushStartRow: number;
}

let cachedSheet: CachedSheetData | null = null;
let pendingPrepay: PrepayPending | null = null;

let highlightedRows: { current: number[]; next: number[] } = { current: [], next: [] };

// =============================================================================
// SESSION ROW
// =============================================================================

let activeSessionRowId: string | null = null;

// =============================================================================
// RESUME POSITION
// =============================================================================

let resumeTab: string = '';
let resumePosition: string = '';

export function setResumePosition(tab: string, bookingId: string, firstRow?: number): void {
  resumeTab = tab;
  resumePosition = bookingId || (firstRow ? `ROW:${firstRow}` : '');
}

// =============================================================================
// DATA LOADING
// =============================================================================

async function loadSheetData(
  spreadsheetId: string,
  sheetName: string,
  sniperConfig?: SniperConfig
): Promise<CachedSheetData> {
  const configHash = JSON.stringify(sniperConfig || DEFAULT_SNIPER_CONFIG);

  if (
    cachedSheet &&
    cachedSheet.spreadsheetId === spreadsheetId &&
    cachedSheet.sheetName === sheetName &&
    cachedSheet.sniperConfigHash === configHash &&
    Date.now() - cachedSheet.timestamp < 30000
  ) {
    return cachedSheet;
  }

  const range = `'${sheetName}'`;
  const rawData = await dialerSheetsService.sheetsGet(spreadsheetId, range);
  if (!rawData || rawData.length < 2) {
    throw new Error(`Sheet "${sheetName}" has no data rows.`);
  }

  const { headerRowIndex, CI } = findHeaders(rawData);
  if (CI.PHONE < 0) {
    throw new Error('No PHONE column found in headers.');
  }

  const headers = rawData[headerRowIndex];
  const dataStartRow = headerRowIndex + 2;
  const all = rawData.slice(headerRowIndex + 1);

  const emptyHidden = new Set<number>();
  const allGroups = buildGroups(all, CI, emptyHidden, dataStartRow);

  const config = sniperConfig || DEFAULT_SNIPER_CONFIG;
  const sniperFiltered = sniperFilterGroups(allGroups, all, CI, config);
  const available = filterAvailable(sniperFiltered, all, CI);

  let sheetTabId = 0;
  try {
    const tabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
    const tab = tabs.find((t) => t.title === sheetName);
    if (tab) sheetTabId = tab.sheetId;
  } catch {
    // Non-critical
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
    infiltrateWindowStart: 0,
    ambushStartRow: 0,
  };

  return cachedSheet;
}

export function invalidateCache(): void {
  cachedSheet = null;
}

// =============================================================================
// PHONE HIGHLIGHTING
// =============================================================================

async function highlightPhones(
  sheet: CachedSheetData,
  currentRows: number[],
  nextRows: number[]
): Promise<void> {
  if (sheet.CI.PHONE < 0) return;

  const phoneCol = sheet.CI.PHONE;
  const requests: any[] = [];

  const allPrevRows = [...highlightedRows.current, ...highlightedRows.next];
  for (const row of allPrevRows) {
    const dataIdx = row - sheet.dataStartRow;
    if (dataIdx < 0) continue;
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheet.sheetTabId,
          startRowIndex: row - 1,
          endRowIndex: row,
          startColumnIndex: phoneCol,
          endColumnIndex: phoneCol + 1,
        },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

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
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.839, blue: 0 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

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
        cell: { userEnteredFormat: { backgroundColor: { red: 0, green: 0.69, blue: 1 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  if (requests.length === 0) return;

  highlightedRows = { current: [...currentRows], next: [...nextRows] };

  try {
    await dialerSheetsService.sheetsFormatBatch(sheet.spreadsheetId, requests);
  } catch {
    // Silent fail
  }
}

// =============================================================================
// INITIALIZE
// =============================================================================

export async function initialize(config: EngineConfig): Promise<EngineSnapshot | null> {
  const sheet = await loadSheetData(
    config.spreadsheetId,
    config.sheetName,
    config.sniperConfig
  );

  if (sheet.available.length === 0) {
    return null;
  }

  // ── AMBUSH ──────────────────────────────────────────────────────────────────
  // Must have a valid Booking ID. Validate it exists and resolve to a row.
  if (config.direction === 'ambush') {
    const bid = (config.startBookingId || '').trim();
    if (!bid) {
      throw new Error('AMBUSH requires a Booking ID. Please enter a Booking ID to start from.');
    }
    if (sheet.CI.BOOKING_ID < 0) {
      throw new Error('No Booking ID column found in this sheet. Cannot use AMBUSH mode.');
    }

    // Find the row matching this Booking ID
    let ambushRow = -1;
    for (let r = 0; r < sheet.all.length; r++) {
      const rowBid = String(sheet.all[r][sheet.CI.BOOKING_ID] ?? '').trim();
      if (rowBid === bid) {
        ambushRow = r + sheet.dataStartRow;
        break;
      }
    }

    if (ambushRow < 0) {
      throw new Error(`Booking ID "${bid}" not found in this sheet. Please check and try again.`);
    }

    // Store where Ambush started so the engine can detect a full loop
    sheet.ambushStartRow = ambushRow;

    const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
    const group = findNextGroup(ordered, ambushRow, config.direction);

    if (!group) {
      // The booking ID exists but there are no available groups at or after it —
      // wrap immediately to the top
      const wrappedGroup = ordered[0] ?? null;
      if (!wrappedGroup) return null;
      return buildSnapshot(sheet, wrappedGroup, config);
    }

    const session = await loadOrCreateSession(config);
    const snapshot = await buildSnapshot(sheet, group, config, session);
    return snapshot;
  }

  // ── INFILTRATE ───────────────────────────────────────────────────────────────
  // Find the 20-raw-row window with the lowest average NA count and start there.
  if (config.direction === 'infiltrate') {
    let startRow: number;

    // If resuming with a specific row hint, honour it
    if (config.startBookingId && sheet.CI.BOOKING_ID >= 0) {
      const bid = config.startBookingId.trim();
      let found = -1;
      for (let r = 0; r < sheet.all.length; r++) {
        const rowBid = String(sheet.all[r][sheet.CI.BOOKING_ID] ?? '').trim();
        if (rowBid === bid) { found = r + sheet.dataStartRow; break; }
      }
      startRow = found > 0 ? found : findInfiltrateStart(sheet.available, sheet.all, sheet.CI, sheet.dataStartRow);
    } else {
      startRow = findInfiltrateStart(sheet.available, sheet.all, sheet.CI, sheet.dataStartRow);
    }

    // Store the window start for wrap-around
    sheet.infiltrateWindowStart = startRow;

    const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
    const group = findNextGroup(ordered, startRow, config.direction);
    if (!group) return null;

    const session = await loadOrCreateSession(config);
    return buildSnapshot(sheet, group, config, session);
  }

  // ── SIEGE ────────────────────────────────────────────────────────────────────
  // Tier-sorted. Start from afterRow = config.startRow (typically 2 = top).
  {
    const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
    const group = findNextGroup(ordered, config.startRow, config.direction);
    if (!group) return null;

    const session = await loadOrCreateSession(config);
    return buildSnapshot(sheet, group, config, session);
  }
}

// =============================================================================
// BUILD SNAPSHOT HELPER
// =============================================================================

async function buildSnapshot(
  sheet: CachedSheetData,
  group: ClientGroup,
  config: EngineConfig,
  session?: GamificationSession
): Promise<EngineSnapshot> {
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

  const resolvedSession = session ?? await loadOrCreateSession(config);

  const prefetchState = getPrefetchState(sheet, state, config.direction);
  highlightPhones(sheet, state.rows, prefetchState?.rows || []);

  return {
    state,
    prefetchState,
    session: resolvedSession,
    totalGroups: sheet.groups.length,
    availableGroups: sheet.available.length,
  };
}

// =============================================================================
// NAVIGATION
// =============================================================================

export async function getNextState(
  config: EngineConfig,
  afterRow: number
): Promise<DialerStateResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig);

  const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
  let group = findNextGroup(ordered, afterRow, config.direction);

  // ── WRAP LOGIC ─────────────────────────────────────────────────────────────

  if (!group) {
    if (config.direction === 'siege') {
      // Siege never wraps — mission complete
      return { found: false, message: 'All targets neutralized. Mission complete.' };
    }

    if (config.direction === 'ambush') {
      // Wrap to the very top of the available list
      group = ordered[0] ?? null;
      if (!group) return { found: false, message: 'No available groups found.' };

      // Check if we've looped back past our original start point
      // (i.e. the group we just wrapped to is at or past ambushStartRow)
      // The full loop is complete when we've come back around — return mission complete
      if (sheet.ambushStartRow > 0 && group.firstRow >= sheet.ambushStartRow) {
        return { found: false, message: 'Full loop complete. Mission accomplished.' };
      }
    }

    if (config.direction === 'infiltrate') {
      // Wrap back to the top of the winning window
      const windowRow = sheet.infiltrateWindowStart > 0
        ? sheet.infiltrateWindowStart
        : ordered[0]?.firstRow ?? sheet.dataStartRow;

      group = findNextGroup(ordered, windowRow, config.direction);
      if (!group) group = ordered[0] ?? null;
      if (!group) return { found: false, message: 'No available groups found.' };
    }
  } else {
    // Ambush: check if we've advanced past the start point after wrapping
    // (handles the case where we started mid-list and have now returned to start)
    if (config.direction === 'ambush' && sheet.ambushStartRow > 0) {
      // If we've gone below where we started, that's fine — normal forward progress.
      // The full loop detection triggers on the NEXT wrap.
    }
  }

  if (!group) {
    return { found: false, message: 'No more available groups.' };
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
// PREFETCH
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
// DISPOSITION
// =============================================================================

export interface DispositionResult {
  nextState: DialerStateResult;
  gamification: GamificationResult | null;
  redialPhone?: string;
}

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

  if (disposition === 'PREPAY') {
    const gamCtx = buildGamificationContext(state, disposition, extra, yesStartTime);
    pendingPrepay = {
      sheetName: config.sheetName,
      groupDataIndices: state.dataIndices,
      phone,
      extra,
      dataStartRow: sheet.dataStartRow,
      gamContext: gamCtx,
      yesStartTime: yesStartTime || 0,
    };
    return { nextState: state, gamification: null };
  }

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

  if (dispResult.updates.length > 0) {
    const sheetsData = cellUpdatesToSheetsData(config.sheetName, dispResult.updates);
    await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);

    for (const u of dispResult.updates) {
      const dataIdx = u.row - sheet.dataStartRow;
      if (dataIdx >= 0 && dataIdx < sheet.all.length) {
        sheet.all[dataIdx][u.col] = u.value;
      }
    }
  }

  if (dispResult.redial) {
    const gamCtx = buildGamificationContext(state, disposition, extra, yesStartTime);
    const gamResult = processGamification(session, disposition, gamCtx);
    await saveSession(session);

    return {
      nextState: { found: true, ...state, phone: dispResult.redial.newPhone } as DialerState,
      gamification: gamResult,
      redialPhone: dispResult.redial.newPhone,
    };
  }

  const gamCtx = buildGamificationContext(state, disposition, extra, yesStartTime);
  const gamResult = processGamification(session, disposition, gamCtx);
  await saveSession(session);

  sheet.available = filterAvailable(sheet.groups, sheet.all, sheet.CI);
  sheet.timestamp = Date.now();

  const afterRow = nextAfterRow(state.rows, config.direction);
  const nextStateResult = await getNextState(config, afterRow);

  if (nextStateResult.found) {
    const ns = nextStateResult as DialerState;
    const prefetch = getPrefetchState(sheet, ns, config.direction);
    highlightPhones(sheet, ns.rows, prefetch?.rows || []);
  }

  return { nextState: nextStateResult, gamification: gamResult };
}

// =============================================================================
// PREPAY FLOW
// =============================================================================

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

  if (cardData.amount) {
    pp.extra.price = cardData.amount;
  }

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

    for (const u of dispResult.updates) {
      const dataIdx = u.row - sheet.dataStartRow;
      if (dataIdx >= 0 && dataIdx < sheet.all.length) {
        sheet.all[dataIdx][u.col] = u.value;
      }
    }
  }

  const gamCtx = { ...pp.gamContext, price: parseFloat(pp.extra.price || '0') || 0 };
  const gamResult = processGamification(session, 'PREPAY', gamCtx);
  await saveSession(session);

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

  pendingPrepay = null;

  sheet.available = filterAvailable(sheet.groups, sheet.all, sheet.CI);
  sheet.timestamp = Date.now();

  const afterRow = nextAfterRow(
    pp.groupDataIndices.map((r) => r + pp.dataStartRow),
    config.direction
  );
  const nextStateResult = await getNextState(config, afterRow);

  if (nextStateResult.found) {
    const ns = nextStateResult as DialerState;
    const prefetch = getPrefetchState(sheet, ns, config.direction);
    highlightPhones(sheet, ns.rows, prefetch?.rows || []);
  }

  return { nextState: nextStateResult, gamification: gamResult };
}

export function cancelPrepay(): void {
  pendingPrepay = null;
}

export function hasPendingPrepay(): boolean {
  return pendingPrepay !== null;
}

// =============================================================================
// STREET CLEARED CHECK
// =============================================================================

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
// YEAR DISCOVERY
// =============================================================================

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
// SESSION PERSISTENCE
// =============================================================================

async function loadOrCreateSession(config: EngineConfig): Promise<GamificationSession> {
  const today = getTodayEST();

  try {
    const dbSession = await campaignService.getOrCreateTodaySession(
      config.campaignId,
      config.managerId
    );

    activeSessionRowId = dbSession.id;

    const stored = dbSession.gamificationState;

    if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
      const restored = stored as GamificationSession;
      if (restored.date === today) {
        return migrateSession(restored, config.repCode, today);
      }
    }

    const fresh = createFreshSession(config.repCode, today);
    fresh.sessionStartTime = Date.now();
    return fresh;

  } catch (err) {
    console.warn('Failed to load session from Supabase, starting fresh in-memory:', err);
    activeSessionRowId = null;
    const fresh = createFreshSession(config.repCode, today);
    fresh.sessionStartTime = Date.now();
    return fresh;
  }
}

async function saveSession(session: GamificationSession): Promise<void> {
  if (!activeSessionRowId) return;

  try {
    const stateWithResume: any = {
      ...session,
      _resumeTab: resumeTab || undefined,
      _resumePosition: resumePosition || undefined,
    };

    await campaignService.upsertGamificationState(activeSessionRowId, stateWithResume);
  } catch (err) {
    console.warn('Session save to Supabase failed (non-critical):', err);
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
// EXPORTS
// =============================================================================

export type { DialerState, DialerStateResult } from './dialerStateBuilder';
export type { Direction } from './dialerGroupBuilder';
export type { DispositionType, DispositionExtra } from './dialerDispositions';
export type { GamificationSession } from './gamificationDefs';
export type { GamificationResult, MultiplierSnapshot } from './gamificationEngine';
export { getCurrentRank, createFreshSession } from './gamificationDefs';
export { getActiveMultipliers } from './gamificationEngine';
export { formatPhoneDisplay } from './dialerUtils';
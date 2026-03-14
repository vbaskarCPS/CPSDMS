// src/lib/dialer/dialerEngine.ts
//
// AutoSniper Dialer — main engine orchestrator.
//
// Direction modes:
//   ambush    — start at user Booking ID, call down, wrap to top, full loop
//   infiltrate — find best 20-raw-row window (lowest avg NA), call down, wrap to window top
//   siege     — tier-sorted (blanks → 1s → 2s…), no wrap, mission complete when exhausted
//
// City mode: when cityTabs + cityName are set in EngineConfig, the engine
// loads rows from ALL cityTabs, filters to only rows matching cityName in the
// CITY column, merges them into a single ordered group list, and dials through
// that merged list. When exhausted, returns mission complete.
//

import { resolveHeaders, findHeaders, applyBCFixedColumns, ColumnIndices } from './dialerHeaders';
import {
  buildGroups,
  sniperFilterGroups,
  filterAvailable,
  applyOrdering,
  findNextGroup,
  findSiegeIndexByRow,
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
import type { SniperConfig, CampaignType } from '../campaignService';
import { DEFAULT_SNIPER_CONFIG } from '../campaignService';

// =============================================================================
// TYPES
// =============================================================================

export interface EngineConfig {
  spreadsheetId: string;
  sheetName: string;
  direction: Direction;
  startRow: number;
  repCode: string;
  managerId: string;
  campaignId: string;
  sniperConfig?: SniperConfig;
  startBookingId?: string;
  campaignType?: CampaignType;
  cityName?: string;
  cityTabs?: string[];
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
  sourceTab?: string;
}

// =============================================================================
// CACHED SHEET DATA — single tab
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
  infiltrateWindowStart: number;
  ambushStartRow: number;
  siegeIndex: number;
}

// =============================================================================
// CACHED CITY DATA — merged across tabs
// =============================================================================

interface TabSlice {
  tabName: string;
  headers: any[];
  CI: ColumnIndices;
  dataStartRow: number;
  all: any[][];
  sheetTabId: number;
}

interface CachedCityData {
  spreadsheetId: string;
  cityName: string;
  sniperConfigHash: string;
  timestamp: number;
  mergedAll: any[][];
  mergedCI: ColumnIndices;
  mergedDataStartRow: number;
  rowToTab: string[];
  rowToRealSheetRow: number[];
  tabSlices: TabSlice[];
  groups: ClientGroup[];
  available: ClientGroup[];
  infiltrateWindowStart: number;
  siegeIndex: number;
}

// =============================================================================
// MODULE STATE
// =============================================================================

let cachedSheet: CachedSheetData | null = null;
let cachedCity: CachedCityData | null = null;
let pendingPrepay: PrepayPending | null = null;
let highlightedRows: { current: number[]; next: number[] } = { current: [], next: [] };
let activeSessionRowId: string | null = null;
let resumeTab: string = '';
let resumePosition: string = '';
let resumeBookId: string = '';

// =============================================================================
// RESUME POSITION
// =============================================================================

export function setResumePosition(tab: string, bookingId: string, firstRow?: number, bookId?: string): void {
  resumeTab = tab;
  resumePosition = bookingId || (firstRow ? `ROW:${firstRow}` : '');
  if (bookId !== undefined) resumeBookId = bookId;
}

// =============================================================================
// CACHE INVALIDATION
// =============================================================================

export function invalidateCache(): void {
  cachedSheet = null;
  cachedCity = null;
}

// =============================================================================
// SINGLE-TAB DATA LOADING
// =============================================================================

async function loadSheetData(
  spreadsheetId: string,
  sheetName: string,
  sniperConfig?: SniperConfig,
  campaignType?: CampaignType
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

  if (campaignType === 'bc') {
    applyBCFixedColumns(CI);
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
    siegeIndex: 0,
  };

  return cachedSheet;
}

// =============================================================================
// CITY DATA LOADING — merges rows from all tabs filtered by city
// =============================================================================

async function loadCityData(
  spreadsheetId: string,
  cityName: string,
  cityTabs: string[],
  sniperConfig?: SniperConfig,
  campaignType?: CampaignType
): Promise<CachedCityData> {
  const configHash = JSON.stringify(sniperConfig || DEFAULT_SNIPER_CONFIG);

  if (
    cachedCity &&
    cachedCity.spreadsheetId === spreadsheetId &&
    cachedCity.cityName === cityName &&
    cachedCity.sniperConfigHash === configHash &&
    Date.now() - cachedCity.timestamp < 30000
  ) {
    return cachedCity;
  }

  const config = sniperConfig || DEFAULT_SNIPER_CONFIG;
  const tabSlices: TabSlice[] = [];

  for (const tabName of cityTabs) {
    try {
      const rawData = await dialerSheetsService.sheetsGet(spreadsheetId, `'${tabName}'`);
      if (!rawData || rawData.length < 2) continue;

      const { headerRowIndex, CI } = findHeaders(rawData);
      if (CI.PHONE < 0) continue;

      if (campaignType === 'bc') {
        applyBCFixedColumns(CI);
      }

      const headers = rawData[headerRowIndex];
      const dataStartRow = headerRowIndex + 2;
      const all = rawData.slice(headerRowIndex + 1);

      let sheetTabId = 0;
      try {
        const tabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
        const tab = tabs.find((t) => t.title === tabName);
        if (tab) sheetTabId = tab.sheetId;
      } catch { /* Non-critical */ }

      tabSlices.push({ tabName, headers, CI, dataStartRow, all, sheetTabId });
    } catch {
      // Skip tabs that fail to load
    }
  }

  if (tabSlices.length === 0) {
    throw new Error(`No tabs could be loaded for city "${cityName}".`);
  }

  const mergedCI = tabSlices[0].CI;
  const mergedAll: any[][] = [];
  const rowToTab: string[] = [];
  const rowToRealSheetRow: number[] = [];
  const mergedDataStartRow = 2;

  for (const slice of tabSlices) {
    for (let r = 0; r < slice.all.length; r++) {
      const row = slice.all[r];
      if (slice.CI.CITY >= 0) {
        const rowCity = String(row[slice.CI.CITY] ?? '').trim().toLowerCase();
        if (rowCity !== cityName.trim().toLowerCase()) continue;
      } else {
        continue;
      }
      mergedAll.push(row);
      rowToTab.push(slice.tabName);
      rowToRealSheetRow.push(r + slice.dataStartRow);
    }
  }

  if (mergedAll.length === 0) {
    throw new Error(`No rows found for city "${cityName}".`);
  }

  const emptyHidden = new Set<number>();
  const allGroups = buildGroups(mergedAll, mergedCI, emptyHidden, mergedDataStartRow);
  const sniperFiltered = sniperFilterGroups(allGroups, mergedAll, mergedCI, config);
  const available = filterAvailable(sniperFiltered, mergedAll, mergedCI);

  cachedCity = {
    spreadsheetId,
    cityName,
    sniperConfigHash: configHash,
    timestamp: Date.now(),
    mergedAll,
    mergedCI,
    mergedDataStartRow,
    rowToTab,
    rowToRealSheetRow,
    tabSlices,
    groups: sniperFiltered,
    available,
    infiltrateWindowStart: 0,
    siegeIndex: 0,
  };

  return cachedCity;
}

// =============================================================================
// PHONE HIGHLIGHTING
// =============================================================================

async function highlightPhones(
  spreadsheetId: string,
  sheetTabId: number,
  phoneCol: number,
  currentRows: number[],
  nextRows: number[]
): Promise<void> {
  if (phoneCol < 0) return;

  const requests: any[] = [];

  const allPrevRows = [...highlightedRows.current, ...highlightedRows.next];
  for (const row of allPrevRows) {
    requests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: phoneCol, endColumnIndex: phoneCol + 1 },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  for (const row of currentRows) {
    requests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: phoneCol, endColumnIndex: phoneCol + 1 },
        cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 0.839, blue: 0 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  for (const row of nextRows) {
    requests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: phoneCol, endColumnIndex: phoneCol + 1 },
        cell: { userEnteredFormat: { backgroundColor: { red: 0, green: 0.69, blue: 1 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  if (requests.length === 0) return;
  highlightedRows = { current: [...currentRows], next: [...nextRows] };

  try {
    await dialerSheetsService.sheetsFormatBatch(spreadsheetId, requests);
  } catch {
    // Silent fail
  }
}

async function highlightPhonesFromSheet(
  sheet: CachedSheetData,
  currentRows: number[],
  nextRows: number[]
): Promise<void> {
  if (sheet.CI.PHONE < 0) return;
  await highlightPhones(sheet.spreadsheetId, sheet.sheetTabId, sheet.CI.PHONE, currentRows, nextRows);
}

async function highlightPhonesFromCity(
  city: CachedCityData,
  currentMergedRows: number[],
  nextMergedRows: number[]
): Promise<void> {
  if (city.mergedCI.PHONE < 0) return;

  const tabBatches = new Map<string, { current: number[]; next: number[] }>();

  for (const mergedRow of currentMergedRows) {
    const dataIdx = mergedRow - city.mergedDataStartRow;
    if (dataIdx < 0 || dataIdx >= city.rowToTab.length) continue;
    const tabName = city.rowToTab[dataIdx];
    const realRow = city.rowToRealSheetRow[dataIdx];
    if (!tabBatches.has(tabName)) tabBatches.set(tabName, { current: [], next: [] });
    tabBatches.get(tabName)!.current.push(realRow);
  }

  for (const mergedRow of nextMergedRows) {
    const dataIdx = mergedRow - city.mergedDataStartRow;
    if (dataIdx < 0 || dataIdx >= city.rowToTab.length) continue;
    const tabName = city.rowToTab[dataIdx];
    const realRow = city.rowToRealSheetRow[dataIdx];
    if (!tabBatches.has(tabName)) tabBatches.set(tabName, { current: [], next: [] });
    tabBatches.get(tabName)!.next.push(realRow);
  }

  for (const [tabName, batch] of tabBatches) {
    const slice = city.tabSlices.find(s => s.tabName === tabName);
    if (!slice) continue;
    await highlightPhones(city.spreadsheetId, slice.sheetTabId, city.mergedCI.PHONE, batch.current, batch.next);
  }
}

// =============================================================================
// INITIALIZE
// =============================================================================

export async function initialize(config: EngineConfig): Promise<EngineSnapshot | null> {

  if (config.cityName && config.cityTabs && config.cityTabs.length > 0) {
    return initializeCity(config);
  }

  const sheet = await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig, config.campaignType);

  if (sheet.available.length === 0) return null;

  if (config.direction === 'ambush') {
    const bid = (config.startBookingId || '').trim();
    if (!bid) throw new Error('AMBUSH requires a Booking ID. Please enter a Booking ID to start from.');
    if (sheet.CI.BOOKING_ID < 0) throw new Error('No Booking ID column found in this sheet. Cannot use AMBUSH mode.');

    let ambushRow = -1;
    for (let r = 0; r < sheet.all.length; r++) {
      const rowBid = String(sheet.all[r][sheet.CI.BOOKING_ID] ?? '').trim();
      if (rowBid === bid) { ambushRow = r + sheet.dataStartRow; break; }
    }
    if (ambushRow < 0) throw new Error(`Booking ID "${bid}" not found in this sheet. Please check and try again.`);

    sheet.ambushStartRow = ambushRow;
    const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
    const group = findNextGroup(ordered, ambushRow, config.direction);

    if (!group) {
      const wrappedGroup = ordered[0] ?? null;
      if (!wrappedGroup) return null;
      return buildSnapshotFromSheet(sheet, wrappedGroup, config);
    }

    const session = await loadOrCreateSession(config);
    return buildSnapshotFromSheet(sheet, group, config, session);
  }

  if (config.direction === 'infiltrate') {
    let startRow: number;
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

    sheet.infiltrateWindowStart = startRow;
    const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
    const group = findNextGroup(ordered, startRow, config.direction);
    if (!group) return null;

    const session = await loadOrCreateSession(config);
    return buildSnapshotFromSheet(sheet, group, config, session);
  }

  // Siege
  {
    sheet.siegeIndex = 0;
    const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
    const group = findNextGroup(ordered, config.startRow, config.direction, 0);
    if (!group) return null;

    const session = await loadOrCreateSession(config);
    const storedIndex = (session as any)._siegeIndex;
    if (typeof storedIndex === 'number' && storedIndex > 0 && storedIndex < ordered.length) {
      sheet.siegeIndex = storedIndex;
      const resumedGroup = ordered[storedIndex];
      if (!resumedGroup) return null;
      return buildSnapshotFromSheet(sheet, resumedGroup, config, session);
    }

    return buildSnapshotFromSheet(sheet, group, config, session);
  }
}

// =============================================================================
// INITIALIZE — CITY MODE
// =============================================================================

async function initializeCity(config: EngineConfig): Promise<EngineSnapshot | null> {
  const city = await loadCityData(
    config.spreadsheetId,
    config.cityName!,
    config.cityTabs!,
    config.sniperConfig,
    config.campaignType
  );

  if (city.available.length === 0) return null;

  if (config.direction === 'infiltrate') {
    const startRow = findInfiltrateStart(
      city.available, city.mergedAll, city.mergedCI, city.mergedDataStartRow
    );
    city.infiltrateWindowStart = startRow;
    const ordered = applyOrdering(city.available, city.mergedAll, city.mergedCI, 'infiltrate');
    const group = findNextGroup(ordered, startRow, 'infiltrate');
    if (!group) return null;

    const session = await loadOrCreateSession(config);
    return buildSnapshotFromCity(city, group, config, session);
  }

  // Siege
  {
    city.siegeIndex = 0;
    const ordered = applyOrdering(city.available, city.mergedAll, city.mergedCI, 'siege');
    const group = findNextGroup(ordered, city.mergedDataStartRow, 'siege', 0);
    if (!group) return null;

    const session = await loadOrCreateSession(config);
    const storedIndex = (session as any)._siegeIndex;
    if (typeof storedIndex === 'number' && storedIndex > 0 && storedIndex < ordered.length) {
      city.siegeIndex = storedIndex;
      const resumedGroup = ordered[storedIndex];
      if (!resumedGroup) return null;
      return buildSnapshotFromCity(city, resumedGroup, config, session);
    }

    return buildSnapshotFromCity(city, group, config, session);
  }
}

// =============================================================================
// BUILD SNAPSHOT HELPERS
// =============================================================================

async function buildSnapshotFromSheet(
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
    group.rows, sheet.all, sheet.CI, config.sheetName,
    currentGroupIndex, sheet.groups.length, sheet.dataStartRow
  );

  const resolvedSession = session ?? await loadOrCreateSession(config);
  const prefetchState = getPrefetchStateFromSheet(sheet, state, config.direction);
  highlightPhonesFromSheet(sheet, state.rows, prefetchState?.rows || []);

  return {
    state,
    prefetchState,
    session: resolvedSession,
    totalGroups: sheet.groups.length,
    availableGroups: sheet.available.length,
  };
}

async function buildSnapshotFromCity(
  city: CachedCityData,
  group: ClientGroup,
  config: EngineConfig,
  session?: GamificationSession
): Promise<EngineSnapshot> {
  let currentGroupIndex = 0;
  for (let i = 0; i < city.groups.length; i++) {
    if (city.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  const displayName = config.cityName || config.sheetName;

  const state = buildState(
    group.rows, city.mergedAll, city.mergedCI, displayName,
    currentGroupIndex, city.groups.length, city.mergedDataStartRow
  );

  const resolvedSession = session ?? await loadOrCreateSession(config);
  const prefetchState = getPrefetchStateFromCity(city, state, config.direction);
  highlightPhonesFromCity(city, state.rows, prefetchState?.rows || []);

  return {
    state,
    prefetchState,
    session: resolvedSession,
    totalGroups: city.groups.length,
    availableGroups: city.available.length,
  };
}

// =============================================================================
// NAVIGATION
// =============================================================================

export async function getNextState(
  config: EngineConfig,
  afterRow: number
): Promise<DialerStateResult> {

  if (config.cityName && config.cityTabs) {
    return getNextStateCity(config, afterRow);
  }

  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig, config.campaignType);
  const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, config.direction);
  let group: ClientGroup | null = null;

  if (config.direction === 'siege') {
    sheet.siegeIndex = sheet.siegeIndex + 1;
    group = findNextGroup(ordered, afterRow, config.direction, sheet.siegeIndex);
  } else {
    group = findNextGroup(ordered, afterRow, config.direction);
  }

  if (!group) {
    if (config.direction === 'siege') return { found: false, message: 'All targets neutralized. Mission complete.' };
    if (config.direction === 'ambush') {
      group = ordered[0] ?? null;
      if (!group) return { found: false, message: 'No available groups found.' };
      if (sheet.ambushStartRow > 0 && group.firstRow >= sheet.ambushStartRow) {
        return { found: false, message: 'Full loop complete. Mission accomplished.' };
      }
    }
    if (config.direction === 'infiltrate') {
      const windowRow = sheet.infiltrateWindowStart > 0 ? sheet.infiltrateWindowStart : ordered[0]?.firstRow ?? sheet.dataStartRow;
      group = findNextGroup(ordered, windowRow, config.direction);
      if (!group) group = ordered[0] ?? null;
      if (!group) return { found: false, message: 'No available groups found.' };
    }
  }

  if (!group) return { found: false, message: 'No more available groups.' };

  let currentGroupIndex = 0;
  for (let i = 0; i < sheet.groups.length; i++) {
    if (sheet.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  return buildState(group.rows, sheet.all, sheet.CI, config.sheetName, currentGroupIndex, sheet.groups.length, sheet.dataStartRow);
}

async function getNextStateCity(config: EngineConfig, afterRow: number): Promise<DialerStateResult> {
  const city = cachedCity || await loadCityData(config.spreadsheetId, config.cityName!, config.cityTabs!, config.sniperConfig, config.campaignType);
  const ordered = applyOrdering(city.available, city.mergedAll, city.mergedCI, config.direction);
  let group: ClientGroup | null = null;

  if (config.direction === 'siege') {
    city.siegeIndex = city.siegeIndex + 1;
    group = findNextGroup(ordered, afterRow, 'siege', city.siegeIndex);
    if (!group) return { found: false, message: 'All targets neutralized. Mission complete.' };
  } else {
    group = findNextGroup(ordered, afterRow, 'infiltrate');
    if (!group) {
      const windowRow = city.infiltrateWindowStart > 0 ? city.infiltrateWindowStart : ordered[0]?.firstRow ?? city.mergedDataStartRow;
      group = findNextGroup(ordered, windowRow, 'infiltrate');
      if (!group) group = ordered[0] ?? null;
      if (!group) return { found: false, message: 'No available groups found.' };
    }
  }

  let currentGroupIndex = 0;
  for (let i = 0; i < city.groups.length; i++) {
    if (city.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  const displayName = config.cityName || config.sheetName;
  return buildState(group.rows, city.mergedAll, city.mergedCI, displayName, currentGroupIndex, city.groups.length, city.mergedDataStartRow);
}

export async function findGroupByBookingId(config: EngineConfig, bookingId: string): Promise<DialerStateResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig, config.campaignType);
  if (sheet.CI.BOOKING_ID < 0) return { found: false, message: 'No Booking ID column found.' };

  for (let r = 0; r < sheet.all.length; r++) {
    const bid = String(sheet.all[r][sheet.CI.BOOKING_ID] ?? '').trim();
    if (bid === bookingId) {
      const afterRow = r + sheet.dataStartRow;
      return getNextState(config, afterRow);
    }
  }
  return { found: false, message: `Booking ID "${bookingId}" not found.` };
}

export async function findGroupByPhone(config: EngineConfig, phone: string): Promise<DialerStateResult> {
  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig, config.campaignType);
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

function getPrefetchStateFromSheet(
  sheet: CachedSheetData,
  currentState: DialerState,
  direction: Direction
): DialerState | null {
  const afterRow = nextAfterRow(currentState.rows, direction);
  const ordered = applyOrdering(sheet.available, sheet.all, sheet.CI, direction);

  let group: ClientGroup | null = null;
  if (direction === 'siege') {
    const peekIndex = sheet.siegeIndex + 1;
    group = peekIndex < ordered.length ? ordered[peekIndex] : null;
  } else {
    group = findNextGroup(ordered, afterRow, direction);
  }
  if (!group) return null;

  let currentGroupIndex = 0;
  for (let i = 0; i < sheet.groups.length; i++) {
    if (sheet.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }
  return buildState(group.rows, sheet.all, sheet.CI, sheet.sheetName, currentGroupIndex, sheet.groups.length, sheet.dataStartRow);
}

function getPrefetchStateFromCity(
  city: CachedCityData,
  currentState: DialerState,
  direction: Direction
): DialerState | null {
  const afterRow = nextAfterRow(currentState.rows, direction);
  const ordered = applyOrdering(city.available, city.mergedAll, city.mergedCI, direction);

  let group: ClientGroup | null = null;
  if (direction === 'siege') {
    const peekIndex = city.siegeIndex + 1;
    group = peekIndex < ordered.length ? ordered[peekIndex] : null;
  } else {
    group = findNextGroup(ordered, afterRow, direction);
  }
  if (!group) return null;

  let currentGroupIndex = 0;
  for (let i = 0; i < city.groups.length; i++) {
    if (city.groups[i].firstRow === group.firstRow) { currentGroupIndex = i + 1; break; }
  }

  const displayName = currentState.sheetName;
  return buildState(group.rows, city.mergedAll, city.mergedCI, displayName, currentGroupIndex, city.groups.length, city.mergedDataStartRow);
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

  if (config.cityName && config.cityTabs) {
    return applyDispositionCity(config, state, disposition, phone, session, extra, yesStartTime);
  }

  const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig, config.campaignType);

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
    disposition, sheet.all, sheet.CI, state.dataIndices, sheet.dataStartRow, phone, config.repCode, extra
  );

  if (dispResult.updates.length > 0) {
    const sheetsData = cellUpdatesToSheetsData(config.sheetName, dispResult.updates);
    await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);
    for (const u of dispResult.updates) {
      const dataIdx = u.row - sheet.dataStartRow;
      if (dataIdx >= 0 && dataIdx < sheet.all.length) sheet.all[dataIdx][u.col] = u.value;
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
    const prefetch = getPrefetchStateFromSheet(sheet, ns, config.direction);
    highlightPhonesFromSheet(sheet, ns.rows, prefetch?.rows || []);
  }

  return { nextState: nextStateResult, gamification: gamResult };
}

// =============================================================================
// DISPOSITION — CITY MODE
// =============================================================================

async function applyDispositionCity(
  config: EngineConfig,
  state: DialerState,
  disposition: DispositionType,
  phone: string,
  session: GamificationSession,
  extra: DispositionExtra,
  yesStartTime?: number
): Promise<DispositionResult> {
  const city = cachedCity || await loadCityData(config.spreadsheetId, config.cityName!, config.cityTabs!, config.sniperConfig, config.campaignType);

  if (disposition === 'PREPAY') {
    const firstDataIdx = state.dataIndices[0];
    const sourceTab = city.rowToTab[firstDataIdx] || config.sheetName;
    const gamCtx = buildGamificationContext(state, disposition, extra, yesStartTime);
    pendingPrepay = {
      sheetName: sourceTab,
      groupDataIndices: state.dataIndices,
      phone,
      extra,
      dataStartRow: city.mergedDataStartRow,
      gamContext: gamCtx,
      yesStartTime: yesStartTime || 0,
      sourceTab,
    };
    return { nextState: state, gamification: null };
  }

  const updatesByTab = new Map<string, { range: string; values: any[][] }[]>();

  const dispResult = buildDispositionUpdates(
    disposition, city.mergedAll, city.mergedCI, state.dataIndices,
    city.mergedDataStartRow, phone, config.repCode, extra
  );

  if (dispResult.updates.length > 0) {
    for (const u of dispResult.updates) {
      const dataIdx = u.row - city.mergedDataStartRow;
      if (dataIdx < 0 || dataIdx >= city.rowToTab.length) continue;

      const tabName = city.rowToTab[dataIdx];
      const realSheetRow = city.rowToRealSheetRow[dataIdx];

      const colLetter = columnToLetter(u.col + 1);
      const range = `'${tabName}'!${colLetter}${realSheetRow}`;

      if (!updatesByTab.has(tabName)) updatesByTab.set(tabName, []);
      updatesByTab.get(tabName)!.push({ range, values: [[u.value]] });

      city.mergedAll[dataIdx][u.col] = u.value;
    }

    for (const [, sheetsData] of updatesByTab) {
      await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);
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

  city.available = filterAvailable(city.groups, city.mergedAll, city.mergedCI);
  city.timestamp = Date.now();

  const afterRow = nextAfterRow(state.rows, config.direction);
  const nextStateResult = await getNextStateCity(config, afterRow);

  if (nextStateResult.found) {
    const ns = nextStateResult as DialerState;
    const prefetch = getPrefetchStateFromCity(city, ns, config.direction);
    highlightPhonesFromCity(city, ns.rows, prefetch?.rows || []);
  }

  return { nextState: nextStateResult, gamification: gamResult };
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
    return { nextState: { found: false, message: 'No pending prepay to finalize.' }, gamification: null };
  }

  const isCityMode = !!(config.cityName && config.cityTabs);
  const pp = pendingPrepay;

  if (cardData.amount) pp.extra.price = cardData.amount;

  let all: any[][];
  let CI: ColumnIndices;
  let dataStartRow: number;
  let headers: any[];

  if (isCityMode) {
    const city = cachedCity || await loadCityData(config.spreadsheetId, config.cityName!, config.cityTabs!, config.sniperConfig, config.campaignType);
    all = city.mergedAll;
    CI = city.mergedCI;
    dataStartRow = city.mergedDataStartRow;
    const slice = city.tabSlices.find(s => s.tabName === pp.sourceTab) || city.tabSlices[0];
    headers = slice.headers;
  } else {
    const sheet = cachedSheet || await loadSheetData(config.spreadsheetId, config.sheetName, config.sniperConfig, config.campaignType);
    all = sheet.all;
    CI = sheet.CI;
    dataStartRow = sheet.dataStartRow;
    headers = sheet.headers;
  }

  const dispResult = buildDispositionUpdates('PREPAY', all, CI, pp.groupDataIndices, dataStartRow, pp.phone, config.repCode, pp.extra);

  if (dispResult.updates.length > 0) {
    if (isCityMode) {
      const city = cachedCity!;
      const updatesByTab = new Map<string, { range: string; values: any[][] }[]>();
      for (const u of dispResult.updates) {
        const dataIdx = u.row - city.mergedDataStartRow;
        if (dataIdx < 0 || dataIdx >= city.rowToTab.length) continue;
        const tabName = city.rowToTab[dataIdx];
        const realSheetRow = city.rowToRealSheetRow[dataIdx];
        const colLetter = columnToLetter(u.col + 1);
        const range = `'${tabName}'!${colLetter}${realSheetRow}`;
        if (!updatesByTab.has(tabName)) updatesByTab.set(tabName, []);
        updatesByTab.get(tabName)!.push({ range, values: [[u.value]] });
        city.mergedAll[dataIdx][u.col] = u.value;
      }
      for (const [, sheetsData] of updatesByTab) {
        await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);
      }
    } else {
      const sheet = cachedSheet!;
      const sheetsData = cellUpdatesToSheetsData(pp.sheetName, dispResult.updates);
      await dialerSheetsService.sheetsBatchUpdate(config.spreadsheetId, sheetsData);
      for (const u of dispResult.updates) {
        const dataIdx = u.row - sheet.dataStartRow;
        if (dataIdx >= 0 && dataIdx < sheet.all.length) sheet.all[dataIdx][u.col] = u.value;
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

  if (CI.YEAR >= 0) {
    for (const r of pp.groupDataIndices) {
      const yr = parseInt(String(all[r]?.[CI.YEAR] ?? '0'), 10) || 0;
      if (yr > globalBestYear) { globalBestYear = yr; globalBestIdx = r; }
      if (CI.PHONE >= 0) {
        const rowPh = normalizePhone(String(all[r]?.[CI.PHONE] ?? ''));
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
      const sourceRow = all[detailIdx];
      const ccdWrite = buildCCDRow(sourceRow, headers, ccdHeaders, cardData, config.repCode, { email: pp.extra.email, name: pp.extra.name, price: pp.extra.price });
      await dialerSheetsService.sheetsAppend(config.spreadsheetId, `'CCD'!A1`, [ccdWrite.rowValues]);
    }
  } catch (err) {
    console.warn('CCD write failed (CCD tab may not exist):', err);
  }

  pendingPrepay = null;

  if (isCityMode) {
    const city = cachedCity!;
    city.available = filterAvailable(city.groups, city.mergedAll, city.mergedCI);
    city.timestamp = Date.now();
    const afterRow = nextAfterRow(pp.groupDataIndices.map(r => r + city.mergedDataStartRow), config.direction);
    const nextStateResult = await getNextStateCity(config, afterRow);
    if (nextStateResult.found) {
      const ns = nextStateResult as DialerState;
      const prefetch = getPrefetchStateFromCity(city, ns, config.direction);
      highlightPhonesFromCity(city, ns.rows, prefetch?.rows || []);
    }
    return { nextState: nextStateResult, gamification: gamResult };
  } else {
    const sheet = cachedSheet!;
    sheet.available = filterAvailable(sheet.groups, sheet.all, sheet.CI);
    sheet.timestamp = Date.now();
    const afterRow = nextAfterRow(pp.groupDataIndices.map(r => r + pp.dataStartRow), config.direction);
    const nextStateResult = await getNextState(config, afterRow);
    if (nextStateResult.found) {
      const ns = nextStateResult as DialerState;
      const prefetch = getPrefetchStateFromSheet(sheet, ns, config.direction);
      highlightPhonesFromSheet(sheet, ns.rows, prefetch?.rows || []);
    }
    return { nextState: nextStateResult, gamification: gamResult };
  }
}

export function cancelPrepay(): void { pendingPrepay = null; }
export function hasPendingPrepay(): boolean { return pendingPrepay !== null; }

// =============================================================================
// STREET CLEARED CHECK
// =============================================================================

export function checkStreetCleared(state: DialerState): { cleared: boolean; visibleGroupCount: number } {
  const isCityMode = !!cachedCity;

  const all = isCityMode ? cachedCity!.mergedAll : cachedSheet?.all;
  const CI = isCityMode ? cachedCity!.mergedCI : cachedSheet?.CI;
  const groups = isCityMode ? cachedCity!.groups : cachedSheet?.groups;

  if (!all || !CI || !groups) return { cleared: false, visibleGroupCount: 0 };

  const streetKey = state.streetKey;
  if (!streetKey) return { cleared: false, visibleGroupCount: 0 };

  const streetGroups: ClientGroup[] = [];
  for (const group of groups) {
    let inStreet = false;
    for (const r of group.rows) {
      const s = CI.STREET >= 0 ? String(all[r]?.[CI.STREET] ?? '').trim() : '';
      const rc = CI.ROUTE_CODE >= 0 ? String(all[r]?.[CI.ROUTE_CODE] ?? '').trim() : '';
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
      if (CI.YES >= 0 && String(all[r]?.[CI.YES] ?? '').trim() !== '') { hasDisposition = true; break; }
      if (CI.NO >= 0 && String(all[r]?.[CI.NO] ?? '').trim() !== '') { hasDisposition = true; break; }
      if (CI.WN >= 0 && String(all[r]?.[CI.WN] ?? '').trim() !== '') { hasDisposition = true; break; }
      if (CI.REMOVE >= 0 && String(all[r]?.[CI.REMOVE] ?? '').trim() !== '') { hasDisposition = true; break; }
    }
    if (!hasDisposition) { allCleared = false; break; }
  }

  return { cleared: allCleared, visibleGroupCount: streetGroups.length };
}

// =============================================================================
// YEAR DISCOVERY
// =============================================================================

export async function discoverAvailableYears(spreadsheetId: string, sheetName: string): Promise<number[]> {
  const sheet = cachedSheet && cachedSheet.spreadsheetId === spreadsheetId && cachedSheet.sheetName === sheetName
    ? cachedSheet
    : await loadSheetData(spreadsheetId, sheetName);

  if (sheet.CI.YEAR < 0) return [];

  const yearSet = new Set<number>();
  for (let r = 0; r < sheet.all.length; r++) {
    const yr = parseInt(String(sheet.all[r][sheet.CI.YEAR] ?? ''), 10);
    if (!isNaN(yr) && yr >= 2000 && yr <= 2100) yearSet.add(yr);
  }
  return Array.from(yearSet).sort((a, b) => b - a);
}

// =============================================================================
// CITY DISCOVERY
// =============================================================================

export interface CityInfo {
  cityName: string;
  tabs: string[];
  totalRows: number;
  bookings: number;
  reachedPct: number;
  avgAttempts: number;
  lastUsed: string | null;
}

export async function discoverCities(
  spreadsheetId: string,
  tabNames: string[],
  onProgress?: (scanned: number, total: number, tabName: string) => void
): Promise<CityInfo[]> {
  const cityMap = new Map<string, {
    displayName: string;
    tabs: Set<string>;
    totalRows: number;
    bookings: number;
    reachedRows: number;
    naValues: number[];
    latestDate: Date | null;
  }>();

  const hasValue = (v: any) => v !== null && v !== undefined && String(v).trim() !== '';
  const hasAER = (v: any) => { const s = String(v ?? '').trim().toUpperCase(); return s === 'X' || s === 'AER' || s === 'YES' || s === 'Y'; };
  const isDisposed = (row: any[], YES: number, NO: number, WN: number, REMOVE: number) =>
    [YES, NO, WN, REMOVE].some(c => c >= 0 && hasValue(row[c]));
  const getNA = (row: any[], NA: number) => {
    if (NA < 0) return 0;
    const v = parseInt(String(row[NA] ?? '0'), 10);
    return isNaN(v) ? 0 : Math.max(0, v);
  };
  const normalizePhoneLocal = (v: any) => {
    let s = String(v ?? '').trim();
    if (s.endsWith('.0')) s = s.slice(0, -2);
    const d = s.replace(/\D/g, '');
    const t = d.length > 10 ? d.slice(-10) : d;
    return t.length === 10 ? t : '';
  };

  for (let i = 0; i < tabNames.length; i++) {
    const tabName = tabNames[i];
    onProgress?.(i, tabNames.length, tabName);

    try {
      const rawData = await dialerSheetsService.sheetsGet(spreadsheetId, `'${tabName}'`);
      if (!rawData || rawData.length < 2) continue;

      const { headerRowIndex, CI } = findHeaders(rawData);
      if (CI.PHONE < 0 || CI.CITY < 0) continue;

      const rows = rawData.slice(headerRowIndex + 1);

      for (const row of rows) {
        if (!row[0]) continue;
        if (!normalizePhoneLocal(row[CI.PHONE])) continue;
        const route = CI.ROUTE_CODE >= 0 ? String(row[CI.ROUTE_CODE] ?? '').trim() : '';
        if (!route) continue;

        const cityRaw = String(row[CI.CITY] ?? '').trim();
        if (!cityRaw) continue;
        const cityKey = cityRaw.toLowerCase();

        if (!cityMap.has(cityKey)) {
          cityMap.set(cityKey, { displayName: cityRaw, tabs: new Set(), totalRows: 0, bookings: 0, reachedRows: 0, naValues: [], latestDate: null });
        }
        const entry = cityMap.get(cityKey)!;
        entry.tabs.add(tabName);
        entry.totalRows++;

        if (CI.AER >= 0 && hasAER(row[CI.AER])) entry.bookings++;
        if (isDisposed(row, CI.YES, CI.NO, CI.WN, CI.REMOVE)) entry.reachedRows++;
        else entry.naValues.push(getNA(row, CI.NA));

        if (CI.DATE1 >= 0 && hasValue(row[CI.DATE1])) {
          try {
            const d = new Date(row[CI.DATE1]);
            if (!isNaN(d.getTime()) && (!entry.latestDate || d > entry.latestDate)) entry.latestDate = d;
          } catch { /* skip */ }
        }
      }
    } catch {
      // Skip tabs that fail
    }

    onProgress?.(i + 1, tabNames.length, tabName);
  }

  const result: CityInfo[] = [];
  for (const [, entry] of cityMap) {
    const reachedPct = entry.totalRows > 0 ? Math.round((entry.reachedRows / entry.totalRows) * 100) : 0;
    const avgAttempts = entry.naValues.length > 0
      ? Math.round((entry.naValues.reduce((s, n) => s + n, 0) / entry.naValues.length) * 10) / 10
      : 0;
    result.push({
      cityName: entry.displayName,
      tabs: Array.from(entry.tabs),
      totalRows: entry.totalRows,
      bookings: entry.bookings,
      reachedPct,
      avgAttempts,
      lastUsed: entry.latestDate ? entry.latestDate.toISOString() : null,
    });
  }

  result.sort((a, b) => a.cityName.localeCompare(b.cityName));
  return result;
}

// =============================================================================
// AVAILABLE GROUP PHONES — for cooldown-aware count
// =============================================================================

/**
 * Returns an array of phone lists, one per available group.
 * Each phone list contains only non-WN phones for that group.
 * Works for both single-tab and city mode.
 * Used by DialerPage to compute how many groups are not on cooldown.
 */
export function getAvailableGroupPhones(): string[][] {
  const isCityMode = !!cachedCity;

  if (isCityMode && cachedCity) {
    return cachedCity.available.map(group => {
      const phones: string[] = [];
      const seenPhones = new Set<string>();
      const CI = cachedCity!.mergedCI;
      const all = cachedCity!.mergedAll;

      for (const r of group.rows) {
        if (CI.PHONE < 0) continue;
        const wnVal = CI.WN >= 0 ? String(all[r][CI.WN] ?? '').trim() : '';
        if (wnVal !== '') continue;
        const phone = normalizePhone(String(all[r][CI.PHONE] ?? ''));
        if (phone && !seenPhones.has(phone)) {
          seenPhones.add(phone);
          phones.push(phone);
        }
      }
      return phones;
    });
  }

  if (cachedSheet) {
    return cachedSheet.available.map(group => {
      const phones: string[] = [];
      const seenPhones = new Set<string>();
      const CI = cachedSheet!.CI;
      const all = cachedSheet!.all;

      for (const r of group.rows) {
        if (CI.PHONE < 0) continue;
        const wnVal = CI.WN >= 0 ? String(all[r][CI.WN] ?? '').trim() : '';
        if (wnVal !== '') continue;
        const phone = normalizePhone(String(all[r][CI.PHONE] ?? ''));
        if (phone && !seenPhones.has(phone)) {
          seenPhones.add(phone);
          phones.push(phone);
        }
      }
      return phones;
    });
  }

  return [];
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

    const { cleared, visibleGroupCount } = checkStreetCleared(state);
    ctx.streetFullyCleared = cleared;
    ctx.streetVisibleGroupCount = visibleGroupCount;

    if (disposition === 'PREPAY') {
      const hasPriorPrepay = state.serviceHistory.some(h => h.pmtType === 'Prepaid');
      ctx.isFirstTimePrepay = !hasPriorPrepay;
    }

    if (extra.upsellType && extra.upsellType !== 'none') {
      ctx.upsellType = extra.upsellType;
      ctx.skipAeration = extra.skipAeration || false;
      if (extra.upsellType === 'dethatch') {
        ctx.dtPrice = parseFloat(extra.dtPrice || '0') || 0;
        ctx.dtPrepaid = extra.dtPrepaid || false;
      }
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
    const dbSession = await campaignService.getOrCreateTodaySession(config.campaignId, config.managerId);
    activeSessionRowId = dbSession.id;

    const stored = dbSession.gamificationState;
    if (stored && typeof stored === 'object' && Object.keys(stored).length > 0) {
      const restored = stored as GamificationSession;
      if (restored.date === today) return migrateSession(restored, config.repCode, today);
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
      _resumeBookId: resumeBookId || undefined,
      _siegeIndex: cachedSheet?.siegeIndex ?? cachedCity?.siegeIndex ?? undefined,
    };
    await campaignService.upsertGamificationState(activeSessionRowId, stateWithResume);
  } catch (err) {
    console.warn('Session save to Supabase failed (non-critical):', err);
  }
}

function migrateSession(loaded: GamificationSession, repCode: string, dateStr: string): GamificationSession {
  const fresh = createFreshSession(repCode, dateStr);
  for (const key of Object.keys(fresh) as (keyof GamificationSession)[]) {
    if ((loaded as any)[key] === undefined) (loaded as any)[key] = (fresh as any)[key];
  }
  if (!loaded.multipliers) loaded.multipliers = fresh.multipliers;
  for (const mKey of Object.keys(fresh.multipliers) as (keyof typeof fresh.multipliers)[]) {
    if (!(loaded.multipliers as any)[mKey]) {
      (loaded.multipliers as any)[mKey] = (fresh.multipliers as any)[mKey];
    } else {
      const freshSub = (fresh.multipliers as any)[mKey];
      const loadedSub = (loaded.multipliers as any)[mKey];
      for (const sKey of Object.keys(freshSub)) {
        if (loadedSub[sKey] === undefined) loadedSub[sKey] = freshSub[sKey];
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
export type { DispositionType, DispositionExtra, UpsellType } from './dialerDispositions';
export type { GamificationSession } from './gamificationDefs';
export type { GamificationResult, MultiplierSnapshot } from './gamificationEngine';
export { getCurrentRank, createFreshSession } from './gamificationDefs';
export { getActiveMultipliers } from './gamificationEngine';
export { formatPhoneDisplay } from './dialerUtils';
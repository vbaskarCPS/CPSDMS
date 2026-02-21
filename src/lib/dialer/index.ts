// src/lib/dialer/index.ts
//
// Barrel export for the AutoSniper dialer engine.
// Import everything from here:
//   import { initialize, applyDisposition, ... } from '@/lib/dialer';
//

// --- Engine (main orchestrator) ---
export {
  initialize,
  getNextState,
  findGroupByBookingId,
  findGroupByPhone,
  applyDisposition,
  stageCardData,
  finalizePrepay,
  cancelPrepay,
  hasPendingPrepay,
  checkStreetCleared,
  invalidateCache,
  discoverAvailableYears,
  discoverCities,
  formatPhoneDisplay,
  getCurrentRank,
  getActiveMultipliers,
  setResumePosition,
  createFreshSession,
} from './dialerEngine';

export type {
  EngineConfig,
  EngineSnapshot,
  DispositionResult,
  DialerState,
  DialerStateResult,
  Direction,
  DispositionType,
  DispositionExtra,
  GamificationSession,
  GamificationResult,
  MultiplierSnapshot,
  CityInfo,
} from './dialerEngine';

// --- Sub-modules (for advanced usage) ---
export { resolveHeaders, findHeaders } from './dialerHeaders';
export type { ColumnIndices } from './dialerHeaders';

export {
  buildGroups,
  sniperFilterGroups,
  filterAvailable,
  applyOrdering,
  findNextGroup,
  findInfiltrateStart,
  nextAfterRow,
} from './dialerGroupBuilder';
export type { ClientGroup } from './dialerGroupBuilder';

export { buildState, countStreetAER } from './dialerStateBuilder';
export type { ServiceHistoryRow, NearbyAER, ClientInfo, PhoneStrategy } from './dialerStateBuilder';

export { buildDispositionUpdates, cellUpdatesToSheetsData } from './dialerDispositions';
export type { CellUpdate } from './dialerDispositions';

export { buildCCDRow, detectCardType } from './dialerCCD';
export type { StagedCard, CCDWriteData } from './dialerCCD';

export { processDisposition } from './gamificationEngine';
export type { DispositionContext, PointBreakdown, ProcessResult } from './gamificationEngine';

export {
  BADGE_DEFS,
  MULTIPLIER_DEFS,
  BASE_POINTS,
} from './gamificationDefs';
export type {
  BadgeDef,
  MultiplierDef,
  BadgeEarned,
  BookingRecord,
  Rank,
} from './gamificationDefs';

export {
  normalizePhone,
  normalizeStreet,
  normalizeAddr,
  parseHiddenRows,
  parseYear,
  buildStreetKey,
  getRoutePrefix,
  isPrepaid,
  hasAER,
  isCTS,
} from './dialerUtils';
// src/lib/googleSheetsConfig.ts
import { commandCenterService } from './commandCenterService';
import { SeasonType } from '../types';

// OAuth configuration (static, app-wide)
export const GOOGLE_OAUTH_CONFIG = {
  clientId: '40612258514-r65coio3euepdovh7ib8a4mhsh9p79qv.apps.googleusercontent.com',
  scopes: 'https://www.googleapis.com/auth/spreadsheets',
};

// Standard tab names (static, same for all command centers)
export const SHEET_TABS = {
  routes: 'Routes',
  feedPlaceholder: 'Feed Placeholder',
  managers: 'Managers',
  accounts: 'Accounts',
  logsheets: 'Logsheets',
  payoutStats: 'Payout Stats',
};

// --- FEED PLACEHOLDER COLUMN MAPPINGS ---
// UNIFIED: All seasons use the same column layout (A-R)
// The only difference is whether service flag columns (L-P) are populated

export const FEED_COLUMNS = {
  range: 'A:R',
  mapping: {
    routeNumber: 0,      // A
    firstName: 1,        // B
    lastName: 2,         // C
    houseNumber: 3,      // D
    streetName: 4,       // E
    logNotes: 5,         // F (Call 1st)
    phone: 6,            // G
    email: 7,            // H
    serviceType: 8,      // I (FO/BO/FP)
    prepaid: 9,          // J (PP)
    price: 10,           // K (AER. AMT)
    // Service flags (A/D/F/S/L) - only populated for lawn_rejuv
    serviceAeration: 11, // L (A)
    serviceDethatch: 12, // M (D)
    serviceFertilizer: 13, // N (F)
    serviceSeed: 14,     // O (S)
    serviceLime: 15,     // P (L)
    // Completion - ALWAYS columns Q and R regardless of season
    dateCompleted: 16,   // Q
    contractor: 17,      // R
  },
  // Export columns for completed bookings - ALWAYS Q and R
  exportDateColumn: 'Q',
  exportContractorColumn: 'R',
  // Service flag columns (only used for lawn_rejuv)
  exportServiceAerationColumn: 'L',
  exportServiceDethatchColumn: 'M',
  exportServiceFertilizerColumn: 'N',
  exportServiceSeedColumn: 'O',
  exportServiceLimeColumn: 'P',
};

// Legacy exports for backward compatibility
export const AERATION_FEED_COLUMNS = FEED_COLUMNS;
export const LAWN_REJUV_FEED_COLUMNS = FEED_COLUMNS;

// --- WORKERBOOK COLUMN MAPPINGS ---

// Standard workerbook columns (for worker data)
export const WORKERBOOK_COLUMNS = {
  // Row index 0 is header row
  dataStartRow: 2, // Data starts at row 3 (index 2)
  mapping: {
    // Column indices
    contractorId: 1,    // B
    firstName: 2,       // C
    lastName: 3,        // D
    cellPhone: 4,       // E
    alumniRate: 5,      // F
    silverRate: 6,      // G
    managerName: 7,     // H
    teamId: 8,          // I (Teams column - only used in lawn_rejuv)
    // ... other columns
    showFlag: 10,       // K (Show column - 'x' means active)
  },
};

// --- PAYOUT STATS COLUMN MAPPINGS ---
// Matches the actual spreadsheet header: A-AH (34 columns)
export const PAYOUT_STATS_COLUMNS = {
  range: 'A:AH',
  columnCount: 34,
  mapping: {
    date: 0,              // A
    contractorId: 1,      // B
    firstName: 2,         // C
    lastName: 3,          // D
    manager: 4,           // E
    stepCount: 5,         // F
    iosCount: 6,          // G
    prodBilled: 7,        // H
    prodCash: 8,          // I
    prodCheque: 9,        // J
    prodCreditCard: 10,   // K
    prodETransfer: 11,    // L
    prodFlats: 12,        // M
    prodPrepaid: 13,      // N
    prodPrepaidSplit: 14, // O
    prodGross: 15,        // P
    prodPayable: 16,      // Q
    totalEQ: 17,          // R
    upsellCount: 18,      // S
    upsellCash: 19,       // T
    upsellCheque: 20,     // U
    upsellCreditCard: 21, // V
    upsellETransfer: 22,  // W
    upsellPrepaid: 23,    // X
    upsellGross: 24,      // Y
    upsellPayable: 25,    // Z
    payoutRate: 26,       // AA
    productionComm: 27,   // AB
    upsellComm: 28,       // AC
    iosComm: 29,          // AD
    machineRental: 30,    // AE
    deductions: 31,       // AF
    bonuses: 32,          // AG
    finalPay: 33,         // AH
  },
};

// --- HELPER FUNCTIONS ---

/**
 * Get feed placeholder column config based on season type
 * Now returns the same unified config for all seasons
 */
export const getFeedColumnsConfig = (seasonType: SeasonType) => {
  return FEED_COLUMNS;
};

/**
 * Get the feed placeholder range for import
 */
export const getFeedRange = (seasonType: SeasonType): string => {
  return FEED_COLUMNS.range;
};

/**
 * Check if a cell value indicates a service is included
 */
export const isServiceIncluded = (value: any): boolean => {
  if (!value) return false;
  const str = String(value).toLowerCase().trim();
  return str === 'x' || str === 'yes' || str === 'true' || str === '1';
};

/**
 * Check if the season type uses service flags
 */
export const seasonUsesServiceFlags = (seasonType: SeasonType): boolean => {
  return seasonType === 'lawn_rejuv';
};

// Dynamic config based on current command center
export const getGoogleSheetsConfig = (): {
  spreadsheets: {
    workerbook: string;
    masterbookings: string;
  };
} | null => {
  const cc = commandCenterService.getCurrentCommandCenter();
  
  if (!cc) {
    return null;
  }
  
  return {
    spreadsheets: {
      workerbook: cc.workerbookSheetId,
      masterbookings: cc.masterbookingsSheetId,
    },
  };
};

// Validate date tab format (MmmDD like Feb01, Mar15)
export const isValidDateTab = (tabName: string): boolean => {
  const pattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(0[1-9]|[12][0-9]|3[01])$/;
  return pattern.test(tabName);
};

// Get readable error for invalid date tab
export const getDateTabError = (tabName: string): string | null => {
  if (!tabName.trim()) {
    return 'Please enter a date tab name (e.g., Feb01)';
  }
  if (!isValidDateTab(tabName)) {
    return 'Invalid format. Use MmmDD format (e.g., Feb01, Mar15, Dec25)';
  }
  return null;
};
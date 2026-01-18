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

// Aeration Season: A-M (13 columns)
export const AERATION_FEED_COLUMNS = {
  range: 'A:M',
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
    dateCompleted: 11,   // L
    contractor: 12,      // M
  },
  // Export columns for completed bookings
  exportDateColumn: 'L',
  exportContractorColumn: 'M',
};

// Lawn Rejuvenation Season: A-R (18 columns)
export const LAWN_REJUV_FEED_COLUMNS = {
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
    // Service flags (A/D/F/S/L)
    serviceAeration: 11, // L (A)
    serviceDethatch: 12, // M (D)
    serviceFertilizer: 13, // N (F)
    serviceSeed: 14,     // O (S)
    serviceLime: 15,     // P (L)
    // Completion
    dateCompleted: 16,   // Q
    contractor: 17,      // R
  },
  // Export columns for completed bookings
  exportServiceAerationColumn: 'L',
  exportServiceDethatchColumn: 'M',
  exportServiceFertilizerColumn: 'N',
  exportServiceSeedColumn: 'O',
  exportServiceLimeColumn: 'P',
  exportDateColumn: 'Q',
  exportContractorColumn: 'R',
};

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

// --- HELPER FUNCTIONS ---

/**
 * Get feed placeholder column config based on season type
 */
export const getFeedColumnsConfig = (seasonType: SeasonType) => {
  return seasonType === 'lawn_rejuv' 
    ? LAWN_REJUV_FEED_COLUMNS 
    : AERATION_FEED_COLUMNS;
};

/**
 * Get the feed placeholder range for import
 */
export const getFeedRange = (seasonType: SeasonType): string => {
  return getFeedColumnsConfig(seasonType).range;
};

/**
 * Check if a cell value indicates a service is included
 */
export const isServiceIncluded = (value: any): boolean => {
  if (!value) return false;
  const str = String(value).toLowerCase().trim();
  return str === 'x' || str === 'yes' || str === 'true' || str === '1';
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
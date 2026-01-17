// src/lib/googleSheetsConfig.ts
import { commandCenterService } from './commandCenterService';

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
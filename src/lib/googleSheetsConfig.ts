// src/lib/googleSheetsConfig.ts

export const GOOGLE_SHEETS_CONFIG = {
    // OAuth Client ID from Google Cloud Console
    clientId: '40612258514-r65coio3euepdovh7ib8a4mhsh9p79qv.apps.googleusercontent.com',
    
    // Google Sheets API scope
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
    
    // Spreadsheet IDs (from the URL)
    spreadsheets: {
      workerbook: '1bfz54XWwUvA8mH4jviRgoa89X7ETOf4jCIAGgB51beI',
      masterbookings: '1slQt5kAjynyjiREC_j1kw-FqmOXtEaRt8aNbm8syn4M',
    },
    
    // Tab names (for reading)
    tabs: {
      routes: 'Routes',
      feedPlaceholder: 'Feed Placeholder',
      managers: 'Managers',
      accounts: 'Accounts',
      logsheets: 'Logsheets',
      payoutStats: 'Payout Stats',
    },
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
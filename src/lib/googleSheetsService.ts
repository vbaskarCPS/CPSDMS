// src/lib/googleSheetsService.ts
import { GOOGLE_SHEETS_CONFIG, isValidDateTab } from './googleSheetsConfig';
import { DailySessionData, ManagementUser, Worker, RouteData, MasterBooking } from '../types';
import { formatPhoneNumber, normalizeEmail } from './validationUtils';

// Type declarations for Google Identity Services
declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: any) => any;
        };
      };
    };
    gapi: {
      load: (api: string, callback: () => void) => void;
      client: {
        init: (config: any) => Promise<void>;
        sheets: {
          spreadsheets: {
            values: {
              get: (params: any) => Promise<any>;
              update: (params: any) => Promise<any>;
              append: (params: any) => Promise<any>;
              batchUpdate: (params: any) => Promise<any>;
            };
          };
        };
      };
    };
  }
}

class GoogleSheetsService {
  private static instance: GoogleSheetsService;
  private accessToken: string | null = null;
  private tokenClient: any = null;
  private gapiLoaded: boolean = false;
  private gisLoaded: boolean = false;

  private constructor() {}

  public static getInstance(): GoogleSheetsService {
    if (!GoogleSheetsService.instance) {
      GoogleSheetsService.instance = new GoogleSheetsService();
    }
    return GoogleSheetsService.instance;
  }

  // --- INITIALIZATION ---

  /**
   * Initialize the Google API client library
   */
  public async initGapi(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.gapiLoaded) {
        resolve();
        return;
      }

      if (!window.gapi) {
        reject(new Error('Google API (gapi) not loaded. Make sure the script is included in index.html'));
        return;
      }

      window.gapi.load('client', async () => {
        try {
          await window.gapi.client.init({
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
          });
          this.gapiLoaded = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * Initialize the Google Identity Services token client
   */
  public initTokenClient(): void {
    if (this.gisLoaded) return;

    if (!window.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services not loaded. Make sure the script is included in index.html');
    }

    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_SHEETS_CONFIG.clientId,
      scope: GOOGLE_SHEETS_CONFIG.scopes,
      callback: (response: any) => {
        if (response.access_token) {
          this.accessToken = response.access_token;
        }
      },
    });

    this.gisLoaded = true;
  }

  /**
   * Check if user is authenticated
   */
  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Request access token (opens Google sign-in popup)
   */
  public async authenticate(): Promise<boolean> {
    await this.initGapi();
    this.initTokenClient();

    return new Promise((resolve) => {
      this.tokenClient.callback = (response: any) => {
        if (response.access_token) {
          this.accessToken = response.access_token;
          resolve(true);
        } else {
          resolve(false);
        }
      };

      if (this.accessToken) {
        // Already have token, request a fresh one
        this.tokenClient.requestAccessToken({ prompt: '' });
      } else {
        // First time, show consent screen
        this.tokenClient.requestAccessToken({ prompt: 'consent' });
      }
    });
  }

  /**
   * Sign out and clear token
   */
  public signOut(): void {
    this.accessToken = null;
  }

  // --- HELPER METHODS ---

  /**
   * Make authenticated request to Sheets API
   */
  private async sheetsGet(spreadsheetId: string, range: string): Promise<any[][]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch sheet data');
    }

    const data = await response.json();
    return data.values || [];
  }

  /**
   * Update cells in a sheet (RAW to preserve destination formatting)
   */
  private async sheetsUpdate(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to update sheet');
    }
  }

  /**
   * Append rows to a sheet (RAW to preserve destination formatting)
   */
  private async sheetsAppend(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to append to sheet');
    }
  }

  /**
   * Batch update multiple ranges (RAW to preserve destination formatting)
   */
  private async sheetsBatchUpdate(spreadsheetId: string, data: { range: string; values: any[][] }[]): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to batch update sheet');
    }
  }

  // Generate consistent IDs (same as feedParser)
  private generateConsistentId(name: string, rolePrefix: string): string {
    return `${rolePrefix}_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  private generateRMUsername(fullName: string): string {
    if (!fullName) return '';
    const parts = fullName.trim().split(' ');
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || firstName;
    const lastPart = lastName.substring(0, 3).toLowerCase();
    const firstPart = firstName.substring(0, 2).toLowerCase();
    return `${lastPart}${firstPart}`;
  }

  // --- READ OPERATIONS ---

  /**
   * Check if a tab exists in the Workerbook
   */
  public async checkTabExists(tabName: string): Promise<boolean> {
    try {
      await this.sheetsGet(GOOGLE_SHEETS_CONFIG.spreadsheets.workerbook, `'${tabName}'!A1`);
      return true;
    } catch (err: any) {
      if (err.message?.includes('Unable to parse range')) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Import session data from Google Sheets
   */
  public async importSessionData(dateTab: string): Promise<DailySessionData> {
    if (!isValidDateTab(dateTab)) {
      throw new Error(`Invalid date tab format: ${dateTab}. Use MmmDD format (e.g., Feb01)`);
    }

    // Check if tab exists
    const tabExists = await this.checkTabExists(dateTab);
    if (!tabExists) {
      throw new Error(`Tab "${dateTab}" not found in Workerbook. Please check the tab name.`);
    }

    // Fetch all data in parallel
    const [routesData, bookingsData, workersData, managersData] = await Promise.all([
      this.sheetsGet(GOOGLE_SHEETS_CONFIG.spreadsheets.masterbookings, `'${GOOGLE_SHEETS_CONFIG.tabs.routes}'!A:G`),
      this.sheetsGet(GOOGLE_SHEETS_CONFIG.spreadsheets.masterbookings, `'${GOOGLE_SHEETS_CONFIG.tabs.feedPlaceholder}'!A:M`),
      this.sheetsGet(GOOGLE_SHEETS_CONFIG.spreadsheets.workerbook, `'${dateTab}'!A:K`),
      this.sheetsGet(GOOGLE_SHEETS_CONFIG.spreadsheets.workerbook, `'${GOOGLE_SHEETS_CONFIG.tabs.managers}'!A:G`),
    ]);

    const date = new Date().toISOString().split('T')[0];

    // --- PROCESS MANAGERS (from Managers tab) ---
    // Row 0 = header, data starts row 1
    const managersMap = new Map<string, ManagementUser>();
    
    for (let i = 1; i < managersData.length; i++) {
      const row = managersData[i];
      const managerName = row[0]?.toString().trim();
      const phoneNumber = row[5]?.toString().trim() || '';
      const password = row[6]?.toString().trim() || '';

      if (!managerName) continue;
      if (!password) {
        console.warn(`⚠️ Manager "${managerName}" has no password, skipping.`);
        continue;
      }

      const username = this.generateRMUsername(managerName);
      managersMap.set(managerName, {
        userId: this.generateConsistentId(managerName, 'rm'),
        name: managerName,
        username,
        password,
        phone: formatPhoneNumber(phoneNumber),
        role: 'RouteManager',
      });
    }

    const managers = Array.from(managersMap.values());

    // --- PROCESS ROUTES ---
    // Row 0 = header, data starts row 1
    // Col A = Manager Assignment, Col D = RT #, Col E = Street_List
    const routes: RouteData[] = [];

    for (let i = 1; i < routesData.length; i++) {
      const row = routesData[i];
      const managerName = row[0]?.toString().trim();
      const routeCode = row[3]?.toString().trim(); // Column D (index 3)
      const streetListRaw = row[4]?.toString() || ''; // Column E (index 4)

      if (!routeCode) continue;

      if (managerName && !managersMap.has(managerName)) {
        console.warn(`⚠️ Route ${routeCode} references manager "${managerName}" not found in Managers tab. Skipping route.`);
        continue;
      }

      if (managerName && routeCode) {
        const streets = streetListRaw.split(',').map(s => s.trim()).filter(Boolean);
        const manager = managersMap.get(managerName)!;
        
        routes.push({
          routeCode,
          managerId: manager.userId,
          assignedWorkerIds: [],
          streets,
        });
      }
    }

    // --- PROCESS WORKERS (from dated tab) ---
    // Row 0 = date/stats row, Row 1 = header, data starts row 2
    // Filter by Column K (index 10) = 'x' (Show)
    // Cols: B=CN# (1), C=First (2), D=Last (3), E=Cell (4), F=Alm (5), G=Slv (6), H=Manager (7), K=Show (10)
    const workers: Worker[] = [];

    for (let i = 2; i < workersData.length; i++) {
      const row = workersData[i];
      const showValue = row[10]?.toString().trim().toLowerCase();

      // Only include workers who have "x" in the Show column
      if (showValue !== 'x') continue;

      const contractorId = row[1]?.toString().trim() || '';
      const firstName = row[2]?.toString().trim() || '';
      const lastName = row[3]?.toString().trim() || '';
      const cellPhone = row[4]?.toString().trim() || '';
      const alumniRate = parseFloat(row[5]) || 0;
      const silverRate = parseFloat(row[6]) || 0;
      const managerName = row[7]?.toString().trim() || '';

      if (!contractorId) {
        console.warn(`⚠️ Worker ${firstName} ${lastName} has no contractor ID, skipping.`);
        continue;
      }

      const assignedManager = managers.find(m => m.name === managerName);

      workers.push({
        contractorId,
        firstName,
        lastName,
        cellPhone: formatPhoneNumber(cellPhone),
        status: 'Return',
        assignedManagerId: assignedManager?.userId,
        alumniRate,
        silverRate,
      });
    }

    // --- PROCESS BOOKINGS (from Feed Placeholder) ---
    // Row 0 = empty, Row 1 = header, data starts row 2
    // Cols: A=Route# (0), B=First (1), C=Last (2), D=House# (3), E=Street (4), 
    //       F=Call1st (5), G=Phone (6), H=Email (7), I=ServiceType (8), J=PP (9), K=Amount (10)
    const pendingBookings: MasterBooking[] = [];

    for (let i = 2; i < bookingsData.length; i++) {
      const row = bookingsData[i];
      const routeNum = row[0]?.toString().trim();

      if (!routeNum) continue;

      const booking: MasterBooking = {
        'Booking ID': `job_${i}_${Date.now()}`,
        'Route Number': routeNum,
        'First Name': row[1]?.toString().trim() || '',
        'Last Name': row[2]?.toString().trim() || '',
        'House Number': row[3]?.toString().trim() || '',
        'Street Name': row[4]?.toString().trim() || '',
        'Full Address': `${row[3] || ''} ${row[4] || ''}`.trim(),
        'Home Phone': formatPhoneNumber(row[6]?.toString() || ''),
        'Email Address': normalizeEmail(row[7]?.toString() || ''),
        'Price': row[10]?.toString() || '',
        'FO/BO/FP': row[8]?.toString().trim() as any,
        'Prepaid': row[9]?.toString().toLowerCase() === 'x' ? 'x' : undefined,
        'Log Sheet Notes': row[5]?.toString() || '',
        'Status': 'pending',
        'Completed': undefined,
        isPrebooked: true,
        sort_order: i - 2, // Preserve order
        _sourceRow: i + 1, // Store the actual row number for updating later (1-indexed for Sheets)
      };

      pendingBookings.push(booking);
    }

    return { date, managers, workers, routes, pendingBookings };
  }

  // --- WRITE OPERATIONS ---

  /**
   * Update completed/cancelled bookings back to Feed Placeholder (cols L & M)
   */
  public async updateCompletedBookings(
    bookings: Array<{
      routeNumber: string;
      firstName: string;
      lastName: string;
      dateCompleted: string; // Date or "Cancelled"
      contractorId: string;
    }>
  ): Promise<number> {
    // First, read the current Feed Placeholder to find matching rows
    const currentData = await this.sheetsGet(
      GOOGLE_SHEETS_CONFIG.spreadsheets.masterbookings,
      `'${GOOGLE_SHEETS_CONFIG.tabs.feedPlaceholder}'!A:M`
    );

    const updates: { range: string; values: any[][] }[] = [];
    let matchCount = 0;

    // For each completed/cancelled booking, find the matching row
    for (const booking of bookings) {
      for (let i = 2; i < currentData.length; i++) {
        const row = currentData[i];
        const rowRoute = row[0]?.toString().trim();
        const rowFirst = row[1]?.toString().trim().toLowerCase();
        const rowLast = row[2]?.toString().trim().toLowerCase();

        // Match by Route + First + Last name
        if (
          rowRoute === booking.routeNumber &&
          rowFirst === booking.firstName.toLowerCase() &&
          rowLast === booking.lastName.toLowerCase()
        ) {
          // Update columns L and M (indices 11 and 12, but in Sheets it's columns L:M)
          const rowNum = i + 1; // 1-indexed for Sheets
          updates.push({
            range: `'${GOOGLE_SHEETS_CONFIG.tabs.feedPlaceholder}'!L${rowNum}:M${rowNum}`,
            values: [[booking.dateCompleted, booking.contractorId]],
          });
          matchCount++;
          break; // Found the match, move to next booking
        }
      }
    }

    if (updates.length > 0) {
      await this.sheetsBatchUpdate(GOOGLE_SHEETS_CONFIG.spreadsheets.masterbookings, updates);
    }

    return matchCount;
  }

  /**
   * Append accounts data to Accounts tab
   */
  public async appendAccounts(
    accounts: Array<{
      routeNumber: string;
      firstName: string;
      lastName: string;
      streetNum: string;
      streetName: string;
      phone: string;
      email: string;
      clientType: string;
      propertyType: string;
      notes: string;
      price: number;
      paymentType: string;
      contractorName: string;
      paymentDetails: string;
      expiry: string;
      cvc: string;
    }>
  ): Promise<void> {
    if (accounts.length === 0) return;

    const rows = accounts.map(a => [
      a.routeNumber,
      a.firstName,
      a.lastName,
      a.streetNum,
      a.streetName,
      a.phone,
      a.email,
      a.clientType,
      a.propertyType,
      a.notes,
      a.price,
      a.paymentType,
      a.contractorName,
      a.paymentDetails,
      a.expiry,
      a.cvc,
    ]);

    await this.sheetsAppend(
      GOOGLE_SHEETS_CONFIG.spreadsheets.masterbookings,
      `'${GOOGLE_SHEETS_CONFIG.tabs.accounts}'!A:P`,
      rows
    );
  }

  /**
   * Append logsheet entries to Logsheets tab
   */
  public async appendLogsheets(
    logsheets: Array<{
      routeNumber: string;
      firstName: string;
      lastName: string;
      streetNum: string;
      streetName: string;
      phone: string;
      email: string;
      clientType: string;
      propertyType: string;
      notes: string;
      price: number;
      paymentType: string;
      contractorName: string;
    }>
  ): Promise<void> {
    if (logsheets.length === 0) return;

    const rows = logsheets.map(l => [
      l.routeNumber,
      l.firstName,
      l.lastName,
      l.streetNum,
      l.streetName,
      l.phone,
      l.email,
      l.clientType,
      l.propertyType,
      l.notes,
      l.price,
      l.paymentType,
      l.contractorName,
    ]);

    await this.sheetsAppend(
      GOOGLE_SHEETS_CONFIG.spreadsheets.masterbookings,
      `'${GOOGLE_SHEETS_CONFIG.tabs.logsheets}'!A:M`,
      rows
    );
  }

  /**
   * Append payout stats to Payout Stats tab in Workerbook
   * @param dateTab - The date tab name (e.g., "Feb01") to be written to column A
   */
  public async appendPayoutStats(
    dateTab: string,
    stats: Array<{
      contractorId: string;
      firstName: string;
      lastName: string;
      manager: string;
      stepCount: number;
      iosCount: number;
      prodBilled: number;
      prodCash: number;
      prodCheque: number;
      prodCreditCard: number;
      prodETransfer: number;
      prodFlats: number;
      prodPrepaid: number;
      prodPrepaidSplit: number;
      prodGross: number;
      prodPayable: number;
      totalEQ: number;
      upsellCount: number;
      upsellCash: number;
      upsellCheque: number;
      upsellCreditCard: number;
      upsellETransfer: number;
      upsellPrepaid: number;
      upsellGross: number;
      upsellPayable: number;
      payoutRate: number;
      productionComm: number;
      upsellComm: number;
      iosComm: number;
      machineRental: number;
      deductions: number;
      bonuses: number;
      finalPay: number;
    }>
  ): Promise<void> {
    if (stats.length === 0) return;

    // Column A is now the date tab, shift all other columns right
    const rows = stats.map(s => [
      dateTab, // NEW: Column A - Date tab (e.g., "Feb01")
      s.contractorId,
      s.firstName,
      s.lastName,
      s.manager,
      s.stepCount,
      s.iosCount,
      s.prodBilled,
      s.prodCash,
      s.prodCheque,
      s.prodCreditCard,
      s.prodETransfer,
      s.prodFlats,
      s.prodPrepaid,
      s.prodPrepaidSplit,
      s.prodGross,
      s.prodPayable,
      s.totalEQ,
      s.upsellCount,
      s.upsellCash,
      s.upsellCheque,
      s.upsellCreditCard,
      s.upsellETransfer,
      s.upsellPrepaid,
      s.upsellGross,
      s.upsellPayable,
      s.payoutRate,
      s.productionComm,
      s.upsellComm,
      s.iosComm,
      s.machineRental,
      s.deductions,
      s.bonuses,
      s.finalPay,
    ]);

    await this.sheetsAppend(
      GOOGLE_SHEETS_CONFIG.spreadsheets.workerbook,
      `'${GOOGLE_SHEETS_CONFIG.tabs.payoutStats}'!A:AH`, // Extended to AH for new column
      rows
    );
  }
}

export const googleSheetsService = GoogleSheetsService.getInstance();
// src/lib/googleSheetsService.ts
import { getGoogleSheetsConfig, GOOGLE_OAUTH_CONFIG, SHEET_TABS, isValidDateTab } from './googleSheetsConfig';
import { commandCenterService } from './commandCenterService';
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

// Export types for import metadata
export interface ImportMeta {
  source: 'sheets' | 'file';
  dateTab?: string; // Only present if source is 'sheets'
  sheetsExported?: boolean;
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

  // --- GET CURRENT CONFIG (throws if no CC context) ---
  private getConfig() {
    const config = getGoogleSheetsConfig();
    if (!config) {
      throw new Error('No command center context. Please log in to a command center first.');
    }
    return config;
  }

  // --- INITIALIZATION ---

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

  public initTokenClient(): void {
    if (this.gisLoaded) return;

    if (!window.google?.accounts?.oauth2) {
      throw new Error('Google Identity Services not loaded. Make sure the script is included in index.html');
    }

    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CONFIG.clientId,
      scope: GOOGLE_OAUTH_CONFIG.scopes,
      callback: (response: any) => {
        if (response.access_token) {
          this.accessToken = response.access_token;
        }
      },
    });

    this.gisLoaded = true;
  }

  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

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
        this.tokenClient.requestAccessToken({ prompt: '' });
      } else {
        this.tokenClient.requestAccessToken({ prompt: 'consent' });
      }
    });
  }

  public signOut(): void {
    this.accessToken = null;
  }

  // --- HELPER METHODS ---

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
   * Append rows to a sheet using OVERWRITE to preserve row formatting
   */
  private async sheetsAppend(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
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

  public async checkTabExists(tabName: string): Promise<boolean> {
    const config = this.getConfig();
    try {
      await this.sheetsGet(config.spreadsheets.workerbook, `'${tabName}'!A1`);
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
   * The returned data includes _importMeta with source and dateTab
   */
  public async importSessionData(dateTab: string): Promise<DailySessionData> {
    const config = this.getConfig();
    const ccId = commandCenterService.getCurrentCommandCenterId();
    
    if (!isValidDateTab(dateTab)) {
      throw new Error(`Invalid date tab format: ${dateTab}. Use MmmDD format (e.g., Feb01)`);
    }

    const tabExists = await this.checkTabExists(dateTab);
    if (!tabExists) {
      throw new Error(`Tab "${dateTab}" not found in Workerbook. Please check the tab name.`);
    }

    const [routesData, bookingsData, workersData, managersData] = await Promise.all([
      this.sheetsGet(config.spreadsheets.masterbookings, `'${SHEET_TABS.routes}'!A:G`),
      this.sheetsGet(config.spreadsheets.masterbookings, `'${SHEET_TABS.feedPlaceholder}'!A:M`),
      this.sheetsGet(config.spreadsheets.workerbook, `'${dateTab}'!A:K`),
      this.sheetsGet(config.spreadsheets.workerbook, `'${SHEET_TABS.managers}'!A:G`),
    ]);

    const date = new Date().toISOString().split('T')[0];

    // --- PROCESS MANAGERS ---
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
        commandCenterId: ccId || undefined,
      });
    }

    const managers = Array.from(managersMap.values());

    // --- PROCESS ROUTES ---
    const routes: RouteData[] = [];

    for (let i = 1; i < routesData.length; i++) {
      const row = routesData[i];
      const managerName = row[0]?.toString().trim();
      const routeCode = row[3]?.toString().trim();
      const streetListRaw = row[4]?.toString() || '';

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
          commandCenterId: ccId || undefined,
        });
      }
    }

    // --- PROCESS WORKERS ---
    const workers: Worker[] = [];

    for (let i = 2; i < workersData.length; i++) {
      const row = workersData[i];
      const showValue = row[10]?.toString().trim().toLowerCase();

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
        commandCenterId: ccId || undefined,
      });
    }

    // --- PROCESS BOOKINGS ---
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
        sort_order: i - 2,
        _sourceRow: i + 1,
        commandCenterId: ccId || undefined,
      };

      pendingBookings.push(booking);
    }

    // Return with import metadata embedded
    const result: DailySessionData = { 
      date, 
      managers, 
      workers, 
      routes, 
      pendingBookings,
      commandCenterId: ccId || undefined,
    };

    // Add import metadata (will be stored in session)
    (result as any)._importMeta = {
      source: 'sheets',
      dateTab: dateTab,
      sheetsExported: false
    } as ImportMeta;

    return result;
  }

  // --- WRITE OPERATIONS ---

  public async updateCompletedBookings(
    bookings: Array<{
      routeNumber: string;
      firstName: string;
      lastName: string;
      dateCompleted: string;
      contractorId: string;
    }>
  ): Promise<number> {
    const config = this.getConfig();
    
    const currentData = await this.sheetsGet(
      config.spreadsheets.masterbookings,
      `'${SHEET_TABS.feedPlaceholder}'!A:M`
    );

    const updates: { range: string; values: any[][] }[] = [];
    let matchCount = 0;

    for (const booking of bookings) {
      for (let i = 2; i < currentData.length; i++) {
        const row = currentData[i];
        const rowRoute = row[0]?.toString().trim();
        const rowFirst = row[1]?.toString().trim().toLowerCase();
        const rowLast = row[2]?.toString().trim().toLowerCase();

        if (
          rowRoute === booking.routeNumber &&
          rowFirst === booking.firstName.toLowerCase() &&
          rowLast === booking.lastName.toLowerCase()
        ) {
          const rowNum = i + 1;
          updates.push({
            range: `'${SHEET_TABS.feedPlaceholder}'!L${rowNum}:M${rowNum}`,
            values: [[booking.dateCompleted, booking.contractorId]],
          });
          matchCount++;
          break;
        }
      }
    }

    if (updates.length > 0) {
      await this.sheetsBatchUpdate(config.spreadsheets.masterbookings, updates);
    }

    return matchCount;
  }

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

    const config = this.getConfig();

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
      config.spreadsheets.masterbookings,
      `'${SHEET_TABS.accounts}'!A:P`,
      rows
    );
  }

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

    const config = this.getConfig();

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
      config.spreadsheets.masterbookings,
      `'${SHEET_TABS.logsheets}'!A:M`,
      rows
    );
  }

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

    const config = this.getConfig();

    const rows = stats.map(s => [
      dateTab,
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
      config.spreadsheets.workerbook,
      `'${SHEET_TABS.payoutStats}'!A:AH`,
      rows
    );
  }
}

export const googleSheetsService = GoogleSheetsService.getInstance();
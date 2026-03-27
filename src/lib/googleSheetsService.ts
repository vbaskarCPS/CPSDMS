// src/lib/googleSheetsService.ts
import { 
  getGoogleSheetsConfig, 
  GOOGLE_OAUTH_CONFIG, 
  SHEET_TABS, 
  isValidDateTab,
  getFeedColumnsConfig,
  getFeedRange,
  isServiceIncluded,
  seasonUsesServiceFlags,
  WORKERBOOK_COLUMNS,
  DATE_TAB_COLUMNS,
  FEED_COLUMNS,
  PAYOUT_STATS_COLUMNS
} from './googleSheetsConfig';
import { commandCenterService, seasonHasTeams } from './commandCenterService';
import { 
  DailySessionData, 
  ManagementUser, 
  Worker, 
  RouteData, 
  MasterBooking,
  SeasonType,
  ServiceFlags,
  TeamCart,
  SEASON_CONFIGS
} from '../types';
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
  dateTab?: string;
  sheetsExported?: boolean;
  seasonType?: SeasonType;
  productCostPercent?: number;
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

  // Returns the current OAuth access token, or null if not authenticated.
  // Used by features (like Write Routes) that need to call the Sheets API
  // on behalf of the user against arbitrary spreadsheets.
  public getAccessToken(): string | null {
    return this.accessToken;
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

  // --- PRIVATE HELPER METHODS ---

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

  private parseServiceFlags(row: any[], colConfig: typeof FEED_COLUMNS['mapping']): ServiceFlags {
    return {
      aeration: isServiceIncluded(row[colConfig.serviceAeration]),
      dethatch: isServiceIncluded(row[colConfig.serviceDethatch]),
      fertilizer: isServiceIncluded(row[colConfig.serviceFertilizer]),
      seed: isServiceIncluded(row[colConfig.serviceSeed]),
      lime: isServiceIncluded(row[colConfig.serviceLime]),
    };
  }

  // --- PUBLIC UTILITY METHODS ---

  public serviceFlagsToString(services?: ServiceFlags): string {
    if (!services) return '';
    
    let result = '';
    if (services.aeration) result += 'A';
    if (services.dethatch) result += 'D';
    if (services.fertilizer) result += 'F';
    if (services.seed) result += 'S';
    if (services.lime) result += 'L';
    
    return result ? `(${result})` : '';
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
   * Read a range from the Workerbook spreadsheet.
   * Used by TrainingsTab to sync contractors.
   * @param range - A1 notation, e.g. "A:K"
   */
  public async readWorkerbookRange(range: string): Promise<any[][]> {
    const config = this.getConfig();
    return this.sheetsGet(config.spreadsheets.workerbook, range);
  }

  /**
   * Read a range from the Masterbookings spreadsheet.
   * Used by Digital Master Bookings to load the Bookings tab.
   * @param range - A1 notation, e.g. "'Bookings'!A:P"
   */
  public async readMasterbookingsRange(range: string): Promise<any[][]> {
    const config = this.getConfig();
    return this.sheetsGet(config.spreadsheets.masterbookings, range);
  }

  /**
   * Get the numeric sheetId for a named tab in the Masterbookings spreadsheet.
   * Needed by the formatting API — tab names alone aren't accepted there.
   */
  public async getMasterbookingsTabSheetId(tabName: string): Promise<number | null> {
    if (!this.accessToken) throw new Error('Not authenticated. Call authenticate() first.');
    const config = this.getConfig();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.masterbookings}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );

    if (!response.ok) return null;
    const data = await response.json();
    const sheet = (data.sheets || []).find(
      (s: any) => s.properties.title === tabName
    );
    return sheet?.properties.sheetId ?? null;
  }

  /**
   * Paint cell K (email column, 0-based index 10) a light red background
   * in the Masterbookings Bookings tab for a given 1-based sheet row number.
   * Called when a DMB confirmation email fails to send.
   */
  public async highlightBookingEmailCell(
    sheetId: number,
    rowNumber: number
  ): Promise<void> {
    if (!this.accessToken) throw new Error('Not authenticated. Call authenticate() first.');
    const config = this.getConfig();

    // Convert 1-based sheet row to 0-based Sheets API index
    const rowIndex = rowNumber - 1;

    const request = {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 10, // Column K (0-based)
          endColumnIndex: 11,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 }, // #FFCCCC
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    };

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.masterbookings}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: [request] }),
      }
    );
  }

  /**
   * Get the numeric sheet ID for a named tab in the Masterbookings spreadsheet.
   * Required for the formatting API which uses numeric IDs, not tab names.
   */
  public async getMasterbookingsTabSheetId(tabName: string): Promise<number | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    const config = this.getConfig();
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.masterbookings}?fields=sheets.properties`,
      { headers: { Authorization: `Bearer ${this.accessToken}` } }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch masterbookings metadata');
    }
    const data = await response.json();
    const sheet = (data.sheets || []).find((s: any) => s.properties.title === tabName);
    return sheet ? sheet.properties.sheetId : null;
  }

  /**
   * Highlight the email cell (column K, index 10) light red for a specific row
   * in the Bookings tab. Called when a DMB confirmation email fails to send.
   * @param sheetId   - Numeric sheet ID of the Bookings tab
   * @param rowNumber - 1-based sheet row number
   */
  public async highlightBookingEmailCell(sheetId: number, rowNumber: number): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    const config = this.getConfig();
    const request = {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: rowNumber - 1,  // 0-based
          endRowIndex:   rowNumber,
          startColumnIndex: 10,          // Column K (0-based)
          endColumnIndex:   11,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 }, // #FFCCCC light red
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    };
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.masterbookings}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: [request] }),
      }
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to highlight email cell');
    }
  }

  /**
   * Get the numeric sheet ID for a named tab in the Masterbookings spreadsheet.
   * The formatting API requires numeric IDs — tab names alone are not enough.
   * @param tabName - e.g. 'Bookings'
   */
  public async getMasterbookingsTabSheetId(tabName: string): Promise<number | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const config = this.getConfig();
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.masterbookings}?fields=sheets.properties`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch masterbookings metadata');
    }

    const data = await response.json();
    const sheet = (data.sheets || []).find((s: any) => s.properties.title === tabName);
    return sheet ? sheet.properties.sheetId : null;
  }

  /**
   * Highlight the email cell (column K) for a specific row in the Bookings tab
   * with a light red background to flag a failed email send.
   * Non-fatal — logs a warning on failure but does not throw.
   * @param numericSheetId - pre-fetched via getMasterbookingsTabSheetId('Bookings')
   * @param rowNumber      - 1-based sheet row number
   */
  public async highlightFailedEmailCell(numericSheetId: number, rowNumber: number): Promise<void> {
    if (!this.accessToken) return;

    const config = this.getConfig();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.masterbookings}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{
            repeatCell: {
              range: {
                sheetId: numericSheetId,
                startRowIndex: rowNumber - 1, // 0-based
                endRowIndex: rowNumber,
                startColumnIndex: 10,         // Column K (email)
                endColumnIndex: 11,
              },
              cell: {
                userEnteredFormat: {
                  // Light red #FFCCCC
                  backgroundColor: { red: 1.0, green: 0.8, blue: 0.8 },
                },
              },
              fields: 'userEnteredFormat.backgroundColor',
            },
          }],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.warn('Failed to highlight email cell:', error.error?.message);
    }
  }

  /**
   * Import session data from Google Sheets.
   * @param dateTab - The date tab name (e.g., "Feb01")
   * @param seasonType - The season type ('aeration' or 'lawn_rejuv')
   */
  public async importSessionData(dateTab: string, seasonType: SeasonType = 'aeration'): Promise<DailySessionData> {
    const config = this.getConfig();
    const ccId = commandCenterService.getCurrentCommandCenterId();
    const isTeamSeason = seasonHasTeams(seasonType);
    const seasonConfig = SEASON_CONFIGS[seasonType];
    const useServiceFlags = seasonUsesServiceFlags(seasonType);
    
    if (!isValidDateTab(dateTab)) {
      throw new Error(`Invalid date tab format: ${dateTab}. Use MmmDD format (e.g., Feb01)`);
    }

    const tabExists = await this.checkTabExists(dateTab);
    if (!tabExists) {
      throw new Error(`Tab "${dateTab}" not found in Workerbook. Please check the tab name.`);
    }

    const feedRange = getFeedRange(seasonType);
    const feedColumns = getFeedColumnsConfig(seasonType);

    // FIXED: Use DATE_TAB_COLUMNS range (A:W) instead of the old hardcoded A:K.
    // Date tabs have a different column layout than the Contractors tab —
    // columns start at A (Shuttle) with no empty column A prefix.
    const workerbookRange = `'${dateTab}'!${DATE_TAB_COLUMNS.range}`;

    const [routesData, bookingsData, workersData, managersData] = await Promise.all([
      this.sheetsGet(config.spreadsheets.masterbookings, `'${SHEET_TABS.routes}'!A:G`),
      this.sheetsGet(config.spreadsheets.masterbookings, `'${SHEET_TABS.feedPlaceholder}'!${feedRange}`),
      this.sheetsGet(config.spreadsheets.workerbook, workerbookRange),
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
    // FIXED: Use DATE_TAB_COLUMNS.mapping for date tabs instead of WORKERBOOK_COLUMNS.mapping.
    // Date tabs start at column A (Shuttle) whereas the Contractors tab has an empty column A,
    // so all indices are shifted left by 1 on date tabs.
    const workers: Worker[] = [];
    const dateTabColMap = DATE_TAB_COLUMNS.mapping;

    for (let i = DATE_TAB_COLUMNS.dataStartRow; i < workersData.length; i++) {
      const row = workersData[i];
      const showValue = row[dateTabColMap.showFlag]?.toString().trim().toLowerCase();

      if (showValue !== 'x') continue;

      const contractorId = row[dateTabColMap.contractorId]?.toString().trim() || '';
      const firstName = row[dateTabColMap.firstName]?.toString().trim() || '';
      const lastName = row[dateTabColMap.lastName]?.toString().trim() || '';
      const cellPhone = row[dateTabColMap.cellPhone]?.toString().trim() || '';
      const alumniRate = parseFloat(row[dateTabColMap.alumniRate]) || 0;
      const silverRate = parseFloat(row[dateTabColMap.silverRate]) || 0;
      const managerName = row[dateTabColMap.managerName]?.toString().trim() || '';
      const teamId = isTeamSeason ? row[dateTabColMap.teamId]?.toString().trim() || '' : '';

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
        teamId: teamId || undefined,
      });
    }

    // --- BUILD TEAM CARTS (Lawn Rejuv only) ---
    let teamCarts: TeamCart[] | undefined;
    
    if (isTeamSeason) {
      const teamMap = new Map<string, Worker[]>();
      
      workers.forEach(w => {
        const tid = w.teamId || w.contractorId;
        if (!teamMap.has(tid)) {
          teamMap.set(tid, []);
        }
        teamMap.get(tid)!.push(w);
      });
      
      teamCarts = Array.from(teamMap.entries()).map(([teamId, teamWorkers]) => ({
        teamId,
        workerIds: teamWorkers.map(w => w.contractorId),
        workers: teamWorkers,
      }));
    }

    // --- PROCESS BOOKINGS ---
    const pendingBookings: MasterBooking[] = [];
    const colMap = feedColumns.mapping;

    for (let i = 2; i < bookingsData.length; i++) {
      const row = bookingsData[i];
      const routeNum = row[colMap.routeNumber]?.toString().trim();

      if (!routeNum) continue;

      let services: ServiceFlags | undefined;
      if (useServiceFlags) {
        services = this.parseServiceFlags(row, colMap);
      }

      const booking: MasterBooking = {
        'Booking ID': `job_${i}_${Date.now()}`,
        'Route Number': routeNum,
        'First Name': row[colMap.firstName]?.toString().trim() || '',
        'Last Name': row[colMap.lastName]?.toString().trim() || '',
        'House Number': row[colMap.houseNumber]?.toString().trim() || '',
        'Street Name': row[colMap.streetName]?.toString().trim() || '',
        'Full Address': `${row[colMap.houseNumber] || ''} ${row[colMap.streetName] || ''}`.trim(),
        'Home Phone': formatPhoneNumber(row[colMap.phone]?.toString() || ''),
        'Email Address': normalizeEmail(row[colMap.email]?.toString() || ''),
        'Price': row[colMap.price]?.toString() || '',
        'FO/BO/FP': row[colMap.serviceType]?.toString().trim() as any,
        'Prepaid': row[colMap.prepaid]?.toString().toLowerCase() === 'x' ? 'x' : undefined,
        'Log Sheet Notes': row[colMap.logNotes]?.toString() || '',
        'Status': 'pending',
        'Completed': undefined,
        isPrebooked: true,
        sort_order: i - 2,
        _sourceRow: i + 1,
        commandCenterId: ccId || undefined,
        services,
      };

      pendingBookings.push(booking);
    }

    const result: DailySessionData = { 
      date, 
      managers, 
      workers, 
      routes, 
      pendingBookings,
      commandCenterId: ccId || undefined,
      seasonType,
      teamCarts,
    };

    (result as any)._importMeta = {
      source: 'sheets',
      dateTab: dateTab,
      sheetsExported: false,
      seasonType,
      productCostPercent: seasonConfig.defaultProductCostPercent,
    } as ImportMeta;

    return result;
  }

  // --- WRITE OPERATIONS ---

  public async updateCompletedBookings(
    bookings: Array<{
      _sourceRow: number;
      dateCompleted: string;
      contractorId: string;
      services?: ServiceFlags;
      isCancelled?: boolean;
    }>,
    seasonType: SeasonType = 'aeration'
  ): Promise<number> {
    const config = this.getConfig();
    const useServiceFlags = seasonUsesServiceFlags(seasonType);

    const updates: { range: string; values: any[][] }[] = [];

    for (const booking of bookings) {
      const rowNum = booking._sourceRow;
      
      if (!rowNum || rowNum < 1) {
        console.warn('Skipping booking with invalid _sourceRow:', booking);
        continue;
      }

      const dateValue = booking.isCancelled ? 'Cancelled' : booking.dateCompleted;
      const contractorValue = booking.isCancelled ? '' : booking.contractorId;

      if (useServiceFlags && booking.services && !booking.isCancelled) {
        const values = [
          booking.services.aeration ? 'x' : '',
          booking.services.dethatch ? 'x' : '',
          booking.services.fertilizer ? 'x' : '',
          booking.services.seed ? 'x' : '',
          booking.services.lime ? 'x' : '',
          dateValue,
          contractorValue,
        ];
        updates.push({
          range: `'${SHEET_TABS.feedPlaceholder}'!L${rowNum}:R${rowNum}`,
          values: [values],
        });
      } else {
        updates.push({
          range: `'${SHEET_TABS.feedPlaceholder}'!Q${rowNum}:R${rowNum}`,
          values: [[dateValue, contractorValue]],
        });
      }
    }

    if (updates.length > 0) {
      await this.sheetsBatchUpdate(config.spreadsheets.masterbookings, updates);
    }

    return updates.length;
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
      services?: ServiceFlags;
    }>
  ): Promise<void> {
    if (accounts.length === 0) return;

    const config = this.getConfig();

    const rows = accounts.map(a => {
      const servicesStr = this.serviceFlagsToString(a.services);
      const notesWithServices = servicesStr 
        ? `${a.notes} ${servicesStr}`.trim() 
        : a.notes;
      
      return [
        a.routeNumber,
        a.firstName,
        a.lastName,
        a.streetNum,
        a.streetName,
        a.phone,
        a.email,
        a.clientType,
        a.propertyType,
        notesWithServices,
        a.price,
        a.paymentType,
        a.contractorName,
        a.paymentDetails,
        a.expiry,
        a.cvc,
      ];
    });

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
      services?: ServiceFlags;
    }>
  ): Promise<void> {
    if (logsheets.length === 0) return;

    const config = this.getConfig();

    const rows = logsheets.map(l => {
      const servicesStr = this.serviceFlagsToString(l.services);
      const notesWithServices = servicesStr 
        ? `${l.notes} ${servicesStr}`.trim() 
        : l.notes;
      
      return [
        l.routeNumber,
        l.firstName,
        l.lastName,
        l.streetNum,
        l.streetName,
        l.phone,
        l.email,
        l.clientType,
        l.propertyType,
        notesWithServices,
        l.price,
        l.paymentType,
        l.contractorName,
      ];
    });

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
      totalEQ?: number;
      teamTotalEQ?: number;
      assignedEQ?: number;
      upsellCount: number;
      upsellCash: number;
      upsellCheque: number;
      upsellCreditCard: number;
      upsellETransfer: number;
      upsellPrepaid: number;
      upsellGross: number;
      upsellPayable: number;
      payoutRate?: number;
      totalPayoutRate?: number;
      productionComm: number;
      upsellComm: number;
      iosComm: number;
      machineRental: number;
      deductions: number;
      bonuses: number;
      finalPay: number;
      teamId?: string;
      equivSplitPercent?: number;
      upsellSplitPercent?: number;
    }>
  ): Promise<void> {
    if (stats.length === 0) return;

    const config = this.getConfig();

    const rows = stats.map(s => {
      const eqValue = s.assignedEQ ?? s.teamTotalEQ ?? s.totalEQ ?? 0;
      const rateValue = s.totalPayoutRate ?? s.payoutRate ?? 0;
      
      return [
        dateTab,            // A: Date
        s.contractorId,     // B: Contractor ID
        s.firstName,        // C: First Name
        s.lastName,         // D: Last Name
        s.manager,          // E: Manager
        s.stepCount,        // F: Step Count
        s.iosCount,         // G: IOSCount
        s.prodBilled,       // H: prodBilled
        s.prodCash,         // I: prodCash
        s.prodCheque,       // J: prodCheque
        s.prodCreditCard,   // K: prodCreditCard
        s.prodETransfer,    // L: prodETransfer
        s.prodFlats,        // M: ProdFlats
        s.prodPrepaid,      // N: prodPrepaid
        s.prodPrepaidSplit, // O: prodPrepaidSplit
        s.prodGross,        // P: ProdGross
        s.prodPayable,      // Q: ProdPayable
        eqValue,            // R: totalEQ
        s.upsellCount,      // S: upsellCount
        s.upsellCash,       // T: upsellCash
        s.upsellCheque,     // U: upsellCheque
        s.upsellCreditCard, // V: upsellCreditCard
        s.upsellETransfer,  // W: upsellETransfer
        s.upsellPrepaid,    // X: upsellPrepaid
        s.upsellGross,      // Y: upsellGross
        s.upsellPayable,    // Z: upsellPayable
        rateValue,          // AA: Payout rate
        s.productionComm,   // AB: Production Comm.
        s.upsellComm,       // AC: Upsell Commission
        s.iosComm,          // AD: IOS Commission
        s.machineRental,    // AE: Machine Rental
        s.deductions,       // AF: Deductions
        s.bonuses,          // AG: Bonuses
        s.finalPay,         // AH: Final Pay
      ];
    });

    await this.sheetsAppend(
      config.spreadsheets.workerbook,
      `'${SHEET_TABS.payoutStats}'!${PAYOUT_STATS_COLUMNS.range}`,
      rows
    );
  }

  public async appendApplicants(applicants: any[][]): Promise<void> {
    if (applicants.length === 0) return;

    const config = this.getConfig();

    await this.sheetsAppend(
      config.spreadsheets.workerbook,
      `'Applicants'!A:T`,
      applicants
    );
  }

  // --- TRAINING COLOUR METHODS ---

  /**
   * Fetch all tab names and their numeric sheet IDs from the workerbook.
   * The formatting API requires numeric IDs — tab names alone aren't enough.
   */
  private async sheetsGetSpreadsheetMetadata(): Promise<{ sheetId: number; title: string }[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const config = this.getConfig();
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.workerbook}?fields=sheets.properties`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch spreadsheet metadata');
    }

    const data = await response.json();
    return (data.sheets || []).map((s: any) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
    }));
  }

  /**
   * Read multiple ranges from the workerbook in one API call.
   * Chunked at 50 ranges per request to stay under Google's limit.
   */
  private async sheetsBatchGetValues(
    ranges: string[]
  ): Promise<{ values: any[][] }[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const config = this.getConfig();
    const CHUNK_SIZE = 50;
    const results: { values: any[][] }[] = [];

    for (let i = 0; i < ranges.length; i += CHUNK_SIZE) {
      const chunk = ranges.slice(i, i + CHUNK_SIZE);
      const params = chunk.map(r => `ranges=${encodeURIComponent(r)}`).join('&');

      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.workerbook}/values:batchGet?${params}`,
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to batch get values');
      }

      const data = await response.json();
      for (const vr of (data.valueRanges || [])) {
        results.push({ values: vr.values || [] });
      }
    }

    return results;
  }

  /**
   * Apply cell background colour formatting to the workerbook.
   * Uses the spreadsheet batchUpdate endpoint (separate from the values batchUpdate).
   * Chunked at 1000 requests per call to stay within API limits.
   */
  private async sheetsFormatBatchUpdate(requests: any[]): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const config = this.getConfig();
    const CHUNK_SIZE = 1000;

    for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
      const chunk = requests.slice(i, i + CHUNK_SIZE);

      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheets.workerbook}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests: chunk }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to apply cell formatting');
      }
    }
  }

  /**
   * Apply training status colours to every CN# cell across all workerbook tabs.
   *
   * Colour legend:
   *   Gold        (#FFD966) — Level 2 fully complete
   *   Light grey  (#D9D9D9) — Level 1 fully complete (regardless of L2 status)
   *   Light green (#C6EFCE) — At least 1 module complete, Level 1 not yet finished
   *   White                 — No training progress recorded
   *
   * Tabs covered:
   *   - Contractors tab        → CN# in column C (index 2)
   *   - All MmmDD date tabs    → CN# in column B (index 1)
   *   - WL, NS, WDR, TNB, Q, F, SNOW → CN# in column B (index 1)
   *
   * @param colorMap  Map of contractorId → training status
   * @returns         Number of cells that received a non-white colour
   */
  public async applyTrainingColorsToWorkerbook(
    colorMap: Map<string, 'none' | 'started' | 'level1' | 'level2'>
  ): Promise<number> {
    // RGB values on Google's 0–1 scale
    const COLORS = {
      level2:  { red: 1.0,   green: 0.851, blue: 0.4   }, // #FFD966 gold
      level1:  { red: 0.851, green: 0.851, blue: 0.851  }, // #D9D9D9 light grey
      started: { red: 0.776, green: 0.937, blue: 0.808  }, // #C6EFCE light green
      none:    { red: 1.0,   green: 1.0,   blue: 1.0    }, // white (clear)
    };

    const SPECIAL_TABS = new Set(['WL', 'NS', 'WDR', 'TNB', 'Q', 'F', 'SNOW']);

    // 1. Get all sheet metadata (tab name → numeric sheetId)
    const sheetMeta = await this.sheetsGetSpreadsheetMetadata();
    const sheetIdMap = new Map<string, number>();
    sheetMeta.forEach(s => sheetIdMap.set(s.title, s.sheetId));

    // 2. Decide which tabs to process and which column CN# lives in
    //    cnColIndex is 0-based: column B = 1, column C = 2
    const tabsToProcess: { title: string; cnColIndex: number }[] = [];

    for (const sheet of sheetMeta) {
      const { title } = sheet;
      if (title === 'Contractors') {
        tabsToProcess.push({ title, cnColIndex: 2 }); // Column C
      } else if (SPECIAL_TABS.has(title) || isValidDateTab(title)) {
        tabsToProcess.push({ title, cnColIndex: 1 }); // Column B
      }
    }

    // 3. Build one range per tab to read its CN# column (rows 3 onwards)
    const ranges = tabsToProcess.map(t => {
      const col = t.cnColIndex === 2 ? 'C' : 'B';
      return `'${t.title}'!${col}3:${col}2000`;
    });

    // 4. Read all CN# columns in one (chunked) batch call
    const valueResults = await this.sheetsBatchGetValues(ranges);

    // 5. Build one formatting request per non-empty CN# cell
    const formatRequests: any[] = [];
    let coloured = 0;

    for (let i = 0; i < tabsToProcess.length; i++) {
      const tab = tabsToProcess[i];
      const sheetId = sheetIdMap.get(tab.title);
      if (sheetId === undefined) continue;

      const rows = valueResults[i]?.values || [];

      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const cn = rows[rowIdx]?.[0]?.toString().trim();
        if (!cn) continue;

        const status = colorMap.get(cn) ?? 'none';
        const bgColor = COLORS[status];

        // Sheet row index is 0-based; data starts at spreadsheet row 3 = index 2
        const sheetRowIndex = rowIdx + 2;

        formatRequests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: sheetRowIndex,
              endRowIndex: sheetRowIndex + 1,
              startColumnIndex: tab.cnColIndex,
              endColumnIndex: tab.cnColIndex + 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: bgColor,
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
          },
        });

        if (status !== 'none') coloured++;
      }
    }

    // 6. Fire all formatting requests in one (chunked) batch
    if (formatRequests.length > 0) {
      await this.sheetsFormatBatchUpdate(formatRequests);
    }

    return coloured;
  }
}

export const googleSheetsService = GoogleSheetsService.getInstance();
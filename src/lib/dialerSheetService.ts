// src/lib/dialerSheetsService.ts
//
// Thin Google Sheets API wrapper for the AutoSniper dialer.
// Unlike googleSheetsService (which is tied to Command Center context),
// this operates on arbitrary spreadsheet IDs passed in by the caller.
// It shares the same OAuth token flow via googleSheetsService.
//
import { googleSheetsService } from './googleSheetsService';
import { GOOGLE_OAUTH_CONFIG } from './googleSheetsConfig';

class DialerSheetsService {
  private static instance: DialerSheetsService;
  private accessToken: string | null = null;
  private tokenClient: any = null;
  private gapiLoaded: boolean = false;
  private gisLoaded: boolean = false;

  private constructor() {}

  public static getInstance(): DialerSheetsService {
    if (!DialerSheetsService.instance) {
      DialerSheetsService.instance = new DialerSheetsService();
    }
    return DialerSheetsService.instance;
  }

  // --- INITIALIZATION & AUTH ---

  /**
   * Initialize the Google API client library (gapi).
   * Safe to call multiple times — will only load once.
   */
  public async initGapi(): Promise<void> {
    if (this.gapiLoaded) return;

    return new Promise((resolve, reject) => {
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
   * Initialize the Google Identity Services token client.
   * Safe to call multiple times — will only init once.
   */
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

  /**
   * Check if we have a valid access token.
   */
  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Trigger OAuth flow. Returns true if successful.
   * If the user has already granted access, this will silently refresh.
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
        this.tokenClient.requestAccessToken({ prompt: '' });
      } else {
        this.tokenClient.requestAccessToken({ prompt: 'consent' });
      }
    });
  }

  /**
   * Clear the access token.
   */
  public signOut(): void {
    this.accessToken = null;
  }

  // --- CORE SHEETS OPERATIONS ---

  /**
   * Ensure we have a token, throw a clear error if not.
   */
  private requireAuth(): string {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Google. Please connect first.');
    }
    return this.accessToken;
  }

  /**
   * GET values from a range in any spreadsheet.
   * Returns a 2D array of cell values (rows × cols). Empty ranges return [].
   */
  public async sheetsGet(spreadsheetId: string, range: string): Promise<any[][]> {
    const token = this.requireAuth();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
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
   * PUT (overwrite) values in a range in any spreadsheet.
   */
  public async sheetsUpdate(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    const token = this.requireAuth();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
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
   * Batch update multiple ranges in any spreadsheet.
   */
  public async sheetsBatchUpdate(
    spreadsheetId: string,
    data: { range: string; values: any[][] }[]
  ): Promise<void> {
    const token = this.requireAuth();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
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

  /**
   * Append rows to a range in any spreadsheet.
   */
  public async sheetsAppend(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
    const token = this.requireAuth();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
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

  // --- SPREADSHEET METADATA ---

  /**
   * Fetch all sheet/tab names from a spreadsheet.
   * Returns an array of { sheetId, title } objects.
   */
  public async getSheetTabs(
    spreadsheetId: string
  ): Promise<{ sheetId: number; title: string }[]> {
    const token = this.requireAuth();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch spreadsheet metadata');
    }

    const data = await response.json();
    const sheets = data.sheets || [];

    return sheets.map((s: any) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
    }));
  }

  /**
   * Fetch tab names filtered for the dialer — excludes CCD and Managers tabs.
   * Returns just the title strings for callbook tabs.
   */
  public async getCallbookTabs(spreadsheetId: string): Promise<string[]> {
    const allTabs = await this.getSheetTabs(spreadsheetId);
    const excludeNames = new Set(['ccd', 'managers']);
    return allTabs
      .map((t) => t.title)
      .filter((name) => !excludeNames.has(name.toLowerCase()));
  }
}

export const dialerSheetsService = DialerSheetsService.getInstance();
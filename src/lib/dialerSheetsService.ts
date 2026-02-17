// src/lib/dialerSheetsService.ts
//
// Thin Google Sheets API wrapper for the AutoSniper dialer.
// Unlike googleSheetsService (which is tied to Command Center context),
// this operates on arbitrary spreadsheet IDs passed in by the caller.
// It shares the same OAuth token flow via googleSheetsService.
//
// Token management: GIS implicit grant tokens expire after 3600s (1 hour).
// We track token age and silently refresh when within 5 minutes of expiry.
// Every API method calls ensureFreshToken() before making requests.
//
import { googleSheetsService } from './googleSheetsService';
import { GOOGLE_OAUTH_CONFIG } from './googleSheetsConfig';

/** Refresh the token 5 minutes before it expires */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Default GIS token lifetime (Google returns this in the response too) */
const DEFAULT_TOKEN_LIFETIME_MS = 3600 * 1000;

class DialerSheetsService {
  private static instance: DialerSheetsService;
  private accessToken: string | null = null;
  private tokenIssuedAt: number = 0;
  private tokenExpiresIn: number = DEFAULT_TOKEN_LIFETIME_MS;
  private tokenClient: any = null;
  private gapiLoaded: boolean = false;
  private gisLoaded: boolean = false;
  private refreshPromise: Promise<boolean> | null = null; // dedup concurrent refreshes

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
          this.tokenIssuedAt = Date.now();
          this.tokenExpiresIn = (response.expires_in || 3600) * 1000;
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
   * Check if the current token is expired or within the refresh buffer.
   */
  private isTokenExpiring(): boolean {
    if (!this.accessToken || !this.tokenIssuedAt) return true;
    const elapsed = Date.now() - this.tokenIssuedAt;
    return elapsed >= (this.tokenExpiresIn - REFRESH_BUFFER_MS);
  }

  /**
   * Silently refresh the token without showing a popup.
   * Uses prompt: '' which works because the user already granted consent.
   * Deduplicates concurrent calls so only one refresh runs at a time.
   */
  private async silentRefresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = new Promise<boolean>((resolve) => {
      this.tokenClient.callback = (response: any) => {
        if (response.access_token) {
          this.accessToken = response.access_token;
          this.tokenIssuedAt = Date.now();
          this.tokenExpiresIn = (response.expires_in || 3600) * 1000;
          this.refreshPromise = null;
          resolve(true);
        } else {
          this.refreshPromise = null;
          resolve(false);
        }
      };

      this.tokenClient.requestAccessToken({ prompt: '' });
    });

    return this.refreshPromise;
  }

  /**
   * Ensure we have a fresh token before making an API call.
   * Replaces the old synchronous requireAuth() — now async so it can
   * silently refresh an expiring token before returning it.
   */
  private async ensureFreshToken(): Promise<string> {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Google. Please connect first.');
    }

    if (this.isTokenExpiring()) {
      const refreshed = await this.silentRefresh();
      if (!refreshed || !this.accessToken) {
        throw new Error('Google session expired. Please reconnect.');
      }
    }

    return this.accessToken;
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
          this.tokenIssuedAt = Date.now();
          this.tokenExpiresIn = (response.expires_in || 3600) * 1000;
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
    this.tokenIssuedAt = 0;
    this.refreshPromise = null;
  }

  // --- CORE SHEETS OPERATIONS ---

  /**
   * GET values from a range in any spreadsheet.
   * Returns a 2D array of cell values (rows × cols). Empty ranges return [].
   */
  public async sheetsGet(spreadsheetId: string, range: string): Promise<any[][]> {
    const token = await this.ensureFreshToken();

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
    const token = await this.ensureFreshToken();

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
    const token = await this.ensureFreshToken();

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
    const token = await this.ensureFreshToken();

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

  // --- FORMATTING (spreadsheets.batchUpdate) ---

  /**
   * Send a batch of formatting requests to a spreadsheet.
   * Uses the spreadsheets.batchUpdate endpoint (NOT values:batchUpdate).
   * This is used for cell background color changes (highlighting).
   *
   * Each request in the array should be a Sheets API request object, e.g.:
   * {
   *   repeatCell: {
   *     range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex },
   *     cell: { userEnteredFormat: { backgroundColor: { red, green, blue } } },
   *     fields: 'userEnteredFormat.backgroundColor'
   *   }
   * }
   *
   * @see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/request
   */
  public async sheetsFormatBatch(
    spreadsheetId: string,
    requests: any[]
  ): Promise<void> {
    if (requests.length === 0) return;

    const token = await this.ensureFreshToken();

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to apply formatting');
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
    const token = await this.ensureFreshToken();

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
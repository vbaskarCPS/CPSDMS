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
   * GET multiple ranges in a single API call.
   * Returns an array of range values in the SAME order as the input ranges.
   * Each entry is a 2D array (rows x columns). Empty tabs return [].
   *
   * This is the quota-friendly way to load many tabs at once — instead of
   * N separate API calls, use one batchGet with N ranges.
   */
  public async sheetsBatchGet(spreadsheetId: string, ranges: string[]): Promise<any[][][]> {
    if (ranges.length === 0) return [];

    const token = await this.ensureFreshToken();

    // Build query string with repeated ranges=X parameters
    const params = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to batch fetch sheet data');
    }

    const data = await response.json();
    const valueRanges: Array<{ range: string; values?: any[][] }> = data.valueRanges || [];

    // Return in the same order as the input ranges, empty arrays for missing
    return ranges.map((_, idx) => valueRanges[idx]?.values || []);
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

  /**
   * Send a batch of formatting requests to a spreadsheet.
   * Uses the spreadsheets.batchUpdate endpoint (NOT values:batchUpdate).
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
   * Fetch callbook tab names — excludes CCD and Managers tabs.
   */
  public async getCallbookTabs(spreadsheetId: string): Promise<string[]> {
    const allTabs = await this.getSheetTabs(spreadsheetId);
    const excludeNames = new Set(['ccd', 'managers']);
    return allTabs
      .map((t) => t.title)
      .filter((name) => !excludeNames.has(name.toLowerCase()));
  }

  // --- CELL BACKGROUND COLORS ---

  /**
   * Fetch background colors for a single column range.
   * Returns an array (one entry per row) of 'green' | 'silver' | 'gold' | null.
   * Used by Digital Workerbook to show contractor status dots.
   */
  public async getColumnBackgroundColors(
    spreadsheetId: string,
    sheetName: string,
    startRow: number,
    endRow: number,
    column: string, // e.g. 'B'
  ): Promise<Array<'green' | 'silver' | 'gold' | null>> {
    const token = await this.ensureFreshToken();
    const range = `'${sheetName}'!${column}${startRow}:${column}${endRow}`;

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `?ranges=${encodeURIComponent(range)}&includeGridData=true` +
      `&fields=sheets.data.rowData.values.userEnteredFormat.backgroundColor`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch background colors');
    }

    const data = await response.json();
    const rowData: any[] = data?.sheets?.[0]?.data?.[0]?.rowData || [];

    return rowData.map((row): 'green' | 'silver' | 'gold' | null => {
      const bg = row?.values?.[0]?.userEnteredFormat?.backgroundColor;
      if (!bg) return null;

      const r = bg.red   ?? 0;
      const g = bg.green ?? 0;
      const b = bg.blue  ?? 0;

      // White / near-white = no status
      if (r > 0.9 && g > 0.9 && b > 0.9) return null;

      // Green: dominant green channel
      if (g > 0.5 && g > r * 1.3 && g > b * 1.3) return 'green';

      // Gold/Yellow: high red + green, low blue
      if (r > 0.5 && g > 0.5 && b < 0.4) return 'gold';

      // Silver/Gray: all channels close to each other
      if (Math.abs(r - g) < 0.15 && Math.abs(g - b) < 0.15 && r > 0.2) return 'silver';

      return null;
    });
  }

  // --- CAMPAIGN STATS ---

  /**
   * Compute real stats for a single callbook tab for the campaign select screen.
   *
   * totalRows    — data rows that have both a valid 10-digit phone AND a route code
   * groups       — unique route-code clusters (the engine's natural grouping unit)
   * bookings     — individual rows where AER column has an "x" (one per booked group,
   *                since the dialer only writes one AER x per group on the detail row)
   * reachedPct   — % of groups where ≥1 row has YES / NO / WN/NIS / REMOVE
   * avgAttempts  — unreached groups only: average of (max NA value across group rows)
   * lastUsed     — most recent DATE.1 value found in the tab, as ISO string, or null
   *
   * All column positions are resolved by header name (same variants as dialerHeaders.ts)
   * so this works regardless of column order.
   */
  public async computeTabStats(
    spreadsheetId: string,
    tabName: string
  ): Promise<{
    totalRows: number;
    groups: number;
    bookings: number;
    reachedPct: number;
    avgAttempts: number;
    lastUsed: string | null;
  }> {
    const EMPTY = { totalRows: 0, groups: 0, bookings: 0, reachedPct: 0, avgAttempts: 0, lastUsed: null };

    let raw: any[][];
    try {
      raw = await this.sheetsGet(spreadsheetId, `'${tabName}'`);
    } catch {
      return EMPTY;
    }
    if (!raw || raw.length < 2) return EMPTY;

    // Find header row: scan first 5 rows, stop when PHONE column is found
    let headerIdx = 0;
    for (let r = 0; r < Math.min(5, raw.length); r++) {
      if (raw[r].some((h: any) => String(h ?? '').trim().toUpperCase() === 'PHONE')) {
        headerIdx = r;
        break;
      }
    }
    const hdr = raw[headerIdx];

    // Resolve column index by trying multiple name variants
    const colIdx = (names: string[]): number => {
      for (const n of names) {
        const i = hdr.findIndex((h: any) => String(h ?? '').trim().toUpperCase() === n.toUpperCase());
        if (i >= 0) return i;
      }
      return -1;
    };

    const CI = {
      PHONE:      colIdx(['PHONE']),
      ROUTE_CODE: colIdx(['ROUTE CODE', 'ROUTE_CODE', 'ROUTECODE']),
      NA:         colIdx(['NA', '#NA', 'NA COUNT']),
      WN:         colIdx(['WN/NIS', 'WN', 'VN/N', 'VN']),
      NO:         colIdx(['NO']),
      REMOVE:     colIdx(['REMOVE', 'EMOV']),
      YES:        colIdx(['YES']),
      AER:        colIdx(['AER']),
      DATE1:      colIdx(['DATE.1', 'DATE1', 'DATE 1']),
    };

    // ── Helpers ──

    const normalizePhone = (v: any): string => {
      let s = String(v ?? '').trim();
      if (s.endsWith('.0')) s = s.slice(0, -2);
      const d = s.replace(/\D/g, '');
      const t = d.length > 10 ? d.slice(-10) : d;
      return t.length === 10 ? t : '';
    };

    const hasValue = (v: any): boolean =>
      v !== null && v !== undefined && String(v).trim() !== '';

    const hasAER = (v: any): boolean => {
      const s = String(v ?? '').trim().toUpperCase();
      return s === 'X' || s === 'AER' || s === 'YES' || s === 'Y';
    };

    // A row is "disposed" if it has YES / NO / WN / REMOVE
    const isDisposed = (row: any[]): boolean =>
      [CI.YES, CI.NO, CI.WN, CI.REMOVE].some(c => c >= 0 && hasValue(row[c]));

    // NA column may contain numbers or "CTS" — only parse numbers
    const getNA = (row: any[]): number => {
      if (CI.NA < 0) return 0;
      const v = parseInt(String(row[CI.NA] ?? '0'), 10);
      return isNaN(v) ? 0 : Math.max(0, v);
    };

    // ── Build route-code groups from data rows ──
    const routeGroups = new Map<string, any[][]>();
    let totalRows = 0;
    let bookings = 0;
    let latestDate: Date | null = null;

    for (const row of raw.slice(headerIdx + 1)) {
      if (!row[0]) continue;
      if (CI.PHONE >= 0 && !normalizePhone(row[CI.PHONE])) continue;
      const route = CI.ROUTE_CODE >= 0 ? String(row[CI.ROUTE_CODE] ?? '').trim() : '';
      if (!route) continue;

      totalRows++;
      if (!routeGroups.has(route)) routeGroups.set(route, []);
      routeGroups.get(route)!.push(row);

      if (CI.AER >= 0 && hasAER(row[CI.AER])) {
        bookings++;
      }

      if (CI.DATE1 >= 0 && hasValue(row[CI.DATE1])) {
        try {
          const d = new Date(row[CI.DATE1]);
          if (!isNaN(d.getTime()) && (!latestDate || d > latestDate)) latestDate = d;
        } catch { /* skip unparseable dates */ }
      }
    }

    const totalGroups = routeGroups.size;
    let reachedRows = 0;
    const unreachedNAs: number[] = [];

    for (const rows of routeGroups.values()) {
      const groupReached = rows.filter(r => isDisposed(r)).length;
      reachedRows += groupReached;

      if (groupReached === 0) {
        unreachedNAs.push(rows.reduce((mx, r) => Math.max(mx, getNA(r)), 0));
      }
    }

    return {
      totalRows,
      groups: totalGroups,
      bookings,
      reachedPct: totalRows > 0 ? Math.round((reachedRows / totalRows) * 100) : 0,
      avgAttempts: unreachedNAs.length > 0
        ? Math.round((unreachedNAs.reduce((s, n) => s + n, 0) / unreachedNAs.length) * 10) / 10
        : 0,
      lastUsed: latestDate ? latestDate.toISOString() : null,
    };
  }
}

export const dialerSheetsService = DialerSheetsService.getInstance();
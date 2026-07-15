// src/lib/googleAuthService.ts
//
// Single, app-wide Google OAuth token authority.
//
// Previously googleSheetsService and dialerSheetsService each held their own
// in-memory access token and their own GIS token client, so a user could be
// prompted for Google consent more than once and every page reload lost the
// token. This service centralises the token: one GIS token client, one token,
// silent refresh with an expiry buffer, a single-flight refresh guard, and
// persistence to localStorage so the token survives reloads within its lifetime.
//
// NOTE: This is the browser-only GIS implicit/token flow. Access tokens are
// short-lived (~1h) and there is no refresh token. "Persisting" here means
// surviving reloads and re-acquiring silently (prompt: '') where possible;
// a truly indefinite session would require a server-side OAuth exchange.

import { GOOGLE_OAUTH_CONFIG } from './googleSheetsConfig';

const STORAGE_KEY = 'cps.google.oauth.token.v1';
// Refresh a bit before the real expiry so calls never race a dead token.
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_EXPIRES_IN_MS = 3600 * 1000; // GIS default ~1h

interface StoredToken {
  accessToken: string;
  issuedAt: number;
  expiresIn: number; // ms
}

declare global {
  interface Window {
    google?: any;
  }
}

class GoogleAuthService {
  private accessToken: string | null = null;
  private issuedAt = 0;
  private expiresIn = DEFAULT_EXPIRES_IN_MS;
  private tokenClient: any = null;
  private gisLoaded = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.hydrateFromStorage();
  }

  // --- persistence -------------------------------------------------------

  private hydrateFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const t = JSON.parse(raw) as StoredToken;
      if (t && typeof t.accessToken === 'string') {
        this.accessToken = t.accessToken;
        this.issuedAt = t.issuedAt || 0;
        this.expiresIn = t.expiresIn || DEFAULT_EXPIRES_IN_MS;
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  private persist(): void {
    try {
      if (!this.accessToken) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const t: StoredToken = {
        accessToken: this.accessToken,
        issuedAt: this.issuedAt,
        expiresIn: this.expiresIn,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    } catch {
      /* storage may be unavailable; token still works in-memory */
    }
  }

  private setToken(accessToken: string, expiresInSeconds?: number): void {
    this.accessToken = accessToken;
    this.issuedAt = Date.now();
    this.expiresIn = (expiresInSeconds ? expiresInSeconds * 1000 : DEFAULT_EXPIRES_IN_MS);
    this.persist();
  }

  // --- GIS token client --------------------------------------------------

  private ensureTokenClient(): void {
    if (this.gisLoaded && this.tokenClient) return;
    if (!window.google?.accounts?.oauth2) {
      throw new Error(
        'Google Identity Services not loaded. Ensure the GIS script is in index.html.'
      );
    }
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_OAUTH_CONFIG.clientId,
      scope: GOOGLE_OAUTH_CONFIG.scopes,
      callback: () => {
        /* per-request callback is assigned in requestToken() */
      },
    });
    this.gisLoaded = true;
  }

  private requestToken(interactive: boolean): Promise<boolean> {
    this.ensureTokenClient();
    return new Promise<boolean>((resolve) => {
      this.tokenClient.callback = (response: any) => {
        if (response && response.access_token) {
          this.setToken(response.access_token, response.expires_in);
          resolve(true);
        } else {
          resolve(false);
        }
      };
      // '' attempts a silent grant; 'consent' forces the account/consent UI.
      this.tokenClient.requestAccessToken({
        prompt: interactive ? 'consent' : '',
      });
    });
  }

  // --- public API --------------------------------------------------------

  /** True if we currently hold a token (may still be expiring soon). */
  public isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private isExpiring(): boolean {
    if (!this.accessToken || !this.issuedAt) return true;
    return Date.now() - this.issuedAt >= this.expiresIn - REFRESH_BUFFER_MS;
  }

  /** Silent refresh (no popup). Single-flight so concurrent callers share it. */
  private silentRefresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.requestToken(false).finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  /**
   * Interactive sign-in. Call this ONCE at command-center login so the user
   * consents a single time; everything afterwards reuses the shared token.
   */
  public async authenticate(): Promise<boolean> {
    return this.requestToken(true);
  }

  /**
   * Returns a valid access token, silently refreshing if it is missing or
   * about to expire. Throws if no token can be obtained without a prompt —
   * callers that hit this should route the user back through authenticate().
   */
  public async getValidToken(): Promise<string> {
    if (this.accessToken && !this.isExpiring()) {
      return this.accessToken;
    }
    const ok = await this.silentRefresh();
    if (ok && this.accessToken) {
      return this.accessToken;
    }
    throw new Error('Google authentication required. Please sign in again.');
  }

  /** Best-effort current token without triggering a refresh (may be null/stale). */
  public getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Clear the shared token (sign-out or command-center switch). */
  public signOut(): void {
    this.accessToken = null;
    this.issuedAt = 0;
    this.refreshPromise = null;
    this.persist();
  }
}

export const googleAuthService = new GoogleAuthService();

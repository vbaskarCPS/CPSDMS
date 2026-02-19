// src/lib/campaignService.ts
import { supabase } from './supabase';
import { getStorageItem, setStorageItem, removeStorageItem } from './localStorage';
import { extractSheetId } from './commandCenterService';

// Re-export extractSheetId for convenience
export { extractSheetId };

// --- TYPES ---

export interface SniperConfig {
  years: number[];        // Target years to include (default [2025])
  ppOnly: boolean;        // Only show groups with prepaid rows
  minEntries: number;     // Minimum rows per group (default 1)
  linkShot: boolean;      // Only show groups on streets that have AER
  hideCTS: boolean;       // Hide groups with CTS disposition (default true)
}

export const DEFAULT_SNIPER_CONFIG: SniperConfig = {
  years: [2025],
  ppOnly: false,
  minEntries: 1,
  linkShot: false,
  hideCTS: true,
};

export interface Campaign {
  id: string;
  displayName: string;
  spreadsheetId: string;
  spreadsheetUrl?: string;
  appsScriptUrl?: string;
  createdBy?: string;
  createdAt?: string;
  sniperConfig: SniperConfig;
}

export interface CampaignManager {
  id: string;
  campaignId: string;
  name: string;
  repCode: string;
  password: string;
  createdAt?: string;
}

export interface DialerSession {
  id: string;
  campaignId: string;
  managerId: string;
  sessionDate: string;
  gamificationState: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

// =============================================================================
// RESUME DATA TYPE
//
// Returned by getResumeData() — contains everything CampaignSelect needs to
// show the "Last Operation Detected" banner and wire the Resume button.
// =============================================================================

export interface ResumeData {
  /** The callbook tab name they were last dialing */
  tab: string;
  /**
   * Position within the tab. Either a booking ID string (e.g. "ACE01-042")
   * or "ROW:N" when the sheet has no Booking ID column.
   */
  position: string;
  /** The EST date of the session this position belongs to */
  sessionDate: string;
  /** The session row ID — passed back to DialerPage for session restoration */
  sessionId: string;
  /** The full gamification state, so DialerPage can restore it if same day */
  gamificationState: Record<string, any>;
  /** ISO timestamp of last update, for display ("last played 2h ago") */
  lastUpdatedAt: string | null;
}

// Storage keys
const CAMPAIGN_MANAGER_KEY = 'current_campaign_manager';
const CAMPAIGN_KEY = 'current_campaign';

// =============================================================================
// EST DATE HELPER
// Returns "today" as a YYYY-MM-DD string in Eastern Standard Time.
// Used so all reps — regardless of their local timezone — share the same
// session date. Resets at 3am EST which is safely the middle of the night
// for all Canadian timezones (1am Mountain, midnight Pacific).
// =============================================================================

export function getTodayEST(): string {
  const now = new Date();
  // EST is UTC-5. We don't use EDT (UTC-4) — we stay on fixed UTC-5 year-round
  // so the reset time is consistent and predictable for the team.
  const estOffsetMs = -5 * 60 * 60 * 1000;
  const estNow = new Date(now.getTime() + estOffsetMs);
  const y = estNow.getUTCFullYear();
  const m = String(estNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(estNow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

class CampaignService {
  private static instance: CampaignService;

  private constructor() {}

  public static getInstance(): CampaignService {
    if (!CampaignService.instance) {
      CampaignService.instance = new CampaignService();
    }
    return CampaignService.instance;
  }

  // --- CONTEXT MANAGEMENT ---

  public getCurrentManager(): CampaignManager | null {
    return getStorageItem<CampaignManager | null>(CAMPAIGN_MANAGER_KEY, null);
  }

  public setCurrentManager(manager: CampaignManager): void {
    setStorageItem(CAMPAIGN_MANAGER_KEY, manager);
  }

  public clearCurrentManager(): void {
    removeStorageItem(CAMPAIGN_MANAGER_KEY);
  }

  public getCurrentCampaign(): Campaign | null {
    return getStorageItem<Campaign | null>(CAMPAIGN_KEY, null);
  }

  public setCurrentCampaign(campaign: Campaign): void {
    setStorageItem(CAMPAIGN_KEY, campaign);
  }

  public clearCurrentCampaign(): void {
    removeStorageItem(CAMPAIGN_KEY);
  }

  public clearAll(): void {
    this.clearCurrentManager();
    this.clearCurrentCampaign();
  }

  // --- AUTHENTICATION ---

  public async authenticateCampaignManager(
    repCode: string,
    password: string
  ): Promise<{ manager: CampaignManager; campaign: Campaign } | null> {
    const { data, error } = await supabase
      .from('campaign_managers')
      .select('*')
      .ilike('rep_code', repCode)
      .eq('password', password);

    if (error || !data || data.length === 0) return null;

    const managerRow = data[0];
    const manager = this.mapDbToManager(managerRow);

    const campaign = await this.getCampaignById(manager.campaignId);
    if (!campaign) return null;

    return { manager, campaign };
  }

  // --- CAMPAIGN CRUD ---

  public async getAllCampaigns(): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToCampaign);
  }

  public async getCampaignById(id: string): Promise<Campaign | null> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return this.mapDbToCampaign(data);
  }

  public async createCampaign(campaign: {
    displayName: string;
    spreadsheetId: string;
    spreadsheetUrl?: string;
    appsScriptUrl?: string;
    createdBy?: string;
  }): Promise<Campaign> {
    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        display_name: campaign.displayName,
        spreadsheet_id: campaign.spreadsheetId,
        spreadsheet_url: campaign.spreadsheetUrl,
        apps_script_url: campaign.appsScriptUrl,
        created_by: campaign.createdBy,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToCampaign(data);
  }

  public async updateCampaign(
    id: string,
    updates: Partial<{
      displayName: string;
      spreadsheetId: string;
      spreadsheetUrl: string;
      appsScriptUrl: string;
    }>
  ): Promise<Campaign> {
    const dbUpdates: any = {};
    if (updates.displayName !== undefined) dbUpdates.display_name = updates.displayName;
    if (updates.spreadsheetId !== undefined) dbUpdates.spreadsheet_id = updates.spreadsheetId;
    if (updates.spreadsheetUrl !== undefined) dbUpdates.spreadsheet_url = updates.spreadsheetUrl;
    if (updates.appsScriptUrl !== undefined) dbUpdates.apps_script_url = updates.appsScriptUrl;

    const { data, error } = await supabase
      .from('campaigns')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToCampaign(data);
  }

  public async updateSniperConfig(
    campaignId: string,
    config: SniperConfig
  ): Promise<Campaign> {
    const { data, error } = await supabase
      .from('campaigns')
      .update({ sniper_config: config })
      .eq('id', campaignId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    const updated = this.mapDbToCampaign(data);

    // Also update localStorage if this is the current campaign
    const current = this.getCurrentCampaign();
    if (current && current.id === campaignId) {
      this.setCurrentCampaign(updated);
    }

    return updated;
  }

  public async deleteCampaign(id: string): Promise<void> {
    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // --- CAMPAIGN MANAGER CRUD ---

  public async getManagersByCampaign(campaignId: string): Promise<CampaignManager[]> {
    const { data, error } = await supabase
      .from('campaign_managers')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToManager);
  }

  public async createManager(manager: {
    campaignId: string;
    name: string;
    repCode: string;
    password?: string;
  }): Promise<CampaignManager> {
    const { data, error } = await supabase
      .from('campaign_managers')
      .insert({
        campaign_id: manager.campaignId,
        name: manager.name,
        rep_code: manager.repCode,
        password: manager.password || 'callofduty',
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToManager(data);
  }

  public async updateManager(
    id: string,
    updates: Partial<{
      name: string;
      repCode: string;
      password: string;
    }>
  ): Promise<CampaignManager> {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.repCode !== undefined) dbUpdates.rep_code = updates.repCode;
    if (updates.password !== undefined) dbUpdates.password = updates.password;

    const { data, error } = await supabase
      .from('campaign_managers')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToManager(data);
  }

  public async deleteManager(id: string): Promise<void> {
    const { error } = await supabase
      .from('campaign_managers')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  public async syncManagersFromSheet(
    campaignId: string,
    sheetManagers: { name: string; repCode: string }[]
  ): Promise<{ added: number; removed: number }> {
    const existing = await this.getManagersByCampaign(campaignId);
    const existingByCode = new Map(existing.map((m) => [m.repCode.toLowerCase(), m]));
    const sheetCodes = new Set(sheetManagers.map((m) => m.repCode.toLowerCase()));

    let added = 0;
    let removed = 0;

    for (const sm of sheetManagers) {
      if (!existingByCode.has(sm.repCode.toLowerCase())) {
        await this.createManager({
          campaignId,
          name: sm.name,
          repCode: sm.repCode,
        });
        added++;
      }
    }

    for (const em of existing) {
      if (!sheetCodes.has(em.repCode.toLowerCase())) {
        await this.deleteManager(em.id);
        removed++;
      }
    }

    return { added, removed };
  }

  // --- DIALER SESSION ---

  /**
   * Get or create today's session row for this manager.
   * "Today" is always in EST so the whole team shares the same date.
   * One row per manager per day — if they switch campaign tabs,
   * we update campaign_id on the existing row (Option A).
   */
  public async getOrCreateTodaySession(
    campaignId: string,
    managerId: string
  ): Promise<DialerSession> {
    const today = getTodayEST();

    // Try to find an existing row for this manager today
    const { data: existing, error: fetchError } = await supabase
      .from('dialer_sessions')
      .select('*')
      .eq('manager_id', managerId)
      .eq('session_date', today)
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw new Error(fetchError.message);
    }

    if (existing) {
      // If they've switched to a different campaign tab, update campaign_id
      if (existing.campaign_id !== campaignId) {
        const { data: updated, error: updateError } = await supabase
          .from('dialer_sessions')
          .update({ campaign_id: campaignId, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .select()
          .single();

        if (updateError) throw new Error(updateError.message);
        return this.mapDbToSession(updated);
      }

      return this.mapDbToSession(existing);
    }

    // No row yet — create a fresh one
    const { data: created, error: createError } = await supabase
      .from('dialer_sessions')
      .insert({
        campaign_id: campaignId,
        manager_id: managerId,
        session_date: today,
        gamification_state: {},
      })
      .select()
      .single();

    if (createError) throw new Error(createError.message);
    return this.mapDbToSession(created);
  }

  /**
   * Write the full GamificationSession object into the session row.
   * Called after every disposition so the state is always current in Supabase.
   * Uses the row ID we got from getOrCreateTodaySession — no extra lookups.
   */
  public async upsertGamificationState(
    sessionId: string,
    state: Record<string, any>
  ): Promise<void> {
    const { error } = await supabase
      .from('dialer_sessions')
      .update({
        gamification_state: state,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) throw new Error(error.message);
  }

  /**
   * @deprecated Use upsertGamificationState instead.
   * Kept for any legacy callers — delegates to the new method.
   */
  public async updateGamificationState(
    sessionId: string,
    state: Record<string, any>
  ): Promise<void> {
    return this.upsertGamificationState(sessionId, state);
  }

  // =============================================================================
  // RESUME DATA
  //
  // Reads the most recent dialer_sessions row for this manager (any date) and
  // extracts the _resumeTab and _resumeBookingId fields that dialerEngine embeds
  // on every save. Returns null if no resume position exists.
  //
  // Why "most recent" instead of "today only"?
  // Per the design: if it's a new day, we still restore the POSITION (same tab
  // + booking ID) but let DialerPage handle gamification freshness by checking
  // sessionDate against getTodayEST().
  // =============================================================================

  public async getResumeData(managerId: string): Promise<ResumeData | null> {
    try {
      // Fetch the single most recent session row for this manager
      const { data, error } = await supabase
        .from('dialer_sessions')
        .select('id, session_date, gamification_state, updated_at')
        .eq('manager_id', managerId)
        .order('session_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      const state = data.gamification_state as Record<string, any> | null;
      if (!state) return null;

      const tab = state._resumeTab as string | undefined;
      const position = (state._resumePosition || state._resumeBookingId) as string | undefined;

      // Both fields must be present and non-empty to offer a resume
      if (!tab || !position) return null;

      return {
        tab,
        position,
        sessionDate: data.session_date,
        sessionId: data.id,
        gamificationState: state,
        lastUpdatedAt: data.updated_at ?? null,
      };
    } catch (err) {
      // Non-critical — if this fails the rep just doesn't see the resume banner
      console.warn('getResumeData failed:', err);
      return null;
    }
  }

  // --- VALIDATION ---

  public async isRepCodeAvailable(repCode: string, excludeCampaignId?: string): Promise<boolean> {
    let query = supabase
      .from('campaign_managers')
      .select('id')
      .ilike('rep_code', repCode);

    if (excludeCampaignId) {
      query = query.neq('campaign_id', excludeCampaignId);
    }

    const { data } = await query;
    return !data || data.length === 0;
  }

  // --- MAPPERS ---

  private mapDbToCampaign(data: any): Campaign {
    let sniperConfig: SniperConfig = { ...DEFAULT_SNIPER_CONFIG };
    if (data.sniper_config && typeof data.sniper_config === 'object') {
      const sc = data.sniper_config;
      sniperConfig = {
        years: Array.isArray(sc.years) && sc.years.length > 0 ? sc.years : [2025],
        ppOnly: typeof sc.ppOnly === 'boolean' ? sc.ppOnly : false,
        minEntries: typeof sc.minEntries === 'number' && sc.minEntries >= 1 ? sc.minEntries : 1,
        linkShot: typeof sc.linkShot === 'boolean' ? sc.linkShot : false,
        hideCTS: typeof sc.hideCTS === 'boolean' ? sc.hideCTS : true,
      };
    }

    return {
      id: data.id,
      displayName: data.display_name,
      spreadsheetId: data.spreadsheet_id,
      spreadsheetUrl: data.spreadsheet_url,
      appsScriptUrl: data.apps_script_url,
      createdBy: data.created_by,
      createdAt: data.created_at,
      sniperConfig,
    };
  }

  private mapDbToManager(data: any): CampaignManager {
    return {
      id: data.id,
      campaignId: data.campaign_id,
      name: data.name,
      repCode: data.rep_code,
      password: data.password,
      createdAt: data.created_at,
    };
  }

  private mapDbToSession(data: any): DialerSession {
    return {
      id: data.id,
      campaignId: data.campaign_id,
      managerId: data.manager_id,
      sessionDate: data.session_date,
      gamificationState: data.gamification_state || {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export const campaignService = CampaignService.getInstance();
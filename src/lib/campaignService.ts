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
  linkShot: boolean;      // Only show streets that have AER
  hideCTS: boolean;       // Hide groups with CTS disposition (default true)
  maxNA: number;          // BLACKLIST: skip groups where max NA >= this value (0 = OFF)
}

export const DEFAULT_SNIPER_CONFIG: SniperConfig = {
  years: [2025],
  ppOnly: false,
  minEntries: 1,
  linkShot: false,
  hideCTS: true,
  maxNA: 0,
};

// --- USER PREFERENCES ---

export type Direction = 'ambush' | 'infiltrate' | 'siege';

export interface UserPreferences {
  sniperConfig: SniperConfig;
  lastDirection: Direction;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  sniperConfig: { ...DEFAULT_SNIPER_CONFIG },
  lastDirection: 'ambush',
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
  userPreferences?: UserPreferences;
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
// =============================================================================

export interface ResumeData {
  tab: string;
  position: string;
  sessionDate: string;
  sessionId: string;
  gamificationState: Record<string, any>;
  lastUpdatedAt: string | null;
}

// Storage keys
const CAMPAIGN_MANAGER_KEY = 'current_campaign_manager';
const CAMPAIGN_KEY = 'current_campaign';

// =============================================================================
// EST DATE HELPER
// =============================================================================

export function getTodayEST(): string {
  const now = new Date();
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

  public async getOrCreateTodaySession(
    campaignId: string,
    managerId: string
  ): Promise<DialerSession> {
    const today = getTodayEST();

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

  /** @deprecated Use upsertGamificationState instead. */
  public async updateGamificationState(
    sessionId: string,
    state: Record<string, any>
  ): Promise<void> {
    return this.upsertGamificationState(sessionId, state);
  }

  // --- RESUME DATA ---

  public async getResumeData(managerId: string): Promise<ResumeData | null> {
    try {
      const { data, error } = await supabase
        .from('dialer_sessions')
        .select('id, session_date, gamification_state, updated_at')
        .eq('manager_id', managerId)
        .order('session_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      let state = data.gamification_state as Record<string, any> | string | null;
      if (typeof state === 'string') {
        try { state = JSON.parse(state); } catch { return null; }
      }
      if (!state || typeof state !== 'object') return null;

      const tab = (state as any)._resumeTab as string | undefined;
      const position = ((state as any)._resumePosition || (state as any)._resumeBookingId) as string | undefined;

      if (!tab || !position) return null;

      return {
        tab,
        position,
        sessionDate: data.session_date,
        sessionId: data.id,
        gamificationState: state as Record<string, any>,
        lastUpdatedAt: data.updated_at ?? null,
      };
    } catch (err) {
      console.warn('getResumeData failed:', err);
      return null;
    }
  }

  // --- LIFETIME BADGES ---

  /**
   * Merges newly earned badge IDs into campaign_managers.lifetime_badges.
   * Stored as { "badge_id": count } — increments each count.
   * Fire-and-forget safe: errors are swallowed so a Supabase hiccup never breaks dialing.
   */
  public async updateLifetimeBadges(
    managerId: string,
    badgeIds: string[]
  ): Promise<void> {
    if (!badgeIds || badgeIds.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('campaign_managers')
        .select('lifetime_badges')
        .eq('id', managerId)
        .maybeSingle();

      if (error || !data) return;

      const current: Record<string, number> =
        (data.lifetime_badges && typeof data.lifetime_badges === 'object' && !Array.isArray(data.lifetime_badges))
          ? (data.lifetime_badges as Record<string, number>)
          : {};

      for (const id of badgeIds) {
        current[id] = (current[id] || 0) + 1;
      }

      await supabase
        .from('campaign_managers')
        .update({ lifetime_badges: current })
        .eq('id', managerId);
    } catch {
      // Silent fail — non-critical
    }
  }

  /**
   * Fetches the lifetime_badges map for a manager.
   * Returns { "badge_id": count } or empty object if none yet.
   */
  public async getLifetimeBadges(managerId: string): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('campaign_managers')
        .select('lifetime_badges')
        .eq('id', managerId)
        .maybeSingle();

      if (error || !data) return {};

      const raw = data.lifetime_badges;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, number>;
      }
      return {};
    } catch {
      return {};
    }
  }

  // --- USER PREFERENCES ---

  /**
   * Loads user_preferences JSONB from campaign_managers for this manager.
   * Returns DEFAULT_USER_PREFERENCES if none saved yet.
   * Silent fail — never breaks the UI.
   */
  public async getUserPreferences(managerId: string): Promise<UserPreferences> {
    try {
      const { data, error } = await supabase
        .from('campaign_managers')
        .select('user_preferences')
        .eq('id', managerId)
        .maybeSingle();

      if (error || !data) return { ...DEFAULT_USER_PREFERENCES };

      const raw = data.user_preferences;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ...DEFAULT_USER_PREFERENCES };
      }

      const prefs = raw as Record<string, any>;

      // Safely reconstruct SniperConfig with fallbacks
      const sc = prefs.sniperConfig;
      const sniperConfig: SniperConfig = sc && typeof sc === 'object' ? {
        years: Array.isArray(sc.years) && sc.years.length > 0 ? sc.years : [2025],
        ppOnly: typeof sc.ppOnly === 'boolean' ? sc.ppOnly : false,
        minEntries: typeof sc.minEntries === 'number' && sc.minEntries >= 1 ? sc.minEntries : 1,
        linkShot: typeof sc.linkShot === 'boolean' ? sc.linkShot : false,
        hideCTS: typeof sc.hideCTS === 'boolean' ? sc.hideCTS : true,
        maxNA: typeof sc.maxNA === 'number' ? sc.maxNA : 0,
      } : { ...DEFAULT_SNIPER_CONFIG };

      const validDirections = ['ambush', 'infiltrate', 'siege'];
      const lastDirection: Direction = validDirections.includes(prefs.lastDirection)
        ? prefs.lastDirection as Direction
        : 'ambush';

      return { sniperConfig, lastDirection };
    } catch {
      return { ...DEFAULT_USER_PREFERENCES };
    }
  }

  /**
   * Saves user_preferences JSONB to campaign_managers for this manager.
   * Fire-and-forget safe — errors are swallowed.
   */
  public async saveUserPreferences(
    managerId: string,
    prefs: UserPreferences
  ): Promise<void> {
    try {
      await supabase
        .from('campaign_managers')
        .update({ user_preferences: prefs })
        .eq('id', managerId);
    } catch {
      // Silent fail — non-critical
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
        maxNA: typeof sc.maxNA === 'number' ? sc.maxNA : 0,
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
      userPreferences: undefined, // loaded on-demand via getUserPreferences()
    };
  }

  private mapDbToSession(data: any): DialerSession {
    let gamificationState = data.gamification_state || {};
    if (typeof gamificationState === 'string') {
      try {
        gamificationState = JSON.parse(gamificationState);
      } catch {
        gamificationState = {};
      }
    }

    return {
      id: data.id,
      campaignId: data.campaign_id,
      managerId: data.manager_id,
      sessionDate: data.session_date,
      gamificationState,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export const campaignService = CampaignService.getInstance();
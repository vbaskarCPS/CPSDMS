// src/lib/campaignService.ts
import { supabase } from './supabase';
import { getStorageItem, setStorageItem, removeStorageItem } from './localStorage';
import { extractSheetId } from './commandCenterService';

// Re-export extractSheetId for convenience
export { extractSheetId };

// --- TYPES ---

export interface Campaign {
  id: string;
  displayName: string;
  spreadsheetId: string;
  spreadsheetUrl?: string;
  appsScriptUrl?: string;
  createdBy?: string;
  createdAt?: string;
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

// Storage keys
const CAMPAIGN_MANAGER_KEY = 'current_campaign_manager';
const CAMPAIGN_KEY = 'current_campaign';

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

  /**
   * Get the current campaign manager from localStorage
   */
  public getCurrentManager(): CampaignManager | null {
    return getStorageItem<CampaignManager | null>(CAMPAIGN_MANAGER_KEY, null);
  }

  /**
   * Set the current campaign manager context
   */
  public setCurrentManager(manager: CampaignManager): void {
    setStorageItem(CAMPAIGN_MANAGER_KEY, manager);
  }

  /**
   * Clear the current campaign manager context
   */
  public clearCurrentManager(): void {
    removeStorageItem(CAMPAIGN_MANAGER_KEY);
  }

  /**
   * Get the current campaign from localStorage
   */
  public getCurrentCampaign(): Campaign | null {
    return getStorageItem<Campaign | null>(CAMPAIGN_KEY, null);
  }

  /**
   * Set the current campaign context
   */
  public setCurrentCampaign(campaign: Campaign): void {
    setStorageItem(CAMPAIGN_KEY, campaign);
  }

  /**
   * Clear the current campaign context
   */
  public clearCurrentCampaign(): void {
    removeStorageItem(CAMPAIGN_KEY);
  }

  /**
   * Clear all campaign-related context
   */
  public clearAll(): void {
    this.clearCurrentManager();
    this.clearCurrentCampaign();
  }

  // --- AUTHENTICATION ---

  /**
   * Authenticate a campaign manager login.
   * rep_code is used as username. Checks across ALL campaigns.
   * Returns { manager, campaign } if successful, null otherwise.
   */
  public async authenticateCampaignManager(
    repCode: string,
    password: string
  ): Promise<{ manager: CampaignManager; campaign: Campaign } | null> {
    // Find manager by rep_code and password (case-insensitive rep_code match)
    const { data, error } = await supabase
      .from('campaign_managers')
      .select('*')
      .ilike('rep_code', repCode)
      .eq('password', password);

    if (error || !data || data.length === 0) return null;

    // Use the first match (rep_code should be unique per campaign, but a rep
    // could exist in multiple campaigns — take the first)
    const managerRow = data[0];
    const manager = this.mapDbToManager(managerRow);

    // Fetch the associated campaign
    const campaign = await this.getCampaignById(manager.campaignId);
    if (!campaign) return null;

    return { manager, campaign };
  }

  // --- CAMPAIGN CRUD ---

  /**
   * Get all campaigns (for super admin)
   */
  public async getAllCampaigns(): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToCampaign);
  }

  /**
   * Get a campaign by ID
   */
  public async getCampaignById(id: string): Promise<Campaign | null> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;
    return this.mapDbToCampaign(data);
  }

  /**
   * Create a new campaign
   */
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

  /**
   * Update a campaign
   */
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

  /**
   * Delete a campaign and ALL its data (cascade handles managers + sessions)
   */
  public async deleteCampaign(id: string): Promise<void> {
    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // --- CAMPAIGN MANAGER CRUD ---

  /**
   * Get all managers for a campaign
   */
  public async getManagersByCampaign(campaignId: string): Promise<CampaignManager[]> {
    const { data, error } = await supabase
      .from('campaign_managers')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToManager);
  }

  /**
   * Create a campaign manager
   */
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

  /**
   * Update a campaign manager
   */
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

  /**
   * Delete a campaign manager
   */
  public async deleteManager(id: string): Promise<void> {
    const { error } = await supabase
      .from('campaign_managers')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  /**
   * Sync managers from the Managers tab of a Google Sheet.
   * Compares current DB managers against sheet data, adds new / removes stale.
   * Returns { added: number, removed: number }.
   */
  public async syncManagersFromSheet(
    campaignId: string,
    sheetManagers: { name: string; repCode: string }[]
  ): Promise<{ added: number; removed: number }> {
    const existing = await this.getManagersByCampaign(campaignId);
    const existingByCode = new Map(existing.map((m) => [m.repCode.toLowerCase(), m]));
    const sheetCodes = new Set(sheetManagers.map((m) => m.repCode.toLowerCase()));

    let added = 0;
    let removed = 0;

    // Add new managers from sheet
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

    // Remove managers no longer in sheet
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
   * Get or create today's dialer session for a manager
   */
  public async getOrCreateTodaySession(
    campaignId: string,
    managerId: string
  ): Promise<DialerSession> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Try to fetch existing
    const { data: existing, error: fetchError } = await supabase
      .from('dialer_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('manager_id', managerId)
      .eq('session_date', today)
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw new Error(fetchError.message);
    }

    if (existing) {
      return this.mapDbToSession(existing);
    }

    // Create new session
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
   * Update gamification state for a session
   */
  public async updateGamificationState(
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

  // --- VALIDATION ---

  /**
   * Check if a rep_code is available across all campaigns
   * (used during manual manager creation, not sync)
   */
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
    return {
      id: data.id,
      displayName: data.display_name,
      spreadsheetId: data.spreadsheet_id,
      spreadsheetUrl: data.spreadsheet_url,
      appsScriptUrl: data.apps_script_url,
      createdBy: data.created_by,
      createdAt: data.created_at,
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
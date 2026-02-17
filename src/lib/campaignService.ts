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

  public async getOrCreateTodaySession(
    campaignId: string,
    managerId: string
  ): Promise<DialerSession> {
    const today = new Date().toISOString().split('T')[0];

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
// src/lib/commandCenterService.ts
import { supabase } from './supabase';
import { getStorageItem, setStorageItem, removeStorageItem } from './localStorage';
import { SeasonType, SeasonConfig, SEASON_CONFIGS, TeamSplitConfig, EQ_DIVISOR } from '../types';

// Re-export EQ_DIVISOR for convenience
export { EQ_DIVISOR };

// --- TYPES ---
export type Region = 'West' | 'Central' | 'East';

export interface CommandCenter {
  id: string;
  username: string;
  displayName: string;
  region: Region;
  workerbookSheetId: string;
  masterbookingsSheetId: string;
  replyToEmail?: string;
  createdAt?: string;
  // Job Fairs
  jobFairsEnabled?: boolean;
  jobFairsSlug?: string;
  // Digital Mapping
  digitalMappingEnabled?: boolean;
}

export interface CommandCenterWithPassword extends CommandCenter {
  password: string;
}

// Storage key for current command center context
const CC_STORAGE_KEY = 'current_command_center';
const SUPER_ADMIN_MODE_KEY = 'super_admin_mode';

// --- HELPER: Extract Google Sheet ID from URL or ID ---
export const extractSheetId = (input: string): string | null => {
  if (!input) return null;
  
  // If it's already just an ID (no slashes, looks like a sheet ID)
  if (/^[a-zA-Z0-9-_]+$/.test(input.trim()) && input.length > 20) {
    return input.trim();
  }
  
  // Extract from full URL
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

// --- SUPER ADMIN CHECK ---
const SUPER_ADMIN_USERNAME = 'Administrator';
const SUPER_ADMIN_PASSWORD = 'cps26records';

export const isSuperAdminCredentials = (username: string, password: string): boolean => {
  return username === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD;
};

// --- TAX RATE HELPER ---
export const getTaxRateForRegion = (region: Region): number => {
  switch (region) {
    case 'East':
      return 13;
    case 'Central':
    case 'West':
    default:
      return 5;
  }
};

// --- CHECK IF REGION HAS UPGRADES ---
export const regionHasUpgrades = (region: Region, seasonType?: SeasonType): boolean => {
  if (region !== 'West') return false;
  
  // In lawn_rejuv season, no upgrades available
  if (seasonType === 'lawn_rejuv') return false;
  
  return true;
};

// --- CHECK IF REGION SUPPORTS SEASON SELECTION ---
export const regionHasSeasonSelection = (region: Region): boolean => {
  return region === 'West';
};

// --- GET SEASON CONFIG ---
export const getSeasonConfig = (seasonType: SeasonType): SeasonConfig => {
  return SEASON_CONFIGS[seasonType];
};

// --- GET OFFICE FLAT VALUE ---
export const getOfficeFlatValue = (code: string, seasonType: SeasonType): number | null => {
  const config = getSeasonConfig(seasonType);
  const flat = config.officeFlats.find(f => f.code === code);
  return flat ? flat.value : null;
};

// --- CHECK IF CODE IS OFFICE FLAT ---
export const isOfficeFlat = (displayPrice: string | undefined, seasonType: SeasonType): boolean => {
  if (!displayPrice) return false;
  const config = getSeasonConfig(seasonType);
  return config.officeFlats.some(f => displayPrice.startsWith(f.code));
};

// --- GET PAYOUT RATE ($/EQ BASE for commission calculation) ---
// NOTE: This returns the BASE payout rate. Final rate = base + alumniRate + silverRate
// alumniRate and silverRate are also $/EQ amounts (not percentages)
export const getPayoutRate = (seasonType: SeasonType, teamSize: number): number => {
  const config = getSeasonConfig(seasonType);
  return teamSize >= 2 ? config.payoutRateTeam : config.payoutRateSolo;
};

// --- DEPRECATED: Use getPayoutRate instead ---
// Keeping for backwards compatibility during transition
export const getEQRate = (seasonType: SeasonType, teamSize: number): number => {
  console.warn('getEQRate is deprecated. Use getPayoutRate instead.');
  return getPayoutRate(seasonType, teamSize);
};

// --- GET PREPAID WEIGHT ---
export const getPrepaidWeight = (seasonType: SeasonType): number => {
  return getSeasonConfig(seasonType).prepaidWeight;
};

// --- GET BILLED WEIGHT ---
export const getBilledWeight = (seasonType: SeasonType): number => {
  return getSeasonConfig(seasonType).billedWeight;
};

// --- CHECK IF SEASON HAS TEAMS ---
export const seasonHasTeams = (seasonType: SeasonType): boolean => {
  return seasonType === 'lawn_rejuv';
};

// --- GET AVAILABLE ADD-ONS FOR SEASON ---
export const getAvailableAddOns = (seasonType: SeasonType): string[] => {
  return getSeasonConfig(seasonType).availableAddOns;
};

// --- CREATE DEFAULT EQUAL SPLIT ---
export const createEqualSplit = (workerIds: string[]): TeamSplitConfig => {
  if (workerIds.length === 0) return {};
  
  const equalPercent = Math.floor(100 / workerIds.length);
  const remainder = 100 - (equalPercent * workerIds.length);
  
  const split: TeamSplitConfig = {};
  workerIds.forEach((id, index) => {
    // Give the remainder to the first worker
    split[id] = equalPercent + (index === 0 ? remainder : 0);
  });
  
  return split;
};

// --- VALIDATE SPLIT TOTALS 100% ---
export const validateSplitTotal = (split: TeamSplitConfig): boolean => {
  const total = Object.values(split).reduce((sum, val) => sum + val, 0);
  return Math.abs(total - 100) < 0.01; // Allow small floating point variance
};

// --- VALIDATE JOB FAIR SLUG ---
export const isValidJobFairSlug = (slug: string): boolean => {
  // Only lowercase letters, numbers, and hyphens
  // Must start with a letter, 3-50 characters
  const pattern = /^[a-z][a-z0-9-]{2,49}$/;
  return pattern.test(slug);
};

export const getJobFairSlugError = (slug: string): string | null => {
  if (!slug.trim()) {
    return 'Slug is required when Job Fairs is enabled';
  }
  if (slug.length < 3) {
    return 'Slug must be at least 3 characters';
  }
  if (slug.length > 50) {
    return 'Slug must be 50 characters or less';
  }
  if (!/^[a-z]/.test(slug)) {
    return 'Slug must start with a lowercase letter';
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return 'Slug can only contain lowercase letters, numbers, and hyphens';
  }
  return null;
};

class CommandCenterService {
  private static instance: CommandCenterService;
  
  private constructor() {}
  
  public static getInstance(): CommandCenterService {
    if (!CommandCenterService.instance) {
      CommandCenterService.instance = new CommandCenterService();
    }
    return CommandCenterService.instance;
  }

  // --- CONTEXT MANAGEMENT ---

  /**
   * Get the current command center from localStorage
   */
  public getCurrentCommandCenter(): CommandCenter | null {
    return getStorageItem<CommandCenter | null>(CC_STORAGE_KEY, null);
  }

  /**
   * Get the current command center ID
   */
  public getCurrentCommandCenterId(): string | null {
    const cc = this.getCurrentCommandCenter();
    return cc?.id || null;
  }

  /**
   * Get the current region
   */
  public getCurrentRegion(): Region | null {
    const cc = this.getCurrentCommandCenter();
    return cc?.region || null;
  }

  /**
   * Get the tax rate for the current command center
   */
  public getCurrentTaxRate(): number {
    const region = this.getCurrentRegion();
    return region ? getTaxRateForRegion(region) : 5;
  }

  /**
   * Check if current region has upgrades (season-aware)
   */
  public currentRegionHasUpgrades(seasonType?: SeasonType): boolean {
    const region = this.getCurrentRegion();
    return region ? regionHasUpgrades(region, seasonType) : false;
  }

  /**
   * Check if current region supports season selection
   */
  public currentRegionHasSeasonSelection(): boolean {
    const region = this.getCurrentRegion();
    return region ? regionHasSeasonSelection(region) : false;
  }

  /**
   * Check if current command center has job fairs enabled
   */
  public currentHasJobFairs(): boolean {
    const cc = this.getCurrentCommandCenter();
    return cc?.jobFairsEnabled || false;
  }

  /**
   * Check if current command center has digital mapping enabled
   */
  public currentHasDigitalMapping(): boolean {
    const cc = this.getCurrentCommandCenter();
    return cc?.digitalMappingEnabled || false;
  }

  /**
   * Set the current command center context
   */
  public setCurrentCommandCenter(cc: CommandCenter): void {
    setStorageItem(CC_STORAGE_KEY, cc);
  }

  /**
   * Clear the current command center context
   */
  public clearCurrentCommandCenter(): void {
    removeStorageItem(CC_STORAGE_KEY);
  }

  /**
   * Check if currently in super admin impersonation mode
   */
  public isSuperAdminMode(): boolean {
    return getStorageItem<boolean>(SUPER_ADMIN_MODE_KEY, false);
  }

  /**
   * Set super admin impersonation mode
   */
  public setSuperAdminMode(enabled: boolean): void {
    setStorageItem(SUPER_ADMIN_MODE_KEY, enabled);
  }

  // --- AUTHENTICATION ---

  /**
   * Authenticate a command center login
   * Returns the command center if successful, null otherwise
   */
  public async authenticateCommandCenter(username: string, password: string): Promise<CommandCenter | null> {
    const { data, error } = await supabase
      .from('command_centers')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .maybeSingle();

    if (error || !data) return null;

    return this.mapDbToCommandCenter(data);
  }

  /**
   * Get a command center by ID (for impersonation)
   */
  public async getCommandCenterById(id: string): Promise<CommandCenter | null> {
    const { data, error } = await supabase
      .from('command_centers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    return this.mapDbToCommandCenter(data);
  }

  /**
   * Get a command center by job fair slug (for public form)
   */
  public async getCommandCenterBySlug(slug: string): Promise<CommandCenter | null> {
    const { data, error } = await supabase
      .from('command_centers')
      .select('*')
      .eq('job_fairs_slug', slug)
      .eq('job_fairs_enabled', true)
      .maybeSingle();

    if (error || !data) return null;

    return this.mapDbToCommandCenter(data);
  }

  // --- CRUD OPERATIONS ---

  /**
   * Get all command centers (for super admin)
   */
  public async getAllCommandCenters(): Promise<CommandCenter[]> {
    const { data, error } = await supabase
      .from('command_centers')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];

    return data.map(this.mapDbToCommandCenter);
  }

  /**
   * Create a new command center
   */
  public async createCommandCenter(cc: {
    username: string;
    password: string;
    displayName: string;
    region: Region;
    workerbookSheetId: string;
    masterbookingsSheetId: string;
    replyToEmail?: string;
    jobFairsEnabled?: boolean;
    jobFairsSlug?: string;
    digitalMappingEnabled?: boolean;
  }): Promise<CommandCenter> {
    // Validate username uniqueness across all login types
    const isAvailable = await this.isUsernameAvailable(cc.username);
    if (!isAvailable) {
      throw new Error(`Username "${cc.username}" is already taken.`);
    }

    // Validate job fair slug if enabled
    if (cc.jobFairsEnabled && cc.jobFairsSlug) {
      const slugError = getJobFairSlugError(cc.jobFairsSlug);
      if (slugError) {
        throw new Error(slugError);
      }
      
      // Check slug uniqueness
      const slugAvailable = await this.isJobFairSlugAvailable(cc.jobFairsSlug);
      if (!slugAvailable) {
        throw new Error(`Job Fair URL "${cc.jobFairsSlug}" is already taken.`);
      }
    }

    const { data, error } = await supabase
      .from('command_centers')
      .insert({
        username: cc.username,
        password: cc.password,
        display_name: cc.displayName,
        region: cc.region,
        workerbook_sheet_id: cc.workerbookSheetId,
        masterbookings_sheet_id: cc.masterbookingsSheetId,
        reply_to_email: cc.replyToEmail,
        job_fairs_enabled: cc.jobFairsEnabled || false,
        job_fairs_slug: cc.jobFairsEnabled ? cc.jobFairsSlug : null,
        digital_mapping_enabled: cc.digitalMappingEnabled || false,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToCommandCenter(data);
  }

  /**
   * Update a command center
   */
  public async updateCommandCenter(id: string, updates: Partial<{
    username: string;
    password: string;
    displayName: string;
    region: Region;
    workerbookSheetId: string;
    masterbookingsSheetId: string;
    replyToEmail: string;
    jobFairsEnabled: boolean;
    jobFairsSlug: string;
    digitalMappingEnabled: boolean;
  }>): Promise<CommandCenter> {
    // If username is being changed, check availability
    if (updates.username) {
      const current = await this.getCommandCenterById(id);
      if (current && current.username !== updates.username) {
        const isAvailable = await this.isUsernameAvailable(updates.username);
        if (!isAvailable) {
          throw new Error(`Username "${updates.username}" is already taken.`);
        }
      }
    }

    // Validate job fair slug if being set
    if (updates.jobFairsEnabled && updates.jobFairsSlug) {
      const slugError = getJobFairSlugError(updates.jobFairsSlug);
      if (slugError) {
        throw new Error(slugError);
      }
      
      // Check slug uniqueness (excluding current CC)
      const slugAvailable = await this.isJobFairSlugAvailable(updates.jobFairsSlug, id);
      if (!slugAvailable) {
        throw new Error(`Job Fair URL "${updates.jobFairsSlug}" is already taken.`);
      }
    }

    const dbUpdates: any = {};
    if (updates.username) dbUpdates.username = updates.username;
    if (updates.password) dbUpdates.password = updates.password;
    if (updates.displayName) dbUpdates.display_name = updates.displayName;
    if (updates.region) dbUpdates.region = updates.region;
    if (updates.workerbookSheetId) dbUpdates.workerbook_sheet_id = updates.workerbookSheetId;
    if (updates.masterbookingsSheetId) dbUpdates.masterbookings_sheet_id = updates.masterbookingsSheetId;
    if (updates.replyToEmail !== undefined) dbUpdates.reply_to_email = updates.replyToEmail;
    if (updates.jobFairsEnabled !== undefined) dbUpdates.job_fairs_enabled = updates.jobFairsEnabled;
    if (updates.jobFairsSlug !== undefined) {
      dbUpdates.job_fairs_slug = updates.jobFairsEnabled ? updates.jobFairsSlug : null;
    }
    if (updates.digitalMappingEnabled !== undefined) dbUpdates.digital_mapping_enabled = updates.digitalMappingEnabled;

    const { data, error } = await supabase
      .from('command_centers')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToCommandCenter(data);
  }

  /**
   * Delete a command center and ALL its data
   * This is a cascading delete - removes all users, sessions, transactions, etc.
   */
  public async deleteCommandCenter(id: string): Promise<void> {
    // The CASCADE on foreign keys will handle cleanup
    const { error } = await supabase
      .from('command_centers')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // --- UNIVERSAL WIPE (Super Admin Only) ---

  /**
   * Wipe ALL data from ALL tables across ALL command centers.
   * This resets the entire application to a fresh state.
   * 
   * DANGER: This is irreversible and deletes everything!
   * 
   * Deletion order respects foreign key constraints:
   * 1. job_fair_applicants (refs job_fair_sessions, command_centers)
   * 2. job_fair_sessions (refs command_centers)
   * 3. bookings (refs users, daily_sessions, command_centers)
   * 4. logsheet_sessions (refs users, daily_sessions, command_centers)
   * 5. routes (refs users, daily_sessions, command_centers)
   * 6. transactions (refs users, command_centers)
   * 7. email_logs (standalone)
   * 8. email_templates (refs command_centers)
   * 9. users (refs command_centers)
   * 10. daily_sessions (refs command_centers)
   * 11. command_centers (parent table)
   */
  public async universalWipe(): Promise<void> {
    // Delete in FK-safe order (children before parents)
    
    // 1. job_fair_applicants
    const { error: applicantsError } = await supabase
      .from('job_fair_applicants')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (applicantsError) throw new Error(`Failed to delete job_fair_applicants: ${applicantsError.message}`);

    // 2. job_fair_sessions
    const { error: jfSessionsError } = await supabase
      .from('job_fair_sessions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (jfSessionsError) throw new Error(`Failed to delete job_fair_sessions: ${jfSessionsError.message}`);

    // 3. bookings
    const { error: bookingsError } = await supabase
      .from('bookings')
      .delete()
      .neq('booking_id', ''); // Delete all rows
    if (bookingsError) throw new Error(`Failed to delete bookings: ${bookingsError.message}`);

    // 4. logsheet_sessions
    const { error: logsheetError } = await supabase
      .from('logsheet_sessions')
      .delete()
      .neq('id', '');
    if (logsheetError) throw new Error(`Failed to delete logsheet_sessions: ${logsheetError.message}`);

    // 5. routes
    const { error: routesError } = await supabase
      .from('routes')
      .delete()
      .neq('route_code', '');
    if (routesError) throw new Error(`Failed to delete routes: ${routesError.message}`);

    // 6. transactions
    const { error: transactionsError } = await supabase
      .from('transactions')
      .delete()
      .neq('id', '');
    if (transactionsError) throw new Error(`Failed to delete transactions: ${transactionsError.message}`);

    // 7. email_logs
    const { error: emailLogsError } = await supabase
      .from('email_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows (UUID comparison)
    if (emailLogsError) throw new Error(`Failed to delete email_logs: ${emailLogsError.message}`);

    // 8. email_templates
    const { error: emailTemplatesError } = await supabase
      .from('email_templates')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (emailTemplatesError) throw new Error(`Failed to delete email_templates: ${emailTemplatesError.message}`);

    // 9. users
    const { error: usersError } = await supabase
      .from('users')
      .delete()
      .neq('user_id', '');
    if (usersError) throw new Error(`Failed to delete users: ${usersError.message}`);

    // 10. daily_sessions
    const { error: dailySessionsError } = await supabase
      .from('daily_sessions')
      .delete()
      .neq('date', '1900-01-01'); // Delete all rows
    if (dailySessionsError) throw new Error(`Failed to delete daily_sessions: ${dailySessionsError.message}`);

    // 11. command_centers
    const { error: commandCentersError } = await supabase
      .from('command_centers')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (commandCentersError) throw new Error(`Failed to delete command_centers: ${commandCentersError.message}`);

    // Clear local storage
    this.clearCurrentCommandCenter();
    this.setSuperAdminMode(false);
  }

  // --- VALIDATION ---

  /**
   * Check if a username is available across all login types
   */
  public async isUsernameAvailable(username: string): Promise<boolean> {
    // Check against super admin
    if (username.toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase()) {
      return false;
    }

    // Check command_centers table
    const { data: ccData } = await supabase
      .from('command_centers')
      .select('id')
      .ilike('username', username)
      .maybeSingle();

    if (ccData) return false;

    // Check users table - username field (Route Managers)
    const { data: rmData } = await supabase
      .from('users')
      .select('user_id')
      .ilike('username', username)
      .maybeSingle();

    if (rmData) return false;

    // Check users table - user_id field (Workers/Contractors)
    const { data: workerData } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', username)
      .maybeSingle();

    if (workerData) return false;

    return true;
  }

  /**
   * Check if a job fair slug is available
   */
  public async isJobFairSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
    let query = supabase
      .from('command_centers')
      .select('id')
      .eq('job_fairs_slug', slug);
    
    if (excludeId) {
      query = query.neq('id', excludeId);
    }
    
    const { data } = await query.maybeSingle();
    return !data;
  }

  // --- HELPERS ---

  private mapDbToCommandCenter(data: any): CommandCenter {
    return {
      id: data.id,
      username: data.username,
      displayName: data.display_name,
      region: data.region as Region,
      workerbookSheetId: data.workerbook_sheet_id,
      masterbookingsSheetId: data.masterbookings_sheet_id,
      replyToEmail: data.reply_to_email,
      createdAt: data.created_at,
      jobFairsEnabled: data.job_fairs_enabled || false,
      jobFairsSlug: data.job_fairs_slug,
      digitalMappingEnabled: data.digital_mapping_enabled || false,
    };
  }
}

export const commandCenterService = CommandCenterService.getInstance();
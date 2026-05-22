// src/lib/commandCenterService.ts
import { supabase } from './supabase';
import { getStorageItem, setStorageItem, removeStorageItem } from './localStorage';
import {
  SeasonType,
  SeasonConfig,
  SEASON_CONFIGS,
  TeamSplitConfig,
  EQ_DIVISOR,
  RAMP_CREW_TEAM_ID_PATTERN,
  ASPHALT_SPLIT,
  CartKind,
  AsphaltSplit,
} from '../types';

// Re-export shared constants for convenience (matches the existing EQ_DIVISOR pattern)
export { EQ_DIVISOR, RAMP_CREW_TEAM_ID_PATTERN, ASPHALT_SPLIT };

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
  jobFairsEnabled?: boolean;
  jobFairsSlug?: string;
  digitalMappingEnabled?: boolean;
  callbookSheetId?: string;
  workerbookRunUrl?: string;
}

export interface CommandCenterWithPassword extends CommandCenter {
  password: string;
}

const CC_STORAGE_KEY = 'current_command_center';
const SUPER_ADMIN_MODE_KEY = 'super_admin_mode';

// --- HELPER: Extract Google Sheet ID from URL or ID ---
export const extractSheetId = (input: string): string | null => {
  if (!input) return null;

  if (/^[a-zA-Z0-9-_]+$/.test(input.trim()) && input.length > 20) {
    return input.trim();
  }

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
  if (seasonType === 'lawn_rejuv') return false;
  return true;
};

// --- CHECK IF REGION SUPPORTS SEASON SELECTION ---
export const regionHasSeasonSelection = (region: Region): boolean => {
  return region === 'West' || region === 'East';
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
export const getPayoutRate = (seasonType: SeasonType, teamSize: number): number => {
  const config = getSeasonConfig(seasonType);
  return teamSize >= 2 ? config.payoutRateTeam : config.payoutRateSolo;
};

// --- DEPRECATED: Use getPayoutRate instead ---
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
// Team seasons share a cart/logsheet across multiple workers (teamId field).
// Currently: lawn_rejuv (West) + sealing (East).
// TODO: When 'cleaning' season ships for Central, include it here.
export const seasonHasTeams = (seasonType: SeasonType): boolean => {
  return seasonType === 'lawn_rejuv' || seasonType === 'sealing';
};

// --- CHECK IF SEASON HAS ASPHALT ---
// Asphalt = the Sealing-only Ramp Crew add-on workflow. Centralised so every
// component asking "should I show the asphalt UI?" gets a consistent answer.
// TODO: If a future season adds an asphalt-equivalent workflow, extend here.
export const seasonHasAsphalt = (seasonType: SeasonType): boolean => {
  return seasonType === 'sealing';
};

// --- CHECK IF TEAM ID BELONGS TO A RAMP CREW ---
// Case-sensitive. Matches 'RC', 'RC1', 'RC2', etc. Does NOT match 'rc1', 'RCB',
// or 'RCx'. Empty/undefined teamId returns false.
export const isRampCrewTeamId = (teamId: string | undefined | null): boolean => {
  if (!teamId) return false;
  return RAMP_CREW_TEAM_ID_PATTERN.test(teamId);
};

// --- CLASSIFY A CART KIND FROM ITS TEAM ID ---
// Convenience wrapper for components that want to switch on cart kind.
export const classifyCartKind = (teamId: string | undefined | null): CartKind => {
  return isRampCrewTeamId(teamId) ? 'ramp-crew' : 'regular';
};

// --- CALCULATE ASPHALT SPLIT ---
// Pure function. Takes the three component dollar amounts and returns each
// cart's payout-share contribution. Used by completeJob and any UI that wants
// to preview the split before completion.
//   driveway → 100% to selling cart
//   asphalt  → 30% to selling cart, 70% to RC
//   upsold   → 100% to RC
// Negative inputs are clamped to 0 (defensive — shouldn't happen but cheap to guard).
export const calculateAsphaltSplit = (
  driveway: number,
  asphalt: number,
  upsold: number
): AsphaltSplit => {
  const d = Math.max(0, driveway || 0);
  const a = Math.max(0, asphalt || 0);
  const u = Math.max(0, upsold || 0);

  const cartShare = d * ASPHALT_SPLIT.DRIVEWAY_CART + a * ASPHALT_SPLIT.ASPHALT_CART;
  const rcShare = a * ASPHALT_SPLIT.ASPHALT_RC + u * ASPHALT_SPLIT.UPSOLD_RC;

  return {
    cartShare,
    rcShare,
    total: cartShare + rcShare,
  };
};

// --- CREATE DEFAULT EQUAL SPLIT ---
export const createEqualSplit = (workerIds: string[]): TeamSplitConfig => {
  if (workerIds.length === 0) return {};

  const equalPercent = Math.floor(100 / workerIds.length);
  const remainder = 100 - (equalPercent * workerIds.length);

  const split: TeamSplitConfig = {};
  workerIds.forEach((id, index) => {
    split[id] = equalPercent + (index === 0 ? remainder : 0);
  });

  return split;
};

// --- VALIDATE SPLIT TOTALS 100% ---
export const validateSplitTotal = (split: TeamSplitConfig): boolean => {
  const total = Object.values(split).reduce((sum, val) => sum + val, 0);
  return Math.abs(total - 100) < 0.01;
};

// --- VALIDATE JOB FAIR SLUG ---
export const isValidJobFairSlug = (slug: string): boolean => {
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

  public getCurrentCommandCenter(): CommandCenter | null {
    return getStorageItem<CommandCenter | null>(CC_STORAGE_KEY, null);
  }

  public getCurrentCommandCenterId(): string | null {
    const cc = this.getCurrentCommandCenter();
    return cc?.id || null;
  }

  public getCurrentRegion(): Region | null {
    const cc = this.getCurrentCommandCenter();
    return cc?.region || null;
  }

  public getCurrentTaxRate(): number {
    const region = this.getCurrentRegion();
    return region ? getTaxRateForRegion(region) : 5;
  }

  public currentRegionHasUpgrades(seasonType?: SeasonType): boolean {
    const region = this.getCurrentRegion();
    return region ? regionHasUpgrades(region, seasonType) : false;
  }

  public currentRegionHasSeasonSelection(): boolean {
    const region = this.getCurrentRegion();
    return region ? regionHasSeasonSelection(region) : false;
  }

  public currentHasJobFairs(): boolean {
    const cc = this.getCurrentCommandCenter();
    return cc?.jobFairsEnabled || false;
  }

  public currentHasDigitalMapping(): boolean {
    const cc = this.getCurrentCommandCenter();
    return cc?.digitalMappingEnabled || false;
  }

  public setCurrentCommandCenter(cc: CommandCenter): void {
    setStorageItem(CC_STORAGE_KEY, cc);
  }

  public clearCurrentCommandCenter(): void {
    removeStorageItem(CC_STORAGE_KEY);
  }

  public isSuperAdminMode(): boolean {
    return getStorageItem<boolean>(SUPER_ADMIN_MODE_KEY, false);
  }

  public setSuperAdminMode(enabled: boolean): void {
    setStorageItem(SUPER_ADMIN_MODE_KEY, enabled);
  }

  // --- AUTHENTICATION ---

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

  public async getCommandCenterById(id: string): Promise<CommandCenter | null> {
    const { data, error } = await supabase
      .from('command_centers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) return null;

    return this.mapDbToCommandCenter(data);
  }

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

  public async getAllCommandCenters(): Promise<CommandCenter[]> {
    const { data, error } = await supabase
      .from('command_centers')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];

    return data.map(this.mapDbToCommandCenter);
  }

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
    callbookSheetId?: string;
    workerbookRunUrl?: string;
  }): Promise<CommandCenter> {
    const isAvailable = await this.isUsernameAvailable(cc.username);
    if (!isAvailable) {
      throw new Error(`Username "${cc.username}" is already taken.`);
    }

    if (cc.jobFairsEnabled && cc.jobFairsSlug) {
      const slugError = getJobFairSlugError(cc.jobFairsSlug);
      if (slugError) {
        throw new Error(slugError);
      }

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
        callbook_sheet_id: cc.callbookSheetId || null,
        workerbook_run_url: cc.workerbookRunUrl || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToCommandCenter(data);
  }

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
    callbookSheetId: string;
    workerbookRunUrl: string;
  }>): Promise<CommandCenter> {
    if (updates.username) {
      const current = await this.getCommandCenterById(id);
      if (current && current.username !== updates.username) {
        const isAvailable = await this.isUsernameAvailable(updates.username);
        if (!isAvailable) {
          throw new Error(`Username "${updates.username}" is already taken.`);
        }
      }
    }

    if (updates.jobFairsEnabled && updates.jobFairsSlug) {
      const slugError = getJobFairSlugError(updates.jobFairsSlug);
      if (slugError) {
        throw new Error(slugError);
      }

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
    if (updates.callbookSheetId !== undefined) {
      dbUpdates.callbook_sheet_id = updates.digitalMappingEnabled ? updates.callbookSheetId : null;
    }
    if (updates.workerbookRunUrl !== undefined) {
      dbUpdates.workerbook_run_url = updates.workerbookRunUrl || null;
    }

    const { data, error } = await supabase
      .from('command_centers')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    return this.mapDbToCommandCenter(data);
  }

  public async deleteCommandCenter(id: string): Promise<void> {
    const { error } = await supabase
      .from('command_centers')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // --- UNIVERSAL WIPE (Super Admin Only) ---

  public async universalWipe(): Promise<void> {
    const { error: applicantsError } = await supabase
      .from('job_fair_applicants')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (applicantsError) throw new Error(`Failed to delete job_fair_applicants: ${applicantsError.message}`);

    const { error: jfSessionsError } = await supabase
      .from('job_fair_sessions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (jfSessionsError) throw new Error(`Failed to delete job_fair_sessions: ${jfSessionsError.message}`);

    const { error: bookingsError } = await supabase
      .from('bookings')
      .delete()
      .neq('booking_id', '');
    if (bookingsError) throw new Error(`Failed to delete bookings: ${bookingsError.message}`);

    const { error: logsheetError } = await supabase
      .from('logsheet_sessions')
      .delete()
      .neq('id', '');
    if (logsheetError) throw new Error(`Failed to delete logsheet_sessions: ${logsheetError.message}`);

    const { error: routesError } = await supabase
      .from('routes')
      .delete()
      .neq('route_code', '');
    if (routesError) throw new Error(`Failed to delete routes: ${routesError.message}`);

    const { error: transactionsError } = await supabase
      .from('transactions')
      .delete()
      .neq('id', '');
    if (transactionsError) throw new Error(`Failed to delete transactions: ${transactionsError.message}`);

    const { error: emailLogsError } = await supabase
      .from('email_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (emailLogsError) throw new Error(`Failed to delete email_logs: ${emailLogsError.message}`);

    const { error: emailTemplatesError } = await supabase
      .from('email_templates')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (emailTemplatesError) throw new Error(`Failed to delete email_templates: ${emailTemplatesError.message}`);

    const { error: usersError } = await supabase
      .from('users')
      .delete()
      .neq('user_id', '');
    if (usersError) throw new Error(`Failed to delete users: ${usersError.message}`);

    const { error: dailySessionsError } = await supabase
      .from('daily_sessions')
      .delete()
      .neq('date', '1900-01-01');
    if (dailySessionsError) throw new Error(`Failed to delete daily_sessions: ${dailySessionsError.message}`);

    const { error: commandCentersError } = await supabase
      .from('command_centers')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (commandCentersError) throw new Error(`Failed to delete command_centers: ${commandCentersError.message}`);

    this.clearCurrentCommandCenter();
    this.setSuperAdminMode(false);
  }

  // --- VALIDATION ---

  public async isUsernameAvailable(username: string): Promise<boolean> {
    if (username.toLowerCase() === SUPER_ADMIN_USERNAME.toLowerCase()) {
      return false;
    }

    const { data: ccData } = await supabase
      .from('command_centers')
      .select('id')
      .ilike('username', username)
      .maybeSingle();

    if (ccData) return false;

    const { data: rmData } = await supabase
      .from('users')
      .select('user_id')
      .ilike('username', username)
      .maybeSingle();

    if (rmData) return false;

    const { data: workerData } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', username)
      .maybeSingle();

    if (workerData) return false;

    return true;
  }

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
      callbookSheetId: data.callbook_sheet_id || undefined,
      workerbookRunUrl: data.workerbook_run_url || undefined,
    };
  }
}

export const commandCenterService = CommandCenterService.getInstance();
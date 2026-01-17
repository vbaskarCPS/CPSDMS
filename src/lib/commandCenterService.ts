// src/lib/commandCenterService.ts
import { supabase } from './supabase';
import { getStorageItem, setStorageItem, removeStorageItem } from './localStorage';

// --- TYPES ---
export type Region = 'West' | 'Central' | 'East';

export interface CommandCenter {
  id: string;
  username: string;
  displayName: string;
  region: Region;
  workerbookSheetId: string;
  masterbookingsSheetId: string;
  createdAt?: string;
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
  }): Promise<CommandCenter> {
    // Validate username uniqueness across all login types
    const isAvailable = await this.isUsernameAvailable(cc.username);
    if (!isAvailable) {
      throw new Error(`Username "${cc.username}" is already taken.`);
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

    const dbUpdates: any = {};
    if (updates.username) dbUpdates.username = updates.username;
    if (updates.password) dbUpdates.password = updates.password;
    if (updates.displayName) dbUpdates.display_name = updates.displayName;
    if (updates.region) dbUpdates.region = updates.region;
    if (updates.workerbookSheetId) dbUpdates.workerbook_sheet_id = updates.workerbookSheetId;
    if (updates.masterbookingsSheetId) dbUpdates.masterbookings_sheet_id = updates.masterbookingsSheetId;

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
   * 1. bookings (refs users, daily_sessions, command_centers)
   * 2. logsheet_sessions (refs users, daily_sessions, command_centers)
   * 3. routes (refs users, daily_sessions, command_centers)
   * 4. transactions (refs users, command_centers)
   * 5. email_logs (standalone)
   * 6. users (refs command_centers)
   * 7. daily_sessions (refs command_centers)
   * 8. command_centers (parent table)
   */
  public async universalWipe(): Promise<void> {
    // Delete in FK-safe order (children before parents)
    
    // 1. bookings
    const { error: bookingsError } = await supabase
      .from('bookings')
      .delete()
      .neq('booking_id', ''); // Delete all rows
    if (bookingsError) throw new Error(`Failed to delete bookings: ${bookingsError.message}`);

    // 2. logsheet_sessions
    const { error: logsheetError } = await supabase
      .from('logsheet_sessions')
      .delete()
      .neq('id', '');
    if (logsheetError) throw new Error(`Failed to delete logsheet_sessions: ${logsheetError.message}`);

    // 3. routes
    const { error: routesError } = await supabase
      .from('routes')
      .delete()
      .neq('route_code', '');
    if (routesError) throw new Error(`Failed to delete routes: ${routesError.message}`);

    // 4. transactions
    const { error: transactionsError } = await supabase
      .from('transactions')
      .delete()
      .neq('id', '');
    if (transactionsError) throw new Error(`Failed to delete transactions: ${transactionsError.message}`);

    // 5. email_logs
    const { error: emailLogsError } = await supabase
      .from('email_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows (UUID comparison)
    if (emailLogsError) throw new Error(`Failed to delete email_logs: ${emailLogsError.message}`);

    // 6. users
    const { error: usersError } = await supabase
      .from('users')
      .delete()
      .neq('user_id', '');
    if (usersError) throw new Error(`Failed to delete users: ${usersError.message}`);

    // 7. daily_sessions
    const { error: dailySessionsError } = await supabase
      .from('daily_sessions')
      .delete()
      .neq('date', '1900-01-01'); // Delete all rows
    if (dailySessionsError) throw new Error(`Failed to delete daily_sessions: ${dailySessionsError.message}`);

    // 8. command_centers
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

  // --- HELPERS ---

  private mapDbToCommandCenter(data: any): CommandCenter {
    return {
      id: data.id,
      username: data.username,
      displayName: data.display_name,
      region: data.region as Region,
      workerbookSheetId: data.workerbook_sheet_id,
      masterbookingsSheetId: data.masterbookings_sheet_id,
      createdAt: data.created_at,
    };
  }
}

export const commandCenterService = CommandCenterService.getInstance();
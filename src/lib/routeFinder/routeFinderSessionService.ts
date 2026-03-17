// src/lib/routeFinder/routeFinderSessionService.ts
//
// Supabase persistence for the Route Finder work session.
// Stores: queue progress, learned streets, fix log.
// Session survives across days — resumes exactly where you left off.
//
// Required Supabase table (run once in SQL editor):
//
//   create table route_finder_sessions (
//     id uuid primary key default gen_random_uuid(),
//     spreadsheet_id text not null unique,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now(),
//     total_rows integer default 0,
//     fixed_rows integer default 0,
//     pending_row_ids jsonb default '[]',
//     learned_streets jsonb default '{}',
//     learned_streets_original jsonb default '{}',
//     fix_log jsonb default '[]'
//   );
//

import { supabase } from '../supabase';
import { RouteFinderRow, normalizeStreetForMatch } from './routeFinderEngine';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RouteFinderSession {
  id: string;
  spreadsheetId: string;
  totalRows: number;
  fixedRows: number;
  pendingRowIds: string[];
  learnedStreets: Record<string, string[]>;         // routeCode → normalized streets
  learnedStreetsOriginal: Record<string, string[]>; // routeCode → original streets (display)
  fixLog: FixLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface FixLogEntry {
  rowId: string;
  bookingId: string;
  sheetName: string;
  oldRouteCode: string;
  newRouteCode: string;
  oldStreetName: string;
  newStreetName: string;
  cascadeCount: number;
  timestamp: string;
}

const TABLE = 'route_finder_sessions';

// ─── SESSION SERVICE ──────────────────────────────────────────────────────────

export const routeFinderSessionService = {

  // ── Load existing session by spreadsheet ID ───────────────────────────────

  async loadSession(spreadsheetId: string): Promise<RouteFinderSession | null> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('spreadsheet_id', spreadsheetId)
      .maybeSingle();

    if (error) {
      console.error('RF: error loading session:', error);
      return null;
    }
    if (!data) return null;

    return mapRow(data);
  },

  // ── Create a brand-new session ────────────────────────────────────────────

  async createSession(
    spreadsheetId: string,
    queue: RouteFinderRow[],
    totalScanned: number
  ): Promise<RouteFinderSession> {
    // Delete any stale session for this spreadsheet first
    await supabase.from(TABLE).delete().eq('spreadsheet_id', spreadsheetId);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        spreadsheet_id:           spreadsheetId,
        total_rows:               totalScanned,
        fixed_rows:               0,
        pending_row_ids:          queue.map(r => r.id),
        learned_streets:          {},
        learned_streets_original: {},
        fix_log:                  [],
      })
      .select()
      .single();

    if (error) throw new Error(`RF: failed to create session: ${error.message}`);
    return mapRow(data);
  },

  // ── Mark a row (and any cascade-resolved rows) as fixed ──────────────────

  async markRowFixed(params: {
    sessionId: string;
    rowId: string;
    logEntry: FixLogEntry;
    currentPendingIds: string[];
    currentFixedRows: number;
    cascadeResolvedIds: string[];
  }): Promise<{ newPendingIds: string[]; newFixedRows: number }> {
    const { sessionId, rowId, logEntry, currentPendingIds, currentFixedRows, cascadeResolvedIds } = params;

    const resolvedSet  = new Set([rowId, ...cascadeResolvedIds]);
    const newPendingIds = currentPendingIds.filter(id => !resolvedSet.has(id));
    const newFixedRows  = currentFixedRows + resolvedSet.size;

    // Fetch current log to append
    const { data: current } = await supabase
      .from(TABLE)
      .select('fix_log')
      .eq('id', sessionId)
      .single();

    const currentLog = (current?.fix_log as FixLogEntry[]) || [];

    const { error } = await supabase
      .from(TABLE)
      .update({
        pending_row_ids: newPendingIds,
        fixed_rows:      newFixedRows,
        fix_log:         [...currentLog, { ...logEntry, cascadeCount: cascadeResolvedIds.length }],
        updated_at:      new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) console.error('RF: error marking row fixed:', error);

    return { newPendingIds, newFixedRows };
  },

  // ── Move a row to the back of the pending queue (skip) ───────────────────

  async skipRow(
    sessionId: string,
    rowId: string,
    currentPendingIds: string[]
  ): Promise<string[]> {
    const withoutRow   = currentPendingIds.filter(id => id !== rowId);
    const newPendingIds = [...withoutRow, rowId]; // append to end

    await supabase
      .from(TABLE)
      .update({ pending_row_ids: newPendingIds, updated_at: new Date().toISOString() })
      .eq('id', sessionId);

    return newPendingIds;
  },

  // ── Add a learned street (updates both normalized and original maps) ───────

  async addLearnedStreet(params: {
    sessionId: string;
    routeCode: string;
    originalStreet: string;
    currentLearned: Record<string, string[]>;
    currentLearnedOriginal: Record<string, string[]>;
  }): Promise<{ learned: Record<string, string[]>; learnedOriginal: Record<string, string[]> }> {
    const { sessionId, routeCode, originalStreet, currentLearned, currentLearnedOriginal } = params;

    const rc             = routeCode.toUpperCase();
    const normalizedStreet = normalizeStreetForMatch(originalStreet);

    const newLearned         = { ...currentLearned };
    const newLearnedOriginal = { ...currentLearnedOriginal };

    if (!newLearned[rc]) newLearned[rc] = [];
    if (!newLearnedOriginal[rc]) newLearnedOriginal[rc] = [];

    // Avoid duplicates
    if (!newLearned[rc].includes(normalizedStreet)) {
      newLearned[rc]         = [...newLearned[rc], normalizedStreet];
      newLearnedOriginal[rc] = [...newLearnedOriginal[rc], originalStreet];
    }

    const { error } = await supabase
      .from(TABLE)
      .update({
        learned_streets:          newLearned,
        learned_streets_original: newLearnedOriginal,
        updated_at:               new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) console.error('RF: error saving learned street:', error);

    return { learned: newLearned, learnedOriginal: newLearnedOriginal };
  },

  // ── Wipe a session (for re-scan) ─────────────────────────────────────────

  async resetSession(spreadsheetId: string): Promise<void> {
    await supabase.from(TABLE).delete().eq('spreadsheet_id', spreadsheetId);
  },

  // ── Spreadsheet ID persistence (localStorage) ─────────────────────────────

  getSavedSpreadsheetId(): string {
    try { return localStorage.getItem('rf_spreadsheet_id') || ''; }
    catch { return ''; }
  },

  saveSpreadsheetId(id: string): void {
    try { localStorage.setItem('rf_spreadsheet_id', id); }
    catch { /* ignore */ }
  },
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function mapRow(data: any): RouteFinderSession {
  return {
    id:                   data.id,
    spreadsheetId:        data.spreadsheet_id,
    totalRows:            data.total_rows || 0,
    fixedRows:            data.fixed_rows || 0,
    pendingRowIds:        data.pending_row_ids || [],
    learnedStreets:       data.learned_streets || {},
    learnedStreetsOriginal: data.learned_streets_original || {},
    fixLog:               data.fix_log || [],
    createdAt:            data.created_at,
    updatedAt:            data.updated_at,
  };
}
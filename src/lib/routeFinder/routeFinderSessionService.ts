// src/lib/routeFinder/routeFinderSessionService.ts
//
// Supabase persistence for the Route Finder work session.
// Stores: fix log + learned streets only.
// pending_row_ids is intentionally never stored — 10k IDs would exceed Supabase limits.
// Resume works by re-scanning and subtracting already-fixed row IDs from fix_log.
//

import { supabase } from '../supabase';
import { RouteFinderRow, normalizeStreetForMatch } from './routeFinderEngine';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RouteFinderSession {
  id: string;
  spreadsheetId: string;
  totalRows: number;
  fixedRows: number;
  pendingRowIds: string[];                          // never persisted — always [] in DB
  learnedStreets: Record<string, string[]>;
  learnedStreetsOriginal: Record<string, string[]>;
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

export const routeFinderSessionService = {

  async loadSession(spreadsheetId: string): Promise<RouteFinderSession | null> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('spreadsheet_id', spreadsheetId)
      .maybeSingle();

    if (error) { console.error('RF: error loading session:', error); return null; }
    if (!data) return null;
    return mapRow(data);
  },

  // Never stores pending_row_ids — too large for Supabase with 10k+ rows.
  // Resume uses fix_log to subtract already-fixed rows from a fresh scan.
  async createSession(
    spreadsheetId: string,
    _queue: RouteFinderRow[],
    totalScanned: number
  ): Promise<RouteFinderSession> {
    await supabase.from(TABLE).delete().eq('spreadsheet_id', spreadsheetId);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        spreadsheet_id:           spreadsheetId,
        total_rows:               totalScanned,
        fixed_rows:               0,
        pending_row_ids:          [],
        learned_streets:          {},
        learned_streets_original: {},
        fix_log:                  [],
      })
      .select()
      .single();

    if (error) throw new Error(`RF: failed to create session: ${error.message}`);
    return mapRow(data);
  },

  async markRowFixed(params: {
    sessionId: string;
    rowId: string;
    logEntry: FixLogEntry;
    currentFixedRows: number;
    cascadeResolvedIds: string[];
  }): Promise<{ newFixedRows: number }> {
    const { sessionId, rowId, logEntry, currentFixedRows, cascadeResolvedIds } = params;

    const newFixedRows = currentFixedRows + 1 + cascadeResolvedIds.length;

    const { data: current } = await supabase
      .from(TABLE)
      .select('fix_log')
      .eq('id', sessionId)
      .single();

    const currentLog = (current?.fix_log as FixLogEntry[]) || [];

    const cascadeEntries: FixLogEntry[] = cascadeResolvedIds.map(cId => ({
      ...logEntry,
      rowId: cId,
      bookingId: cId,
      cascadeCount: 0,
      timestamp: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from(TABLE)
      .update({
        fixed_rows: newFixedRows,
        fix_log:    [...currentLog, { ...logEntry, cascadeCount: cascadeResolvedIds.length }, ...cascadeEntries],
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) console.error('RF: error marking row fixed:', error);
    return { newFixedRows };
  },

  async addLearnedStreet(params: {
    sessionId: string;
    routeCode: string;
    originalStreet: string;
    currentLearned: Record<string, string[]>;
    currentLearnedOriginal: Record<string, string[]>;
  }): Promise<{ learned: Record<string, string[]>; learnedOriginal: Record<string, string[]> }> {
    const { sessionId, routeCode, originalStreet, currentLearned, currentLearnedOriginal } = params;

    const rc               = routeCode.toUpperCase();
    const normalizedStreet = normalizeStreetForMatch(originalStreet);

    const newLearned         = { ...currentLearned };
    const newLearnedOriginal = { ...currentLearnedOriginal };

    if (!newLearned[rc]) newLearned[rc] = [];
    if (!newLearnedOriginal[rc]) newLearnedOriginal[rc] = [];

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

  async resetSession(spreadsheetId: string): Promise<void> {
    await supabase.from(TABLE).delete().eq('spreadsheet_id', spreadsheetId);
  },

  getSavedSpreadsheetId(): string {
    try { return localStorage.getItem('rf_spreadsheet_id') || ''; }
    catch { return ''; }
  },

  saveSpreadsheetId(id: string): void {
    try { localStorage.setItem('rf_spreadsheet_id', id); }
    catch { /* ignore */ }
  },
};

function mapRow(data: any): RouteFinderSession {
  return {
    id:                     data.id,
    spreadsheetId:          data.spreadsheet_id,
    totalRows:              data.total_rows || 0,
    fixedRows:              data.fixed_rows || 0,
    pendingRowIds:          [],
    learnedStreets:         data.learned_streets || {},
    learnedStreetsOriginal: data.learned_streets_original || {},
    fixLog:                 data.fix_log || [],
    createdAt:              data.created_at,
    updatedAt:              data.updated_at,
  };
}
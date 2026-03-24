// src/lib/routeFinder/rfScanSessionService.ts
//
// CRUD for rf_scan_sessions and rf_review_queue tables.
// All Supabase queries paginate in chunks of 500 to avoid the 1000-row default limit.
//

import { supabase } from '../supabase';
import { CustomerRow } from './routeFinderGeoService';

const PAGE_SIZE = 500;

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ScanStatus = 'discovering' | 'confirming' | 'scanning' | 'reviewing' | 'complete';
export type QueueStatus = 'pending' | 'fixed' | 'skipped';
export type PinColor = 'orange' | 'red';

export interface RFScanSession {
  id: string;
  region: string;
  aerationSpreadsheetId: string | null;
  sealingSpreadsheetId: string | null;
  status: ScanStatus;
  currentGroup: string | null;
  groupsTotal: number;
  groupsCompleted: number;
  customersTotal: number;
  customersFixed: number;
  customersQueued: number;
  customersSkipped: number;
  createdAt: string;
  updatedAt: string;
}

export interface RFQueueEntry {
  id: string;
  scanSessionId: string;
  customerId: string;
  mapPrefix: string;
  areaName: string;
  firstName: string;
  lastName: string;
  phone: string;
  houseNum: string;
  streetName: string;
  city: string;
  currentRouteCode: string;
  suggestedRouteCode: string;
  suggestedSegmentName: string;
  distanceDeg: number;
  pinColor: PinColor;
  lat: number | null;
  lng: number | null;
  rows: CustomerRow[];
  status: QueueStatus;
  fixLog: any;
  createdAt: string;
  updatedAt: string;
}

// ─── MAPPERS ──────────────────────────────────────────────────────────────────

function mapSession(row: any): RFScanSession {
  return {
    id:                     row.id,
    region:                 row.region,
    aerationSpreadsheetId:  row.aeration_spreadsheet_id,
    sealingSpreadsheetId:   row.sealing_spreadsheet_id,
    status:                 row.status,
    currentGroup:           row.current_group,
    groupsTotal:            row.groups_total,
    groupsCompleted:        row.groups_completed,
    customersTotal:         row.customers_total,
    customersFixed:         row.customers_fixed,
    customersQueued:        row.customers_queued,
    customersSkipped:       row.customers_skipped,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
}

function mapQueueEntry(row: any): RFQueueEntry {
  return {
    id:                   row.id,
    scanSessionId:        row.scan_session_id,
    customerId:           row.customer_id,
    mapPrefix:            row.map_prefix,
    areaName:             row.area_name,
    firstName:            row.first_name || '',
    lastName:             row.last_name || '',
    phone:                row.phone || '',
    houseNum:             row.house_num || '',
    streetName:           row.street_name || '',
    city:                 row.city || '',
    currentRouteCode:     row.current_route_code || '',
    suggestedRouteCode:   row.suggested_route_code || '',
    suggestedSegmentName: row.suggested_segment_name || '',
    distanceDeg:          row.distance_deg || 0,
    pinColor:             row.pin_color,
    lat:                  row.lat,
    lng:                  row.lng,
    rows:                 row.rows || [],
    status:               row.status,
    fixLog:               row.fix_log || {},
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
  };
}

// ─── PAGINATED FETCH HELPER ───────────────────────────────────────────────────

async function fetchAllPages<T>(
  buildQuery: (from: number, to: number) => any,
  mapper: (row: any) => T
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw new Error('Supabase fetch failed: ' + error.message);
    if (!data || data.length === 0) break;
    results.push(...data.map(mapper));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return results;
}

// ─── SERVICE ──────────────────────────────────────────────────────────────────

export const rfScanSessionService = {

  // ── Sessions ────────────────────────────────────────────────────────────────

  async loadLatestSession(
    aerationId: string | null,
    sealingId: string | null
  ): Promise<RFScanSession | null> {
    // Match by whichever IDs are provided
    let query = supabase
      .from('rf_scan_sessions')
      .select('*')
      .neq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1);

    if (aerationId) query = query.eq('aeration_spreadsheet_id', aerationId);
    if (sealingId)  query = query.eq('sealing_spreadsheet_id', sealingId);

    const { data, error } = await query.maybeSingle();
    if (error) { console.error('RF: error loading session:', error); return null; }
    if (!data) return null;
    return mapSession(data);
  },

  async createSession(params: {
    region: string;
    aerationSpreadsheetId: string | null;
    sealingSpreadsheetId: string | null;
    groupsTotal: number;
    customersTotal: number;
  }): Promise<RFScanSession> {
    const { data, error } = await supabase
      .from('rf_scan_sessions')
      .insert({
        region:                   params.region,
        aeration_spreadsheet_id:  params.aerationSpreadsheetId,
        sealing_spreadsheet_id:   params.sealingSpreadsheetId,
        status:                   'scanning',
        groups_total:             params.groupsTotal,
        customers_total:          params.customersTotal,
      })
      .select()
      .single();

    if (error) throw new Error('Failed to create scan session: ' + error.message);
    return mapSession(data);
  },

  async updateSession(
    sessionId: string,
    updates: Partial<{
      status: ScanStatus;
      currentGroup: string | null;
      groupsCompleted: number;
      customersFixed: number;
      customersQueued: number;
      customersSkipped: number;
    }>
  ): Promise<void> {
    const row: any = { updated_at: new Date().toISOString() };
    if (updates.status !== undefined)           row.status            = updates.status;
    if (updates.currentGroup !== undefined)     row.current_group     = updates.currentGroup;
    if (updates.groupsCompleted !== undefined)  row.groups_completed  = updates.groupsCompleted;
    if (updates.customersFixed !== undefined)   row.customers_fixed   = updates.customersFixed;
    if (updates.customersQueued !== undefined)  row.customers_queued  = updates.customersQueued;
    if (updates.customersSkipped !== undefined) row.customers_skipped = updates.customersSkipped;

    const { error } = await supabase
      .from('rf_scan_sessions')
      .update(row)
      .eq('id', sessionId);

    if (error) console.error('RF: error updating session:', error);
  },

  // ── Review Queue ─────────────────────────────────────────────────────────────

  // Load all pending queue entries for a session (paginated)
  async loadPendingQueue(sessionId: string): Promise<RFQueueEntry[]> {
    return fetchAllPages(
      (from, to) => supabase
        .from('rf_review_queue')
        .select('*')
        .eq('scan_session_id', sessionId)
        .eq('status', 'pending')
        .order('map_prefix')
        .order('created_at')
        .range(from, to),
      mapQueueEntry
    );
  },

  // Load pending queue entries for a specific map prefix (paginated)
  async loadPendingQueueForPrefix(
    sessionId: string,
    mapPrefix: string
  ): Promise<RFQueueEntry[]> {
    return fetchAllPages(
      (from, to) => supabase
        .from('rf_review_queue')
        .select('*')
        .eq('scan_session_id', sessionId)
        .eq('map_prefix', mapPrefix)
        .eq('status', 'pending')
        .order('created_at')
        .range(from, to),
      mapQueueEntry
    );
  },

  // Push a batch of entries to the queue (upsert — safe to re-run)
  async pushToQueue(entries: Omit<RFQueueEntry, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<void> {
    if (entries.length === 0) return;

    const rows = entries.map(e => ({
      scan_session_id:        e.scanSessionId,
      customer_id:            e.customerId,
      map_prefix:             e.mapPrefix,
      area_name:              e.areaName,
      first_name:             e.firstName,
      last_name:              e.lastName,
      phone:                  e.phone,
      house_num:              e.houseNum,
      street_name:            e.streetName,
      city:                   e.city,
      current_route_code:     e.currentRouteCode,
      suggested_route_code:   e.suggestedRouteCode,
      suggested_segment_name: e.suggestedSegmentName,
      distance_deg:           e.distanceDeg,
      pin_color:              e.pinColor,
      lat:                    e.lat,
      lng:                    e.lng,
      rows:                   e.rows,
      status:                 e.status,
      fix_log:                e.fixLog,
    }));

    // Insert in chunks of PAGE_SIZE
    for (let i = 0; i < rows.length; i += PAGE_SIZE) {
      const chunk = rows.slice(i, i + PAGE_SIZE);
      const { error } = await supabase
        .from('rf_review_queue')
        .upsert(chunk, { onConflict: 'scan_session_id,customer_id' });

      if (error) throw new Error('Failed to push to queue: ' + error.message);
    }
  },

  // Mark a single queue entry as fixed
  async markFixed(params: {
    entryId: string;
    newRouteCode: string;
    newStreetName: string;
    fixedBy: 'auto' | 'manual';
  }): Promise<void> {
    const { error } = await supabase
      .from('rf_review_queue')
      .update({
        status:     'fixed',
        fix_log: {
          newRouteCode:  params.newRouteCode,
          newStreetName: params.newStreetName,
          fixedBy:       params.fixedBy,
          timestamp:     new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.entryId);

    if (error) console.error('RF: error marking fixed:', error);
  },

  // Mark a single queue entry as skipped
  async markSkipped(entryId: string): Promise<void> {
    const { error } = await supabase
      .from('rf_review_queue')
      .update({ status: 'skipped', updated_at: new Date().toISOString() })
      .eq('id', entryId);

    if (error) console.error('RF: error marking skipped:', error);
  },

  // Get summary counts for a session
  async getQueueCounts(sessionId: string): Promise<{
    pending: number;
    fixed: number;
    skipped: number;
    orange: number;
    red: number;
  }> {
    const { data, error } = await supabase
      .from('rf_review_queue')
      .select('status, pin_color')
      .eq('scan_session_id', sessionId);

    if (error) return { pending: 0, fixed: 0, skipped: 0, orange: 0, red: 0 };

    const rows = data || [];
    return {
      pending: rows.filter(r => r.status === 'pending').length,
      fixed:   rows.filter(r => r.status === 'fixed').length,
      skipped: rows.filter(r => r.status === 'skipped').length,
      orange:  rows.filter(r => r.pin_color === 'orange' && r.status === 'pending').length,
      red:     rows.filter(r => r.pin_color === 'red' && r.status === 'pending').length,
    };
  },

  // Get distinct map prefixes that have pending entries
  async getPendingPrefixes(sessionId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('rf_review_queue')
      .select('map_prefix')
      .eq('scan_session_id', sessionId)
      .eq('status', 'pending');

    if (error) return [];
    const prefixes = [...new Set((data || []).map(r => r.map_prefix))];
    return prefixes.sort();
  },

  // Re-match pending queue entries after a new segment is added
  // Returns IDs of entries that can now be auto-resolved
  async findResolvableBySegmentName(
    sessionId: string,
    segmentName: string,
    mapPrefix: string
  ): Promise<RFQueueEntry[]> {
    return fetchAllPages(
      (from, to) => supabase
        .from('rf_review_queue')
        .select('*')
        .eq('scan_session_id', sessionId)
        .eq('status', 'pending')
        .eq('map_prefix', mapPrefix)
        .ilike('street_name', `%${segmentName}%`)
        .range(from, to),
      mapQueueEntry
    );
  },

  // Delete a session and its queue (cascade handles queue deletion)
  async deleteSession(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from('rf_scan_sessions')
      .delete()
      .eq('id', sessionId);

    if (error) console.error('RF: error deleting session:', error);
  },
};
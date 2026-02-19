// src/lib/dialerRealtimeService.ts
//
// Handles Supabase Realtime for the dialer team feed.
// - publishBookingEvent(): INSERTs a booking row (YES/PREPAY)
// - publishDialEvent():    INSERTs a dial-tick row (every disposition)
// - publishLoginEvent():   INSERTs a login event (fires once at auth)
// - publishMultiplierEvent(): INSERTs a multiplier activation row
// - publishPresence():     UPSERTs heartbeat row into dialer_presence
// - clearPresence():       DELETEs own row from dialer_presence
// - subscribeToPresence(): listens for changes in dialer_presence
// - fetchActivePresence(): fetches all rows with last_seen within 90s
// - subscribeToTeamFeed(): listens for INSERTs from the current campaign only
// - subscribeToGlobalFeed(): listens for INSERTs across ALL campaigns (incl. logins)
// - fetchTodayEvents():    fetches today's booking + login + multiplier events
// - fetchFireteamStats():  aggregates per-member stats for one campaign, today
// - fetchGlobalStats():    aggregates per-member stats across all campaigns, today
// - fetchFireteamStatsFromSessions(): reads per-member stats from dialer_sessions
// - fetchGlobalStatsFromSessions():   reads per-member stats from dialer_sessions
// - createIsolatedChannel(): creates a private realtime subscription
//

import { supabase } from './supabase';
import { getTodayEST } from './campaignService';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TeamBookingEvent } from '../pages/Dialer/DialerHUD';

// =============================================================================
// TYPES
// =============================================================================

interface PublishBookingPayload {
  campaignId: string;
  managerId: string;
  managerName: string;
  points: number;
  ppDollars?: number;
  badges?: string[];
  multipliers?: string[];
  isPrepay?: boolean;
}

interface PublishDialPayload {
  campaignId: string;
  managerId: string;
  managerName: string;
}

export interface PublishMultiplierPayload {
  campaignId: string;
  managerId: string;
  managerName: string;
  multiplierId: string;   // e.g. 'ghost_town', 'blitz'
  multiplierText: string; // e.g. 'Justice N is in a Ghost Town'
}

export interface PresenceRecord {
  managerId: string;
  managerName: string;
  campaignId: string;
  lastSeen: string;
}

type TeamFeedCallback = (event: TeamBookingEvent & { isLogin?: boolean; isMultiplier?: boolean; multiplierId?: string; multiplierText?: string }) => void;
type PresenceCallback = (records: PresenceRecord[]) => void;

// =============================================================================
// MEMBER STATS
// =============================================================================

export interface MemberStats {
  managerId: string;
  managerName: string;
  points: number;
  totalBookings: number;
  pbs: number;
  pps: number;
  ppDollars: number;
  totalDials: number;
  badges: string[];
}

// =============================================================================
// SERVICE
// =============================================================================

class DialerRealtimeService {
  private static instance: DialerRealtimeService;

  private fireteamChannel: RealtimeChannel | null = null;
  private globalChannel: RealtimeChannel | null = null;
  private presenceChannel: RealtimeChannel | null = null;

  private currentCampaignId: string | null = null;
  private currentManagerId: string | null = null;

  private constructor() {}

  public static getInstance(): DialerRealtimeService {
    if (!DialerRealtimeService.instance) {
      DialerRealtimeService.instance = new DialerRealtimeService();
    }
    return DialerRealtimeService.instance;
  }

  // =========================================================================
  // ISOLATED CHANNEL
  // =========================================================================

  public createIsolatedChannel(
    channelName: string,
    filter: {
      event: string;
      schema: string;
      table: string;
      filter?: string;
    },
    callback: (row: any) => void
  ): () => void {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        filter as any,
        (payload) => { callback(payload.new); }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[IsolatedChannel] Subscribed: ${channelName}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`[IsolatedChannel] Error: ${channelName}`);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }

  // =========================================================================
  // PUBLISH BOOKING
  // =========================================================================

  public async publishBookingEvent(payload: PublishBookingPayload): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_team_events')
        .insert({
          campaign_id:  payload.campaignId,
          manager_id:   payload.managerId,
          manager_name: payload.managerName,
          points:       payload.points,
          pp_dollars:   payload.ppDollars ?? 0,
          badges:       payload.badges || [],
          multipliers:  payload.multipliers || [],
          is_prepay:    payload.isPrepay || false,
          is_booking:   true,
          is_dial:      true,
        });
      if (error) console.error('Failed to publish booking event:', error.message);
    } catch (err) {
      console.error('Booking event publish error:', err);
    }
  }

  // =========================================================================
  // PUBLISH MULTIPLIER ACTIVATION
  // Inserts a row with is_multiplier=true so all teammates see it in realtime.
  // multiplier_id stores which multiplier fired (e.g. 'ghost_town').
  // manager_name stores the display name for rendering in FireteamPanel.
  // =========================================================================

  public async publishMultiplierEvent(payload: PublishMultiplierPayload): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_team_events')
        .insert({
          campaign_id:    payload.campaignId,
          manager_id:     payload.managerId,
          manager_name:   payload.managerName,
          points:         0,
          pp_dollars:     0,
          badges:         [],
          multipliers:    [payload.multiplierId],
          is_prepay:      false,
          is_booking:     false,
          is_dial:        false,
          is_login:       false,
          is_multiplier:  true,
          multiplier_id:  payload.multiplierId,
          // Store the display text in the multipliers array slot [0] is already
          // the id; we embed the text as manager_name suffix via a separate
          // approach — we store it JSON-encoded in a dedicated column.
          // Since we only have multiplier_id as new column, the full text
          // is reconstructed client-side from multiplierId + managerName.
        });
      if (error) console.error('Failed to publish multiplier event:', error.message);
    } catch (err) {
      console.error('Multiplier event publish error:', err);
    }
  }

  // =========================================================================
  // PUBLISH LOGIN EVENT
  // =========================================================================

  public async publishLoginEvent(payload: {
    campaignId: string;
    managerId: string;
    managerName: string;
  }): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_team_events')
        .insert({
          campaign_id:  payload.campaignId,
          manager_id:   payload.managerId,
          manager_name: payload.managerName,
          points:       0,
          pp_dollars:   0,
          badges:       [],
          multipliers:  [],
          is_prepay:    false,
          is_booking:   false,
          is_dial:      false,
          is_login:     true,
        });
      if (error) console.error('Failed to publish login event:', error.message);
    } catch (err) {
      console.error('Login event publish error:', err);
    }
  }

  // =========================================================================
  // PUBLISH DIAL TICK
  // =========================================================================

  public async publishDialEvent(payload: PublishDialPayload): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_team_events')
        .insert({
          campaign_id:  payload.campaignId,
          manager_id:   payload.managerId,
          manager_name: payload.managerName,
          points:       0,
          pp_dollars:   0,
          badges:       [],
          multipliers:  [],
          is_prepay:    false,
          is_booking:   false,
          is_dial:      true,
        });
      if (error) console.error('Failed to publish dial event:', error.message);
    } catch (err) {
      console.error('Dial event publish error:', err);
    }
  }

  // =========================================================================
  // PRESENCE — UPSERT
  // =========================================================================

  public async publishPresence(payload: {
    managerId: string;
    managerName: string;
    campaignId: string;
  }): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_presence')
        .upsert(
          {
            manager_id:   payload.managerId,
            manager_name: payload.managerName,
            campaign_id:  payload.campaignId,
            last_seen:    new Date().toISOString(),
          },
          { onConflict: 'manager_id' }
        );
      if (error) console.error('Failed to publish presence:', error.message);
    } catch (err) {
      console.error('Presence publish error:', err);
    }
  }

  // =========================================================================
  // PRESENCE — DELETE
  // =========================================================================

  public async clearPresence(managerId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_presence')
        .delete()
        .eq('manager_id', managerId);
      if (error) console.error('Failed to clear presence:', error.message);
    } catch (err) {
      console.error('Presence clear error:', err);
    }
  }

  // =========================================================================
  // PRESENCE — FETCH active
  // =========================================================================

  public async fetchActivePresence(): Promise<PresenceRecord[]> {
    const cutoff = new Date(Date.now() - 90_000).toISOString();
    const { data, error } = await supabase
      .from('dialer_presence')
      .select('manager_id, manager_name, campaign_id, last_seen')
      .gte('last_seen', cutoff);

    if (error) { console.error('Failed to fetch presence:', error.message); return []; }

    return (data || []).map(row => ({
      managerId:   row.manager_id,
      managerName: row.manager_name,
      campaignId:  row.campaign_id,
      lastSeen:    row.last_seen,
    }));
  }

  // =========================================================================
  // PRESENCE — SUBSCRIBE
  // =========================================================================

  public subscribeToPresence(callback: PresenceCallback): () => void {
    if (this.presenceChannel) {
      supabase.removeChannel(this.presenceChannel);
      this.presenceChannel = null;
    }

    this.presenceChannel = supabase
      .channel('dialer_presence_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dialer_presence' },
        async () => {
          const records = await this.fetchActivePresence();
          callback(records);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('[Presence] Subscribed');
      });

    return () => {
      if (this.presenceChannel) {
        supabase.removeChannel(this.presenceChannel);
        this.presenceChannel = null;
      }
    };
  }

  // =========================================================================
  // FETCH TODAY'S EVENTS — bookings + logins + multiplier activations
  // campaignId = undefined → global
  // campaignId = string    → fireteam bookings + all logins + all multipliers
  // =========================================================================

  public async fetchTodayEvents(campaignId?: string): Promise<(TeamBookingEvent & { isLogin?: boolean; isMultiplier?: boolean; multiplierId?: string })[]> {
    const today = new Date().toISOString().split('T')[0];
    const cols = 'id, manager_id, manager_name, points, pp_dollars, badges, multipliers, is_prepay, is_booking, is_login, is_multiplier, multiplier_id, created_at';
    const gte = `${today}T00:00:00.000Z`;
    const lte = `${today}T23:59:59.999Z`;

    let data: any[] | null = null;
    let error: any = null;

    if (campaignId) {
      ({ data, error } = await supabase
        .from('dialer_team_events')
        .select(cols)
        .or(`and(is_booking.eq.true,campaign_id.eq.${campaignId}),is_login.eq.true,is_multiplier.eq.true`)
        .gte('created_at', gte)
        .lte('created_at', lte)
        .order('created_at', { ascending: true }));
    } else {
      ({ data, error } = await supabase
        .from('dialer_team_events')
        .select(cols)
        .or('is_booking.eq.true,is_login.eq.true,is_multiplier.eq.true')
        .gte('created_at', gte)
        .lte('created_at', lte)
        .order('created_at', { ascending: true }));
    }

    if (error) { console.error('Failed to fetch today events:', error.message); return []; }

    return (data || []).map(row => ({
      id:           row.id,
      name:         row.manager_name,
      points:       row.points,
      badges:       row.badges || [],
      multipliers:  row.multipliers || [],
      isPrepay:     row.is_prepay || false,
      isLogin:      row.is_login || false,
      isMultiplier: row.is_multiplier || false,
      multiplierId: row.multiplier_id || undefined,
      timestamp:    new Date(row.created_at).getTime(),
      managerId:    row.manager_id,
    }));
  }

  // =========================================================================
  // SUBSCRIBE — Fireteam (current campaign, skip own bookings)
  // =========================================================================

  public subscribeToTeamFeed(
    campaignId: string,
    managerId: string,
    callback: TeamFeedCallback
  ): () => void {
    if (this.fireteamChannel) {
      supabase.removeChannel(this.fireteamChannel);
      this.fireteamChannel = null;
    }

    this.currentCampaignId = campaignId;
    this.currentManagerId = managerId;

    this.fireteamChannel = supabase
      .channel(`team_feed_${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'dialer_team_events',
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (row.manager_id === managerId) return;
          if (!row.is_booking) return;

          callback({
            id:          row.id,
            name:        row.manager_name,
            points:      row.points,
            badges:      row.badges || [],
            multipliers: row.multipliers || [],
            isPrepay:    row.is_prepay || false,
            timestamp:   new Date(row.created_at).getTime(),
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log(`[TeamFeed] Subscribed to campaign ${campaignId}`);
        else if (status === 'CHANNEL_ERROR') console.error(`[TeamFeed] Channel error for campaign ${campaignId}`);
      });

    return () => {
      if (this.fireteamChannel) {
        supabase.removeChannel(this.fireteamChannel);
        this.fireteamChannel = null;
      }
    };
  }

  // =========================================================================
  // SUBSCRIBE — Global (all campaigns, include own, include login + multiplier)
  // =========================================================================

  public subscribeToGlobalFeed(
    managerId: string,
    callback: TeamFeedCallback
  ): () => void {
    if (this.globalChannel) {
      supabase.removeChannel(this.globalChannel);
      this.globalChannel = null;
    }

    this.globalChannel = supabase
      .channel('global_feed_all_campaigns')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dialer_team_events' },
        (payload) => {
          const row = payload.new as any;
          if (!row.is_booking && !row.is_login && !row.is_multiplier) return;

          callback({
            id:           row.id,
            name:         row.manager_name,
            points:       row.points,
            badges:       row.badges || [],
            multipliers:  row.multipliers || [],
            isPrepay:     row.is_prepay || false,
            isLogin:      row.is_login || false,
            isMultiplier: row.is_multiplier || false,
            multiplierId: row.multiplier_id || undefined,
            timestamp:    new Date(row.created_at).getTime(),
            managerId:    row.manager_id,
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('[GlobalFeed] Subscribed to all campaigns');
        else if (status === 'CHANNEL_ERROR') console.error('[GlobalFeed] Channel error');
      });

    return () => {
      if (this.globalChannel) {
        supabase.removeChannel(this.globalChannel);
        this.globalChannel = null;
      }
    };
  }

  // =========================================================================
  // FETCH FIRETEAM STATS
  // =========================================================================

  public async fetchFireteamStats(campaignId: string): Promise<MemberStats[]> {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('dialer_team_events')
      .select('manager_id, manager_name, points, pp_dollars, badges, is_prepay, is_booking, is_dial')
      .eq('campaign_id', campaignId)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (error) { console.error('Failed to fetch fireteam stats:', error.message); return []; }
    return aggregateStats(data || []);
  }

  // =========================================================================
  // FETCH GLOBAL STATS
  // =========================================================================

  public async fetchGlobalStats(): Promise<MemberStats[]> {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('dialer_team_events')
      .select('manager_id, manager_name, points, pp_dollars, badges, is_prepay, is_booking, is_dial')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (error) { console.error('Failed to fetch global stats:', error.message); return []; }
    return aggregateStats(data || []);
  }

  // =========================================================================
  // FETCH FIRETEAM STATS FROM SESSIONS
  // =========================================================================

  public async fetchFireteamStatsFromSessions(campaignId: string): Promise<MemberStats[]> {
    const today = getTodayEST();
    const { data, error } = await supabase
      .from('dialer_sessions')
      .select(`manager_id, gamification_state, campaign_managers (name, rep_code)`)
      .eq('campaign_id', campaignId)
      .eq('session_date', today);

    if (error) { console.error('Failed to fetch fireteam session stats:', error.message); return []; }

    return (data || [])
      .map(row => sessionRowToMemberStats(row))
      .filter(Boolean)
      .sort((a, b) => b!.points - a!.points) as MemberStats[];
  }

  // =========================================================================
  // FETCH GLOBAL STATS FROM SESSIONS
  // =========================================================================

  public async fetchGlobalStatsFromSessions(): Promise<MemberStats[]> {
    const today = getTodayEST();
    const { data, error } = await supabase
      .from('dialer_sessions')
      .select(`manager_id, gamification_state, campaign_managers (name, rep_code)`)
      .eq('session_date', today);

    if (error) { console.error('Failed to fetch global session stats:', error.message); return []; }

    const map = new Map<string, MemberStats>();
    for (const row of (data || [])) {
      const parsed = sessionRowToMemberStats(row);
      if (!parsed) continue;
      if (!map.has(parsed.managerId)) {
        map.set(parsed.managerId, { ...parsed });
      } else {
        const existing = map.get(parsed.managerId)!;
        existing.points        += parsed.points;
        existing.totalBookings += parsed.totalBookings;
        existing.pbs           += parsed.pbs;
        existing.pps           += parsed.pps;
        existing.ppDollars     += parsed.ppDollars;
        existing.totalDials    += parsed.totalDials;
        existing.badges        = [...existing.badges, ...parsed.badges];
      }
    }
    return Array.from(map.values()).sort((a, b) => b.points - a.points);
  }

  // =========================================================================
  // CLEANUP ALL
  // =========================================================================

  public unsubscribeAll(): void {
    if (this.fireteamChannel) { supabase.removeChannel(this.fireteamChannel); this.fireteamChannel = null; }
    if (this.globalChannel)   { supabase.removeChannel(this.globalChannel);   this.globalChannel = null; }
    if (this.presenceChannel) { supabase.removeChannel(this.presenceChannel); this.presenceChannel = null; }
    this.currentCampaignId = null;
    this.currentManagerId = null;
  }

  /** @deprecated use unsubscribeAll */
  public unsubscribe(): void { this.unsubscribeAll(); }
}

// =============================================================================
// AGGREGATION HELPER
// =============================================================================

function aggregateStats(rows: any[]): MemberStats[] {
  const map = new Map<string, MemberStats>();
  for (const row of rows) {
    const id = row.manager_id as string;
    if (!map.has(id)) {
      map.set(id, { managerId: id, managerName: row.manager_name, points: 0, totalBookings: 0, pbs: 0, pps: 0, ppDollars: 0, totalDials: 0, badges: [] });
    }
    const s = map.get(id)!;
    if (row.is_dial)    s.totalDials++;
    if (row.is_booking) {
      s.totalBookings++;
      s.points    += row.points     ?? 0;
      s.ppDollars += row.pp_dollars ?? 0;
      if (row.is_prepay) s.pps++;
      else               s.pbs++;
      if (Array.isArray(row.badges)) s.badges.push(...row.badges);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.points - a.points);
}

// =============================================================================
// SESSION ROW → MemberStats
// =============================================================================

function sessionRowToMemberStats(row: any): MemberStats | null {
  const id = row.manager_id as string;
  if (!id) return null;
  const cm = row.campaign_managers;
  const managerName: string = cm?.name || cm?.rep_code || 'Unknown';
  const state = row.gamification_state as Record<string, any> | null;

  if (!state || Object.keys(state).length === 0) {
    return { managerId: id, managerName, points: 0, totalBookings: 0, pbs: 0, pps: 0, ppDollars: 0, totalDials: 0, badges: [] };
  }

  const badges: string[] = Array.isArray(state.badges)
    ? state.badges.map((b: any) => (typeof b === 'string' ? b : b?.id)).filter(Boolean)
    : [];

  return {
    managerId:     id,
    managerName,
    points:        typeof state.totalSessionPoints === 'number' ? state.totalSessionPoints : 0,
    totalBookings: typeof state.totalBookings      === 'number' ? state.totalBookings      : 0,
    pbs:           typeof state.pbs                === 'number' ? state.pbs                : 0,
    pps:           typeof state.pps                === 'number' ? state.pps                : 0,
    ppDollars:     typeof state.ppDollars          === 'number' ? state.ppDollars          : 0,
    totalDials:    typeof state.totalDials         === 'number' ? state.totalDials         : 0,
    badges,
  };
}

export const dialerRealtimeService = DialerRealtimeService.getInstance();
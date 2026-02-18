// src/lib/dialerRealtimeService.ts
//
// Handles Supabase Realtime for the dialer team feed.
// - publishBookingEvent(): INSERTs a booking row (YES/PREPAY)
// - publishDialEvent():    INSERTs a dial-tick row (every disposition)
// - subscribeToTeamFeed(): listens for INSERTs from the current campaign only
// - subscribeToGlobalFeed(): listens for INSERTs across ALL campaigns
// - fetchTodayEvents():    fetches today's booking events (campaignId optional)
// - fetchFireteamStats():  aggregates per-member stats for one campaign, today
// - fetchGlobalStats():    aggregates per-member stats across all campaigns, today
//

import { supabase } from './supabase';
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

type TeamFeedCallback = (event: TeamBookingEvent) => void;

// =============================================================================
// MEMBER STATS (aggregated from dialer_team_events)
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

  // Campaign-scoped channel (Fireteam)
  private fireteamChannel: RealtimeChannel | null = null;
  // Global channel (all campaigns)
  private globalChannel: RealtimeChannel | null = null;

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
  // PUBLISH BOOKING — call after YES/PREPAY disposition
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

      if (error) {
        console.error('Failed to publish booking event:', error.message);
      }
    } catch (err) {
      console.error('Booking event publish error:', err);
    }
  }

  // =========================================================================
  // PUBLISH DIAL TICK — call on every disposition
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

      if (error) {
        console.error('Failed to publish dial event:', error.message);
      }
    } catch (err) {
      console.error('Dial event publish error:', err);
    }
  }

  // =========================================================================
  // FETCH TODAY'S BOOKING EVENTS
  // campaignId = undefined → global (all campaigns)
  // campaignId = string    → fireteam (single campaign)
  // =========================================================================

  public async fetchTodayEvents(campaignId?: string): Promise<TeamBookingEvent[]> {
    const today = new Date().toISOString().split('T')[0];

    let query = supabase
      .from('dialer_team_events')
      .select('id, manager_id, manager_name, points, pp_dollars, badges, multipliers, is_prepay, created_at')
      .eq('is_booking', true)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`)
      .order('created_at', { ascending: true });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch today events:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      id:          row.id,
      name:        row.manager_name,
      points:      row.points,
      badges:      row.badges || [],
      multipliers: row.multipliers || [],
      isPrepay:    row.is_prepay || false,
      timestamp:   new Date(row.created_at).getTime(),
      managerId:   row.manager_id,
    }));
  }

  // =========================================================================
  // SUBSCRIBE — Fireteam (current campaign only, skip own)
  // =========================================================================

  public subscribeToTeamFeed(
    campaignId: string,
    managerId: string,
    callback: TeamFeedCallback
  ): () => void {
    // Tear down existing fireteam channel if campaign changed
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
          if (row.manager_id === managerId) return; // skip own
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
        if (status === 'SUBSCRIBED') {
          console.log(`[TeamFeed] Subscribed to campaign ${campaignId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`[TeamFeed] Channel error for campaign ${campaignId}`);
        }
      });

    return () => {
      if (this.fireteamChannel) {
        supabase.removeChannel(this.fireteamChannel);
        this.fireteamChannel = null;
      }
    };
  }

  // =========================================================================
  // SUBSCRIBE — Global (all campaigns, include own labeled as managerId)
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
        {
          event: 'INSERT',
          schema: 'public',
          table: 'dialer_team_events',
        },
        (payload) => {
          const row = payload.new as any;
          if (!row.is_booking) return;

          // Own events come through as-is — caller will rename to "You"
          callback({
            id:          row.id,
            name:        row.manager_name,
            points:      row.points,
            badges:      row.badges || [],
            multipliers: row.multipliers || [],
            isPrepay:    row.is_prepay || false,
            timestamp:   new Date(row.created_at).getTime(),
            managerId:   row.manager_id,
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[GlobalFeed] Subscribed to all campaigns');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[GlobalFeed] Channel error');
        }
      });

    return () => {
      if (this.globalChannel) {
        supabase.removeChannel(this.globalChannel);
        this.globalChannel = null;
      }
    };
  }

  // =========================================================================
  // FETCH FIRETEAM STATS — aggregated for one campaign, today
  // =========================================================================

  public async fetchFireteamStats(campaignId: string): Promise<MemberStats[]> {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('dialer_team_events')
      .select('manager_id, manager_name, points, pp_dollars, badges, is_prepay, is_booking, is_dial')
      .eq('campaign_id', campaignId)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (error) {
      console.error('Failed to fetch fireteam stats:', error.message);
      return [];
    }

    return aggregateStats(data || []);
  }

  // =========================================================================
  // FETCH GLOBAL STATS — aggregated across all campaigns, today
  // =========================================================================

  public async fetchGlobalStats(): Promise<MemberStats[]> {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('dialer_team_events')
      .select('manager_id, manager_name, points, pp_dollars, badges, is_prepay, is_booking, is_dial')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (error) {
      console.error('Failed to fetch global stats:', error.message);
      return [];
    }

    return aggregateStats(data || []);
  }

  // =========================================================================
  // CLEANUP ALL
  // =========================================================================

  public unsubscribeAll(): void {
    if (this.fireteamChannel) {
      supabase.removeChannel(this.fireteamChannel);
      this.fireteamChannel = null;
    }
    if (this.globalChannel) {
      supabase.removeChannel(this.globalChannel);
      this.globalChannel = null;
    }
    this.currentCampaignId = null;
    this.currentManagerId = null;
  }

  /** @deprecated use unsubscribeAll */
  public unsubscribe(): void {
    this.unsubscribeAll();
  }
}

// =============================================================================
// AGGREGATION HELPER
// =============================================================================

function aggregateStats(rows: any[]): MemberStats[] {
  const map = new Map<string, MemberStats>();

  for (const row of rows) {
    const id = row.manager_id as string;
    if (!map.has(id)) {
      map.set(id, {
        managerId:     id,
        managerName:   row.manager_name,
        points:        0,
        totalBookings: 0,
        pbs:           0,
        pps:           0,
        ppDollars:     0,
        totalDials:    0,
        badges:        [],
      });
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

export const dialerRealtimeService = DialerRealtimeService.getInstance();
// src/lib/dialerRealtimeService.ts
//
// Handles Supabase Realtime for the dialer team feed.
// - publishBookingEvent(): INSERTs a row when the current manager books
// - subscribeToTeamFeed(): listens for INSERTs from other managers in the same campaign
//

import { supabase } from './supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TeamBookingEvent } from '../pages/Dialer/DialerHUD';

// =============================================================================
// TYPES
// =============================================================================

interface PublishPayload {
  campaignId: string;
  managerId: string;
  managerName: string;
  points: number;
  badges?: string[];
  multipliers?: string[];
  isPrepay?: boolean;
}

type TeamFeedCallback = (event: TeamBookingEvent) => void;

// =============================================================================
// SERVICE
// =============================================================================

class DialerRealtimeService {
  private static instance: DialerRealtimeService;
  private channel: RealtimeChannel | null = null;
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
  // PUBLISH — call this after a successful YES/PREPAY disposition
  // =========================================================================

  /**
   * Insert a booking event into dialer_team_events so other managers
   * on the same campaign see it in their team feed.
   */
  public async publishBookingEvent(payload: PublishPayload): Promise<void> {
    try {
      const { error } = await supabase
        .from('dialer_team_events')
        .insert({
          campaign_id: payload.campaignId,
          manager_id: payload.managerId,
          manager_name: payload.managerName,
          points: payload.points,
          badges: payload.badges || [],
          multipliers: payload.multipliers || [],
          is_prepay: payload.isPrepay || false,
        });

      if (error) {
        console.error('Failed to publish team event:', error.message);
      }
    } catch (err) {
      // Non-critical — don't break the dialer flow if this fails
      console.error('Team event publish error:', err);
    }
  }

  // =========================================================================
  // SUBSCRIBE — call this on dialer mount to receive other managers' events
  // =========================================================================

  /**
   * Subscribe to INSERT events on dialer_team_events for a given campaign.
   * Filters out events from the current manager (you don't need to see your own).
   * Returns an unsubscribe function.
   */
  public subscribeToTeamFeed(
    campaignId: string,
    managerId: string,
    callback: TeamFeedCallback
  ): () => void {
    // Clean up any existing subscription
    this.unsubscribe();

    this.currentCampaignId = campaignId;
    this.currentManagerId = managerId;

    const channelName = `team_feed_${campaignId}`;

    this.channel = supabase
      .channel(channelName)
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

          // Skip own events
          if (row.manager_id === managerId) return;

          // Map DB row → TeamBookingEvent
          const event: TeamBookingEvent = {
            id: row.id,
            name: row.manager_name,
            points: row.points,
            badges: row.badges || [],
            multipliers: row.multipliers || [],
            isPrepay: row.is_prepay || false,
            timestamp: new Date(row.created_at).getTime(),
          };

          callback(event);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[TeamFeed] Subscribed to campaign ${campaignId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`[TeamFeed] Channel error for campaign ${campaignId}`);
        }
      });

    // Return unsubscribe function
    return () => this.unsubscribe();
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  /**
   * Unsubscribe from the current team feed channel.
   */
  public unsubscribe(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.currentCampaignId = null;
      this.currentManagerId = null;
    }
  }
}

export const dialerRealtimeService = DialerRealtimeService.getInstance();
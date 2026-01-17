// src/lib/realtimeService.ts
import { supabase } from './supabase';
import { commandCenterService } from './commandCenterService';
import { RealtimeChannel } from '@supabase/supabase-js';

type SubscriptionCallback = (payload: any) => void;

class RealtimeService {
  private static instance: RealtimeService;
  private channels: Map<string, RealtimeChannel> = new Map();
  private callbacks: Map<string, Set<SubscriptionCallback>> = new Map();

  private constructor() {}

  public static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  /**
   * Get the current command center ID for filtering
   */
  private getCCId(): string | null {
    return commandCenterService.getCurrentCommandCenterId();
  }

  /**
   * Subscribe to transaction changes for the current command center
   */
  public subscribeToTransactions(callback: SubscriptionCallback): () => void {
    const ccId = this.getCCId();
    if (!ccId) {
      console.warn('No command center context for realtime subscription');
      return () => {};
    }

    const channelName = `transactions_${ccId}`;
    
    if (!this.channels.has(channelName)) {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'transactions',
            filter: `command_center_id=eq.${ccId}`,
          },
          (payload) => {
            this.notifyCallbacks(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
      this.callbacks.set(channelName, new Set());
    }

    this.callbacks.get(channelName)!.add(callback);

    // Return unsubscribe function
    return () => {
      const cbs = this.callbacks.get(channelName);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      }
    };
  }

  /**
   * Subscribe to booking changes for the current command center
   */
  public subscribeToBookings(callback: SubscriptionCallback): () => void {
    const ccId = this.getCCId();
    if (!ccId) {
      console.warn('No command center context for realtime subscription');
      return () => {};
    }

    const channelName = `bookings_${ccId}`;
    
    if (!this.channels.has(channelName)) {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bookings',
            filter: `command_center_id=eq.${ccId}`,
          },
          (payload) => {
            this.notifyCallbacks(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
      this.callbacks.set(channelName, new Set());
    }

    this.callbacks.get(channelName)!.add(callback);

    return () => {
      const cbs = this.callbacks.get(channelName);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      }
    };
  }

  /**
   * Subscribe to logsheet session changes for the current command center
   */
  public subscribeToLogsheetSessions(callback: SubscriptionCallback): () => void {
    const ccId = this.getCCId();
    if (!ccId) {
      console.warn('No command center context for realtime subscription');
      return () => {};
    }

    const channelName = `logsheet_sessions_${ccId}`;
    
    if (!this.channels.has(channelName)) {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'logsheet_sessions',
            filter: `command_center_id=eq.${ccId}`,
          },
          (payload) => {
            this.notifyCallbacks(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
      this.callbacks.set(channelName, new Set());
    }

    this.callbacks.get(channelName)!.add(callback);

    return () => {
      const cbs = this.callbacks.get(channelName);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      }
    };
  }

  /**
   * Subscribe to route changes for the current command center
   */
  public subscribeToRoutes(callback: SubscriptionCallback): () => void {
    const ccId = this.getCCId();
    if (!ccId) {
      console.warn('No command center context for realtime subscription');
      return () => {};
    }

    const channelName = `routes_${ccId}`;
    
    if (!this.channels.has(channelName)) {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'routes',
            filter: `command_center_id=eq.${ccId}`,
          },
          (payload) => {
            this.notifyCallbacks(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
      this.callbacks.set(channelName, new Set());
    }

    this.callbacks.get(channelName)!.add(callback);

    return () => {
      const cbs = this.callbacks.get(channelName);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      }
    };
  }

  /**
   * Subscribe to user changes for the current command center
   */
  public subscribeToUsers(callback: SubscriptionCallback): () => void {
    const ccId = this.getCCId();
    if (!ccId) {
      console.warn('No command center context for realtime subscription');
      return () => {};
    }

    const channelName = `users_${ccId}`;
    
    if (!this.channels.has(channelName)) {
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'users',
            filter: `command_center_id=eq.${ccId}`,
          },
          (payload) => {
            this.notifyCallbacks(channelName, payload);
          }
        )
        .subscribe();

      this.channels.set(channelName, channel);
      this.callbacks.set(channelName, new Set());
    }

    this.callbacks.get(channelName)!.add(callback);

    return () => {
      const cbs = this.callbacks.get(channelName);
      if (cbs) {
        cbs.delete(callback);
        if (cbs.size === 0) {
          this.unsubscribeChannel(channelName);
        }
      }
    };
  }

  /**
   * Notify all callbacks for a channel
   */
  private notifyCallbacks(channelName: string, payload: any): void {
    const cbs = this.callbacks.get(channelName);
    if (cbs) {
      cbs.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error('Realtime callback error:', err);
        }
      });
    }
  }

  /**
   * Unsubscribe from a specific channel
   */
  private unsubscribeChannel(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
      this.callbacks.delete(channelName);
    }
  }

  /**
   * Unsubscribe from all channels (e.g., on logout)
   */
  public unsubscribeAll(): void {
    this.channels.forEach((channel, name) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
    this.callbacks.clear();
  }
}

export const realtimeService = RealtimeService.getInstance();
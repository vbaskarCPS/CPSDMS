// src/lib/realtimeService.ts
import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

type ChangeHandler = (payload: any) => void;

interface SubscriptionConfig {
  table: string;
  filter?: string;  // e.g., "worker_id=eq.123"
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}

class RealtimeService {
  private static instance: RealtimeService;
  private channels: Map<string, RealtimeChannel> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Debounce delay in ms
  private DEBOUNCE_MS = 500;

  private constructor() {}

  public static getInstance(): RealtimeService {
    if (!RealtimeService.instance) {
      RealtimeService.instance = new RealtimeService();
    }
    return RealtimeService.instance;
  }

  /**
   * Subscribe to changes with filtering and debouncing
   */
  public subscribe(
    channelName: string,
    configs: SubscriptionConfig[],
    onChangeDebounced: ChangeHandler,
    options?: { debounceMs?: number; immediate?: boolean }
  ): () => void {
    const debounceMs = options?.debounceMs ?? this.DEBOUNCE_MS;
    const immediate = options?.immediate ?? false;

    // Clean up existing channel with same name
    this.unsubscribe(channelName);

    const channel = supabase.channel(channelName);

    // Debounced handler
    const handleChange = (payload: any) => {
      // Clear existing timer
      const existingTimer = this.debounceTimers.get(channelName);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      if (immediate) {
        // Fire immediately, then debounce subsequent calls
        onChangeDebounced(payload);
        this.debounceTimers.set(
          channelName,
          setTimeout(() => {}, debounceMs)
        );
      } else {
        // Standard debounce - wait for quiet period
        this.debounceTimers.set(
          channelName,
          setTimeout(() => {
            onChangeDebounced(payload);
          }, debounceMs)
        );
      }
    };

    // Add subscriptions for each config
    configs.forEach((config) => {
      const subscriptionConfig: any = {
        event: config.event || '*',
        schema: 'public',
        table: config.table,
      };

      // Add row-level filter if provided
      if (config.filter) {
        subscriptionConfig.filter = config.filter;
      }

      channel.on('postgres_changes', subscriptionConfig, handleChange);
    });

    // Subscribe and store reference
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`✅ Realtime [${channelName}]: Connected`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`❌ Realtime [${channelName}]: Error`);
      }
    });

    this.channels.set(channelName, channel);

    // Return cleanup function
    return () => this.unsubscribe(channelName);
  }

  /**
   * Unsubscribe from a channel
   */
  public unsubscribe(channelName: string): void {
    const channel = this.channels.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.channels.delete(channelName);
      console.log(`🔌 Realtime [${channelName}]: Disconnected`);
    }

    const timer = this.debounceTimers.get(channelName);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(channelName);
    }
  }

  /**
   * Unsubscribe from all channels
   */
  public unsubscribeAll(): void {
    this.channels.forEach((_, name) => this.unsubscribe(name));
  }

  /**
   * Get active subscription count (for debugging)
   */
  public getActiveCount(): number {
    return this.channels.size;
  }
}

export const realtimeService = RealtimeService.getInstance();


// ============================================
// PRE-BUILT SUBSCRIPTION HELPERS
// ============================================

/**
 * Subscribe to contractor-specific changes
 * Only receives updates for this contractor's data
 * Includes users table for upsell toggle updates
 */
export function subscribeAsContractor(
  contractorId: string,
  onUpdate: () => void
): () => void {
  return realtimeService.subscribe(
    `contractor-${contractorId}`,
    [
      // All bookings - need to catch new assignments where contractor_id changes TO this worker
      { 
        table: 'bookings'
      },
      // Only MY transactions
      { 
        table: 'transactions', 
        filter: `worker_id=eq.${contractorId}` 
      },
      // My session updates
      { 
        table: 'logsheet_sessions', 
        filter: `worker_id=eq.${contractorId}` 
      },
      // My user updates (for upsell toggle)
      {
        table: 'users',
        filter: `user_id=eq.${contractorId}`
      },
      // Route changes (for new route assignments)
      {
        table: 'routes'
      },
    ],
    onUpdate,
    { debounceMs: 300 }
  );
}

/**
 * Subscribe to route manager's team changes
 * Receives updates for all workers under this manager
 */
export function subscribeAsRouteManager(
  managerId: string,
  workerIds: string[],
  onUpdate: () => void
): () => void {
  // Build OR filter for all worker IDs
  // Note: Supabase filters don't support OR directly, so we use a different approach
  
  const configs: SubscriptionConfig[] = [
    // Routes assigned to this manager
    { 
      table: 'routes', 
      filter: `manager_id=eq.${managerId}` 
    },
  ];

  // For bookings and transactions, we'll listen to all but filter client-side
  // This is a trade-off: fewer subscriptions vs. more messages
  // For 5-20 workers, this is acceptable
  if (workerIds.length > 0) {
    configs.push(
      { table: 'bookings' },      // Will filter in handler
      { table: 'transactions' },  // Will filter in handler
      { table: 'logsheet_sessions' },
      { table: 'users' }          // For upsell toggle updates
    );
  }

  return realtimeService.subscribe(
    `rm-${managerId}`,
    configs,
    (payload) => {
      // Client-side filter: only trigger update if relevant to our team
      const workerId = payload.new?.worker_id || payload.new?.contractor_id || payload.new?.user_id;
      
      if (workerId && !workerIds.includes(workerId)) {
        // Change is for a worker not on our team - ignore
        return;
      }
      
      onUpdate();
    },
    { debounceMs: 500 }
  );
}

/**
 * Subscribe to admin-level changes (all data)
 * Use sparingly - this is heavy
 */
export function subscribeAsAdmin(onUpdate: () => void): () => void {
  return realtimeService.subscribe(
    'admin-global',
    [
      { table: 'logsheet_sessions' },
      { table: 'transactions' },
    ],
    onUpdate,
    { debounceMs: 1000 }  // Longer debounce for admin
  );
}
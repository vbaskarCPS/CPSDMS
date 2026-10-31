// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { trackedFetch } from './offline/net';
import { supabaseAnonKey, supabaseUrl } from './supabaseConfig';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  // every request tells the app whether the server is reachable (dead zones → the phone's copy)
  global: { fetch: trackedFetch() },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
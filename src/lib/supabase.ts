// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { trackedFetch } from './offline/net';

const supabaseUrl = 'https://mipvcafqrmwxnoqmicxh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pcHZjYWZxcm13eG5vcW1pY3hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NDk5OTQsImV4cCI6MjA4MTMyNTk5NH0.EWr6S_W0FZzbAv8TI1KwqE3pTedryaVBjIOv6tVkOBg';

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
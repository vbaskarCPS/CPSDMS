// src/v2/lib/client.ts
//
// Supabase client for the new app. Unlike the legacy client (src/lib/supabase.ts)
// it keeps a real Supabase Auth session, so row-level security sees who is signed in.
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY point it at a staging branch when set.
import { createClient } from '@supabase/supabase-js';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env || {};
const url = env.VITE_SUPABASE_URL || 'https://mipvcafqrmwxnoqmicxh.supabase.co';
const anonKey = env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pcHZjYWZxcm13eG5vcW1pY3hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3NDk5OTQsImV4cCI6MjA4MTMyNTk5NH0.EWr6S_W0FZzbAv8TI1KwqE3pTedryaVBjIOv6tVkOBg';

export const db = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cpsdms-v2-auth' },
});

/** Managers sign in with a 5-letter username; Supabase Auth needs an email-shaped login. */
export const loginAddress = (username: string) => `${username.trim().toLowerCase()}@login.cpsdms.app`;

/** Throws the Supabase error so callers can show it. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// src/v2/lib/client.ts
//
// Supabase client for the new app. Unlike the legacy client (src/lib/supabase.ts)
// it keeps a real Supabase Auth session, so row-level security sees who is signed in.
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY point it at a staging branch when set.
import { createClient } from '@supabase/supabase-js';
import { trackedFetch } from '../../lib/offline/net';

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env || {};
// TEMPORARY (Nov 2026): the hosting's VITE_SUPABASE_* still name the paused main project, so they're ignored here
// while the app runs on cps-temp-bc. Revert with the switch.
void env;
const url = 'https://gfvdbxuzaqagvephzwup.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmdmRieHV6YXFhZ3ZlcGh6d3VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxODcxNTEsImV4cCI6MjEwOTc2MzE1MX0.l4MMsyCfTx6Z6zrJtsQ4LernJTcKF7ZQn9L-oGc2da8';

export const db = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cpsdms-v2-auth' },
  global: { fetch: trackedFetch() },   // dead zones → the phone's copy (src/lib/offline)
});

/** Managers sign in with a 5-letter username; Supabase Auth needs an email-shaped login. */
export const loginAddress = (username: string) => `${username.trim().toLowerCase()}@login.cpsdms.app`;

/** Throws the Supabase error so callers can show it. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

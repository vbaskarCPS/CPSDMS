// src/lib/naCooldownService.ts
//
// Cooldown System — prevents reps from re-dialing clients who were recently
// reached by any disposition (NA, CTS, WN/NIS, NO, REMOVE, YES, PREPAY).
// Logs are stored in Supabase and checked on every group load.
//
// Cooldown rules (configurable in SniperSettings, per campaign):
//   - Team cooldown: skip if ANY rep disposed this phone within X days (default 2)
//   - Self cooldown: skip if THIS rep disposed this phone within X days (default 4)
//   - Max configurable period: 7 days (log retention matches this)
//

import { supabase } from './supabase';
import { normalizePhone } from './dialer/dialerUtils';

// =============================================================================
// TYPES
// =============================================================================

export interface NACooldownEntry {
  phone: string;       // normalized 10-digit phone
  repId: string;       // manager UUID who fired the disposition
  createdAt: string;   // ISO timestamp
}

export interface NACooldownList {
  entries: NACooldownEntry[];
  fetchedAt: number;   // Date.now() at fetch time
}

// =============================================================================
// LOG A DISPOSITION
// =============================================================================

/**
 * Writes one row to na_cooldown_log when a rep fires any disposition.
 * Fire-and-forget safe — errors are swallowed so a Supabase hiccup never
 * interrupts the dialer.
 *
 * @param phone      Raw phone string from the dialer state (will be normalized)
 * @param campaignId Campaign UUID
 * @param repId      Manager UUID of the rep firing the disposition
 */
export async function logDisposition(
  phone: string,
  campaignId: string,
  repId: string
): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized || !campaignId || !repId) return;

  try {
    await supabase.from('na_cooldown_log').insert({
      phone: normalized,
      campaign_id: campaignId,
      rep_id: repId,
    });
  } catch {
    // Silent fail — non-critical
  }
}

// =============================================================================
// FETCH COOLDOWN LIST
// =============================================================================

/**
 * Fetches all disposition log entries for this campaign from the last 7 days.
 * Called on deploy and refreshed every 30 seconds while dialing so
 * multi-rep sessions stay in sync.
 *
 * @param campaignId Campaign UUID
 */
export async function fetchCooldownList(campaignId: string): Promise<NACooldownList> {
  if (!campaignId) return { entries: [], fetchedAt: Date.now() };

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('na_cooldown_log')
      .select('phone, rep_id, created_at')
      .eq('campaign_id', campaignId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (error || !data) return { entries: [], fetchedAt: Date.now() };

    const entries: NACooldownEntry[] = data.map((row: any) => ({
      phone: row.phone,
      repId: row.rep_id,
      createdAt: row.created_at,
    }));

    return { entries, fetchedAt: Date.now() };
  } catch {
    return { entries: [], fetchedAt: Date.now() };
  }
}

// =============================================================================
// COOLDOWN CHECK
// =============================================================================

/**
 * Returns true if the given phone should be skipped based on cooldown rules.
 *
 * @param phone             Raw or normalized phone to check
 * @param repId             UUID of the current rep (for self-cooldown check)
 * @param cooldownList      The list fetched at the start of this group load
 * @param teamCooldownDays  Days for team-wide cooldown (0 = disabled)
 * @param selfCooldownDays  Days for self cooldown (0 = disabled)
 */
export function isOnCooldown(
  phone: string,
  repId: string,
  cooldownList: NACooldownList,
  teamCooldownDays: number,
  selfCooldownDays: number
): boolean {
  if (teamCooldownDays <= 0 && selfCooldownDays <= 0) return false;
  if (cooldownList.entries.length === 0) return false;

  const normalized = normalizePhone(phone);
  if (!normalized) return false;

  const now = Date.now();
  const teamCutoffMs = teamCooldownDays > 0 ? teamCooldownDays * 24 * 60 * 60 * 1000 : 0;
  const selfCutoffMs = selfCooldownDays > 0 ? selfCooldownDays * 24 * 60 * 60 * 1000 : 0;

  for (const entry of cooldownList.entries) {
    if (entry.phone !== normalized) continue;

    const ageMs = now - new Date(entry.createdAt).getTime();

    // Team cooldown: any rep disposed this phone recently
    if (teamCutoffMs > 0 && ageMs <= teamCutoffMs) return true;

    // Self cooldown: this rep specifically disposed this phone recently
    if (selfCutoffMs > 0 && entry.repId === repId && ageMs <= selfCutoffMs) return true;
  }

  return false;
}
// src/v2/lib/legacy.ts — run the old app's screens (payouts) inside the new app.
// The old services find "their" center through commandCenterService; point it at the
// center picked in the new app, then load the old app's live session for that center.
import type { DailySessionData } from '../../types';

export interface LegacySession { date: string; data: DailySessionData }

/** Points the old services at this center. Must run before any old screen loads. */
export async function pointLegacyAt(centerId: string): Promise<void> {
  const { commandCenterService } = await import('../../lib/commandCenterService');
  const cc = await commandCenterService.getCommandCenterById(centerId);
  if (!cc) throw new Error('Couldn’t load this center in the current app.');
  commandCenterService.setCurrentCommandCenter(cc);
}

/** The old app's live session at this center, or null when none is open. */
export async function legacyLiveSession(centerId: string): Promise<LegacySession | null> {
  await pointLegacyAt(centerId);
  const { sessionService } = await import('../../lib/sessionService');
  const data = await sessionService.getDailySession();
  return data ? { date: data.date, data } : null;
}

/** The old app's route managers on the live session at a center (users rows). */
export async function legacyRouteManagers(centerId: string): Promise<{ user_id: string; name: string }[]> {
  await pointLegacyAt(centerId);
  const { supabase } = await import('../../lib/supabase');
  const { data, error } = await supabase.from('users').select('user_id, name').eq('role', 'RouteManager').eq('command_center_id', centerId).order('name');
  if (error) throw new Error(error.message);
  return (data || []) as { user_id: string; name: string }[];
}

/**
 * Signs the old RM screens in as one of today's route managers, the same way the old login
 * did (current_user in local storage, with the manager's floater and digital-map settings).
 * Returns false when that manager isn't on the live session.
 */
export async function actAsLegacyRouteManager(centerId: string, userId: string): Promise<boolean> {
  await pointLegacyAt(centerId);
  const [{ supabase }, { USER_COLS }, { setStorageItem }] = await Promise.all([
    import('../../lib/supabase'), import('../../lib/legacyColumns'), import('../../lib/localStorage'),
  ]);
  const { data, error } = await supabase.from('users').select(USER_COLS)
    .eq('user_id', userId).eq('role', 'RouteManager').eq('command_center_id', centerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return false;
  const meta = (data.metadata || {}) as Record<string, unknown>;
  const mapping = meta.digitalMapping as unknown;
  setStorageItem('current_user', {
    userId: data.user_id, name: data.name, username: data.username, phone: (meta.phone as string) || '',
    role: 'RouteManager', commandCenterId: data.command_center_id,
    floatingFor: Array.isArray(meta.floatingFor) ? meta.floatingFor : [],
    digitalMapping: mapping || undefined,
    digitalMappings: Array.isArray(meta.digitalMappings) ? meta.digitalMappings : (mapping ? [mapping] : []),
  });
  return true;
}

// src/v2/lib/liveRoutes.ts — routes on today's live session, and adding more to a manager
// mid-session. Uses the old app's own live "apply mapping" step (sessionService.
// applyManagerMappingLive), so the RM map sees the new routes exactly as if they'd been picked
// at the start. Add-only: a route another manager already has can't be taken.
import { pointLegacyAt } from './legacy';
import { mappingsFor, openLegacySession, type PlanRoute } from './startSession';

export interface LiveManager { id: string; full_name: string }   // id = the old app's manager id (rm_…)
export interface LiveRoutes { date: string; managers: LiveManager[]; owner: Map<string, string> }   // route code → manager id

export async function liveRoutes(centerId: string): Promise<LiveRoutes | null> {
  await pointLegacyAt(centerId);
  const date = await openLegacySession(centerId);
  if (!date) return null;
  const { supabase } = await import('../../lib/supabase');
  const [routes, mgrs] = await Promise.all([
    supabase.from('routes').select('route_code, manager_id').eq('session_date', date).eq('command_center_id', centerId),
    supabase.from('users').select('user_id, name').eq('role', 'RouteManager').eq('command_center_id', centerId).order('name'),
  ]);
  if (routes.error) throw new Error(routes.error.message);
  if (mgrs.error) throw new Error(mgrs.error.message);
  return {
    date,
    managers: (mgrs.data || []).map(m => ({ id: m.user_id as string, full_name: (m.name as string) || (m.user_id as string) })),
    owner: new Map((routes.data || []).map(r => [r.route_code as string, r.manager_id as string])),
  };
}

/** Adds routes to a manager on the live session (one map per area). Returns how many were added. */
export async function addLiveRoutes(centerId: string, managerId: string, picked: PlanRoute[]): Promise<number> {
  if (!picked.length) return 0;
  await pointLegacyAt(centerId);
  const [{ sessionService }, { getApprovedRouteMapsByCodes, streetsFromSegments }] = await Promise.all([
    import('../../lib/sessionService'), import('../../lib/managerMappingService'),
  ]);
  let n = 0;
  for (const cfg of mappingsFor(picked.map(r => ({ ...r, managerId })))) {
    // street names for each route, as the old app writes them (missing streets don't stop the add)
    const streets = new Map<string, string[]>();
    try { for (const rm of await getApprovedRouteMapsByCodes(cfg.routeCodes)) streets.set(rm.routeCode, streetsFromSegments(rm.segments)); }
    catch (e) { console.warn('[liveRoutes] street names not loaded:', e); }
    await sessionService.applyManagerMappingLive(managerId, cfg, cfg.routeCodes.map(code => ({ routeCode: code, streets: streets.get(code) || [] })));
    n += cfg.routeCodes.length;
  }
  return n;
}

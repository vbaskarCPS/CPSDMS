// src/lib/mapShareTargets.ts — who a route manager can share their RM map with, and who has shared
// with them. Sharing is open to every manager of the center (their accounts), not just the ones who
// have workers or routes on today's session.
import type { ManagerMapSharing } from '../types';

/** A manager's id on the old RM screens: "rm_" + their name, letters and digits only (as Start Session makes it). */
export const managerIdFromName = (fullName: string) => `rm_${fullName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

export interface ShareTarget { id: string; name: string }

/**
 * Everyone I can share with: today's route managers plus every active manager account of the center,
 * once each, by name, never me.
 */
export function shareTargets(
  seats: { userId: string; name: string; role?: string }[],
  centerManagers: { full_name: string }[],
  me: string,
): ShareTarget[] {
  const byId = new Map<string, ShareTarget>();
  for (const s of seats) if (s.role === undefined || s.role === 'RouteManager') byId.set(s.userId, { id: s.userId, name: s.name || s.userId });
  for (const m of centerManagers) {
    const name = (m.full_name || '').trim();
    if (!name) continue;
    const id = managerIdFromName(name);
    if (!byId.has(id)) byId.set(id, { id, name });
  }
  byId.delete(me);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The managers on today's session who've shared with me: full access, and position only. */
export function sharedWithMe(
  seats: { userId: string; mapSharing?: Partial<ManagerMapSharing> | null }[],
  me: string,
): ManagerMapSharing {
  const access: string[] = []; const position: string[] = [];
  for (const s of seats) {
    if (s.userId === me) continue;
    const a = Array.isArray(s.mapSharing?.access) ? s.mapSharing!.access! : [];
    const p = Array.isArray(s.mapSharing?.position) ? s.mapSharing!.position! : [];
    if (a.includes(me)) access.push(s.userId);
    else if (p.includes(me)) position.push(s.userId);
  }
  return { access, position };
}

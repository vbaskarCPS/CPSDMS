// src/v2/lib/floater.ts — Floater Route Manager: every live session's route managers (any center),
// with what they have today, and opening the floater map for a chosen few.
import { db, must } from './client';

export interface FloaterManager {
  center_id: string; center_name: string; session_date: string; season_type: string;
  manager_id: string; manager_name: string; phone: string | null;
  routes: string[]; areas: string[]; workers: number; carts: number; steps: number; gross: number;
}

export async function floaterManagers(): Promise<FloaterManager[]> {
  const rows = must(await db.rpc('app_floater_managers')) as FloaterManager[];
  return rows.map(r => ({ ...r, routes: r.routes || [], areas: r.areas || [], steps: Number(r.steps) || 0, gross: Number(r.gross) || 0 }));
}

/** Route codes as short runs: GA01, GA02, GA03, BR07 → "GA01–03, BR07". */
export function routeRuns(codes: string[]): string {
  const parsed = [...new Set(codes)].map(c => { const m = /^(.*?)(\d+)$/.exec(c); return m ? { p: m[1], n: Number(m[2]), w: m[2].length, c } : { p: c, n: NaN, w: 0, c }; })
    .sort((a, b) => a.p.localeCompare(b.p) || a.n - b.n);
  const out: string[] = [];
  for (let i = 0; i < parsed.length;) {
    const a = parsed[i]; let j = i;
    while (!Number.isNaN(a.n) && j + 1 < parsed.length && parsed[j + 1].p === a.p && parsed[j + 1].n === parsed[j].n + 1) j++;
    const b = parsed[j];
    out.push(j > i ? `${a.c}–${String(b.n).padStart(b.w, '0')}` : a.c);
    i = j + 1;
  }
  return out.join(', ');
}

/** The id the floater view signs in as on the old map: never one of the day's real managers. */
export const floaterLegacyId = (username: string) => `floater_${username}`;

/**
 * Signs the old RM map in as a floater over these managers (the same way an office-set floater
 * works: current_user with floatingFor), at their center.
 */
export async function actAsLegacyFloater(centerId: string, viewer: { username: string; full_name: string }, managerIds: string[]): Promise<void> {
  const [{ pointLegacyAt }, { setStorageItem }] = await Promise.all([import('./legacy'), import('../../lib/localStorage')]);
  await pointLegacyAt(centerId);
  setStorageItem('current_user', {
    userId: floaterLegacyId(viewer.username), name: viewer.full_name, username: viewer.username, phone: '',
    role: 'RouteManager', commandCenterId: centerId, floatingFor: [...managerIds], digitalMappings: [],
  });
}

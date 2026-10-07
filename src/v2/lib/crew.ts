// src/v2/lib/crew.ts — center types (Road Trip / In City) and the road-trip Crew List.
// A worker's home center is the one behind their CN #; their current center is where they're
// working now. Moves go through app_crew_move (coming off a road trip → WDR at home).
import { db, must } from './client';

export type CenterType = 'in_city' | 'road_trip';
export const centerTypeLabel = (t: CenterType) => (t === 'road_trip' ? 'Road Trip' : 'In City');

export interface CrewRow {
  hire_id: string; cn: string; status: string; room: string | null; moved_at: string | null; shuttle: string | null;
  first_name: string; last_name: string; cell_phone: string | null;
  home_id: string; home: string; current_id: string | null; current: string | null;
}
export interface CrewList { type: CenterType; here: CrewRow[]; away: CrewRow[] }

/** The center's type; In City until the database knows about types. */
export async function getCenterType(centerId: string): Promise<CenterType> {
  const res = await db.from('command_centers').select('center_type').eq('id', centerId).maybeSingle();
  if (res.error || !res.data) return 'in_city';
  return ((res.data as { center_type?: string }).center_type === 'road_trip' ? 'road_trip' : 'in_city');
}
export async function setCenterType(centerId: string, type: CenterType): Promise<void> {
  must(await db.rpc('app_set_center_type', { p_center: centerId, p_type: type }));
}

export async function crewList(centerId: string): Promise<CrewList> {
  return must(await db.rpc('app_crew_list', { p_center: centerId })) as CrewList;
}
export async function crewSearch(centerId: string, q: string, scope: 'others' | 'home'): Promise<CrewRow[]> {
  if (q.trim().length < 2) return [];
  return must(await db.rpc('app_crew_search', { p_center: centerId, p_q: q, p_scope: scope })) as CrewRow[];
}
/** Move workers to a center (with an optional room), or home when toCenter is null. */
export async function crewMove(hireIds: string[], toCenter: string | null, room: string | null = null): Promise<number> {
  return must(await db.rpc('app_crew_move', { p_hire_ids: hireIds, p_to_center: toCenter, p_room: room })) as number;
}
export async function setRoom(hireId: string, room: string): Promise<void> {
  must(await db.rpc('app_crew_set_room', { p_hire: hireId, p_room: room }));
}
export async function roadTripCenters(): Promise<{ id: string; display_name: string }[]> {
  return must(await db.rpc('app_road_trip_centers')) as { id: string; display_name: string }[];
}

/**
 * A road trip's day runs off the crew, not bookings: a day that hasn't started gets everyone
 * active in the crew on its roster, and anyone no longer in the crew comes off it (unless
 * something was already recorded for them that day).
 */
export async function syncCrewDay(centerId: string, date: string): Promise<{ added: number; removed: number }> {
  const { getDay, listRoster, book, removeFromDay } = await import('./workerbook');
  const crew = (await crewList(centerId)).here.filter(r => r.status === 'active');
  const day = await getDay(centerId, date);
  if (day && day.state !== 'planned') return { added: 0, removed: 0 };
  const rows = day ? await listRoster(day.id) : [];
  const have = new Set(rows.map(r => r.hire_id));
  const want = new Set(crew.map(r => r.hire_id));
  const add = crew.filter(r => !have.has(r.hire_id)).map(r => r.hire_id);
  const added = add.length ? await book(centerId, date, add) : 0;
  const drop = rows.filter(r => !want.has(r.hire_id) && !r.attendance && !r.team && !r.next_action && !r.next_day);
  for (const r of drop) await removeFromDay(r.id);
  return { added, removed: drop.length };
}

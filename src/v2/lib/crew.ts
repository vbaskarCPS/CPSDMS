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

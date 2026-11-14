// src/v2/lib/bennyMs.ts — the Benny on MainstreetAI (for MainstreetAI admins): its two cards and what they save.
//   ms_assign → who has which zone: one move, a swap, or many ("all of Sam's zones to Priya"). Saved with the Zones
//               screen's own assign (ms_assign_rep), one zone and campaign at a time.
//   ms_zone   → retire a zone, or bring one back (the Zones screen's own ms_set_zone_status).
// The database checks every card first (benny_ms_check_assign / benny_ms_check_zone) and again right before the save.
import { db } from './client';
import { assignRep, setZoneStatus } from './mainstreet';

export interface MsMove { zone_id: string; zone: string; city?: string; campaign_id: string; campaign: string; from_id?: string; from?: string; to_id?: string; to?: string }
export interface MsAssignCheck { ok: boolean; problems?: string[]; moves: MsMove[]; stamp: string; ask: { zone: string; campaign_id: string; rep: string }[] }
export interface MsZoneCheck {
  ok: boolean; problems?: string[]; zone: { id: string; name: string; city?: string }; from: 'active' | 'retired'; to: 'active' | 'retired';
  /** who is on it now, e.g. "Sina Kazeroonizand (Taxifi)" */
  reps?: string; businesses?: number; stamp: string;
}

const first = (n?: string) => (n || '').split(' ')[0];
const NOBODY = 'no rep';
/** One move in words: "Hamilton South 3 (2): Sina Kazeroonizand → Newton Onaiwu" (the campaign only when the card has more than one). */
export function moveSaid(m: MsMove, withCampaign: boolean): string {
  return `${m.zone}${withCampaign ? ` · ${m.campaign}` : ''}: ${m.from || NOBODY} → ${m.to || NOBODY}`;
}
/** What each rep ends up with from this card: "Newton +1 −1, Sina +1 −1". */
export function repChanges(moves: MsMove[]): string {
  const by = new Map<string, { name: string; up: number; down: number }>();
  const at = (id: string, name: string) => { const r = by.get(id) || { name, up: 0, down: 0 }; by.set(id, r); return r; };
  for (const m of moves) { if (m.to_id) at(m.to_id, m.to || '').up++; if (m.from_id) at(m.from_id, m.from || '').down++; }
  return [...by.values()].map(r => `${first(r.name)} ${[r.up ? `+${r.up}` : '', r.down ? `−${r.down}` : ''].filter(Boolean).join(' ')}`).join(', ');
}

export function msAssignCard(c: MsAssignCheck): { title: string; lines: string[]; action: string } {
  const n = c.moves.length; const one = c.moves[0];
  const campaigns = new Set(c.moves.map(m => m.campaign)).size > 1;
  return {
    title: n > 1 ? `Reassign ${n} zones` : one.to ? `Give ${one.zone} to ${first(one.to)}` : `Take ${first(one.from)} off ${one.zone}`,
    lines: [
      ...c.moves.map(m => moveSaid(m, campaigns)),
      ...(!campaigns ? [`Campaign: ${one.campaign}`] : []),
      ...(n > 1 ? [`Zones each: ${repChanges(c.moves)}`] : []),
      'Only who has the zone changes. Its shape, businesses and visits stay as they are.',
    ],
    action: n > 1 ? 'Reassign' : one.to ? 'Assign' : 'Unassign',
  };
}

export function msZoneCard(c: MsZoneCheck): { title: string; lines: string[]; action: string } {
  const retiring = c.to === 'retired';
  return {
    title: retiring ? `Retire ${c.zone.name}` : `Bring back ${c.zone.name}`,
    lines: [
      [c.zone.city, c.businesses != null ? `${c.businesses} business${c.businesses === 1 ? '' : 'es'} in it` : ''].filter(Boolean).join(' · '),
      c.reps ? `On it now: ${c.reps}.` : 'Nobody is on it.',
      retiring ? 'A retired zone can be brought back: ask me, or use Zones › Show retired.' : 'It goes back on the Zones map as an active zone.',
    ].filter(Boolean),
    action: retiring ? 'Retire' : 'Bring back',
  };
}

async function recheck<T extends { ok: boolean; problems?: string[] }>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  const fresh = data as T;
  if (!fresh?.ok) throw new Error(fresh?.problems?.[0] || 'That can’t be done any more. Ask me again.');
  return fresh;
}

/** What the Benny says once the moves are saved. */
export function msAssignedSaid(moves: MsMove[]): string {
  if (moves.length === 1) { const m = moves[0]; return m.to ? `${m.zone} is ${first(m.to)}’s now${m.from ? ` (it was ${first(m.from)}’s)` : ''}.` : `${m.zone} has no rep now (it was ${first(m.from)}’s).`; }
  return `Done: ${moves.map(m => `${m.zone} → ${m.to ? first(m.to) : NOBODY}`).join(', ')}.`;
}

export async function msAssignFromBenny(check: MsAssignCheck): Promise<string> {
  const c = await recheck<MsAssignCheck>('benny_ms_check_assign', { p_moves: check.ask });
  if (c.stamp !== check.stamp) throw new Error('Those zones changed since I checked. Ask me again.');
  let done = 0;
  for (const m of c.moves) {
    try { await assignRep(m.zone_id, m.campaign_id, m.to_id || null); done++; }
    catch (e) {
      const why = e instanceof Error && e.message ? ` (${e.message.replace(/\.$/, '')})` : '';
      throw new Error(done ? `Only ${done} of ${c.moves.length} saved${why}. Check the Zones screen before trying again.` : `It didn’t save${why}. Nothing changed.`);
    }
  }
  return msAssignedSaid(c.moves);
}

export async function msZoneFromBenny(check: MsZoneCheck): Promise<string> {
  const c = await recheck<MsZoneCheck>('benny_ms_check_zone', { p_zone: check.zone.id, p_status: check.to });
  if (c.stamp !== check.stamp) throw new Error(`${c.zone.name} changed since I checked. Ask me again.`);
  await setZoneStatus(c.zone.id, c.to);
  return c.to === 'retired' ? `${c.zone.name} is retired.` : `${c.zone.name} is back as an active zone.`;
}

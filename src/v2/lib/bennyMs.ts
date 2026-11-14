// src/v2/lib/bennyMs.ts — the Benny on MainstreetAI (for MainstreetAI admins): its two cards and what they save.
//   ms_assign → who has which zone: one move, a swap, or many ("all of Sam's zones to Priya"). Saved with the Zones
//               screen's own assign (ms_assign_rep), one zone and campaign at a time.
//   ms_zone   → retire a zone, or bring one back (the Zones screen's own ms_set_zone_status).
//   ms_cut    → cut zones with Zones › Generate's own generator: a city's unzoned part, some of its zones again, or
//               all of it. Tapping it only WORKS THE ZONES OUT (a proposal, as on the Zones screen): the chat then shows
//               them on the map with a second card,
//   ms_cut_save → which saves them (ms_run_accept: the zones being re-cut are retired and the new ones made, together).
//               "Not now" on it discards the proposal.
// The database checks every card first (benny_ms_check_assign / _zone / _cut, benny_ms_run) and again right before the save.
import { db } from './client';
import { acceptRun, assignRep, discardRun, generateZonesOver, runToReady, setZoneStatus, stepLabel } from './mainstreet';

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

// ───────────── cutting zones ─────────────
export interface MsCutCheck {
  ok: boolean; problems?: string[]; city: { id: string; name: string }; campaign: { id: string; name: string }; target: number;
  /** all = every active zone of the city is re-cut; only = nothing but the named zones' blocks */
  all?: boolean; only?: boolean;
  replace: { id: string; name: string; density?: number; reps?: string }[];
  area: { blocks: number; density: number; per_zone: number };
  zones_left_alone?: number; proposals_waiting?: number; stamp: string;
  ask: { city: string; target: number; campaign: string; zones: string[] };
}
/** A worked-out proposal (benny_ms_run), as its save card keeps it: the shapes go to the chat's map, not the card. */
export interface MsRunCheck {
  ok: boolean; problems?: string[]; run: string; city: string; campaign: string;
  zones: { name: string; density: number; plazas: number }[]; smallest?: number; largest?: number;
  replace?: { id: string; name: string; gone?: boolean; reps?: string }[]; stamp: string;
}
export interface MsZoneMap { title: string; zones: { name: string; who?: string; polygon: GeoJSON.Geometry }[] }
/** What a card's save hands back when the chat goes on by itself: the card's own line, then a new message (a map, another card). */
export interface MsNext { text: string; then: { text: string; map: MsZoneMap | null; proposal: { kind: 'ms_cut_save'; check: MsRunCheck } } }

const num = (n: number) => Math.round(n).toLocaleString('en-CA');
const list = (names: string[], max = 6) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));
const withRep = (z: { name: string; reps?: string }) => (z.reps ? `${z.name} (${z.reps})` : z.name);
/** "Sina", "Sina and Alireza", "Sina, Alireza and Bo" */
const people = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const zonesWord = (n: number) => `${n} zone${n === 1 ? '' : 's'}`;

export function msCutCard(c: MsCutCheck): { title: string; lines: string[]; action: string } {
  const n = c.target, k = c.replace.length;
  return {
    title: !k ? `Cut ${zonesWord(n)} in ${c.city.name}` : c.all ? `Re-cut ${c.city.name} into ${zonesWord(n)}` : `Re-cut ${zonesWord(k)} into ${n}`,
    lines: [
      k ? `From: ${list(c.replace.map(withRep))}` : `From the part of ${c.city.name} that is in no zone yet.`,
      `${c.area.blocks} block${c.area.blocks === 1 ? '' : 's'} · density ${num(c.area.density)} · about ${num(c.area.per_zone)} a zone`,
      `Campaign: ${c.campaign.name}`,
      ...(c.zones_left_alone ? [`The other ${zonesWord(c.zones_left_alone)} in ${c.city.name} stay${c.zones_left_alone === 1 ? 's' : ''} as ${c.zones_left_alone === 1 ? 'it is' : 'they are'}.`] : []),
      ...(c.proposals_waiting ? [`A proposal for ${c.city.name} is already waiting on the Zones screen. This makes another.`] : []),
      'Nothing changes yet. I work the zones out and show them on the map; you save them after.',
    ],
    action: 'Work them out',
  };
}

/** The proposal in words, for the message the map and the save card sit under. */
export function msRunSaid(r: MsRunCheck): string {
  const uneven = r.smallest != null && r.largest != null && r.zones.length > 1 && r.largest > 2 * Math.max(1, r.smallest);
  return [
    `**${zonesWord(r.zones.length)} worked out for ${r.city}.** Nothing is saved yet.`,
    ...r.zones.map(z => `${z.name}: density ${num(z.density)}`),
    ...(uneven ? ['They come out uneven: a zone is made of whole blocks (the pieces between main roads), and a big block can’t be split.'] : []),
    'Save them with the card, or tell me a different number of zones.',
  ].join('\n');
}

export function msCutSaveCard(r: MsRunCheck): { title: string; lines: string[]; action: string } {
  const old = r.replace || []; const reps = [...new Set(old.flatMap(z => (z.reps || '').split(', ').filter(Boolean)))];
  return {
    title: `Save ${zonesWord(r.zones.length)} in ${r.city}`,
    lines: [
      `New: ${list(r.zones.map(z => z.name), 8)}`,
      ...(old.length ? [`Retires: ${list(old.map(withRep))}`] : []),
      ...(reps.length ? [`${people(reps.map(first))} will have no zone until you give ${reps.length === 1 ? 'them' : 'each'} one.`] : []),
      `Campaign: ${r.campaign}. The new zones start with no rep.`,
      ...(old.length ? ['A retired zone keeps its visits and can be brought back.'] : []),
    ],
    action: 'Save the zones',
  };
}

/** Tapping the cut card: checks again, starts the run and steps it until it's ready, then hands back the proposal to show. */
export async function msCutFromBenny(check: MsCutCheck, onStep?: (note: string) => void): Promise<MsNext> {
  const c = await recheck<MsCutCheck>('benny_ms_check_cut', { p_city: check.ask.city, p_target: check.ask.target, p_zones: check.ask.zones, p_campaign: check.ask.campaign });
  if (c.stamp !== check.stamp) throw new Error(`${c.city.name}’s zones changed since I checked. Ask me again.`);
  onStep?.(stepLabel(null));
  const run = await generateZonesOver(c.city.id, c.campaign.id, c.target, c.replace.map(z => z.id), !!c.only);
  try { await runToReady(run, s => onStep?.(stepLabel(s))); }
  catch (e) { await discardRun(run).catch(() => undefined); throw e; }   // a run that didn't finish isn't left lying on the Zones screen
  const { map, ...r } = await recheck<MsRunCheck & { map?: MsZoneMap }>('benny_ms_run', { p_run: run });
  return { text: `Worked out ${zonesWord(r.zones.length)}. They’re on the map below.`, then: { text: msRunSaid(r), map: map || null, proposal: { kind: 'ms_cut_save', check: r } } };
}

export async function msCutSaveFromBenny(check: MsRunCheck): Promise<string> {
  const { map: _map, ...r } = await recheck<MsRunCheck & { map?: MsZoneMap }>('benny_ms_run', { p_run: check.run });
  if (r.stamp !== check.stamp) throw new Error('That proposal changed since I showed it. Ask me to cut again.');
  if ((r.replace || []).some(z => z.gone)) throw new Error('One of the zones this replaces has changed since. Ask me to cut again.');
  const n = await acceptRun(r.run);
  const old = (r.replace || []).map(z => z.name);
  return `Saved ${zonesWord(n)} in ${r.city}${old.length ? ` and retired ${list(old)}` : ''}. None has a rep yet: tell me who gets which.`;
}

/** "Not now" on the save card: the proposal is discarded, so it doesn't wait on the Zones screen. */
export async function msCutDiscard(check: MsRunCheck): Promise<string> {
  await discardRun(check.run);
  return 'Discarded. Nothing changed.';
}

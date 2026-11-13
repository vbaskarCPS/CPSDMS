// src/v2/lib/bennyWalk.ts — "help me start the day": the Benny walks the person through it one question at a time
// (attendance on a road trip, who's going out and together or not, maps, how the crews are made, product cost and tax),
// then asks itself for the Start the day card with everything they chose. Nothing changes until they tap that card;
// the roll call saves only when they tap Save roll call (the same as ticking on the Day page).
import { db } from './client';
import type { PlanSettings } from './startSession';

export type WalkStep = 'attendance' | 'rollcall' | 'who' | 'maps' | 'crews' | 'carts' | 'money' | 'done' | 'draft';
export type CrewWay = 'balanced' | 'random' | 'roster' | 'draft';
export type CartWay = 'roster' | 'solo' | 'pairs';
export interface WalkManager { id: string; name: string }
export interface WalkWorker { rowId: string; hireId: string; name: string; here: boolean }
export interface WalkMoney { productCostPercent: number; noTaxOnCash: boolean; taxName: string; taxRate: number; from: string | null; changed?: boolean }
export interface WalkState {
  step: WalkStep; date: string; roadTrip: boolean; centerId?: string;
  /** the live draft started from this walk */
  draft?: string;
  managers: WalkManager[];                 // everyone who can manage that day
  groups: string[][];                      // who's going out: each group is one team (manager ids); two in a group = together
  maps: Record<string, string[]>;          // group key (ids joined by +) → map names
  areas: string[];                         // the center's maps
  recent?: string[];                       // the maps of the last day started, offered first
  crews?: CrewWay; carts?: CartWay; rules?: string;
  money?: WalkMoney;
  crew?: WalkWorker[];                     // the roll call
  rollSaved?: boolean;
}

export const groupKey = (g: string[]) => g.join('+');
export const groupName = (g: string[], managers: WalkManager[]) => g.map(id => managers.find(m => m.id === id)?.name || '?').join(' + ');

/** The steps in order, for this walk (a road trip asks about attendance first; one team has no crews to split). */
export function nextStep(s: WalkState): WalkStep {
  const order: WalkStep[] = ['attendance', 'who', 'maps', 'crews', 'carts', 'money', 'done'];
  const at = s.step === 'rollcall' ? 0 : order.indexOf(s.step);
  for (const st of order.slice(at + 1)) {
    if (st === 'crews' && s.groups.length < 2) continue;
    return st;
  }
  return 'done';
}
export const firstStep = (roadTrip: boolean): WalkStep => (roadTrip ? 'attendance' : 'who');

/** Join two teams into one (the first tapped, then the second), or split a team back into one per manager. */
export function joinGroups(groups: string[][], a: string, b: string): string[][] {
  const ga = groups.find(g => g.includes(a)); const gb = groups.find(g => g.includes(b));
  if (!ga || !gb || ga === gb) return groups;
  return [...groups.filter(g => g !== ga && g !== gb), [...ga, ...gb]];
}
export const splitGroup = (groups: string[][], g: string[]): string[][] => [...groups.filter(x => x !== g), ...g.map(id => [id])];
export function toggleOut(groups: string[][], id: string): string[][] {
  if (groups.some(g => g.includes(id))) return groups.map(g => g.filter(x => x !== id)).filter(g => g.length);
  return [...groups, [id]];
}

/** Random crews: the workers here, shuffled and dealt out in turn. rnd is passed in so it's tested. */
export function dealRandom<T>(people: T[], teams: number, rnd: () => number = Math.random): T[][] {
  const a = [...people];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const out: T[][] = Array.from({ length: teams }, () => []);
  a.forEach((p, i) => out[i % teams].push(p));
  return out;
}

const pct = (n: number) => `${Number(n.toFixed(2))}%`;
export const moneyLine = (m: WalkMoney) =>
  `Product cost ${pct(m.productCostPercent)} · ${m.taxName} ${pct(m.taxRate)} · ${m.noTaxOnCash ? 'no tax on cash' : 'tax on cash'}`;

/** What the Benny is asked for once the walk is done: the plan in words it already knows how to turn into a card. */
export function walkAsk(s: WalkState, random?: string[][]): string {
  const day = s.date;
  const lines = [`Start the day on ${day} with this plan.`];
  for (const g of s.groups) {
    const names = groupName(g, s.managers);
    const maps = s.maps[groupKey(g)] || [];
    lines.push(`${g.length > 1 ? `${names} together as one team (both managers)` : names}: ${maps.length ? maps.join(', ') : 'no maps yet'}.`);
  }
  if (s.groups.length > 1) {
    if (s.crews === 'balanced') lines.push('Crews: balanced, a snake draft down the ranking by average equiv per day worked.');
    if ((s.crews === 'random' || s.crews === 'draft') && random) s.groups.forEach((g, i) => lines.push(`${groupName(g, s.managers)}'s crew: ${(random[i] || []).join(', ') || 'nobody'}.`));
    if (s.crews === 'roster') lines.push('Crews: keep each worker with the manager they have on the roster.');
  }
  if (s.rules?.trim()) lines.push(`Keep in mind: ${s.rules.trim()}`);
  lines.push(`Carts: ${s.carts === 'solo' ? 'everyone solo' : s.carts === 'pairs' ? 'two to a cart' : 'as on the roster'}.`);
  return lines.join('\n');
}

/** The product cost and tax the center's last started day used (same service), or null when there's none. */
export async function lastSettings(centerId: string, service: string): Promise<{ settings: PlanSettings; day: string; maps: string[] } | null> {
  try {
    const { data } = await db.from('sessions').select('settings, routes, day:days!inner(day, center_id)').eq('day.center_id', centerId)
      .order('day(day)', { ascending: false }).limit(10);
    const rows = (data || []) as unknown as { settings: PlanSettings; routes: { area?: string }[] | null; day: { day: string } }[];
    const hit = rows.filter(r => r.settings && typeof r.settings.productCostPercent === 'number' && (!r.settings.service || r.settings.service === service))
      .sort((a, b) => b.day.day.localeCompare(a.day.day))[0];
    return hit ? { settings: hit.settings, day: hit.day.day, maps: [...new Set((hit.routes || []).map(r => r.area).filter((a): a is string => !!a))] } : null;
  } catch { return null; }
}

/** The maps to show for a search: the chosen ones, then what matches the words typed (or, with nothing typed, the last
 *  day's maps), at most 12 more. "north van 1" finds NORTH VANCOUVER #1. */
export function mapChoices(all: string[], chosen: string[], find: string, recent: string[] = []): string[] {
  const words = find.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean);
  const hits = words.length
    ? all.filter(a => { const w = a.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean); return words.every(x => w.some(y => /^\d+$/.test(x) ? y === x : y.startsWith(x))); })
    : recent.filter(r => all.includes(r));
  return [...chosen, ...hits.filter(a => !chosen.includes(a)).slice(0, 12)];
}

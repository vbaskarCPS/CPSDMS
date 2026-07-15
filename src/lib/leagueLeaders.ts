// src/lib/leagueLeaders.ts
import { LoadedWorkbook } from './reportDataLoader';
import { ContractorOverride, MergeOverridePayload, SplitOverridePayload } from './reportingService';
import { Region, SeasonType } from '../types';

// ============================================================================
// LEAGUE LEADERS — per-contractor leaderboards
// ----------------------------------------------------------------------------
// Aggregates Payout Stats rows per contractor and ranks them by various stats.
// Supports filtering by region+season or by nickname, and applies data-cleanup
// overrides (merge two IDs into one person; split one ID into several people).
//
// "Past 3 days" means each contractor's three most recent WORKING days.
// ============================================================================

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ordOf(tab: string): number | null {
  if (!tab) return null;
  const t = tab.toString().trim();
  if (t.length < 4) return null;
  const month = MONTHS.indexOf(t.substring(0, 3));
  const day = parseInt(t.substring(3), 10);
  if (month < 0 || !day || day < 1 || day > 31) return null;
  return month * 31 + day;
}

export type LeagueFilter =
  | { type: 'all' }
  | { type: 'regionSeason'; region: Region; season: SeasonType }
  | { type: 'nickname'; nickname: string };

export interface LeaderRow {
  rank: number;
  identity: string;
  name: string;
  ids: string[];          // raw contractor IDs behind this identity
  value: number;
  detail?: string;        // small secondary line (e.g. "over 3 days")
}

export type BoardUnit = 'count' | 'eq' | 'money';

export interface LeaderBoard {
  key: string;
  title: string;
  unit: BoardUnit;
  rows: LeaderRow[];
}

export interface MergeSuggestion {
  name: string;
  ids: string[];          // same person appearing under these different IDs
}

export interface SplitSuggestion {
  id: string;             // one ID shared by several people
  names: string[];
}

export interface LeagueLeadersResult {
  regionSeasons: { region: Region; season: SeasonType }[];
  nicknames: string[];
  boards: LeaderBoard[];
  detections: { merges: MergeSuggestion[]; splits: SplitSuggestion[] };
  contractorCount: number;
}

interface RangeInfo { region: Region; season: SeasonType; nickname?: string; }

interface Agg {
  identity: string;
  ids: Set<string>;
  nameCounts: Map<string, number>;
  forcedName?: string;                    // canonical name from a merge override
  days: Map<string, { eq: number; pay: number; bonus: number }>;
}

const displayNameOf = (first: string, last: string) => `${first || ''} ${last || ''}`.trim();
const normName = (first: string, last: string) => displayNameOf(first, last).toLowerCase().replace(/\s+/g, ' ');

export function computeLeagueLeaders(
  workbooks: LoadedWorkbook[],
  overrides: ContractorOverride[],
  filter: LeagueFilter
): LeagueLeadersResult {
  // --- Overrides → identity resolution ---
  const splitIds = new Set<string>();
  const mergeMap = new Map<string, string>();      // base-key → group-key
  const mergeName = new Map<string, string>();     // group-key → canonical name
  const mergedMembers = new Set<string>();
  for (const o of overrides) {
    if (o.kind === 'split') {
      const p = o.payload as SplitOverridePayload;
      if (p.id) splitIds.add(p.id);
    } else if (o.kind === 'merge') {
      const p = o.payload as MergeOverridePayload;
      (p.members || []).forEach((m) => { mergeMap.set(m, o.id); mergedMembers.add(m); });
      mergeName.set(o.id, p.canonicalName || '');
    }
  }

  const baseKey = (id: string, first: string, last: string) =>
    splitIds.has(id) ? `${id}|${normName(first, last)}` : id;
  const identityKey = (id: string, first: string, last: string) => {
    const base = baseKey(id, first, last);
    return mergeMap.get(base) ?? base;
  };

  // --- Detection structures (raw, filter-independent) ---
  const nameToIds = new Map<string, Set<string>>();
  const nameDisplay = new Map<string, string>();
  const idToNorms = new Map<string, Set<string>>();
  const idToDisplays = new Map<string, Set<string>>();

  // --- Aggregation ---
  const aggs = new Map<string, Agg>();
  const ensure = (identity: string): Agg => {
    let a = aggs.get(identity);
    if (!a) { a = { identity, ids: new Set(), nameCounts: new Map(), days: new Map() }; aggs.set(identity, a); }
    return a;
  };

  const rsSet = new Set<string>();      // "region|season"
  const nickSet = new Set<string>();

  for (const wb of workbooks) {
    const ranges = (wb.config?.dateRanges || [])
      .map((r) => ({ lo: ordOf(r.startTab), hi: ordOf(r.endTab), r }))
      .filter((x): x is { lo: number; hi: number; r: typeof x.r } => x.lo != null && x.hi != null);

    for (const row of wb.rows) {
      const dOrd = ordOf(row.date);

      // Range lookup (for filters + option discovery)
      let range: RangeInfo | null = null;
      if (dOrd != null) {
        const m = ranges.find((x) => dOrd >= x.lo && dOrd <= x.hi);
        if (m) {
          range = { region: m.r.region, season: m.r.season, nickname: m.r.nickname };
          rsSet.add(`${m.r.region}|${m.r.season}`);
          if (m.r.nickname) nickSet.add(m.r.nickname);
        }
      }

      // Detection tallies (every row with a name)
      const nn = normName(row.firstName, row.lastName);
      if (nn) {
        if (!nameToIds.has(nn)) { nameToIds.set(nn, new Set()); nameDisplay.set(nn, displayNameOf(row.firstName, row.lastName)); }
        nameToIds.get(nn)!.add(row.contractorId);
        if (!idToNorms.has(row.contractorId)) { idToNorms.set(row.contractorId, new Set()); idToDisplays.set(row.contractorId, new Set()); }
        idToNorms.get(row.contractorId)!.add(nn);
        idToDisplays.get(row.contractorId)!.add(displayNameOf(row.firstName, row.lastName));
      }

      // Filter
      let keep = false;
      if (filter.type === 'all') keep = true;
      else if (filter.type === 'regionSeason') keep = !!range && range.region === filter.region && range.season === filter.season;
      else if (filter.type === 'nickname') keep = !!range && range.nickname === filter.nickname;
      if (!keep) continue;

      // Aggregate
      const identity = identityKey(row.contractorId, row.firstName, row.lastName);
      const a = ensure(identity);
      a.ids.add(row.contractorId);
      const disp = displayNameOf(row.firstName, row.lastName);
      if (disp) a.nameCounts.set(disp, (a.nameCounts.get(disp) || 0) + 1);
      if (mergeName.has(identity)) a.forcedName = mergeName.get(identity);
      const d = a.days.get(row.date) || { eq: 0, pay: 0, bonus: 0 };
      d.eq += row.totalEQ; d.pay += row.finalPay; d.bonus += row.bonuses;
      a.days.set(row.date, d);
    }
  }

  // --- Per-contractor stat objects ---
  interface Stat {
    identity: string; name: string; ids: string[];
    daysWorked: number; totalEQ: number; totalPay: number; totalBonus: number;
    avgEQ3: number; avgPay3: number; days3: number;
    avgEQPerDay: number; bestDayEQ: number; bestDayPay: number;
  }
  const stats: Stat[] = Array.from(aggs.values()).map((a) => {
    const name = a.forcedName
      || Array.from(a.nameCounts.entries()).sort((x, y) => y[1] - x[1])[0]?.[0]
      || Array.from(a.ids)[0] || a.identity;

    const dayEntries = Array.from(a.days.entries())
      .map(([date, v]) => ({ ord: ordOf(date) ?? 0, ...v }))
      .sort((x, y) => x.ord - y.ord);

    const daysWorked = dayEntries.length;
    const totalEQ = dayEntries.reduce((s, d) => s + d.eq, 0);
    const totalPay = dayEntries.reduce((s, d) => s + d.pay, 0);
    const totalBonus = dayEntries.reduce((s, d) => s + d.bonus, 0);

    const last3 = dayEntries.slice(-3);
    const days3 = last3.length;
    const avgEQ3 = days3 ? last3.reduce((s, d) => s + d.eq, 0) / days3 : 0;
    const avgPay3 = days3 ? last3.reduce((s, d) => s + d.pay, 0) / days3 : 0;

    const avgEQPerDay = daysWorked ? totalEQ / daysWorked : 0;
    const bestDayEQ = dayEntries.reduce((m, d) => Math.max(m, d.eq), 0);
    const bestDayPay = dayEntries.reduce((m, d) => Math.max(m, d.pay), 0);

    return { identity: a.identity, name, ids: Array.from(a.ids), daysWorked, totalEQ, totalPay, totalBonus, avgEQ3, avgPay3, days3, avgEQPerDay, bestDayEQ, bestDayPay };
  });

  const TOP = 25;
  const board = (key: string, title: string, unit: BoardUnit, pick: (s: Stat) => number, detail?: (s: Stat) => string | undefined): LeaderBoard => {
    const rows = stats
      .map((s) => ({ s, value: pick(s) }))
      .filter((x) => x.value > 0)
      .sort((x, y) => y.value - x.value)
      .slice(0, TOP)
      .map((x, i) => ({ rank: i + 1, identity: x.s.identity, name: x.s.name, ids: x.s.ids, value: x.value, detail: detail?.(x.s) }));
    return { key, title, unit, rows };
  };

  const boards: LeaderBoard[] = [
    board('daysWorked', 'Most days worked', 'count', (s) => s.daysWorked),
    board('avgEQ3', 'Highest avg EQ — last 3 days', 'eq', (s) => s.avgEQ3, (s) => `over ${s.days3} day${s.days3 === 1 ? '' : 's'}`),
    board('avgPay3', 'Highest avg take-home — last 3 days', 'money', (s) => s.avgPay3, (s) => `over ${s.days3} day${s.days3 === 1 ? '' : 's'}`),
    board('totalEQ', 'Highest total EQ', 'eq', (s) => s.totalEQ),
    board('totalPay', 'Highest total take-home', 'money', (s) => s.totalPay),
    board('totalBonus', 'Highest total bonuses', 'money', (s) => s.totalBonus),
    board('avgEQPerDay', 'Highest avg EQ per day', 'eq', (s) => s.avgEQPerDay, (s) => `${s.daysWorked} days`),
    board('bestDayEQ', 'Best single day — EQ', 'eq', (s) => s.bestDayEQ),
    board('bestDayPay', 'Best single day — take-home', 'money', (s) => s.bestDayPay),
  ];

  // --- Detections ---
  const merges: MergeSuggestion[] = [];
  for (const [nn, ids] of nameToIds.entries()) {
    if (ids.size < 2) continue;
    const arr = Array.from(ids);
    if (arr.every((id) => mergedMembers.has(id))) continue;   // already merged
    merges.push({ name: nameDisplay.get(nn) || nn, ids: arr.sort() });
  }
  merges.sort((a, b) => a.name.localeCompare(b.name));

  const splits: SplitSuggestion[] = [];
  for (const [id, norms] of idToNorms.entries()) {
    if (norms.size < 2) continue;
    if (splitIds.has(id)) continue;                            // already split
    splits.push({ id, names: Array.from(idToDisplays.get(id) || []).sort() });
  }
  splits.sort((a, b) => a.id.localeCompare(b.id));

  const regionSeasons = Array.from(rsSet).map((k) => {
    const [region, season] = k.split('|') as [Region, SeasonType];
    return { region, season };
  }).sort((a, b) => (a.region + a.season).localeCompare(b.region + b.season));

  return {
    regionSeasons,
    nicknames: Array.from(nickSet).sort(),
    boards,
    detections: { merges, splits },
    contractorCount: stats.length,
  };
}
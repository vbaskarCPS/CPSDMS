// src/lib/payableCitySales.ts
import { LoadedWorkbook } from './reportDataLoader';
import { PayableCity, extractContractorPrefix } from './reportingService';
import { Region, SeasonType } from '../types';

// ============================================================================
// PAYABLE CITY SALES — computation
// ----------------------------------------------------------------------------
// Pure function. Reads the already-loaded workbook rows + payable-city configs
// and produces per-city payable-sales totals with the breakdown data the report
// UI needs (contributors, region/season split, per-day-by-workbook stacks), plus
// an unattributed tally so no dollars silently vanish.
//
// Payable formula (locked): payable = (prodGross / (1 + tax%)) * (1 - product%)
//   divisor first, product cost on the post-tax figure.
// ============================================================================

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "MmmDD" -> calendar ordinal (month*31 + day), or null. Season stays within one
// year so month+day orders unambiguously; day maxes at 31, no cross-month clash.
function ordOf(tab: string): number | null {
  if (!tab) return null;
  const t = tab.toString().trim();
  if (t.length < 4) return null;
  const month = MONTHS.indexOf(t.substring(0, 3));
  const day = parseInt(t.substring(3), 10);
  if (month < 0 || !day || day < 1 || day > 31) return null;
  return month * 31 + day;
}

export interface ContributorSlice {
  fromCity: string;   // selling city that fed this receiving city
  amount: number;
  isOwn: boolean;     // fromCity === the receiving city
}

export interface RegionSeasonSlice {
  region: Region;
  season: SeasonType;
  amount: number;
}

export interface DayStack {
  date: string;                                  // "May09"
  ord: number;                                   // for sorting
  total: number;
  byWorkbook: { label: string; amount: number }[];
}

export interface CitySales {
  cityName: string;
  isConfigured: boolean;   // false = a name only referenced in a split, not a real payable city
  total: number;
  contributors: ContributorSlice[];
  regionSeason: RegionSeasonSlice[];
  days: DayStack[];
}

export interface PayableCitySalesResult {
  cities: CitySales[];        // sorted by total desc
  workbookLabels: string[];   // every workbook that contributed (for a stable chart legend)
  unattributed: {
    noRange: number;          // date fell in no defined range (reported as GROSS — tax/cost unknown)
    noCity: number;           // prefix matched no payable city (payable)
    regionUnconfigured: number; // selling city had no split for that region (payable)
    total: number;            // sum of the three
  };
}

export function computePayableCitySales(
  workbooks: LoadedWorkbook[],
  cities: PayableCity[]
): PayableCitySalesResult {
  // prefix (uppercase) -> selling city
  const prefixToCity = new Map<string, PayableCity>();
  cities.forEach((c) => c.prefixes.forEach((p) => prefixToCity.set(p.toUpperCase(), c)));

  interface Acc {
    total: number;
    contributors: Map<string, number>;
    regionSeason: Map<string, number>;
    days: Map<string, Map<string, number>>;
  }
  const acc = new Map<string, Acc>();
  const ensure = (name: string): Acc => {
    let a = acc.get(name);
    if (!a) { a = { total: 0, contributors: new Map(), regionSeason: new Map(), days: new Map() }; acc.set(name, a); }
    return a;
  };

  let noRange = 0, noCity = 0, regionUnconfigured = 0;
  const workbookLabels = new Set<string>();

  for (const wb of workbooks) {
    const ranges = (wb.config?.dateRanges || [])
      .map((r) => ({ lo: ordOf(r.startTab), hi: ordOf(r.endTab), r }))
      .filter((x): x is { lo: number; hi: number; r: typeof x.r } => x.lo != null && x.hi != null);

    for (const row of wb.rows) {
      const dOrd = ordOf(row.date);
      if (dOrd == null) continue;

      const match = ranges.find((x) => dOrd >= x.lo && dOrd <= x.hi);
      if (!match) { noRange += row.prodGross; continue; }

      const { region, season, taxRate, productCostPercent } = match.r;
      const payable = (row.prodGross / (1 + taxRate / 100)) * (1 - productCostPercent / 100);

      const prefix = extractContractorPrefix(row.contractorId).toUpperCase();
      const sellingCity = prefixToCity.get(prefix);
      if (!sellingCity) { noCity += payable; continue; }

      const split = sellingCity.regionSplits[region];
      if (!split || split.length === 0) { regionUnconfigured += payable; continue; }

      workbookLabels.add(wb.label);
      for (const share of split) {
        const amt = payable * ((Number(share.percent) || 0) / 100);
        if (!amt) continue;
        const a = ensure(share.city);
        a.total += amt;
        a.contributors.set(sellingCity.name, (a.contributors.get(sellingCity.name) || 0) + amt);
        const rsKey = `${region}|${season}`;
        a.regionSeason.set(rsKey, (a.regionSeason.get(rsKey) || 0) + amt);
        let dayMap = a.days.get(row.date);
        if (!dayMap) { dayMap = new Map(); a.days.set(row.date, dayMap); }
        dayMap.set(wb.label, (dayMap.get(wb.label) || 0) + amt);
      }
    }
  }

  // Union of configured cities + any names only referenced in splits.
  const configuredNames = new Set(cities.map((c) => c.name));
  const allNames = new Set<string>([...configuredNames, ...acc.keys()]);

  const citySales: CitySales[] = Array.from(allNames).map((name) => {
    const a = acc.get(name);
    const contributors: ContributorSlice[] = a
      ? Array.from(a.contributors.entries())
          .map(([fromCity, amount]) => ({ fromCity, amount, isOwn: fromCity === name }))
          .sort((x, y) => y.amount - x.amount)
      : [];
    const regionSeason: RegionSeasonSlice[] = a
      ? Array.from(a.regionSeason.entries())
          .map(([key, amount]) => {
            const [region, season] = key.split('|') as [Region, SeasonType];
            return { region, season, amount };
          })
          .sort((x, y) => y.amount - x.amount)
      : [];
    const days: DayStack[] = a
      ? Array.from(a.days.entries())
          .map(([date, wbMap]) => {
            const byWorkbook = Array.from(wbMap.entries())
              .map(([label, amount]) => ({ label, amount }))
              .sort((x, y) => y.amount - x.amount);
            const total = byWorkbook.reduce((s, w) => s + w.amount, 0);
            return { date, ord: ordOf(date) ?? 0, total, byWorkbook };
          })
          .sort((x, y) => x.ord - y.ord)
      : [];

    return {
      cityName: name,
      isConfigured: configuredNames.has(name),
      total: a?.total || 0,
      contributors,
      regionSeason,
      days,
    };
  }).sort((x, y) => y.total - x.total);

  return {
    cities: citySales,
    workbookLabels: Array.from(workbookLabels).sort(),
    unattributed: {
      noRange,
      noCity,
      regionUnconfigured,
      total: noRange + noCity + regionUnconfigured,
    },
  };
}

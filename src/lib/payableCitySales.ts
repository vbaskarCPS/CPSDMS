// src/lib/payableCitySales.ts
import { LoadedWorkbook } from './reportDataLoader';
import { PayableCity, extractContractorPrefix } from './reportingService';
import { Region, SeasonType } from '../types';

// ============================================================================
// PAYABLE CITY SALES — computation
// ----------------------------------------------------------------------------
// Pure function over the already-loaded workbook rows + payable-city configs.
//
// Produces TWO things:
//   1. A production SUMMARY — every sale that fell inside a date range, totalled
//      by region/season and by workbook, with gross / tax / product / payable.
//      This is business production and does NOT depend on city attribution.
//   2. Per-CITY attribution — payable sales routed to cities via the selling
//      city's region split, plus an unattributed tally.
//
// The two reconcile: summary payable = sum(city totals) + noCity + regionUnconfigured.
// (noRange rows have no range, so no region/season/tax — excluded from the summary.)
//
// Office flats (ProdFlats) come out of gross BEFORE tax, so they carry neither
// tax nor product cost. Excluded here only - League Leaders is unaffected.
//
// Payable formula (locked): gross = ProdGross - ProdFlats
//   afterTax = gross / (1 + tax%);  payable = afterTax * (1 - product%)
//   tax  = gross - afterTax
//   prod = afterTax - payable
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

export interface ContributorSlice {
  fromCity: string;
  amount: number;
  isOwn: boolean;
}

export interface RegionSeasonSlice {
  region: Region;
  season: SeasonType;
  own: number;       // from this city's own workers
  external: number;  // from other cities' workers
  amount: number;    // own + external (= payable)
  gross: number;
  grossOwn: number;
  grossExternal: number;
  afterTax: number;
  taxRate: number | null;      // consistent rate across contributing ranges, or null if mixed
  productRate: number | null;
}

export interface DaySegment {
  key: string;            // nickname, or "region|season" when unnamed
  nickname?: string;
  region: Region;
  season: SeasonType;
  amount: number;         // payable = own + external
  own: number;            // payable earned by this city's own workers
  external: number;       // payable imported from another city's workers
  gross: number;          // gross behind amount (flats already removed)
  grossOwn: number;
  grossExternal: number;
}

export interface DayStack {
  date: string;
  ord: number;
  total: number;          // payable for the day
  own: number;
  external: number;
  gross: number;
  grossOwn: number;
  grossExternal: number;
  segments: DaySegment[];
}

export interface CitySales {
  cityName: string;
  isConfigured: boolean;
  total: number;      // payable attributed to this city
  own: number;        // payable from this city's own workers
  external: number;   // payable imported from other cities
  gross: number;      // gross behind that payable
  grossOwn: number;
  grossExternal: number;
  contributors: ContributorSlice[];
  regionSeason: RegionSeasonSlice[];
  days: DayStack[];
}

// --- Production summary shapes (all in-range sales, pre-attribution) ---
export interface RegionSeasonTotal {
  region: Region;
  season: SeasonType;
  payable: number;
  gross: number;
}

export interface WorkbookTotal {
  label: string;
  payable: number;
  gross: number;
}

export interface ReportSummary {
  totalPayable: number;
  totalGross: number;
  totalTax: number;
  totalProduct: number;
  regionSeason: RegionSeasonTotal[];
  byWorkbook: WorkbookTotal[];
}

export interface WorkbookRangeCity {
  cityName: string;
  payable: number;
  gross: number;
}

export interface WorkbookRangeBreakdown {
  nickname?: string;
  region: Region;
  season: SeasonType;
  startTab: string;
  endTab: string;
  taxRate: number;
  productRate: number;
  payable: number;
  gross: number;
  cities: WorkbookRangeCity[];   // attributed payable cities within this range
  unattributed: number;          // payable that didn't attribute within this range
}

export interface WorkbookBreakdown {
  label: string;
  payable: number;
  gross: number;
  ranges: WorkbookRangeBreakdown[];
}

export interface PayableCitySalesResult {
  summary: ReportSummary;
  cities: CitySales[];
  workbookBreakdown: WorkbookBreakdown[];
  workbookLabels: string[];
  unattributed: {
    noRange: number;            // date fell in no defined range (GROSS — tax/cost unknown)
    noCity: number;             // prefix matched no payable city (payable)
    regionUnconfigured: number; // selling city had no split for that region (payable)
    total: number;
  };
}

export function computePayableCitySales(
  workbooks: LoadedWorkbook[],
  cities: PayableCity[]
): PayableCitySalesResult {
  const prefixToCity = new Map<string, PayableCity>();
  cities.forEach((c) => c.prefixes.forEach((p) => prefixToCity.set(p.toUpperCase(), c)));

  type DayAcc = {
    key: string; nickname?: string; region: Region; season: SeasonType;
    amount: number; own: number; external: number;
    gross: number; grossOwn: number; grossExternal: number;
  };
  interface Acc {
    total: number;
    own: number;
    external: number;
    gross: number;
    grossOwn: number;
    grossExternal: number;
    contributors: Map<string, number>;
    regionSeason: Map<string, { own: number; external: number; gross: number; grossOwn: number; grossExternal: number; afterTax: number; taxRate: number | null | undefined; productRate: number | null | undefined }>;
    days: Map<string, Map<string, DayAcc>>;
  }
  const acc = new Map<string, Acc>();
  const ensure = (name: string): Acc => {
    let a = acc.get(name);
    if (!a) {
      a = {
        total: 0, own: 0, external: 0, gross: 0, grossOwn: 0, grossExternal: 0,
        contributors: new Map(), regionSeason: new Map(), days: new Map(),
      };
      acc.set(name, a);
    }
    return a;
  };

  // Production summary accumulators (per in-range row, once).
  let prodPayable = 0, prodGross = 0, prodTax = 0, prodProduct = 0;
  const prodRS = new Map<string, { payable: number; gross: number }>();
  const prodWB = new Map<string, { payable: number; gross: number }>();

  type WbRangeAcc = {
    nickname?: string; region: Region; season: SeasonType;
    startTab: string; endTab: string; taxRate: number; productRate: number;
    payable: number; gross: number;
    cities: Map<string, { payable: number; gross: number }>;
    unattributed: number;
  };
  const wbBreak = new Map<string, Map<string, WbRangeAcc>>();

  let noRange = 0, noCity = 0, regionUnconfigured = 0;
  const attributedWbLabels = new Set<string>();

  for (const wb of workbooks) {
    const ranges = (wb.config?.dateRanges || [])
      .map((r) => ({ lo: ordOf(r.startTab), hi: ordOf(r.endTab), r }))
      .filter((x): x is { lo: number; hi: number; r: typeof x.r } => x.lo != null && x.hi != null);

    for (const row of wb.rows) {
      const dOrd = ordOf(row.date);
      if (dOrd == null) continue;

      const match = ranges.find((x) => dOrd >= x.lo && dOrd <= x.hi);

      // Office flats leave the equation entirely: taken out of gross BEFORE tax,
      // so they carry no tax and no product cost. Applies to this report only -
      // League Leaders still ranks on the raw sheet figures.
      const grossExFlats = Math.max(0, row.prodGross - row.prodFlats);

      if (!match) { noRange += grossExFlats; continue; }

      const { region, season, taxRate, productCostPercent } = match.r;
      const gross = grossExFlats;
      const afterTax = gross / (1 + taxRate / 100);
      const payable = afterTax * (1 - productCostPercent / 100);
      const taxAmt = gross - afterTax;
      const productAmt = afterTax - payable;
      const rsKey = `${region}|${season}`;

      // --- Production summary (every in-range row, once) ---
      prodPayable += payable; prodGross += gross; prodTax += taxAmt; prodProduct += productAmt;
      const prs = prodRS.get(rsKey) || { payable: 0, gross: 0 };
      prs.payable += payable; prs.gross += gross; prodRS.set(rsKey, prs);
      const pwb = prodWB.get(wb.label) || { payable: 0, gross: 0 };
      pwb.payable += payable; pwb.gross += gross; prodWB.set(wb.label, pwb);

      // --- Workbook breakdown (per range) ---
      let wbMap = wbBreak.get(wb.label);
      if (!wbMap) { wbMap = new Map<string, WbRangeAcc>(); wbBreak.set(wb.label, wbMap); }
      const rk = `${match.r.startTab}|${match.r.endTab}`;
      let re = wbMap.get(rk);
      if (!re) {
        re = {
          nickname: match.r.nickname, region, season,
          startTab: match.r.startTab, endTab: match.r.endTab,
          taxRate, productRate: productCostPercent,
          payable: 0, gross: 0, cities: new Map(), unattributed: 0,
        };
        wbMap.set(rk, re);
      }
      re.payable += payable; re.gross += gross;

      // --- City attribution ---
      const prefix = extractContractorPrefix(row.contractorId).toUpperCase();
      const sellingCity = prefixToCity.get(prefix);
      if (!sellingCity) { noCity += payable; re.unattributed += payable; continue; }

      const split = sellingCity.regionSplits[region];
      if (!split || split.length === 0) { regionUnconfigured += payable; re.unattributed += payable; continue; }

      attributedWbLabels.add(wb.label);
      for (const share of split) {
        const pct = (Number(share.percent) || 0) / 100;
        if (pct <= 0) continue;
        const amt = payable * pct;
        const grossShare = gross * pct;
        const afterTaxShare = afterTax * pct;
        const a = ensure(share.city);
        const isOwn = share.city === sellingCity.name;
        a.total += amt;
        a.gross += grossShare;
        if (isOwn) { a.own += amt; a.grossOwn += grossShare; }
        else { a.external += amt; a.grossExternal += grossShare; }
        a.contributors.set(sellingCity.name, (a.contributors.get(sellingCity.name) || 0) + amt);
        const rs = a.regionSeason.get(rsKey) || { own: 0, external: 0, gross: 0, grossOwn: 0, grossExternal: 0, afterTax: 0, taxRate: undefined, productRate: undefined };
        if (isOwn) { rs.own += amt; rs.grossOwn += grossShare; }
        else { rs.external += amt; rs.grossExternal += grossShare; }
        rs.gross += grossShare;
        rs.afterTax += afterTaxShare;
        rs.taxRate = rs.taxRate === undefined ? taxRate : (rs.taxRate === taxRate ? rs.taxRate : null);
        rs.productRate = rs.productRate === undefined ? productCostPercent : (rs.productRate === productCostPercent ? rs.productRate : null);
        a.regionSeason.set(rsKey, rs);
        const segKey = match.r.nickname || `${region}|${season}`;
        let dayMap = a.days.get(row.date);
        if (!dayMap) { dayMap = new Map(); a.days.set(row.date, dayMap); }
        const seg: DayAcc = dayMap.get(segKey) || {
          key: segKey, nickname: match.r.nickname, region, season,
          amount: 0, own: 0, external: 0, gross: 0, grossOwn: 0, grossExternal: 0,
        };
        seg.amount += amt;
        seg.gross += grossShare;
        if (isOwn) { seg.own += amt; seg.grossOwn += grossShare; }
        else { seg.external += amt; seg.grossExternal += grossShare; }
        dayMap.set(segKey, seg);

        const rc = re.cities.get(share.city) || { payable: 0, gross: 0 };
        rc.payable += amt; rc.gross += grossShare; re.cities.set(share.city, rc);
      }
    }
  }

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
          .map(([key, v]) => {
            const [region, season] = key.split('|') as [Region, SeasonType];
            return {
              region, season,
              own: v.own, external: v.external, amount: v.own + v.external,
              gross: v.gross, grossOwn: v.grossOwn, grossExternal: v.grossExternal,
              afterTax: v.afterTax,
              taxRate: v.taxRate ?? null,
              productRate: v.productRate ?? null,
            };
          })
          .sort((x, y) => y.amount - x.amount)
      : [];
    const days: DayStack[] = a
      ? Array.from(a.days.entries())
          .map(([date, segMap]) => {
            const segments = Array.from(segMap.values())
              .map((s) => ({
                key: s.key, nickname: s.nickname, region: s.region, season: s.season,
                amount: s.amount, own: s.own, external: s.external,
                gross: s.gross, grossOwn: s.grossOwn, grossExternal: s.grossExternal,
              }))
              .sort((x, y) => y.amount - x.amount);
            const sum = (pick: (s: DaySegment) => number) => segments.reduce((t, s) => t + pick(s), 0);
            return {
              date, ord: ordOf(date) ?? 0,
              total: sum((s) => s.amount),
              own: sum((s) => s.own),
              external: sum((s) => s.external),
              gross: sum((s) => s.gross),
              grossOwn: sum((s) => s.grossOwn),
              grossExternal: sum((s) => s.grossExternal),
              segments,
            };
          })
          .sort((x, y) => x.ord - y.ord)
      : [];

    return {
      cityName: name,
      isConfigured: configuredNames.has(name),
      total: a?.total || 0,
      own: a?.own || 0,
      external: a?.external || 0,
      gross: a?.gross || 0,
      grossOwn: a?.grossOwn || 0,
      grossExternal: a?.grossExternal || 0,
      contributors,
      regionSeason,
      days,
    };
  }).sort((x, y) => y.total - x.total);

  const summary: ReportSummary = {
    totalPayable: prodPayable,
    totalGross: prodGross,
    totalTax: prodTax,
    totalProduct: prodProduct,
    regionSeason: Array.from(prodRS.entries())
      .map(([key, v]) => {
        const [region, season] = key.split('|') as [Region, SeasonType];
        return { region, season, payable: v.payable, gross: v.gross };
      })
      .sort((x, y) => y.payable - x.payable),
    byWorkbook: Array.from(prodWB.entries())
      .map(([label, v]) => ({ label, payable: v.payable, gross: v.gross }))
      .sort((x, y) => y.payable - x.payable),
  };

  const workbookBreakdown: WorkbookBreakdown[] = Array.from(wbBreak.entries()).map(([label, rangeMap]) => {
    const ranges: WorkbookRangeBreakdown[] = Array.from(rangeMap.values())
      .map((re) => ({
        nickname: re.nickname,
        region: re.region,
        season: re.season,
        startTab: re.startTab,
        endTab: re.endTab,
        taxRate: re.taxRate,
        productRate: re.productRate,
        payable: re.payable,
        gross: re.gross,
        cities: Array.from(re.cities.entries())
          .map(([cityName, v]) => ({ cityName, payable: v.payable, gross: v.gross }))
          .sort((x, y) => y.payable - x.payable),
        unattributed: re.unattributed,
      }))
      .sort((x, y) => (ordOf(x.startTab) ?? 0) - (ordOf(y.startTab) ?? 0));
    const payable = ranges.reduce((s, r) => s + r.payable, 0);
    const gross = ranges.reduce((s, r) => s + r.gross, 0);
    return { label, payable, gross, ranges };
  }).sort((x, y) => y.payable - x.payable);

  return {
    summary,
    cities: citySales,
    workbookBreakdown,
    workbookLabels: Array.from(attributedWbLabels).sort(),
    unattributed: {
      noRange,
      noCity,
      regionUnconfigured,
      total: noRange + noCity + regionUnconfigured,
    },
  };
}

// src/lib/routeFinder/routeFinderEngine.ts
//
// Route Finder matching engine.
// Analyzes call book rows against the Listings tab to flag incorrect
// route codes and street names. Runs 5 signals in priority order:
//
//   Signal 1: Phone group match     — same customer has clean data in another year → 🟢 show for confirmation
//   Signal 2: East Listings exact   — street exactly matches assigned route → ✅ green, never shown
//   Signal 3: East Listings fuzzy   — typo on the right route → 🟠 orange
//   Signal 4: Cross-route search    — street found on different route → 🟡 yellow (ranked candidates)
//   Signal 5: Contractor cluster    — same contractor+date colleagues vote on route → upgrades 🔴 → 🟡
//

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type MatchColor = 'phone_group' | 'orange' | 'yellow' | 'red';

export interface CandidateRoute {
  routeCode: string;
  streetName: string;
  matchType: 'exact' | 'fuzzy' | 'cluster' | 'learned';
  similarityScore: number;
  clusterInfo?: string;
  isClusterPrimary: boolean;
}

export interface RouteFinderRow {
  id: string;
  sheetName: string;
  bookingId: string;
  dataIndex: number;       // 0-based index in the sheet's data rows array
  sheetRowNumber: number;  // 1-based actual row in Google Sheet

  // Current values in the call book
  currentRouteCode: string;
  currentStreetName: string;
  city: string;
  houseNum: string;
  contractorName: string;
  serviceDate: string;
  year: number;
  phone: string;

  // Match result
  color: MatchColor;
  suggestedRouteCode: string;
  suggestedStreetName: string;
  candidates: CandidateRoute[]; // ranked, top 3 shown by default

  // Signal flags
  isORSuffix: boolean;       // route ends in OR (e.g. HDPKOR) — suggest PREFIX00 rename
  isMissingRoute: boolean;   // route code completely absent
  clusterSignal: string;     // human-readable: "Dakota Apr 13 — 7/8 rows on ACE01"
  phoneGroupSignal: string;  // human-readable: "Groups with 2023 row: ACE01 / Playfair Ct"

  status: 'pending' | 'fixed' | 'skipped';
}

export interface ListingsData {
  routeMap: Map<string, string[]>;           // routeCode → normalized streets
  routeMapOriginal: Map<string, string[]>;   // routeCode → original streets (for display)
  cityRouteMap: Map<string, string[]>;       // city (lowercase) → routeCodes
  routeToCity: Map<string, string>;          // routeCode → city
}

export interface SheetColumnIndices {
  bookingId: number;
  routeCode: number;
  firstName: number;
  lastName: number;
  houseNum: number;
  streetName: number;
  city: number;
  contractorName: number;
  date: number;
  year: number;
  phone: number;
  areaCode: number;   // separate area code column (sealing sheets)
  headerRowIndex: number;
}

export interface CallBookSheet {
  sheetName: string;
  CI: SheetColumnIndices;
  rows: any[][];
}

export interface LearnedStreets {
  [routeCode: string]: string[]; // routeCode → normalized learned streets
}

export interface LearnedStreetsOriginal {
  [routeCode: string]: string[]; // routeCode → original learned streets (for display)
}

export interface EngineInput {
  listingsData: ListingsData;
  sheets: CallBookSheet[];
  learnedStreets: LearnedStreets;
  learnedStreetsOriginal: LearnedStreetsOriginal;
}

export interface EngineResult {
  queue: RouteFinderRow[];
  totalScanned: number;
  greenCount: number; // rows that were already clean
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const SAME_ROUTE_FUZZY_CUTOFF = 0.52;
const CROSS_ROUTE_FUZZY_CUTOFF = 0.62;
const CLUSTER_MIN_ROWS = 3;
const CLUSTER_MIN_PCT = 0.60;

// ─── STREET NORMALIZATION ─────────────────────────────────────────────────────

const SUFFIX_PATTERN = new RegExp(
  `\\b(street|st|road|rd|avenue|ave|drive|dr|court|ct|crescent|cres|cr|boulevard|blvd|` +
  `lane|ln|place|pl|highway|hwy|circle|cir|way|wy|terrace|ter|terr|trail|tr|grove|gv|` +
  `gardens|gdns|gate|gt|heights|hts|hollow|hlw|loop|lp|mount|mt|park|pk|pass|path|` +
  `point|pt|ridge|run|shore|shores|spur|summit|trace|track|turn|valley|vly|view|` +
  `village|vlg|vista|walk|well|wells|wood|woods|wynd|close|crossing|xing|square|sq|` +
  `parkway|pkwy|key|ky|pine|pines|shoal)\\b`,
  'g'
);

export function normalizeStreetForMatch(s: string): string {
  let t = String(s ?? '').toLowerCase().trim();
  t = t.replace(/(\d+)(st|nd|rd|th)\b/g, '$1');
  t = t.replace(SUFFIX_PATTERN, '');
  t = t.replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
       .replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w');
  return t.replace(/[^a-z0-9]/g, '');
}

// ─── FUZZY MATCHING ───────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

export function stringSimilarity(a: string, b: string): number {
  const na = normalizeStreetForMatch(a);
  const nb = normalizeStreetForMatch(b);
  if (na === nb) return 1.0;
  if (!na || !nb) return 0.0;
  if (na.includes(nb) || nb.includes(na)) return 0.75;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// ─── ROUTE CODE HELPERS ───────────────────────────────────────────────────────

export function getRoutePrefixOnly(routeCode: string): string {
  const m = routeCode.match(/^([a-zA-Z]+)/);
  return m ? m[1].toUpperCase() : '';
}

function getRouteNumericSuffix(routeCode: string): number {
  const m = routeCode.match(/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function detectORSuffix(routeCode: string, routeExistsInListings: boolean): boolean {
  const upper = routeCode.toUpperCase();
  return upper.endsWith('OR') && upper.length > 3 && !routeExistsInListings;
}

export function isZeroRoute(routeCode: string): boolean {
  return /00$/.test(routeCode.toUpperCase());
}

export function suggestZeroRoute(routeCode: string): string {
  const prefix = getRoutePrefixOnly(routeCode);
  return prefix + '00';
}

function routeProximity(assigned: string, candidate: string): number {
  const assignedPrefix = getRoutePrefixOnly(assigned);
  const candidatePrefix = getRoutePrefixOnly(candidate);
  if (assignedPrefix !== candidatePrefix) return 999;
  return Math.abs(getRouteNumericSuffix(assigned) - getRouteNumericSuffix(candidate));
}

// ─── COLUMN RESOLUTION ────────────────────────────────────────────────────────

export function resolveSheetColumns(headers: any[]): Omit<SheetColumnIndices, 'headerRowIndex'> {
  const find = (...names: string[]): number => {
    for (const name of names) {
      const i = headers.findIndex(
        (h: any) => String(h ?? '').trim().toUpperCase() === name.toUpperCase()
      );
      if (i >= 0) return i;
    }
    return -1;
  };

  return {
    bookingId:      find('BOOKING ID', 'BOOKING_ID', 'BOOKINGID'),
    routeCode:      find('ROUTE CODE', 'ROUTE_CODE', 'ROUTECODE', 'RC'),
    firstName:      find('FIRST NAME', 'FIRST_NAME', 'FIRSTNAME', 'FIRST'),
    lastName:       find('LAST NAME', 'LAST_NAME', 'LASTNAME', 'LAST'),
    houseNum:       find('HOUSE #', 'HOUSE#', 'HOUSE_NUM', 'HOUSE NUM', 'PREFIX', 'HOUSE'),
    streetName:     find('STREET NAME', 'STREET_NAME', 'STREETNAME', 'STREET'),
    city:           find('CITY'),
    contractorName: find('CONTRACTOR NAME', 'CONTRACTOR_NAME', 'CONTRACTORNAME', 'CONTRACTOR'),
    date:           find('DATE'),
    year:           find('YEAR'),
    phone:          find('PHONE'),
    areaCode:       find('AREA', 'AC', 'AREA CODE', 'AREA_CODE'),
  };
}

export function findHeaderRow(rawData: any[][]): { headerRowIndex: number; headers: any[] } {
  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    if (rawData[r].some((h: any) => String(h ?? '').trim().toUpperCase() === 'PHONE')) {
      return { headerRowIndex: r, headers: rawData[r] };
    }
  }
  return { headerRowIndex: 0, headers: rawData[0] || [] };
}

// ─── LISTINGS PARSING ─────────────────────────────────────────────────────────

export function parseListingsTab(rawRows: any[][]): ListingsData {
  const routeMap = new Map<string, string[]>();
  const routeMapOriginal = new Map<string, string[]>();
  const cityRouteMap = new Map<string, string[]>();
  const routeToCity = new Map<string, string>();

  if (!rawRows || rawRows.length < 2) {
    return { routeMap, routeMapOriginal, cityRouteMap, routeToCity };
  }

  let headerIdx = 0;
  for (let r = 0; r < Math.min(5, rawRows.length); r++) {
    if (rawRows[r].some((h: any) => String(h ?? '').trim().toUpperCase() === 'RT #')) {
      headerIdx = r;
      break;
    }
  }

  const headers = rawRows[headerIdx];
  const fc = (name: string) =>
    headers.findIndex((h: any) => String(h ?? '').trim().toUpperCase() === name.toUpperCase());

  const rtCol         = fc('RT #');
  const streetListCol = fc('STREET_LIST');
  const cityCol       = fc('CITY');

  if (rtCol < 0 || streetListCol < 0) {
    return { routeMap, routeMapOriginal, cityRouteMap, routeToCity };
  }

  for (let r = headerIdx + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    const routeCode     = String(row[rtCol] ?? '').trim().toUpperCase();
    const streetListRaw = String(row[streetListCol] ?? '').trim();
    const city          = cityCol >= 0 ? String(row[cityCol] ?? '').trim() : '';

    if (!routeCode || !streetListRaw) continue;

    const streets           = streetListRaw.split(',').map(s => s.trim()).filter(Boolean);
    const normalizedStreets = streets.map(normalizeStreetForMatch);

    const existing    = routeMap.get(routeCode) || [];
    const existingOrig = routeMapOriginal.get(routeCode) || [];
    routeMap.set(routeCode, [...existing, ...normalizedStreets]);
    routeMapOriginal.set(routeCode, [...existingOrig, ...streets]);

    if (city) {
      const cityKey = city.toLowerCase();
      routeToCity.set(routeCode, city);
      if (!cityRouteMap.has(cityKey)) cityRouteMap.set(cityKey, []);
      if (!cityRouteMap.get(cityKey)!.includes(routeCode)) {
        cityRouteMap.get(cityKey)!.push(routeCode);
      }
    }
  }

  return { routeMap, routeMapOriginal, cityRouteMap, routeToCity };
}

// ─── CITY INFERENCE ───────────────────────────────────────────────────────────

const SHEET_CITY_HINTS: Array<{ key: string; cities: string[] }> = [
  { key: 'hamilton towns', cities: ['hamilton'] },
  { key: 'hamilton',       cities: ['hamilton'] },
  { key: 'kitchenerwaterloo', cities: ['kitchener', 'waterloo'] },
  { key: 'hamst',          cities: ['hamilton', 'st. catharines'] },
  { key: 'burlington',     cities: ['burlington'] },
  { key: 'oakvillemilton', cities: ['oakville', 'milton'] },
  { key: 'niagara',        cities: ['niagara falls', 'niagara-on-the-lake', 'welland', 'thorold'] },
  { key: 'cambridgeguelph', cities: ['cambridge', 'guelph'] },
];

function inferCitiesFromSheetName(sheetName: string): string[] {
  const lower = sheetName.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim();
  for (const hint of SHEET_CITY_HINTS) {
    if (lower.includes(hint.key) || hint.key.includes(lower)) return hint.cities;
  }
  return [lower];
}

// ─── PHONE NORMALIZATION ──────────────────────────────────────────────────────

function normalizePhone(raw: any): string {
  let s = String(raw ?? '').trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const d = s.replace(/\D/g, '');
  const t = d.length > 10 ? d.slice(-10) : d;
  return t.length === 10 ? t : '';
}

// ─── PHONE GROUP BUILDING ─────────────────────────────────────────────────────

function buildPhoneGroups(rows: any[][], CI: SheetColumnIndices): Map<string, number[]> {
  const n = rows.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  if (CI.phone >= 0) {
    const phoneMap = new Map<string, number>();
    for (let r = 0; r < n; r++) {
      const phone = normalizePhone(rows[r][CI.phone]);
      if (!phone) continue;
      if (phoneMap.has(phone)) union(phoneMap.get(phone)!, r);
      else phoneMap.set(phone, r);
    }
  }

  const phoneToGroup = new Map<string, number[]>();
  const rootToMembers = new Map<number, number[]>();

  for (let r = 0; r < n; r++) {
    const phone = CI.phone >= 0 ? normalizePhone(rows[r][CI.phone]) : '';
    if (!phone) continue;
    const root = find(r);
    if (!rootToMembers.has(root)) rootToMembers.set(root, []);
    rootToMembers.get(root)!.push(r);
  }

  for (const [root, members] of rootToMembers) {
    for (const r of members) {
      const phone = normalizePhone(rows[r][CI.phone]);
      if (phone) phoneToGroup.set(phone, members);
    }
  }

  return phoneToGroup;
}

// ─── CONTRACTOR-DATE CLUSTER BUILDING ────────────────────────────────────────

interface ClusterEntry {
  contractor: string;
  date: string;
  totalRows: number;
  routeVotes: Map<string, number>;
  dominantRoute: string;
  dominantCount: number;
  dominantPct: number;
  displayDate: string;
}

function buildContractorClusters(
  rows: any[][],
  CI: SheetColumnIndices,
  listingsData: ListingsData
): Map<string, ClusterEntry> {
  const clusters = new Map<string, ClusterEntry>();

  for (const row of rows) {
    if (!row || !row[0]) continue;
    const contractor = CI.contractorName >= 0 ? String(row[CI.contractorName] ?? '').trim() : '';
    const date       = CI.date >= 0 ? String(row[CI.date] ?? '').trim() : '';
    const routeCode  = CI.routeCode >= 0 ? String(row[CI.routeCode] ?? '').trim().toUpperCase() : '';

    if (!contractor || !date || !routeCode) continue;

    const effectiveRoute = detectORSuffix(routeCode, listingsData.routeMap.has(routeCode))
      ? routeCode.toUpperCase().slice(0, -2)
      : routeCode;

    if (!listingsData.routeMap.has(effectiveRoute)) continue;

    const key = `${contractor.toLowerCase()}|${date}`;
    if (!clusters.has(key)) {
      const displayDate = date.length > 10 ? date.slice(0, 10) : date;
      clusters.set(key, {
        contractor, date, displayDate,
        totalRows: 0,
        routeVotes: new Map(),
        dominantRoute: '', dominantCount: 0, dominantPct: 0,
      });
    }

    const entry = clusters.get(key)!;
    entry.totalRows++;
    entry.routeVotes.set(routeCode, (entry.routeVotes.get(routeCode) || 0) + 1);
  }

  for (const entry of clusters.values()) {
    let max = 0, dominant = '';
    for (const [route, count] of entry.routeVotes) {
      if (count > max) { max = count; dominant = route; }
    }
    entry.dominantRoute  = dominant;
    entry.dominantCount  = max;
    entry.dominantPct    = entry.totalRows > 0 ? max / entry.totalRows : 0;
  }

  return clusters;
}

// ─── CITY-SCOPED ROUTES ───────────────────────────────────────────────────────

function getCityScopedRoutes(
  city: string,
  sheetName: string,
  listingsData: ListingsData
): string[] {
  const cityKey = city.trim().toLowerCase();

  if (cityKey && listingsData.cityRouteMap.has(cityKey)) {
    return listingsData.cityRouteMap.get(cityKey)!;
  }

  const inferredCities = inferCitiesFromSheetName(sheetName);
  const routes: string[] = [];
  for (const c of inferredCities) {
    const r = listingsData.cityRouteMap.get(c.toLowerCase());
    if (r) routes.push(...r);
  }
  return [...new Set(routes)];
}

// ─── STREET EXACT / FUZZY CHECK ──────────────────────────────────────────────

function streetExactMatch(
  normalizedStreet: string,
  routeCode: string,
  listingsData: ListingsData,
  learnedStreets: LearnedStreets
): boolean {
  const rc = routeCode.toUpperCase();
  const listingsStreets = listingsData.routeMap.get(rc) || [];
  if (listingsStreets.includes(normalizedStreet)) return true;
  const learned = learnedStreets[rc] || [];
  return learned.includes(normalizedStreet);
}

function streetBestFuzzy(
  normalizedStreet: string,
  routeCode: string,
  listingsData: ListingsData,
  learnedStreets: LearnedStreets,
  cutoff: number
): { score: number; originalStreet: string } | null {
  const rc = routeCode.toUpperCase();
  const normalized  = listingsData.routeMap.get(rc) || [];
  const originals   = listingsData.routeMapOriginal.get(rc) || [];
  const learnedNorm = learnedStreets[rc] || [];

  let bestScore = 0;
  let bestOriginal = '';

  for (let i = 0; i < normalized.length; i++) {
    const score = stringSimilarity(normalizedStreet, normalized[i]);
    if (score > bestScore) {
      bestScore    = score;
      bestOriginal = originals[i] || normalized[i];
    }
  }
  for (const ls of learnedNorm) {
    const score = stringSimilarity(normalizedStreet, ls);
    if (score > bestScore) { bestScore = score; bestOriginal = ls; }
  }

  return bestScore >= cutoff ? { score: bestScore, originalStreet: bestOriginal } : null;
}

// ─── ROW MATCHER ─────────────────────────────────────────────────────────────

function matchRow(
  row: any[],
  dataIndex: number,
  CI: SheetColumnIndices,
  sheetName: string,
  phoneGroups: Map<string, number[]>,
  allRows: any[][],
  clusters: Map<string, ClusterEntry>,
  listingsData: ListingsData,
  learnedStreets: LearnedStreets,
  learnedStreetsOriginal: LearnedStreetsOriginal
): RouteFinderRow | null {
  const bookingId      = CI.bookingId >= 0     ? String(row[CI.bookingId] ?? '').trim()      : `row_${dataIndex}`;
  const rawRouteCode   = CI.routeCode >= 0     ? String(row[CI.routeCode] ?? '').trim()      : '';
  const streetName     = CI.streetName >= 0    ? String(row[CI.streetName] ?? '').trim()     : '';
  const city           = CI.city >= 0          ? String(row[CI.city] ?? '').trim()           : '';
  const houseNum       = CI.houseNum >= 0      ? String(row[CI.houseNum] ?? '').trim()       : '';
  const contractorName = CI.contractorName >= 0 ? String(row[CI.contractorName] ?? '').trim() : '';
  const serviceDate    = CI.date >= 0          ? String(row[CI.date] ?? '').trim()           : '';
  const year           = CI.year >= 0          ? (parseInt(String(row[CI.year] ?? ''), 10) || 0) : 0;
  const phone          = CI.phone >= 0         ? normalizePhone(row[CI.phone])               : '';

  if (!bookingId) return null;
  if (!rawRouteCode && !streetName) return null;

  const routeCode        = rawRouteCode.toUpperCase();
  const normalizedStreet = normalizeStreetForMatch(streetName);
  const sheetRowNumber   = dataIndex + CI.headerRowIndex + 2;
  const id               = `${sheetName}:${bookingId}`;

  const routeInListings = listingsData.routeMap.has(routeCode);
  const isOR   = detectORSuffix(routeCode, routeInListings);
  const isZero = isZeroRoute(routeCode);
  const effectiveRoute = isOR ? routeCode.slice(0, -2) : routeCode;

  // ── Signal 1: Phone group match ──────────────────────────────────────────────
  let phoneGroupSignal = '';
  if (phone && phoneGroups.has(phone)) {
    const members = phoneGroups.get(phone)!;
    for (const memberIdx of members) {
      if (memberIdx === dataIndex) continue;
      const mRow    = allRows[memberIdx];
      const mRoute  = CI.routeCode >= 0 ? String(mRow[CI.routeCode] ?? '').trim().toUpperCase() : '';
      const mStreet = CI.streetName >= 0 ? String(mRow[CI.streetName] ?? '').trim() : '';
      if (!mRoute || !mStreet) continue;

      const mNorm      = normalizeStreetForMatch(mStreet);
      const mEffective = detectORSuffix(mRoute, listingsData.routeMap.has(mRoute))
        ? mRoute.slice(0, -2) : mRoute;

      const memberClean   = streetExactMatch(mNorm, mEffective, listingsData, learnedStreets);
      const memberDiffers = mRoute !== routeCode || mStreet !== streetName;

      if (memberClean && memberDiffers) {
        const mYear = CI.year >= 0 ? (parseInt(String(mRow[CI.year] ?? ''), 10) || 0) : 0;
        phoneGroupSignal = `Groups with ${mYear || 'prior'} row: ${mRoute} / ${mStreet}`;

        return {
          id, sheetName, bookingId, dataIndex, sheetRowNumber,
          currentRouteCode: rawRouteCode, currentStreetName: streetName,
          city, houseNum, contractorName, serviceDate, year, phone,
          color: 'phone_group',
          suggestedRouteCode: mRoute,
          suggestedStreetName: mStreet,
          candidates: [{
            routeCode: mRoute, streetName: mStreet,
            matchType: 'exact', similarityScore: 1.0, isClusterPrimary: false,
          }],
          isORSuffix: isOR, isMissingRoute: false,
          clusterSignal: '', phoneGroupSignal,
          status: 'pending',
        };
      }
    }
  }

  // ── Signal 2: Exact match on assigned route (green — skip) ───────────────────
  if (!isOR && routeInListings) {
    if (streetExactMatch(normalizedStreet, routeCode, listingsData, learnedStreets)) {
      return null;
    }
  }

  if (isZero) {
    const basePrefix = getRoutePrefixOnly(routeCode);
    const baseRoutes = [...listingsData.routeMap.keys()].filter(
      r => r.startsWith(basePrefix) && !isZeroRoute(r) && !r.endsWith('OR')
    );
    for (const br of baseRoutes) {
      if (streetExactMatch(normalizedStreet, br, listingsData, learnedStreets)) {
        return null;
      }
    }
  }

  const scopedRoutes = getCityScopedRoutes(city, sheetName, listingsData);

  let clusterSignal = '';
  let clusterDominantRoute = '';
  const clusterKey = `${contractorName.toLowerCase()}|${serviceDate}`;
  const cluster = clusters.get(clusterKey);
  if (cluster && cluster.totalRows >= CLUSTER_MIN_ROWS && cluster.dominantPct >= CLUSTER_MIN_PCT) {
    clusterSignal = `${cluster.contractor} ${cluster.displayDate} — ${cluster.dominantCount}/${cluster.totalRows} on ${cluster.dominantRoute}`;
    clusterDominantRoute = cluster.dominantRoute;
  }

  // ── Signal 3: Fuzzy match on assigned route (Orange) ─────────────────────────
  if (routeInListings || (isZero && !isOR)) {
    const checkRoute = isZero ? effectiveRoute + '01' : effectiveRoute;
    const actualCheckRoute = listingsData.routeMap.has(effectiveRoute) ? effectiveRoute : checkRoute;
    if (listingsData.routeMap.has(actualCheckRoute)) {
      const fuzzy = streetBestFuzzy(normalizedStreet, actualCheckRoute, listingsData, learnedStreets, SAME_ROUTE_FUZZY_CUTOFF);
      if (fuzzy) {
        const suggestedRoute = isOR ? suggestZeroRoute(routeCode) : rawRouteCode;
        return {
          id, sheetName, bookingId, dataIndex, sheetRowNumber,
          currentRouteCode: rawRouteCode, currentStreetName: streetName,
          city, houseNum, contractorName, serviceDate, year, phone,
          color: 'orange',
          suggestedRouteCode: suggestedRoute,
          suggestedStreetName: fuzzy.originalStreet,
          candidates: [{
            routeCode: suggestedRoute, streetName: fuzzy.originalStreet,
            matchType: 'fuzzy', similarityScore: fuzzy.score,
            clusterInfo: clusterSignal, isClusterPrimary: false,
          }],
          isORSuffix: isOR, isMissingRoute: false,
          clusterSignal, phoneGroupSignal,
          status: 'pending',
        };
      }
    }
  }

  // ── Signals 3+4: Cross-route search → Yellow ─────────────────────────────────
  const candidates: CandidateRoute[] = [];

  for (const candidateRoute of scopedRoutes) {
    if (candidateRoute === effectiveRoute || candidateRoute === routeCode) continue;

    if (streetExactMatch(normalizedStreet, candidateRoute, listingsData, learnedStreets)) {
      const origStreets  = listingsData.routeMapOriginal.get(candidateRoute) || [];
      const normStreets  = listingsData.routeMap.get(candidateRoute) || [];
      const idx          = normStreets.indexOf(normalizedStreet);
      const originalStreet = idx >= 0 ? origStreets[idx] : streetName;

      candidates.push({
        routeCode: candidateRoute, streetName: originalStreet,
        matchType: 'exact', similarityScore: 1.0,
        isClusterPrimary: clusterDominantRoute === candidateRoute,
        clusterInfo: clusterDominantRoute === candidateRoute ? clusterSignal : undefined,
      });
    } else {
      const fuzzy = streetBestFuzzy(normalizedStreet, candidateRoute, listingsData, learnedStreets, CROSS_ROUTE_FUZZY_CUTOFF);
      if (fuzzy) {
        candidates.push({
          routeCode: candidateRoute, streetName: fuzzy.originalStreet,
          matchType: 'fuzzy', similarityScore: fuzzy.score,
          isClusterPrimary: clusterDominantRoute === candidateRoute,
          clusterInfo: clusterDominantRoute === candidateRoute ? clusterSignal : undefined,
        });
      }
    }
  }

  if (isOR && candidates.length === 0) {
    candidates.push({
      routeCode: suggestZeroRoute(routeCode), streetName: streetName,
      matchType: 'exact', similarityScore: 0.9, isClusterPrimary: false,
    });
  }

  if (candidates.length === 0) {
    if (cluster && cluster.totalRows >= CLUSTER_MIN_ROWS && cluster.dominantPct >= CLUSTER_MIN_PCT) {
      candidates.push({
        routeCode: cluster.dominantRoute, streetName: streetName,
        matchType: 'cluster', similarityScore: cluster.dominantPct,
        clusterInfo: clusterSignal, isClusterPrimary: true,
      });
      return mkYellow(id, sheetName, bookingId, dataIndex, sheetRowNumber, rawRouteCode, streetName, city, houseNum, contractorName, serviceDate, year, phone, candidates, isOR, clusterSignal, phoneGroupSignal);
    }

    return {
      id, sheetName, bookingId, dataIndex, sheetRowNumber,
      currentRouteCode: rawRouteCode, currentStreetName: streetName,
      city, houseNum, contractorName, serviceDate, year, phone,
      color: 'red',
      suggestedRouteCode: isOR ? suggestZeroRoute(routeCode) : rawRouteCode,
      suggestedStreetName: streetName,
      candidates: [],
      isORSuffix: isOR, isMissingRoute: !rawRouteCode,
      clusterSignal, phoneGroupSignal,
      status: 'pending',
    };
  }

  candidates.sort((a, b) => {
    if (a.isClusterPrimary !== b.isClusterPrimary) return a.isClusterPrimary ? -1 : 1;
    const typeOrder = { exact: 0, fuzzy: 1, cluster: 2, learned: 3 };
    const tDiff = (typeOrder[a.matchType] ?? 2) - (typeOrder[b.matchType] ?? 2);
    if (tDiff !== 0) return tDiff;
    return routeProximity(effectiveRoute, a.routeCode) - routeProximity(effectiveRoute, b.routeCode);
  });

  return mkYellow(id, sheetName, bookingId, dataIndex, sheetRowNumber, rawRouteCode, streetName, city, houseNum, contractorName, serviceDate, year, phone, candidates, isOR, clusterSignal, phoneGroupSignal);
}

function mkYellow(
  id: string, sheetName: string, bookingId: string, dataIndex: number, sheetRowNumber: number,
  rawRouteCode: string, streetName: string, city: string, houseNum: string,
  contractorName: string, serviceDate: string, year: number, phone: string,
  candidates: CandidateRoute[], isOR: boolean, clusterSignal: string, phoneGroupSignal: string
): RouteFinderRow {
  return {
    id, sheetName, bookingId, dataIndex, sheetRowNumber,
    currentRouteCode: rawRouteCode, currentStreetName: streetName,
    city, houseNum, contractorName, serviceDate, year, phone,
    color: 'yellow',
    suggestedRouteCode: candidates[0]?.routeCode || rawRouteCode,
    suggestedStreetName: candidates[0]?.streetName || streetName,
    candidates,
    isORSuffix: isOR, isMissingRoute: false,
    clusterSignal, phoneGroupSignal,
    status: 'pending',
  };
}

// ─── MAIN ENGINE ─────────────────────────────────────────────────────────────

export function runMatchEngine(input: EngineInput): EngineResult {
  const { listingsData, sheets, learnedStreets, learnedStreetsOriginal } = input;
  const queue: RouteFinderRow[] = [];
  let totalScanned = 0;
  let greenCount = 0;

  for (const sheet of sheets) {
    const { sheetName, CI, rows } = sheet;
    if (!rows || rows.length === 0) continue;

    const phoneGroups = buildPhoneGroups(rows, CI);
    const clusters    = buildContractorClusters(rows, CI, listingsData);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;

      const bookingId = CI.bookingId >= 0 ? String(row[CI.bookingId] ?? '').trim() : '';
      if (!bookingId) continue;

      totalScanned++;

      const result = matchRow(
        row, i, CI, sheetName,
        phoneGroups, rows, clusters,
        listingsData, learnedStreets, learnedStreetsOriginal
      );

      if (result === null) greenCount++;
      else queue.push(result);
    }
  }

  return { queue, totalScanned, greenCount };
}

// ─── ASYNC PER-SHEET ENGINE ───────────────────────────────────────────────────

export async function runMatchEngineForSheet(
  params: {
    sheet: CallBookSheet;
    listingsData: ListingsData;
    learnedStreets: LearnedStreets;
    learnedStreetsOriginal: LearnedStreetsOriginal;
  },
  onRowProgress?: (pct: number) => void
): Promise<{ rows: RouteFinderRow[]; scanned: number }> {
  const { sheet, listingsData, learnedStreets, learnedStreetsOriginal } = params;
  const { sheetName, CI, rows } = sheet;
  if (!rows || rows.length === 0) return { rows: [], scanned: 0 };

  const phoneGroups = buildPhoneGroups(rows, CI);
  const clusters    = buildContractorClusters(rows, CI, listingsData);
  const results: RouteFinderRow[] = [];
  let scanned = 0;

  for (let i = 0; i < rows.length; i++) {
    if (i % 50 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      onRowProgress?.(rows.length > 0 ? i / rows.length : 1);
    }

    const row = rows[i];
    if (!row || !row[0]) continue;
    const bookingId = CI.bookingId >= 0 ? String(row[CI.bookingId] ?? '').trim() : '';
    if (!bookingId) continue;

    scanned++;
    const result = matchRow(
      row, i, CI, sheetName,
      phoneGroups, rows, clusters,
      listingsData, learnedStreets, learnedStreetsOriginal
    );
    if (result !== null) results.push(result);
  }

  return { rows: results, scanned };
}

// ─── CASCADE CHECK ────────────────────────────────────────────────────────────

export function cascadeCheck(
  fixedRouteCode: string,
  fixedStreetName: string,
  pendingRows: RouteFinderRow[],
  listingsData: ListingsData,
  learnedStreets: LearnedStreets
): string[] {
  const resolvedIds: string[] = [];
  const normalizedFixed = normalizeStreetForMatch(fixedStreetName);
  const fixedRC = fixedRouteCode.toUpperCase();

  for (const row of pendingRows) {
    if (row.status !== 'pending') continue;

    const rowNorm  = normalizeStreetForMatch(row.currentStreetName);
    const rowRoute = row.currentRouteCode.toUpperCase();

    if (rowNorm === normalizedFixed && rowRoute === fixedRC) {
      resolvedIds.push(row.id);
      continue;
    }

    if (streetExactMatch(rowNorm, rowRoute, listingsData, learnedStreets)) {
      resolvedIds.push(row.id);
    }
  }

  return resolvedIds;
}
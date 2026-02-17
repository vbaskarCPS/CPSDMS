// src/lib/dialer/dialerStateBuilder.ts
//
// Build the full dialer state object from a resolved group.
// Ported from Dialer.gs: dialerBuildState_, dialerCountAer_.
//

import { ColumnIndices } from './dialerHeaders';
import { normalizePhone, normalizeStreet, parseYear, buildStreetKey } from './dialerUtils';

// --- Types ---

export interface ServiceHistoryRow {
  year: number;
  price: string;
  contractor: string;
  bookingId: string;
  fo: string;        // 'FO' | 'BO' | 'FP'
  pmtType: string;
  rowPhone: string;
}

export interface NearbyAER {
  name: string;
  house: string;
}

export interface ClientInfo {
  firstName: string;
  lastName: string;
  houseNum: string;
  streetName: string;
  city: string;
  routeCode: string;
  allNames: string[];
  email: string;
}

export type PhoneStrategy = 'single' | 'dominant' | 'even';

export interface DialerState {
  found: true;
  sheetName: string;
  firstRow: number;
  /** 1-based sheet row numbers for all rows in this group */
  rows: number[];
  /** 0-based data indices for all rows in this group */
  dataIndices: number[];
  groupKey: string;
  phone: string;
  allPhones: string[];
  phoneStrategy: PhoneStrategy;
  alternatePhone: string;
  currentNA: number;
  currentFO: string;      // 'FO' | 'BO' | 'FP'
  previousPrice: string;
  streetKey: string;
  streetAerCount: number;
  mostRecentYear: number;
  nearbyAER: NearbyAER[];
  currentGroupIndex: number;
  totalGroups: number;
  client: ClientInfo;
  serviceHistory: ServiceHistoryRow[];
}

export interface DialerStateNotFound {
  found: false;
  message: string;
}

export type DialerStateResult = DialerState | DialerStateNotFound;

// --- Interpret FO column ---

function interpretFO(rawFO: string): string {
  const upper = rawFO.toUpperCase();
  if (upper === 'X') return 'FO';
  if (upper === 'BO') return 'BO';
  return 'FP';
}

// --- AER counting ---

export function countStreetAER(all: any[][], CI: ColumnIndices, streetKey: string): number {
  if (CI.AER < 0 || CI.STREET < 0) return 0;
  let count = 0;
  for (let r = 0; r < all.length; r++) {
    const s = String(all[r][CI.STREET] ?? '').trim();
    const rc = CI.ROUTE_CODE >= 0 ? String(all[r][CI.ROUTE_CODE] ?? '').trim() : '';
    const key = buildStreetKey(rc, s);
    if (key !== streetKey) continue;
    const aer = String(all[r][CI.AER] ?? '').trim().toUpperCase();
    if (aer === 'X' || aer === 'AER' || aer === 'YES' || aer === 'Y') count++;
  }
  return count;
}

// --- Build State ---

/**
 * Build the full DialerState from a resolved group.
 *
 * @param groupDataIndices  0-based data indices of rows in the group
 * @param all               Full data array (no header row)
 * @param CI                Resolved column indices
 * @param sheetName         Name of the sheet/tab
 * @param currentGroupIndex 1-based index in the full group list
 * @param totalGroups       Total number of groups
 * @param dataStartRow      1-based sheet row of the first data row (typically 2)
 */
export function buildState(
  groupDataIndices: number[],
  all: any[][],
  CI: ColumnIndices,
  sheetName: string,
  currentGroupIndex: number,
  totalGroups: number,
  dataStartRow: number
): DialerState {
  const primaryIdx = groupDataIndices[0];

  // --- Collect phones, names, WN status ---
  const phones: string[] = [];
  const names: string[] = [];
  const seenPhones = new Set<string>();
  const wnPhones = new Set<string>();

  for (const r of groupDataIndices) {
    const phone = normalizePhone(String(all[r][CI.PHONE] ?? ''));
    if (phone && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      phones.push(phone);
    }

    // Track WN'd phones
    const wnVal = CI.WN >= 0 ? String(all[r][CI.WN] ?? '').trim() : '';
    if (wnVal !== '' && phone) wnPhones.add(phone);

    const fn = CI.FIRST_NAME >= 0 ? String(all[r][CI.FIRST_NAME] ?? '').trim() : '';
    const ln = CI.LAST_NAME >= 0 ? String(all[r][CI.LAST_NAME] ?? '').trim() : '';
    const fullName = (fn + ' ' + ln).trim();
    if (fullName && !names.includes(fullName)) names.push(fullName);
  }

  // --- Determine primary phone (prefer non-WN) ---
  const nonWnPhones = phones.filter((p) => !wnPhones.has(p));
  const dialablePhones = nonWnPhones.length > 0 ? nonWnPhones : phones;

  let primaryPhone = dialablePhones[0] ?? '';
  let phoneStrategy: PhoneStrategy = 'single';
  let alternatePhone = '';

  if (dialablePhones.length >= 2) {
    // Count rows per phone (non-WN only)
    const phoneCounts: Record<string, number> = {};
    for (const r of groupDataIndices) {
      const p = normalizePhone(String(all[r][CI.PHONE] ?? ''));
      if (p && !wnPhones.has(p)) {
        phoneCounts[p] = (phoneCounts[p] || 0) + 1;
      }
    }
    const sorted = Object.keys(phoneCounts).sort((a, b) => phoneCounts[b] - phoneCounts[a]);
    primaryPhone = sorted[0] ?? dialablePhones[0];
    alternatePhone = sorted[1] ?? '';
    phoneStrategy = sorted.length >= 2 && phoneCounts[sorted[0]] > phoneCounts[sorted[1]]
      ? 'dominant'
      : 'even';
  }

  // --- Service history ---
  const historyRows: ServiceHistoryRow[] = [];
  if (CI.YEAR >= 0) {
    for (const r of groupDataIndices) {
      const yr = parseYear(all[r][CI.YEAR]);
      if (yr === 0) continue;
      historyRows.push({
        year: yr,
        price: CI.PRICE >= 0 ? String(all[r][CI.PRICE] ?? '').trim() : '',
        contractor: CI.CONTRACTOR >= 0 ? String(all[r][CI.CONTRACTOR] ?? '').trim() : '',
        bookingId: CI.BOOKING_ID >= 0 ? String(all[r][CI.BOOKING_ID] ?? '').trim() : '',
        fo: interpretFO(CI.FO >= 0 ? String(all[r][CI.FO] ?? '').trim() : ''),
        pmtType: CI.PMT_TYPE >= 0 ? String(all[r][CI.PMT_TYPE] ?? '').trim() : '',
        rowPhone: normalizePhone(String(all[r][CI.PHONE] ?? '')),
      });
    }
    historyRows.sort((a, b) => b.year - a.year);
  }

  // Fallback: use service year columns if no YEAR column history
  if (historyRows.length === 0 && CI.SERVICE_YEARS.length > 0) {
    for (const yearInfo of CI.SERVICE_YEARS) {
      for (const r of groupDataIndices) {
        const v = String(all[r][yearInfo.col] ?? '').trim();
        if (v && v !== '0') {
          historyRows.push({
            year: yearInfo.year,
            price: v,
            contractor: '',
            bookingId: '',
            fo: '',
            pmtType: '',
            rowPhone: normalizePhone(String(all[r][CI.PHONE] ?? '')),
          });
        }
      }
    }
  }

  // --- Most recent year ---
  let mostRecentYear = 0;
  if (CI.YEAR >= 0) {
    for (const r of groupDataIndices) {
      const yr = parseYear(all[r][CI.YEAR]);
      if (yr > mostRecentYear) mostRecentYear = yr;
    }
  }
  if (mostRecentYear === 0) {
    for (const yearInfo of CI.SERVICE_YEARS) {
      for (const r of groupDataIndices) {
        const v = String(all[r][yearInfo.col] ?? '').trim();
        if (v && v !== '0') {
          if (yearInfo.year > mostRecentYear) mostRecentYear = yearInfo.year;
          break;
        }
      }
    }
  }

  // --- Street info ---
  const street = CI.STREET >= 0 ? String(all[primaryIdx][CI.STREET] ?? '').trim() : '';
  const houseNum = CI.PREFIX >= 0 ? String(all[primaryIdx][CI.PREFIX] ?? '').trim() : '';
  const routeCode = CI.ROUTE_CODE >= 0 ? String(all[primaryIdx][CI.ROUTE_CODE] ?? '').trim() : '';
  const streetKey = buildStreetKey(routeCode, street);
  const streetAerCount = countStreetAER(all, CI, streetKey);

  // --- Nearby AER ---
  const nearbyAER: NearbyAER[] = [];
  if (CI.AER >= 0 && CI.STREET >= 0) {
    for (let r = 0; r < all.length; r++) {
      const s = String(all[r][CI.STREET] ?? '').trim();
      const rc = CI.ROUTE_CODE >= 0 ? String(all[r][CI.ROUTE_CODE] ?? '').trim() : '';
      const key = buildStreetKey(rc, s);
      if (key !== streetKey) continue;
      const aer = String(all[r][CI.AER] ?? '').trim().toUpperCase();
      if (aer === 'X' || aer === 'AER' || aer === 'YES' || aer === 'Y') {
        const fn2 = CI.FIRST_NAME >= 0 ? String(all[r][CI.FIRST_NAME] ?? '').trim() : '';
        const ln2 = CI.LAST_NAME >= 0 ? String(all[r][CI.LAST_NAME] ?? '').trim() : '';
        const hse = CI.PREFIX >= 0 ? String(all[r][CI.PREFIX] ?? '').trim() : '';
        nearbyAER.push({ name: (fn2 + ' ' + ln2).trim(), house: hse });
      }
    }
  }

  // --- Client info ---
  const firstName = CI.FIRST_NAME >= 0 ? String(all[primaryIdx][CI.FIRST_NAME] ?? '').trim() : '';
  const lastName = CI.LAST_NAME >= 0 ? String(all[primaryIdx][CI.LAST_NAME] ?? '').trim() : '';
  const city = CI.CITY >= 0 ? String(all[primaryIdx][CI.CITY] ?? '').trim() : '';

  let email = '';
  if (CI.EMAIL >= 0) {
    for (const r of groupDataIndices) {
      const em = String(all[r][CI.EMAIL] ?? '').trim();
      if (em) { email = em; break; }
    }
  }

  const naValue = CI.NA >= 0 ? parseInt(String(all[primaryIdx][CI.NA] ?? '0'), 10) || 0 : 0;

  let price = CI.PRICE >= 0 ? String(all[primaryIdx][CI.PRICE] ?? '').trim() : '';
  if (!price && historyRows.length > 0) price = historyRows[0].price || '';

  const bookingId = CI.BOOKING_ID >= 0 ? String(all[primaryIdx][CI.BOOKING_ID] ?? '').trim() : '';

  const rawCurrentFO = CI.FO >= 0 ? String(all[primaryIdx][CI.FO] ?? '').trim() : '';

  // Convert data indices to 1-based sheet rows
  const sheetRows = groupDataIndices.map((r) => r + dataStartRow);
  const groupKey = sheetName + ':' + (groupDataIndices[0] + dataStartRow);

  return {
    found: true,
    sheetName,
    firstRow: groupDataIndices[0] + dataStartRow,
    rows: sheetRows,
    dataIndices: groupDataIndices,
    groupKey,
    phone: primaryPhone,
    allPhones: phones,
    phoneStrategy,
    alternatePhone,
    currentNA: naValue,
    currentFO: interpretFO(rawCurrentFO),
    previousPrice: price,
    streetKey,
    streetAerCount,
    mostRecentYear,
    nearbyAER,
    currentGroupIndex,
    totalGroups,
    client: {
      firstName,
      lastName,
      houseNum,
      streetName: street,
      city,
      routeCode,
      allNames: names,
      email,
    },
    serviceHistory: historyRows,
  };
}
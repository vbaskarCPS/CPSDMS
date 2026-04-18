// src/lib/workerbookCalendarService.ts
//
// Loads the workerbook's dated tabs (e.g. Mar19, Apr16, May23) and counts
// how many contractors are "booked" on each day, using the same rule as
// the workbook's Calendar tab formula:
//
//   Booked = rows where column B (CN#) is non-empty AND column L is not "To:*" AND column L is not "NS"
//   Rookies = booked rows where column O (Days) is 0
//
// Uses a single batchGet API call to fetch ALL tabs at once — avoids the
// Google Sheets 300-reads-per-minute quota limit that killed the old
// sequential approach.

import { dialerSheetsService } from './dialerSheetsService';

const DATED_TAB_RE = /^[A-Z][a-z]{2}\d{2}$/;
const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface DayCount {
  tabName: string;      // "Apr16"
  dayOfMonth: number;   // 16
  booked: number;       // count of booked contractors
  rookies: number;      // count of booked rookies (days=0)
}

export interface MonthGroup {
  monthIndex: number;   // 0-11
  year: number;         // e.g. 2026
  monthName: string;    // "April"
  days: DayCount[];     // sorted by dayOfMonth
}

export interface CalendarProgress {
  loaded: number;
  total: number;
  currentTab: string;
}

/**
 * Get all dated tabs from the workbook, sorted chronologically.
 */
export async function getDatedTabs(spreadsheetId: string): Promise<string[]> {
  const tabs = await dialerSheetsService.getSheetTabs(spreadsheetId);
  const dated = tabs
    .map(t => t.title)
    .filter(t => DATED_TAB_RE.test(t));

  // Sort chronologically (month index, then day)
  dated.sort((a, b) => {
    const aMonth = MONTH_MAP[a.slice(0, 3)] ?? 99;
    const bMonth = MONTH_MAP[b.slice(0, 3)] ?? 99;
    if (aMonth !== bMonth) return aMonth - bMonth;
    return parseInt(a.slice(3), 10) - parseInt(b.slice(3), 10);
  });

  return dated;
}

/**
 * Count "booked" contractors on a tab.
 * A row counts if column B has a CN#, AND column L is NOT "To:*" AND column L is NOT "NS".
 * Rookies are counted separately (days=0 in column O).
 */
function countBookedFromRows(rows: any[][]): { booked: number; rookies: number } {
  let booked = 0;
  let rookies = 0;

  for (const row of rows) {
    if (!row) continue;
    const cn = String(row[1] ?? '').trim();   // Col B
    if (!cn) continue;

    const nextDay = String(row[11] ?? '').trim(); // Col L
    // Skip rows that are already moved (start with "To:") or are NS'd
    if (nextDay.toLowerCase().startsWith('to:')) continue;
    if (nextDay === 'NS') continue;

    booked++;

    // Column O = Days Worked (index 14). Zero = rookie.
    const days = parseInt(String(row[14] ?? '0'), 10);
    if (!isNaN(days) && days === 0) rookies++;
  }

  return { booked, rookies };
}

/**
 * Load booking counts for ALL dated tabs in ONE API call (batchGet).
 *
 * Progress callback fires once at 0% and once at 100% — since we do a
 * single batched call, there's no intermediate progress to report.
 *
 * Returns a Map keyed by tab name (e.g. "Apr16") -> DayCount.
 */
export async function loadAllDayCounts(
  spreadsheetId: string,
  tabNames: string[],
  onProgress?: (p: CalendarProgress) => void,
): Promise<Map<string, DayCount>> {
  const counts = new Map<string, DayCount>();
  if (tabNames.length === 0) return counts;

  // Start progress
  if (onProgress) {
    onProgress({ loaded: 0, total: tabNames.length, currentTab: 'Fetching all tabs...' });
  }

  // Build ranges — we only need columns B, L, O so fetch A3:O200 (as before)
  const ranges = tabNames.map(tab => "'" + tab + "'!A3:O200");

  let allRows: any[][][] = [];
  try {
    allRows = await dialerSheetsService.sheetsBatchGet(spreadsheetId, ranges);
  } catch (err) {
    // If the batched call fails for any reason, return zero counts for all
    // tabs rather than crashing the whole calendar. The refresh button can
    // be used to retry.
    for (const tabName of tabNames) {
      const dayOfMonth = parseInt(tabName.slice(3), 10);
      counts.set(tabName, { tabName, dayOfMonth, booked: 0, rookies: 0 });
    }
    if (onProgress) {
      onProgress({ loaded: tabNames.length, total: tabNames.length, currentTab: '' });
    }
    throw err;
  }

  // Process results — they come back in the same order as the input ranges
  tabNames.forEach((tabName, i) => {
    const rows = allRows[i] || [];
    const { booked, rookies } = countBookedFromRows(rows);
    const dayOfMonth = parseInt(tabName.slice(3), 10);
    counts.set(tabName, { tabName, dayOfMonth, booked, rookies });
  });

  if (onProgress) {
    onProgress({ loaded: tabNames.length, total: tabNames.length, currentTab: '' });
  }

  return counts;
}

/**
 * Group dated tabs into months for rendering.
 * The year is inferred from the current year — this matches how the
 * workbook's Calendar tab is laid out (one year per workbook).
 */
export function groupTabsByMonth(
  tabNames: string[],
  counts: Map<string, DayCount>,
  year: number = new Date().getFullYear(),
): MonthGroup[] {
  const byMonth = new Map<number, DayCount[]>();

  for (const tabName of tabNames) {
    const monthIdx = MONTH_MAP[tabName.slice(0, 3)];
    if (monthIdx === undefined) continue;

    const count = counts.get(tabName) ?? {
      tabName,
      dayOfMonth: parseInt(tabName.slice(3), 10),
      booked: 0,
      rookies: 0,
    };

    if (!byMonth.has(monthIdx)) byMonth.set(monthIdx, []);
    byMonth.get(monthIdx)!.push(count);
  }

  const groups: MonthGroup[] = [];
  for (const [monthIdx, days] of byMonth.entries()) {
    days.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
    groups.push({
      monthIndex: monthIdx,
      year,
      monthName: MONTH_NAMES[monthIdx],
      days,
    });
  }
  groups.sort((a, b) => a.monthIndex - b.monthIndex);

  return groups;
}

/**
 * Build a full calendar grid for a month (with blank cells for padding).
 */
export interface CalendarCell {
  day: number;         // 0 for padding, else 1-31
  count?: DayCount;    // undefined if no data for this day
}

export function buildMonthGrid(month: MonthGroup): CalendarCell[] {
  const year = month.year;
  const m = month.monthIndex;

  // Days in this month
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  // What day of week does the 1st fall on? (0 = Sunday)
  const firstDow = new Date(year, m, 1).getDay();

  // Build counts-by-day lookup
  const byDay = new Map<number, DayCount>();
  for (const d of month.days) byDay.set(d.dayOfMonth, d);

  const cells: CalendarCell[] = [];

  // Leading padding (Sunday-start week)
  for (let i = 0; i < firstDow; i++) cells.push({ day: 0 });

  // Real days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, count: byDay.get(d) });
  }

  // Trailing padding to complete the final row
  while (cells.length % 7 !== 0) cells.push({ day: 0 });

  return cells;
}

/**
 * Build the MmmDD tab name for a given year/month/day combination.
 * e.g. (2026, 3, 16) -> "Apr16"
 */
export function buildTabName(year: number, monthIndex: number, day: number): string {
  const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthIndex];
  return mmm + String(day).padStart(2, '0');
}

/**
 * Get today's tab name (e.g. "Apr16") for highlighting on the calendar.
 */
export function getTodayTabName(): string {
  const d = new Date();
  return buildTabName(d.getFullYear(), d.getMonth(), d.getDate());
}
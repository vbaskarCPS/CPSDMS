// src/lib/reportDataLoader.ts
import { commandCenterService } from './commandCenterService';
import { googleSheetsService } from './googleSheetsService';
import { reportingService, WorkbookConfig, PayableCity, extractContractorPrefix } from './reportingService';

// ============================================================================
// REPORT DATA LOADER
// ----------------------------------------------------------------------------
// Runs once when the Reporting area opens. Signs in to Google a single time,
// gathers every workbook to read (each command center's workerbook, deduped by
// sheet ID, plus any standalone workbook configs like the consolidated CEO book),
// and reads all their Payout Stats tabs in parallel into memory. Everything
// downstream (calendar, city cards, breakdown chart) reads from this result —
// nothing hits Google again until an explicit reload.
// ============================================================================

const PAYOUT_STATS_TAB = 'Payout Stats';

// Column indices within the Payout Stats tab (0-based). Stable across seasons:
// team-season books add columns AFTER Final Pay, so these early indices don't move.
const COL_DATE = 0;          // "May09"
const COL_CONTRACTOR_ID = 1; // "H1001"
const COL_PROD_GROSS = 15;   // ProdGross (column P)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse "MmmDD" → { month: 0-11, day: 1-31 }, or null.
function parseMmmDd(raw: any): { month: number; day: number } | null {
  if (raw == null) return null;
  const t = raw.toString().trim();
  if (t.length < 4) return null;
  const month = MONTHS.indexOf(t.substring(0, 3));
  const day = parseInt(t.substring(3), 10);
  if (month < 0 || !day || day < 1 || day > 31) return null;
  return { month, day };
}

// A single Payout Stats row, trimmed to what the report needs.
export interface PayoutStatRow {
  date: string;          // "May09"
  contractorId: string;  // "H1001"
  prodGross: number;
}

// One workbook, fully loaded (or carrying a read error).
export interface LoadedWorkbook {
  sheetId: string;
  label: string;
  source: 'command_center' | 'standalone';
  config: WorkbookConfig | null;   // null = no ranges saved yet (not persisted)
  dataDays: Set<string>;           // "month-day" keys, for the calendar
  rows: PayoutStatRow[];           // parsed data rows, for the report
  readError?: string;              // set if this book couldn't be read
}

export interface PrefixCount {
  prefix: string;
  count: number;
}

export interface ReportData {
  workbooks: LoadedWorkbook[];
  cities: PayableCity[];
  prefixCounts: PrefixCount[];   // every distinct contractor prefix seen, with row counts, most-used first
}

// Thrown when the user cancels / fails the Google sign-in. ReportingView catches
// this specifically to show a "connect to continue" state rather than a raw error.
export class GoogleAuthCancelledError extends Error {
  constructor() {
    super('Google sign-in is required to read the workbooks.');
    this.name = 'GoogleAuthCancelledError';
  }
}

/**
 * The single entry point. Signs in (once), builds the deduped workbook list,
 * reads every Payout Stats tab in parallel, and returns everything in memory.
 * Throws GoogleAuthCancelledError if the sign-in doesn't succeed.
 */
export async function loadReportData(): Promise<ReportData> {
  // --- 1. One sign-in for the whole session ---
  if (!googleSheetsService.isAuthenticated()) {
    const ok = await googleSheetsService.authenticate();
    if (!ok) throw new GoogleAuthCancelledError();
  }

  // --- 2. Gather the book list + city configs ---
  const [ccs, configs, cities] = await Promise.all([
    commandCenterService.getAllCommandCenters(),
    reportingService.getWorkbookConfigs(),
    reportingService.getPayableCities(),
  ]);

  const configBySheetId = new Map(configs.map((c) => [c.sheetId, c]));

  type Entry = { sheetId: string; label: string; source: 'command_center' | 'standalone'; config: WorkbookConfig | null };
  const entries: Entry[] = [];
  const seen = new Set<string>();

  // Command-center workerbooks first (deduped by sheet ID).
  for (const cc of ccs) {
    const sid = cc.workerbookSheetId;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    entries.push({
      sheetId: sid,
      label: cc.displayName,
      source: 'command_center',
      config: configBySheetId.get(sid) || null,
    });
  }

  // Standalone configs = saved workbooks that aren't any CC's workerbook.
  for (const cfg of configs) {
    if (seen.has(cfg.sheetId)) continue;
    seen.add(cfg.sheetId);
    entries.push({
      sheetId: cfg.sheetId,
      label: cfg.label,
      source: 'standalone',
      config: cfg,
    });
  }

  // --- 3. Read every Payout Stats tab in parallel ---
  const workbooks = await Promise.all(
    entries.map(async (e): Promise<LoadedWorkbook> => {
      const wb: LoadedWorkbook = {
        sheetId: e.sheetId,
        label: e.label,
        source: e.source,
        config: e.config,
        dataDays: new Set<string>(),
        rows: [],
      };

      try {
        const rows = await googleSheetsService.readRangeById(e.sheetId, `'${PAYOUT_STATS_TAB}'!A:P`);
        // Row 0 is the header; skip it.
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i] || [];
          const date = (r[COL_DATE] ?? '').toString().trim();
          const contractorId = (r[COL_CONTRACTOR_ID] ?? '').toString().trim();
          if (!date || !contractorId) continue;

          const prodGross = parseFloat(r[COL_PROD_GROSS]) || 0;
          wb.rows.push({ date, contractorId, prodGross });

          const p = parseMmmDd(date);
          if (p) wb.dataDays.add(`${p.month}-${p.day}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Unable to parse range')) {
          wb.readError = `No "${PAYOUT_STATS_TAB}" tab found in this workbook.`;
        } else if (msg.toLowerCase().includes('permission') || msg.includes('403') || msg.toLowerCase().includes('access')) {
          wb.readError = 'The signed-in Google account can\u2019t access this sheet.';
        } else {
          wb.readError = msg;
        }
      }

      return wb;
    })
  );

  // --- 4. Tally every distinct contractor prefix seen, with counts ---
  const prefixMap = new Map<string, number>();
  for (const wb of workbooks) {
    for (const row of wb.rows) {
      const p = extractContractorPrefix(row.contractorId);
      if (!p) continue;
      prefixMap.set(p, (prefixMap.get(p) || 0) + 1);
    }
  }
  const prefixCounts: PrefixCount[] = Array.from(prefixMap.entries())
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count);

  return { workbooks, cities, prefixCounts };
}

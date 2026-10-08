// src/v2/lib/sheetsBridge.ts — the Google Sheets bridge (until Master Bookings lives in the app).
//
// A closed day sends its Logsheets and Accounts rows to the center's Master Bookings Google
// Sheet, exactly as the old app's Export to Google Sheets did: the rows are built from the day's
// saved copy by the same code (buildSheetRows) and appended with the manager's own Google sign-in.
// Each send is recorded, so the day page shows whether (and when, and by whom) it went.
// Card numbers never reach the sheet: the saved copy only keeps a masked last 4.
import { db, must } from './client';
import type { AccountRow, LogsheetRow } from '../../lib/exportService';

export interface SheetSend { sent_at: string; by: string | null; logsheets: number; accounts: number }
export interface SheetInfo { sheet_id: string | null; saved: boolean; sends: SheetSend[] }
export interface DaySheetRows { logsheets: LogsheetRow[]; accounts: AccountRow[] }

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;

/** The center's Master Bookings sheet, whether the day has a saved copy, and its earlier sends. */
export async function sheetInfo(centerId: string, day: string): Promise<SheetInfo> {
  const r = must(await db.rpc('app_day_sheet_info', { p_center: centerId, p_day: day })) as Partial<SheetInfo> | null;
  return { sheet_id: r?.sheet_id || null, saved: !!r?.saved, sends: r?.sends || [] };
}

/** The rows the day would send, from its saved copy. */
export async function daySheetRows(centerId: string, day: string): Promise<DaySheetRows> {
  const { buildSheetRows } = await import('../../lib/exportService');
  const a = must(await db.rpc('app_archived_day', { p_center: centerId, p_day: day })) as {
    daily_session: { season_type?: string } | null; sessions: unknown[]; transactions: unknown[]; users: unknown[];
  };
  return buildSheetRows({
    transactions: a.transactions as any[], sessions: a.sessions as any[], users: a.users as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
    seasonType: (a.daily_session?.season_type || 'aeration') as never,
  });
}

/** Signs in to Google if needed (a popup the first time, so call it from a click). */
async function googleReady(): Promise<typeof import('../../lib/googleSheetsService')['googleSheetsService']> {
  const { googleSheetsService } = await import('../../lib/googleSheetsService');
  try {
    if (googleSheetsService.isAuthenticated()) { await googleSheetsService.ensureToken(); return googleSheetsService; }
  } catch { /* the saved sign-in ran out: sign in again */ }
  const ok = await googleSheetsService.authenticate();
  if (!ok) throw new Error('Google sign-in didn’t finish. Sign in with the Google account that can edit the Master Bookings sheet, then try again.');
  return googleSheetsService;
}

/**
 * Appends the day's rows to the sheet (Logsheets, then Accounts) and records the send. If one
 * tab fails, what did reach the sheet is still recorded, and the error says which tab didn't.
 */
export async function sendDayToSheets(centerId: string, day: string, sheetId: string, rows: DaySheetRows): Promise<{ logsheets: number; accounts: number }> {
  if (!rows.logsheets.length && !rows.accounts.length) throw new Error('This day has no sales to send.');
  const gs = await googleReady();
  const done = { logsheets: 0, accounts: 0 };
  let failed: { tab: string; e: unknown } | null = null;
  try { await gs.appendLogsheets(rows.logsheets, sheetId); done.logsheets = rows.logsheets.length; }
  catch (e) { failed = { tab: 'Logsheets', e }; }
  if (!failed) {
    try { await gs.appendAccounts(rows.accounts, sheetId); done.accounts = rows.accounts.length; }
    catch (e) { failed = { tab: 'Accounts', e }; }
  }
  if (done.logsheets || done.accounts) {
    must(await db.rpc('app_record_day_sheet_send', { p_center: centerId, p_day: day, p_logsheets: done.logsheets, p_accounts: done.accounts }));
  }
  if (failed) {
    const why = (failed.e as Error)?.message || String(failed.e);
    const already = done.logsheets ? ` The ${done.logsheets} Logsheets row${done.logsheets === 1 ? '' : 's'} did go in, so don’t send the whole day again; once it’s fixed, send just the Accounts rows.` : '';
    throw new Error(`The ${failed.tab} tab didn’t take the rows: ${friendly(why)}.${already}`);
  }
  return done;
}

const friendly = (m: string) =>
  /permission|403|caller does not have/i.test(m) ? 'your Google account can’t edit that sheet (ask for edit access)'
  : /unable to parse range/i.test(m) ? 'the sheet has no tab with that name'
  : /not found|404/i.test(m) ? 'the sheet wasn’t found (check its link)'
  : m;

/** Super Admin › Users: set a center's Master Bookings sheet from its link. */
export async function setCenterSheet(centerId: string, link: string): Promise<string> {
  return must(await db.rpc('app_set_center_sheet', { p_center: centerId, p_link: link })) as string;
}

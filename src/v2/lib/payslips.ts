// src/v2/lib/payslips.ts — day payout lines and payslips.
//
// Lines: one per worker per finalized cart per day, the same numbers the old app wrote to the
// "Payout Stats" sheet (computePayoutStats). Saved at Close day, or rebuilt from the saved copy
// of an already-closed day. Payslips: a date range of unpaid lines per worker, with the old
// payslip extras; Generated → Paid when signed off, or Void (frees the days again).
import { db, must } from './client';
import { pointLegacyAt } from './legacy';
import type { HiddenFields, PayslipDayRow, PayslipSeason, WorkerPayslipData, ExtraItem } from '../../lib/payslipExport';

export interface PayoutLine {
  id: string; center_id: string; day: string; cn: string; hire_id: string | null; first_name: string; last_name: string; manager: string | null;
  steps: number; equiv: number; total_prepay: number; payout_rate: number; aer_comm: number; upsell_comm: number;
  mach_rent: number; deductions: number; daily_bonus: number; total_payout: number; indiv_gross: number; crackfill_base: number;
  payslip_id: string | null; stats?: unknown;
}
export type NewLine = Omit<PayoutLine, 'id' | 'center_id' | 'day' | 'hire_id' | 'payslip_id'> & { stats: unknown };

export interface SlipSettings {
  is120Program: boolean; hotels: number; advances: number; travelPkg: number; crackfillPct: number;
  extraDeductions: ExtraItem[]; additions: ExtraItem[];
}
export interface Payslip {
  id: string; run_id: string; cn: string; first_name: string; last_name: string; batch: string | null;
  settings: SlipSettings; days: PayslipDayRow[]; earned: number; final_pay: number;
  status: 'generated' | 'paid' | 'void'; generated_at: string; paid_at: string | null;
}
export interface PayslipRun {
  id: string; start_day: string; end_day: string; season: PayslipSeason; hidden: HiddenFields; created_at: string; payslips: Payslip[];
}

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };

/** A Payout Stats row → a day line. Field-for-field what the old payslip read from the sheet. */
export function statsToLine(r: Record<string, unknown>): NewLine {
  return {
    cn: String(r.contractorId || ''), first_name: String(r.firstName || ''), last_name: String(r.lastName || ''), manager: String(r.manager || '') || null,
    steps: n(r.stepCount), equiv: n(r.assignedEQ ?? r.teamTotalEQ ?? r.totalEQ),
    total_prepay: n(r.upsellPayable),          // sheet column Z, which the old payslip printed as TOTAL PREPAY
    payout_rate: n(r.totalPayoutRate ?? r.payoutRate), aer_comm: n(r.productionComm), upsell_comm: n(r.upsellComm),
    mach_rent: n(r.machineRental), deductions: n(r.deductions), daily_bonus: n(r.bonuses), total_payout: n(r.finalPay),
    indiv_gross: n(r.prodGross), crackfill_base: n(r.crackfillerCost), stats: r,
  };
}

/** Lines for the live session at a center (used by Close day, before the session is cleared). */
export async function linesFromLiveSession(centerId: string): Promise<{ date: string; lines: NewLine[] }> {
  await pointLegacyAt(centerId);
  const { loadLivePayoutInput, computePayoutStats } = await import('../../lib/exportService');
  const input = await loadLivePayoutInput();
  return { date: input.date, lines: computePayoutStats(input).map(statsToLine) };
}

/** Lines for an already-closed day, rebuilt from its saved copy with the same maths. */
export async function linesFromSavedDay(centerId: string, day: string): Promise<NewLine[]> {
  await pointLegacyAt(centerId);
  const [{ computePayoutStats }, { commandCenterService }, { SEASON_CONFIGS }] = await Promise.all([
    import('../../lib/exportService'), import('../../lib/commandCenterService'), import('../../types'),
  ]);
  const a = must(await db.rpc('app_archived_day', { p_center: centerId, p_day: day })) as {
    daily_session: { season_type?: string; import_meta?: { productCostPercent?: number; noTaxOnCash?: boolean } } | null;
    sessions: unknown[]; transactions: unknown[]; users: unknown[];
  };
  const seasonType = (a.daily_session?.season_type || 'aeration') as keyof typeof SEASON_CONFIGS;
  const meta = a.daily_session?.import_meta || {};
  return computePayoutStats({
    sessions: a.sessions as any[], transactions: a.transactions as any[], users: a.users as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
    seasonType: seasonType as never,
    productCostPercent: meta.productCostPercent ?? SEASON_CONFIGS[seasonType]?.defaultProductCostPercent ?? 0,
    noTaxOnCash: meta.noTaxOnCash ?? false,
    taxRate: commandCenterService.getCurrentTaxRate(),
  }).map(statsToLine);
}

export async function saveLines(centerId: string, day: string, lines: NewLine[]): Promise<number> {
  return must(await db.rpc('app_save_payout_lines', { p_center: centerId, p_day: day, p_lines: lines })) as number;
}
export async function lineGaps(centerId: string): Promise<{ day: string; carts: number }[]> {
  return must(await db.rpc('app_payout_line_gaps', { p_center: centerId })) as { day: string; carts: number }[];
}
export async function listLines(centerId: string, from: string, to: string): Promise<PayoutLine[]> {
  return must(await db.from('payout_lines').select('*').eq('center_id', centerId).gte('day', from).lte('day', to)
    .order('day').order('cn')) as PayoutLine[];
}
export async function listRuns(centerId: string): Promise<PayslipRun[]> {
  return must(await db.from('payslip_runs').select('*, payslips(*)').eq('center_id', centerId)
    .order('created_at', { ascending: false }).limit(50)) as PayslipRun[];
}
export async function generatePayslips(p: {
  centerId: string; start: string; end: string; season: PayslipSeason; hidden: HiddenFields;
  slips: { cn: string; first_name: string; last_name: string; batch: string; settings: SlipSettings; days: PayslipDayRow[]; line_ids: string[]; earned: number; final_pay: number }[];
}): Promise<string> {
  return must(await db.rpc('app_generate_payslips', {
    p_center: p.centerId, p_start: p.start, p_end: p.end, p_season: p.season, p_hidden: p.hidden, p_slips: p.slips,
  })) as string;
}
export async function markPaid(ids: string[]): Promise<number> {
  return must(await db.rpc('app_payslips_mark_paid', { p_ids: ids })) as number;
}
export async function voidPayslip(id: string): Promise<void> {
  must(await db.rpc('app_payslip_void', { p_id: id }));
}

// ───────────── shaping for the payslip PDF ─────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-07 → "Oct07", the date form the payslip PDF prints. */
export const mmmdd = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]}${iso.slice(8, 10)}`;
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00').getTime() - new Date(a + 'T12:00').getTime()) / 86400000) + 1;

export function lineToDay(l: PayoutLine): PayslipDayRow {
  return {
    date: mmmdd(l.day), manager: l.manager || '', steps: n(l.steps), equiv: n(l.equiv), totalPrepay: n(l.total_prepay),
    payoutRate: n(l.payout_rate), aerComm: n(l.aer_comm), upsellComm: n(l.upsell_comm), machRent: n(l.mach_rent),
    deductions: n(l.deductions), dailyBonus: n(l.daily_bonus), totalPayout: n(l.total_payout),
    indivGross: n(l.indiv_gross), crackfillBase: n(l.crackfill_base),
  };
}
export const defaultSettings = (): SlipSettings => ({ is120Program: false, hotels: 0, advances: 0, travelPkg: 0, crackfillPct: 0, extraDeductions: [], additions: [] });
export function toWorkerData(cn: string, first: string, last: string, days: PayslipDayRow[], s: SlipSettings): WorkerPayslipData {
  return { contractorId: cn, firstName: first, lastName: last, days, ...s };
}

/** Download a run's payslips (one PDF per batch), exactly as generated. */
export async function downloadRunPdf(run: PayslipRun, centerName: string, only?: (p: Payslip) => boolean): Promise<void> {
  const { generatePayslipsPDF } = await import('../../lib/payslipExport');
  const slips = run.payslips.filter(p => p.status !== 'void' && (!only || only(p)));
  const batches = [...new Set(slips.map(p => p.batch || 'Payslips'))];
  for (const b of batches) {
    const ws = slips.filter(p => (p.batch || 'Payslips') === b).map(p => toWorkerData(p.cn, p.first_name, p.last_name, p.days, { ...defaultSettings(), ...p.settings }));
    await generatePayslipsPDF(ws, mmmdd(run.start_day), mmmdd(run.end_day), centerName, daysBetween(run.start_day, run.end_day), run.hidden, run.season, batches.length > 1 ? b : undefined);
  }
}

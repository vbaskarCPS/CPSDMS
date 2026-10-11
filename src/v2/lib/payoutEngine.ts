// src/v2/lib/payoutEngine.ts — a worker's pay for one day, worked out from that day's inputs.
//
// Same maths as the old app's payout (sessionService.calculateTeamPayouts), applied to one
// worker's share of a cart:
//
//   rate        = base $/EQ (solo or team, from the rate card)
//               + Alumni $/EQ (contractor year 2+, by days worked BEFORE that day)
//               + Silver $/EQ (by lifetime Silver Hats in the season's service)
//   production  = EQ × rate
//   upsells     = upsell payable × 10% (15% in aeration, which has no teams)
//   IOS         = IOS count × $5
//   final pay   = production + upsells + IOS + bonuses − machine rental − deductions
//
// The inputs (EQ, upsell payable, IOS, bonuses, machine rental, deductions, team size) are kept
// on each payout line (`stats`), so an unpaid line can be worked out again after a worker's
// days or Silver Hats are corrected. Rates are never taken from an old sheet.
import { db, must } from './client';
import { alumniRate, silverRate, type RateCardData } from './rateCard';
import { SERVICE_HAT } from './startSession';
import type { Service } from './permissions';
import type { HatCode } from './workerbook';
import { dayContext } from './dayContext';
import { listLines, saveLines, statsToLine, type PayoutLine } from './payslips';

/** Upsell commission: 10% in the team seasons (sealing, lawn rejuv, cleaning), 15% in aeration. */
export const upsellCommissionRate = (service: Service) => service === 'aeration' ? 0.15 : 0.10;
export const IOS_PER = 5;

export interface WorkerRateFacts { firstYear: number | null; lifetimeDays: number; hats: Partial<Record<HatCode, number>> | null }
export interface RateInfo { base: number; alumni: number; silver: number; total: number; days: number; hats: number; contractorYear: number }

const num = (v: unknown) => { const x = typeof v === 'number' ? v : Number(v); return Number.isFinite(x) ? x : 0; };

/** The $/EQ for one worker on one day. `appDaysBefore` = days they showed in the app before that day. */
export function rateFor(card: RateCardData, service: Service, seasonYear: number, teamSize: number, w: WorkerRateFacts, appDaysBefore: number): RateInfo {
  const base = teamSize >= 2 ? card.perEqTeam : card.perEqSolo;
  const contractorYear = seasonYear - (w.firstYear ?? seasonYear) + 1;
  const days = (w.lifetimeDays || 0) + appDaysBefore;
  const hats = w.hats?.[SERVICE_HAT[service]] || 0;
  const alumni = alumniRate(card, contractorYear, days);
  const silver = silverRate(card, hats);
  return { base, alumni, silver, total: base + alumni + silver, days, hats, contractorYear };
}

/** The pay columns for one worker-day, from its inputs and rate. Returns the stats with them filled in. */
export function payFromInputs(stats: Record<string, unknown>, rate: RateInfo, service: Service): Record<string, unknown> {
  const eq = num(stats.assignedEQ ?? stats.totalEQ);
  const productionComm = eq * rate.total;
  const upsellComm = num(stats.upsellPayable) * upsellCommissionRate(service);
  const iosComm = num(stats.iosCount) * IOS_PER;
  const bonuses = num(stats.bonuses);
  const machineRental = num(stats.machineRental);
  const deductions = num(stats.deductions);
  return {
    ...stats, assignedEQ: eq,
    basePayoutRate: rate.base, alumniRate: rate.alumni, silverRate: rate.silver, totalPayoutRate: rate.total,
    daysBefore: rate.days, silverHats: rate.hats, contractorYear: rate.contractorYear,
    productionComm, upsellComm, iosComm, bonuses, machineRental, deductions,
    finalPay: productionComm + upsellComm + iosComm + bonuses - machineRental - deductions,
  };
}

/** The days each hire showed in the app (any center), for counting days worked before a date. */
export async function appShowedDates(hireIds: string[]): Promise<Record<string, Set<string>>> {
  const out: Record<string, Set<string>> = {};
  for (let i = 0; i < hireIds.length; i += 100) {
    const rows = must(await db.from('day_roster').select('hire_id, day:days!inner(day)').eq('attendance', 'showed')
      .in('hire_id', hireIds.slice(i, i + 100))) as unknown as { hire_id: string; day: { day: string } | null }[];
    for (const r of rows) if (r.day?.day) (out[r.hire_id] ||= new Set()).add(r.day.day);
  }
  return out;
}
export const countBefore = (dates: Iterable<string> | undefined, date: string) => { let n = 0; for (const d of dates || []) if (d < date) n++; return n; };

/** Rate facts (first year, days before this app, Silver Hats) for a set of hires. */
export async function rateFacts(hireIds: string[]): Promise<Record<string, WorkerRateFacts>> {
  const out: Record<string, WorkerRateFacts> = {};
  for (let i = 0; i < hireIds.length; i += 100) {
    const rows = must(await db.from('hires').select('id, person:people(first_year, lifetime_days, hats)').in('id', hireIds.slice(i, i + 100))) as unknown as
      { id: string; person: { first_year: number | null; lifetime_days: number; hats: Partial<Record<HatCode, number>> | null } | null }[];
    for (const r of rows) out[r.id] = { firstYear: r.person?.first_year ?? null, lifetimeDays: r.person?.lifetime_days || 0, hats: r.person?.hats || null };
  }
  return out;
}

const hasInputs = (st: unknown): st is Record<string, unknown> =>
  !!st && typeof st === 'object' && (typeof (st as Record<string, unknown>).assignedEQ === 'number' || typeof (st as Record<string, unknown>).totalEQ === 'number');

/**
 * Works out a closed day's lines again from their inputs, with each worker's days and Silver Hats
 * as they are now in the app. A day on a Generated payslip updates that payslip; a paid one is locked.
 */
export async function recalcDay(centerId: string, region: string, day: string): Promise<{ lines: number; changed: number; before: number; after: number }> {
  const lines = await listLines(centerId, day, day);
  if (lines.some(l => l.payslip_id && l.payslip?.status === 'paid')) throw new Error(`${day} is on a paid payslip, so it's locked.`);
  const total = (xs: { total_payout: number }[]) => xs.reduce((a, x) => a + (Number(x.total_payout) || 0), 0);
  // a day with its carts and sales: work it out from those
  const cartsLib = await import('./payoutCarts');
  const carts = await cartsLib.listCarts(centerId, day);
  if (carts.length) {
    const ctx = await cartsLib.cartContext(centerId, region, day, carts);
    const next = await cartsLib.dayLines(carts, ctx);
    await cartsLib.saveDay(centerId, day, carts, next);
    const byCn = new Map(lines.map(l => [l.cn, Number(l.total_payout) || 0]));
    return { lines: next.length, changed: next.filter(l => Math.abs(l.total_payout - (byCn.get(l.cn) ?? NaN)) > 0.005 || !byCn.has(l.cn)).length, before: total(lines), after: total(next) };
  }
  const ids = [...new Set(lines.map(l => l.hire_id).filter(Boolean) as string[])];
  const [ctx, facts, showed] = await Promise.all([dayContext(centerId, day, region), rateFacts(ids), appShowedDates(ids)]);
  let changed = 0;
  const next = lines.map((l: PayoutLine) => {
    if (!l.hire_id || !hasInputs(l.stats)) return { ...keep(l) };
    const st = l.stats as Record<string, unknown>;
    const rate = rateFor(ctx.card, ctx.service, ctx.seasonYear, Number(st.teamSize) || 1, facts[l.hire_id] || { firstYear: null, lifetimeDays: 0, hats: null }, countBefore(showed[l.hire_id], day));
    const out = statsToLine(payFromInputs({ ...st, contractorId: l.cn, firstName: l.first_name, lastName: l.last_name }, rate, ctx.service));
    if (Math.abs(out.total_payout - l.total_payout) > 0.005) changed++;
    return out;
  });
  await saveLines(centerId, day, next);
  return { lines: next.length, changed, before: total(lines), after: total(next) };
}

const keep = (l: PayoutLine) => ({
  cn: l.cn, first_name: l.first_name, last_name: l.last_name, manager: l.manager, steps: l.steps, equiv: l.equiv, total_prepay: l.total_prepay,
  payout_rate: l.payout_rate, aer_comm: l.aer_comm, upsell_comm: l.upsell_comm, mach_rent: l.mach_rent, deductions: l.deductions,
  daily_bonus: l.daily_bonus, total_payout: l.total_payout, indiv_gross: l.indiv_gross, crackfill_base: l.crackfill_base, stats: l.stats ?? {},
});

/** A contractor's payout lines, newest first. */
export async function hireLines(hireId: string): Promise<PayoutLine[]> {
  return must(await db.from('payout_lines').select('*').eq('hire_id', hireId).order('day', { ascending: false })) as PayoutLine[];
}

/**
 * Works out again every closed day where this contractor has an unpaid line (the whole day, so
 * everyone on it gets their current days and Silver Hats). Days already on a payslip are skipped.
 */
export async function recalcForHire(hireId: string, regionOf: (centerId: string) => string): Promise<{ days: number; skipped: string[]; before: number; after: number }> {
  const lines = await hireLines(hireId);
  const unpaid = [...new Map(lines.filter(l => !l.payslip_id).map(l => [`${l.center_id}|${l.day}`, l])).values()];
  let before = 0, after = 0, days = 0; const skipped: string[] = [];
  for (const l of unpaid) {
    try {
      await recalcDay(l.center_id, regionOf(l.center_id), l.day);
      days++;
    } catch { skipped.push(l.day); }
  }
  const now = await hireLines(hireId);
  for (const l of lines.filter(x => !x.payslip_id)) before += Number(l.total_payout) || 0;
  for (const l of now.filter(x => !x.payslip_id)) after += Number(l.total_payout) || 0;
  return { days, skipped, before, after };
}

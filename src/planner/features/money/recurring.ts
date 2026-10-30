// src/planner/features/money/recurring.ts — bills and subscriptions: the same merchant charged in
// at least 3 of the last 4 months, for about the same amount (±15%).
import { round2, shiftMonth } from './lib';
import type { Txn } from './types';

export interface Recurring { merchant: string; category: string; avg: number; months: string[]; cadence: 'monthly' | 'weekly' | 'biweekly'; last: string; next: string; lastAmount: number }

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function addMonth(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m, Math.min(d, 28));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function findRecurring(months: Record<string, Txn[]>, thisMonth: string, ignore: string[] = []): Recurring[] {
  const window = [0, 1, 2, 3].map(i => shiftMonth(thisMonth, -i));
  const byMerchant = new Map<string, Txn[]>();
  for (const k of window) for (const t of months[k] || []) {
    if (t.amount >= 0 || ['Transfers', 'Credit card payment', 'Income', 'Cash'].includes(t.category)) continue;
    const list = byMerchant.get(t.merchant) || []; list.push(t); byMerchant.set(t.merchant, list);
  }
  const out: Recurring[] = [];
  for (const [merchant, list] of byMerchant) {
    if (ignore.includes(merchant)) continue;
    const perMonth = new Set(list.map(t => t.date.slice(0, 7)));
    if (perMonth.size < 3) continue;
    const amts = list.map(t => -t.amount);
    const median = [...amts].sort((a, b) => a - b)[Math.floor(amts.length / 2)];
    const steady = amts.filter(a => Math.abs(a - median) <= median * 0.15);
    if (steady.length < 3) continue;
    const avg = round2(steady.reduce((s, a) => s + a, 0) / steady.length);
    const dates = list.map(t => t.date).sort();
    const perMonthCount = list.length / perMonth.size;
    const cadence: Recurring['cadence'] = perMonthCount >= 3.5 ? 'weekly' : perMonthCount >= 1.8 ? 'biweekly' : 'monthly';
    const last = dates[dates.length - 1];
    const next = cadence === 'weekly' ? addDays(last, 7) : cadence === 'biweekly' ? addDays(last, 14) : addMonth(last);
    out.push({ merchant, category: list[list.length - 1].category, avg, months: [...perMonth].sort(), cadence, last, next, lastAmount: -list.sort((a, b) => a.date.localeCompare(b.date))[list.length - 1].amount });
  }
  return out.sort((a, b) => b.avg * (b.cadence === 'weekly' ? 4.3 : b.cadence === 'biweekly' ? 2.2 : 1) - a.avg * (a.cadence === 'weekly' ? 4.3 : a.cadence === 'biweekly' ? 2.2 : 1));
}
export const monthlyCost = (r: Recurring) => round2(r.avg * (r.cadence === 'weekly' ? 4.33 : r.cadence === 'biweekly' ? 2.17 : 1));

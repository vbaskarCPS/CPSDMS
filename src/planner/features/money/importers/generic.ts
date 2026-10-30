// src/planner/features/money/importers/generic.ts — any CSV with a header row naming a date, a
// description and either an amount or debit/credit columns (other banks, exports from other apps).
import type { Importer } from './index';
import { parseAmount, parseDate } from './index';
import { maskNumbers, normalizeMerchant, txnId } from '../lib';
import type { Txn } from '../types';

function cols(header: string[]) {
  const h = header.map(s => s.toLowerCase());
  const find = (...names: RegExp[]) => h.findIndex(c => names.some(n => n.test(c)));
  return {
    date: find(/^date$/, /date/),
    desc: find(/descr/, /payee/, /merchant/, /memo/, /details?/, /name/),
    amount: find(/^amount$/, /amount/),
    debit: find(/debit/, /withdraw/, /money out/, /out$/),
    credit: find(/credit/, /deposit/, /money in/, /in$/),
    balance: find(/balance/),
  };
}

export const genericImporter: Importer = {
  name: 'CSV with headers',
  detect(rows) {
    if (rows.length < 2) return false;
    const c = cols(rows[0]);
    return c.date >= 0 && c.desc >= 0 && (c.amount >= 0 || c.debit >= 0 || c.credit >= 0);
  },
  parse(rows, accountId) {
    const c = cols(rows[0]);
    const out: Txn[] = [];
    const seen = new Map<string, number>();
    for (const r of rows.slice(1)) {
      const date = parseDate(r[c.date] || '');
      if (!date) continue;
      const desc = maskNumbers((r[c.desc] || '').trim());
      let amount: number;
      if (c.amount >= 0) amount = parseAmount(r[c.amount] || '') ?? 0;
      else amount = (c.credit >= 0 ? parseAmount(r[c.credit] || '') ?? 0 : 0) - (c.debit >= 0 ? parseAmount(r[c.debit] || '') ?? 0 : 0);
      amount = Math.round(amount * 100) / 100;
      const balance = c.balance >= 0 ? parseAmount(r[c.balance] || '') ?? undefined : undefined;
      if (!desc && !amount) continue;
      const base = `${date}|${desc}|${amount}|${balance}`;
      const n = seen.get(base) || 0; seen.set(base, n + 1);
      out.push({ id: txnId(accountId, date, desc, amount, balance, n), date, desc, merchant: normalizeMerchant(desc), amount, balance, accountId, category: 'Other', source: 'ai' });
    }
    return out;
  },
};

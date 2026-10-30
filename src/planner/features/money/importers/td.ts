// src/planner/features/money/importers/td.ts — TD EasyWeb's CSV download: no header row, five columns
//   Date (MM/DD/YYYY), Description, Debit (money out), Credit (money in), Balance
// The credit-card download has the same shape (Debit = purchases, Credit = payments/refunds).
import type { Importer } from './index';
import { parseAmount, parseDate } from './index';
import { maskNumbers, normalizeMerchant, txnId } from '../lib';
import type { Txn } from '../types';

export const tdImporter: Importer = {
  name: 'TD EasyWeb CSV',
  detect(rows) {
    const r = rows[0];
    return !!r && r.length >= 4 && r.length <= 6 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(r[0]) && parseDate(r[0]) !== null;
  },
  parse(rows, accountId) {
    const out: Txn[] = [];
    const seen = new Map<string, number>();
    for (const r of rows) {
      const date = parseDate(r[0] || '');
      if (!date) continue;
      const desc = maskNumbers((r[1] || '').trim());
      const debit = parseAmount(r[2] || '') ?? 0;
      const credit = parseAmount(r[3] || '') ?? 0;
      const balance = parseAmount(r[4] || '') ?? undefined;
      const amount = Math.round((credit - debit) * 100) / 100;
      if (!desc && !amount) continue;
      // two identical lines on one day (two coffees) are both real: number them
      const base = `${date}|${desc}|${amount}|${balance}`;
      const n = seen.get(base) || 0; seen.set(base, n + 1);
      out.push({ id: txnId(accountId, date, desc, amount, balance, n), date, desc, merchant: normalizeMerchant(desc), amount, balance, accountId, category: 'Other', source: 'ai' });
    }
    return out;
  },
};

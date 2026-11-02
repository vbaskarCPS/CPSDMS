// src/planner/features/money/types.ts — the finance tracker's documents (see ../../lib/docs).
export type AccountType = 'chequing' | 'savings' | 'credit';
/** Set when the account is connected to the bank through Plaid (planner-plaid edge function). While it is,
 *  the bank's rows are the record and this account's CSV rows are hidden (kept, not deleted). */
export interface AccountLink { itemId: string; plaidId: string; institution?: string; linkedAt: string; removedAt?: string }
export interface Account { id: string; name: string; type: AccountType; last4?: string; balance?: number; balanceAsOf?: string; order: number; archived?: boolean; plaid?: AccountLink }

export type TxnSource = 'rule' | 'builtin' | 'ai' | 'manual' | 'plaid';   // 'plaid': Plaid's own category
export interface Txn {
  id: string;            // hash of account + date + desc + amount + balance: the dedupe key ('plaid_<id>' from the bank)
  date: string;          // YYYY-MM-DD
  desc: string;          // as the bank wrote it (long numbers masked)
  merchant: string;      // normalized: uppercase, store numbers and cities stripped
  amount: number;        // negative = money out, positive = money in
  balance?: number;
  accountId: string;
  category: string;
  source: TxnSource;
  note?: string;
}
export interface TxnMonth { rows: Txn[] }        // kind 'txns', key YYYY-MM
export interface Rule { category: string }       // kind 'rule', key = merchant
export type Budget = Record<string, number>;     // kind 'budget', key 'current'
export interface RecurringPrefs { ignore: string[] }   // kind 'moneyprefs' (shared by the household), key 'recurringIgnore'

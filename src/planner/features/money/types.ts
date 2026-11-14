// src/planner/features/money/types.ts — the finance tracker's documents (see ../../lib/docs).
export type AccountType = 'chequing' | 'savings' | 'credit' | 'cash';
/** Set when the account is connected to the bank through Plaid (planner-plaid edge function). While it is,
 *  the bank's rows are the record and this account's CSV rows are hidden (kept, not deleted). */
export interface AccountLink { itemId: string; plaidId: string; institution?: string; linkedAt: string; removedAt?: string }
export interface Account {
  id: string; name: string; type: AccountType; last4?: string; balance?: number; balanceAsOf?: string; order: number; archived?: boolean; plaid?: AccountLink;
  /** The cash wallet (id 'cash'): the first day cash spending was logged. From then on an ATM withdrawal moves money
   *  into the wallet (shown as a transfer) and what's bought with the cash is the spending, so nothing counts twice. */
  cashSince?: string;
}

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
  /** Display only (never saved): an ATM withdrawal shown as money moved into the cash wallet. */
  toWallet?: boolean;
}

/** kind 'receipt', key `${date}~${id}`: a photo of a receipt or of a payment screen, read by the AI. A card receipt is
 *  matched to its bank row (and gives that row its category); a cash receipt makes a row in the cash wallet. */
export interface ReceiptItem { name: string; amount: number; category: string }
export interface Receipt {
  id: string;
  date: string;              // YYYY-MM-DD
  time?: string;
  merchant: string;          // as printed, e.g. "Costco Wholesale"
  total: number;             // positive: what was paid (tip included)
  tax?: number;
  tip?: number;
  payment: 'card' | 'cash';
  cardLast4?: string;
  items: ReceiptItem[];
  category: string;          // where most of the money went
  note?: string;
  kind?: 'receipt' | 'transaction';
  photos: number;            // kind 'receiptimg', keys `${id}~0` …
  txnId?: string;            // the bank row it matched, or its cash row
  txnMonth?: string;         // YYYY-MM of that row
  matchedAt?: string;
  matchedBy?: 'auto' | 'hand' | 'cash';
  addedAt: string;
  /** Where it came from: a photo (the default) or a purchase email read by planner-mail (action 'receipts'). */
  from?: 'photo' | 'email';
  /** The email it was read from (from === 'email'): which of the person's mailboxes, its Gmail id, subject and sender. */
  email?: { mailbox: string; id: string; subject: string; sender: string };
  /** ISO code when it isn't Canadian dollars ('USD'): never matched by itself, the bank's amount is converted. */
  currency?: string;
  /** How an email receipt was paid ('etransfer': an Interac e-transfer, kind 'transaction'). */
  paidBy?: 'card' | 'etransfer' | 'paypal' | 'other';
  /** Who an e-transfer went to. */
  payee?: { name: string; email?: string };   // e-transfers: who it was sent to
  /** Set by the app: paid on the company card, or not a receipt at all. Hidden from "Not matched", never matched. */
  ignored?: 'company' | 'not_receipt';
}
/** kind 'moneyprefs', key 'mailReceipts': when email was last looked through for receipts (YYYY-MM-DD), and per mailbox
 *  address, so a mailbox connected later (or one that had a problem) is read from 12 months back. */
export interface MailReceiptPrefs { lastScan?: string; boxes?: Record<string, string> }
export const CASH_ACCOUNT_ID = 'cash';
export interface TxnMonth { rows: Txn[] }        // kind 'txns', key YYYY-MM
export interface Rule { category: string }       // kind 'rule', key = merchant
export type Budget = Record<string, number>;     // kind 'budget', key 'current'
export interface RecurringPrefs { ignore: string[] }   // kind 'moneyprefs' (shared by the household), key 'recurringIgnore'

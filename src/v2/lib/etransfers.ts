// src/v2/lib/etransfers.ts — Super Admin › Accounts Reporting: e-transfer sales and the bank receipts forwarded to
// payments@propertystars.app (read and matched by Claude: supabase/functions/_shared/etransfer.ts).
import { db, must } from './client';

export const PAYMENTS_ADDRESS = 'payments@propertystars.app';

export interface EtfMatch {
  id: string; receipt_id: string; how: 'auto' | 'claude' | 'manual'; confidence: string | null; reason: string | null; confirmed: boolean;
  sender: string | null; sender_email: string | null; amount: number | null; sent_on: string | null; reference: string | null; memo: string | null;
}
export interface EtfSale {
  id: string; key: string; day: string; center_id: string; center: string | null; route_code: string | null; address: string | null;
  client: string | null; amount: number; price: number; split: boolean; cart: string | null; manager: string | null; match: EtfMatch | null;
}
export type ReceiptStatus = 'new' | 'matched' | 'review' | 'unmatched' | 'ignored' | 'not_receipt' | 'not_forward' | 'error';
export interface EtfReceipt {
  id: string; received_at: string; forwarded_by: string | null; subject: string | null; sender: string | null; sender_email: string | null;
  amount: number | null; sent_on: string | null; reference: string | null; memo: string | null; bank: string | null; status: ReceiptStatus;
  note: string | null; thread_id: string | null;
  sales: { match_id: string; key: string; confirmed: boolean; day: string; client: string | null; amount: number; reason: string | null; how: string }[];
}
export interface EtfReport { sales: EtfSale[]; receipts: EtfReceipt[] }

export async function etfReport(centerId: string | null, from: string, to: string): Promise<EtfReport> {
  const r = must(await db.rpc('app_etf_report', { p_center: centerId, p_from: from, p_to: to })) as EtfReport | null;
  return { sales: r?.sales || [], receipts: r?.receipts || [] };
}
export async function etfMatch(receiptId: string, saleKey: string): Promise<void> { must(await db.rpc('app_etf_match', { p_receipt: receiptId, p_key: saleKey })); }
export async function etfConfirm(matchId: string): Promise<void> { must(await db.rpc('app_etf_confirm', { p_match: matchId })); }
export async function etfUnmatch(matchId: string): Promise<void> { must(await db.rpc('app_etf_unmatch', { p_match: matchId })); }
export async function etfIgnore(receiptId: string, ignore: boolean): Promise<void> { must(await db.rpc('app_etf_ignore', { p_receipt: receiptId, p_ignore: ignore })); }

/** Match every receipt still unmatched again (Claude reads any it couldn't before). */
export async function etfRecheck(): Promise<{ done: number; matched: number; review: number; unmatched: number; errors: number }> {
  const { data, error } = await db.functions.invoke('etransfers', { body: { action: 'recheck' } });
  if (error) throw new Error((data as { error?: string } | null)?.error || error.message);
  return data as { done: number; matched: number; review: number; unmatched: number; errors: number };
}

/** The three lists. A sale is matched once a person or a clear match confirmed it; a suggestion still counts as unmatched. */
export function etfLists(r: EtfReport) {
  const matched = r.sales.filter(s => s.match?.confirmed);
  const waiting = r.sales.filter(s => !s.match?.confirmed);
  const openReceipts = r.receipts.filter(x => ['new', 'unmatched', 'review', 'error'].includes(x.status) && !x.sales.some(s => s.confirmed));
  const notReceipts = r.receipts.filter(x => ['not_receipt', 'not_forward', 'ignored'].includes(x.status));
  const sum = (a: { amount: number | null }[]) => Math.round(a.reduce((t, x) => t + Number(x.amount || 0), 0) * 100) / 100;
  // received = what the bank actually got for the matched sales (the e-transfer is often not the recorded amount)
  const received = sum(matched.map(s => ({ amount: s.match!.amount ?? s.amount })));
  return {
    matched, waiting, openReceipts, notReceipts,
    totals: { expected: sum(r.sales), received, matchedSold: sum(matched), gap: Math.round((received - sum(matched)) * 100) / 100, waiting: sum(waiting), unmatchedEmails: sum(openReceipts) },
  };
}

/** How far an e-transfer is from the sale it paid for: "$12.00 short", "$5.00 over", or '' when they agree. */
export const amountGap = (sent: number | null | undefined, sold: number): string => {
  if (sent == null) return '';
  const d = Math.round((Number(sent) - sold) * 100) / 100;
  return Math.abs(d) < 0.005 ? '' : d < 0 ? `${money(-d)} short` : `${money(d)} over`;
};
export const money = (n: number | null | undefined) => n == null ? '—' : `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const shortDate = (d: string | null | undefined) => !d ? '—' : new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
export const daysSince = (d: string, today = new Date()) => Math.max(0, Math.floor((today.getTime() - new Date(`${d}T12:00:00`).getTime()) / 86400000));
export const HOW_LABEL: Record<string, string> = { auto: 'Auto', claude: 'Claude', manual: 'By hand' };

// src/v2/lib/cardSales.ts — Card Processing: charge a card for a phone sale (the card-sale function), the history of
// every attempt, and the one receipt email. What can be sold, the tax inside a price and the receipt itself live with
// the function (supabase/functions/card-sale/sale.ts) so the form and the charge can never disagree.
import { db, must } from './client';
import { CARD_SERVICES, SEASON_LABEL, cardName, type ReceiptTemplate, type SaleInput, type SaleItem, type Season } from '../../../supabase/functions/card-sale/sale';

export type SaleStatus = 'processing' | 'approved' | 'declined' | 'error';
export interface CardSale {
  id: string; created_at: string; processed_by_name: string;
  first_name: string; last_name: string; phone: string | null; email: string | null;
  address: string; city: string; province: string; postal_code: string | null;
  items: SaleItem[]; total: number; subtotal: number; tax_amount: number; tax_name: string; tax_rate: number; notes: string | null;
  status: SaleStatus; transaction_id: string | null; auth_code: string | null; card_type: string | null; last4: string | null; message: string | null;
  receipt_to: string | null; receipt_sent_at: string | null; receipt_error: string | null;
}
export interface ChargeAnswer {
  approved: boolean; id?: string; status?: SaleStatus; message?: string | null; transactionId?: string | null; authCode?: string | null;
  cardType?: string | null; last4?: string | null; total?: number; receipt?: 'sent' | 'failed' | 'none'; receiptTo?: string | null;
  /** Bambora never answered: the charge may or may not have gone through */
  unsure?: boolean; pending?: boolean;
  /** the same customer was charged the same amount a moment ago: nothing was charged, ask first */
  duplicate?: { at: string; by: string; total: number; last4: string | null };
}
export interface TemplateInfo extends ReceiptTemplate { updated_at: string | null; updated_by: string | null; can_edit: boolean }
export interface CardStats { today_n: number; today_total: number; month_n: number; month_total: number; today_declined: number }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.functions.invoke('card-sale', { body });
  if (error) {
    const res = (error as { context?: Response }).context;
    const msg = res ? await res.json().then((j: { error?: string }) => j.error).catch(() => null) : null;
    throw new Error(msg || error.message || 'The charge didn’t go through to the server');
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as T;
}
/** One key per press of Charge: the server never charges twice for the same key. */
export const newChargeKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
export const chargeCard = (key: string, token: string, sale: SaleInput, confirmDuplicate = false) =>
  call<ChargeAnswer>({ action: 'charge', key, token, sale, confirm_duplicate: confirmDuplicate });
export const resendReceipt = (id: string, email?: string) => call<{ sent: boolean; to: string }>({ action: 'resend_receipt', id, email });
export const sendTestReceipt = () => call<{ sent: boolean; to: string }>({ action: 'test_receipt' });

export async function cardSales(from: string, to: string): Promise<CardSale[]> {
  return ((must(await db.rpc('card_sales_list', { p_from: from, p_to: to })) as CardSale[]) || []).map(s => ({ ...s, total: Number(s.total), subtotal: Number(s.subtotal), tax_amount: Number(s.tax_amount), tax_rate: Number(s.tax_rate) }));
}
export async function cardStats(): Promise<CardStats> { return must(await db.rpc('card_sales_stats')) as CardStats; }
/** Should this person see the Card Processing tour now (once after the permission is turned on), and who turned it on. */
export async function cardIntro(): Promise<{ show: boolean; granted_by: string | null }> { return must(await db.rpc('card_intro')) as { show: boolean; granted_by: string | null }; }
export async function cardIntroDone(): Promise<void> { must(await db.rpc('card_intro_done')); }
export async function receiptTemplate(): Promise<TemplateInfo> { return must(await db.rpc('card_receipt_template_get')) as TemplateInfo; }
export async function saveReceiptTemplate(t: ReceiptTemplate): Promise<void> {
  must(await db.rpc('card_receipt_template_save', { p_subject: t.subject, p_greeting: t.greeting, p_closing: t.closing, p_footer: t.footer }));
}

// ───────────── the form ─────────────
export interface SeasonOption { key: string; season: Season; year: number; label: string }
/** The seasons a sale can be for: the ones still ahead, soonest first (late November 2026 → Spring 2027, Fall 2027). */
export function seasonOptions(now = new Date()): SeasonOption[] {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const all: [Season, number][] = m <= 5 ? [['spring', y], ['fall', y], ['spring', y + 1], ['fall', y + 1]]
    : m <= 10 ? [['fall', y], ['spring', y + 1], ['fall', y + 1]] : [['spring', y + 1], ['fall', y + 1]];
  return all.map(([season, year]) => ({ key: `${season}:${year}`, season, year, label: `${SEASON_LABEL[season]} ${year}` }));
}
export interface ItemDraft { id: number; service: string; description: string; seasonKey: string; price: string }
export const blankItem = (id: number, seasonKey: string): ItemDraft => ({ id, service: '', description: '', seasonKey, price: '' });
export const itemsToInput = (rows: ItemDraft[]) => rows.map(r => {
  const [season, year] = r.seasonKey.split(':');
  return { service: r.service, description: r.description, season, year: Number(year), price: r.price.replace(/[$,\s]/g, '') };
});
export const serviceOptions = CARD_SERVICES;

// ───────────── the history ─────────────
export const customerName = (s: Pick<CardSale, 'first_name' | 'last_name'>) => `${s.first_name} ${s.last_name}`.trim();
export const cardOf = (s: Pick<CardSale, 'card_type' | 'last4'>) => (s.last4 ? `${cardName(s.card_type)} ••${s.last4}` : '');
export const STATUS_LABEL: Record<SaleStatus, string> = { approved: 'Approved', declined: 'Declined', error: 'No answer', processing: 'Never finished' };
export const STATUS_TONE: Record<SaleStatus, 'g' | 'r' | 'a'> = { approved: 'g', declined: 'r', error: 'a', processing: 'a' };
export function searchSales(list: CardSale[], q: string): CardSale[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter(s => {
    const hay = [customerName(s), s.phone, s.email, s.address, s.city, s.province, s.postal_code, s.processed_by_name, s.transaction_id, s.last4,
      ...s.items.map(i => i.label)].filter(Boolean).join(' ').toLowerCase();
    const digitsHay = (s.phone || '').replace(/\D/g, '');
    return words.every(w => hay.includes(w) || (/^\d{3,}$/.test(w) && digitsHay.includes(w)));
  });
}
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The history as a spreadsheet file: one row per charge attempt. */
export function salesCsv(list: CardSale[]): string {
  const head = ['Date', 'Time (ET)', 'Status', 'First name', 'Last name', 'Phone', 'Email', 'Address', 'City', 'Province', 'Postal code', 'Services',
    'Total charged', 'Subtotal', 'Tax', 'Tax amount', 'Sold by', 'Card', 'Approval code', 'Bambora transaction', 'Message', 'Receipt sent to', 'Notes'];
  const rows = list.map(s => {
    const d = new Date(s.created_at);
    return [d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Toronto' }),
      STATUS_LABEL[s.status], s.first_name, s.last_name, s.phone, s.email, s.address, s.city, s.province, s.postal_code,
      s.items.map(i => `${i.label} (${SEASON_LABEL[i.season]} ${i.year}) $${Number(i.price).toFixed(2)}`).join('; '),
      s.total.toFixed(2), s.subtotal.toFixed(2), `${s.tax_name} ${Math.round(s.tax_rate * 10000) / 100}%`, s.tax_amount.toFixed(2), s.processed_by_name,
      cardOf(s), s.auth_code, s.transaction_id, s.status === 'approved' ? '' : s.message, s.receipt_sent_at ? s.receipt_to : '', s.notes];
  });
  return [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

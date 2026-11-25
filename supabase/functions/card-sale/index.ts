// supabase/functions/card-sale/index.ts — Card Processing: charge a card for a phone sale, keep the record, email the
// receipt (card_* in 20261253800000_card_processing.sql). POST as a signed-in user with the Card Processing permission:
//   { action: 'charge', key, token, sale, confirm_duplicate? }   key: one per press of Charge; token: from Bambora's
//        own card fields (the card number never reaches this function). → { approved, id, ... } | { duplicate } | { error }
//   { action: 'resend_receipt', id, email? }   the receipt for an approved sale again (to another address if given)
//   { action: 'test_receipt' }                  a sample receipt to the caller's own email
// Bambora: BAMBORA_MERCHANT_ID / BAMBORA_API_PASSCODE, the same account and request the worker app's bambora-charge
// uses. Every attempt is also written to bambora_idempotency so it shows in Accounts Reporting › Credit cards.
// Receipts: Resend (RESEND_API_KEY) from receipts@propertystars.app.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { checkSale, DEFAULT_TEMPLATE, digits, EMAIL_RE, renderReceipt, sampleReceipt, type ReceiptData, type ReceiptTemplate, type SaleInput } from './sale.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const FROM = 'Property Stars <receipts@propertystars.app>';
const REPLY_TO = 'receipts@propertystars.app';
const UNSURE = 'Bambora didn’t answer, so this charge may or may not have gone through. Look it up in Bambora before charging this card again.';

interface SaleRow {
  id: string; created_at: string; status: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  address: string; city: string; province: string; postal_code: string | null; items: ReceiptData['sale']['items'];
  total: number; subtotal: number; tax_amount: number; tax_name: string; tax_rate: number; processed_by_name: string;
  transaction_id: string | null; auth_code: string | null; card_type: string | null; last4: string | null; message: string | null;
}
const receiptOf = (r: SaleRow): ReceiptData => ({
  card_type: r.card_type, last4: r.last4, transaction_id: r.transaction_id, charged_at: r.created_at,
  sale: { first_name: r.first_name, last_name: r.last_name, address: r.address, city: r.city, province: r.province as ReceiptData['sale']['province'],
    postal_code: r.postal_code, items: r.items, total: Number(r.total), subtotal: Number(r.subtotal), tax_amount: Number(r.tax_amount),
    tax_name: r.tax_name, tax_rate: Number(r.tax_rate) },
});

async function template(svc: SupabaseClient): Promise<ReceiptTemplate> {
  const { data } = await svc.from('card_receipt_template').select('subject, greeting, closing, footer').eq('id', 1).maybeSingle();
  return (data as ReceiptTemplate | null) || DEFAULT_TEMPLATE;
}
async function sendMail(to: string, mail: { subject: string; html: string; text: string }): Promise<string | null> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) throw new Error('RESEND_API_KEY is missing');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok) throw new Error(`${res.status} ${out.message || ''}`.trim());
  return out.id || null;
}
/** Sends the receipt and records how it went. Never throws: a charge that went through stays approved. */
async function sendReceipt(svc: SupabaseClient, row: SaleRow, to: string): Promise<'sent' | 'failed'> {
  try {
    await sendMail(to, renderReceipt(await template(svc), receiptOf(row)));
    await svc.from('card_sales').update({ receipt_to: to, receipt_sent_at: new Date().toISOString(), receipt_error: null }).eq('id', row.id);
    return 'sent';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('card-sale: receipt', row.id, msg);
    await svc.from('card_sales').update({ receipt_to: to, receipt_error: msg.slice(0, 300) }).eq('id', row.id);
    return 'failed';
  }
}
const SALE_COLS = 'id, created_at, status, first_name, last_name, email, phone, address, city, province, postal_code, items, total, subtotal, tax_amount, tax_name, tax_rate, processed_by_name, transaction_id, auth_code, card_type, last4, message';
const answer = (r: SaleRow, extra: Record<string, unknown> = {}) => ({
  approved: r.status === 'approved', id: r.id, status: r.status, message: r.message, transactionId: r.transaction_id, authCode: r.auth_code,
  cardType: r.card_type, last4: r.last4, total: Number(r.total), ...extra,
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization') || '';
    const user = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: ok } = await user.rpc('card_can');
    if (ok !== true) return json({ error: 'Card Processing isn’t turned on for your account' }, 403);
    const { data: who } = await user.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
    if (!who?.user?.id) return json({ error: 'Sign in again' }, 401);
    const svc = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: me } = await svc.from('app_users').select('id, full_name, email, is_active').eq('id', who.user.id).maybeSingle();
    if (!me?.is_active) return json({ error: 'Sign in again' }, 401);
    const body = await req.json().catch(() => ({})) as { action?: string; key?: string; token?: string; sale?: SaleInput; confirm_duplicate?: boolean; id?: string; email?: string };

    if (body.action === 'test_receipt') {
      if (!me.email || !EMAIL_RE.test(me.email)) return json({ error: 'Your account has no email address to send the test to' }, 400);
      const mail = renderReceipt(await template(svc), sampleReceipt());
      await sendMail(me.email, { ...mail, subject: `[Test] ${mail.subject}` });
      return json({ sent: true, to: me.email });
    }

    if (body.action === 'resend_receipt') {
      const { data: row } = await svc.from('card_sales').select(SALE_COLS).eq('id', body.id || '').maybeSingle();
      if (!row) return json({ error: 'That sale wasn’t found' }, 404);
      const sale = row as SaleRow;
      if (sale.status !== 'approved') return json({ error: 'Only an approved charge has a receipt' }, 400);
      const to = String(body.email || sale.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return json({ error: 'Enter the email address to send it to' }, 400);
      const out = await sendReceipt(svc, sale, to);
      return out === 'sent' ? json({ sent: true, to }) : json({ error: 'The receipt couldn’t be sent. Try again in a minute.' }, 502);
    }

    if (body.action !== 'charge') return json({ error: 'Unknown action' }, 400);
    const key = String(body.key || '');
    const token = String(body.token || '');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(key) || !token) return json({ error: 'The card details didn’t come through. Enter the card again.' }, 400);
    const checked = checkSale(body.sale as SaleInput);
    if (!checked.sale) return json({ error: checked.errors.join(' ') }, 400);
    const sale = checked.sale;
    const merchantId = Deno.env.get('BAMBORA_MERCHANT_ID'), passcode = Deno.env.get('BAMBORA_API_PASSCODE');
    if (!merchantId || !passcode) return json({ error: 'Card payments aren’t set up' }, 500);
    const clientName = `${sale.first_name} ${sale.last_name}`;

    // the same person charged the same amount in the last half hour: ask before charging again
    if (!body.confirm_duplicate) {
      const { data: recent } = await svc.from('card_sales').select('created_at, processed_by_name, total, last4, first_name, last_name, email, phone')
        .eq('status', 'approved').eq('total', sale.total).gte('created_at', new Date(Date.now() - 30 * 60000).toISOString());
      const same = ((recent || []) as { created_at: string; processed_by_name: string; total: number; last4: string | null; first_name: string; last_name: string; email: string | null; phone: string | null }[])
        .find(r => (sale.email && r.email === sale.email) || (sale.phone && r.phone && digits(r.phone) === digits(sale.phone))
          || `${r.first_name} ${r.last_name}`.toLowerCase() === clientName.toLowerCase());
      if (same) return json({ duplicate: { at: same.created_at, by: same.processed_by_name, total: Number(same.total), last4: same.last4 } });
    }

    // claim the key: only the request that inserts the row goes on to charge
    const { data: made, error: claimErr } = await svc.from('card_sales').insert({
      processed_by: me.id, processed_by_name: me.full_name || 'Manager', first_name: sale.first_name, last_name: sale.last_name, phone: sale.phone, email: sale.email,
      address: sale.address, city: sale.city, province: sale.province, postal_code: sale.postal_code, items: sale.items, total: sale.total,
      subtotal: sale.subtotal, tax_amount: sale.tax_amount, tax_name: sale.tax_name, tax_rate: sale.tax_rate, notes: sale.notes,
      locked_gate: sale.locked_gate, sprinklers: sale.sprinklers,
      status: 'processing', idempotency_key: key,
    }).select(SALE_COLS).single();
    if (claimErr || !made) {
      const { data: prior } = await svc.from('card_sales').select(SALE_COLS).eq('idempotency_key', key).maybeSingle();
      if (!prior) throw new Error(claimErr?.message || 'The sale couldn’t be saved, so the card was not charged');
      const p = prior as SaleRow;
      if (p.status === 'processing') return json(answer(p, { pending: true, message: 'This charge is already being processed. Check History in a moment.' }));
      return json(answer(p));
    }
    const row = made as SaleRow;
    await svc.from('bambora_idempotency').insert({ idempotency_key: key, status: 'processing', amount: sale.total.toFixed(2), client_name: clientName });
    const settle = async (status: 'approved' | 'declined' | 'error', fields: Record<string, unknown>, report: Record<string, unknown>) => {
      await svc.from('card_sales').update({ status, ...fields }).eq('id', row.id);
      await svc.from('bambora_idempotency').update({ status, response_data: report }).eq('idempotency_key', key);
      Object.assign(row, { status, ...fields });
    };

    // the charge: the same request the worker app sends
    let res: Response, result: Record<string, unknown> = {};
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 45000);
    try {
      res = await fetch('https://api.na.bambora.com/v1/payments', {
        method: 'POST', signal: stop.signal,
        headers: { Authorization: `Passcode ${btoa(`${merchantId}:${passcode}`)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: sale.total, payment_method: 'token',
          token: { code: token, name: clientName, complete: true },
          billing: { name: clientName, ...(sale.email ? { email_address: sale.email } : {}) },
        }),
      });
      result = await res.json().catch(() => ({})) as Record<string, unknown>;
    } catch (err) {
      console.error('card-sale: no answer from Bambora', row.id, err instanceof Error ? err.message : err);
      await settle('error', { message: UNSURE }, { approved: false, message: UNSURE });
      return json(answer(row, { unsure: true }));
    } finally { clearTimeout(timer); }

    if (res.ok && (result.approved === 1 || result.approved === '1')) {
      const card = (result.card || {}) as { card_type?: string; last_four?: string };
      const fields = { transaction_id: result.id != null ? String(result.id) : null, auth_code: (result.auth_code as string) || null,
        card_type: card.card_type || null, last4: card.last_four || null, message: (result.message as string) || 'Approved' };
      await settle('approved', fields, { approved: true, transactionId: fields.transaction_id, authCode: fields.auth_code, message: fields.message, cardType: fields.card_type, last4: fields.last4 });
      const receipt = sale.email ? await sendReceipt(svc, row, sale.email) : 'none';
      return json(answer(row, { receipt, receiptTo: sale.email }));
    }
    const message = (result.message as string) || 'The card was declined';
    const code = result.code != null ? String(result.code) : null;
    await settle('declined', { message, code }, { approved: false, message, code });
    return json(answer(row));
  } catch (err) {
    console.error('card-sale', err instanceof Error ? err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Something went wrong' }, 500);
  }
});

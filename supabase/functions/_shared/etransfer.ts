// supabase/functions/_shared/etransfer.ts — e-transfer receipts forwarded to payments@propertystars.app.
// Claude reads the forwarded bank notice (who sent it, how much, when, their message), then the receipt is
// matched to an e-transfer sale of the saved payout days (rules in etfMatch.ts; Claude only picks when several
// sales fit). Clear matches count as received at once; the rest are suggested for a person to confirm in
// Super Admin › Accounts Reporting. Nothing here changes a payout.
// Used by ms-mail-inbound (every email to payments@, in the background) and etransfers ("Check again").
import { decide, isForward, plainText, type Candidate, type Receipt } from './etfMatch.ts';

export const ETF_MODEL = Deno.env.get('ETF_MODEL') || Deno.env.get('MAIL_MODEL') || 'claude-sonnet-5-5';
export const PAYMENTS_BOX = 'payments';

const READ_RULES = `You read an email that a business owner forwarded to their payments inbox. It should be a bank's Interac e-Transfer notice: money a customer sent to the business (Canadian Property Stars, a lawn care company). Banks write these differently (RBC, TD, Scotiabank, BMO, CIBC, Tangerine, Simplii, credit unions, Interac itself), often with "deposited", "Autodeposit", "You've received", "has sent you", or "Funds deposited".
Pull out the e-transfer exactly as written. Never guess or invent a value: leave it null when it isn't in the email.
- is_receipt: true only for money RECEIVED by the business (deposited or waiting to be deposited). false for money the business sent, payment requests, statements, ads, or anything else.
- sender_name: the person or company who sent the money (as written, e.g. "JOHN SMITH" → "John Smith").
- sender_email: the sender's email address if shown (not the business's own address, not the bank's no-reply address).
- amount: the amount as a number (e.g. 357.00). Canadian dollars.
- sent_on: the date the e-transfer was sent or deposited, YYYY-MM-DD (the original notice's date, not the forward's).
- reference: the reference number / confirmation number if shown.
- memo: the sender's message if there is one.
- bank: the bank that sent the notice, if you can tell.
Output only JSON: {"is_receipt": true, "sender_name": "...", "sender_email": "...", "amount": 0, "sent_on": "YYYY-MM-DD", "reference": "...", "memo": "...", "bank": "...", "why_not": "..."} (why_not only when is_receipt is false, a few words).`;

const PICK_RULES = `You match one Interac e-Transfer a business received to the sale it paid for. You get the e-transfer (sender, amount, date, message) and the possible sales (client name, address, day, amount). People often pay for a spouse or parent, so the sender's name can differ from the client's; the message often has the address or the client's name. A sale is usually paid the same day or within a few days after. The amount sent is often not exactly the recorded amount — tax added or left off, rounded up, a tip, or part of it now and the rest later — so a close amount with the right name or address is still a match.
Pick the one sale it most likely paid for, or none if you can't tell. Never pick when two sales are equally likely.
Output only JSON: {"key": "<the sale's key or null>", "confidence": "high|medium|low", "reason": "<under 90 characters>"}`;

async function claude(system: string, content: string): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Claude isn’t set up (ANTHROPIC_API_KEY is missing)');
  const ws = (Deno.env.get('ANTHROPIC_WORKSPACE_ID') || '').trim();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', ...(ws ? { 'anthropic-workspace-id': ws } : {}) },
    body: JSON.stringify({ model: ETF_MODEL, max_tokens: 800, system, messages: [{ role: 'user', content }] }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude didn’t answer: ${out?.error?.message || res.status}`);
  const text = (out.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('Claude’s answer wasn’t usable');
  return JSON.parse(m[0]);
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Match one receipt (already read) to a sale and keep the result. */
// deno-lint-ignore no-explicit-any
export async function matchReceipt(svc: any, receiptId: string): Promise<string> {
  const { data: r, error } = await svc.from('etf_receipts').select('id, sender_name, sender_email, amount, sent_on, memo, received_at').eq('id', receiptId).single();
  if (error) throw new Error(error.message);
  const rc = r as Receipt & { id: string; received_at: string };
  const on = rc.sent_on || String(rc.received_at).slice(0, 10);
  const { data: cands, error: ce } = await svc.rpc('etf_candidates', { p_amount: rc.amount, p_on: on, p_name: rc.sender_name || '' });
  if (ce) throw new Error(ce.message);
  let d = decide(rc, (cands || []) as Candidate[]);
  if (!d.key && d.ask?.length) {
    const pick = await claude(PICK_RULES, JSON.stringify({ e_transfer: rc, sales: d.ask.map(c => ({ key: c.key, client: c.client, address: c.address, day: c.day, amount: c.amount, centre: c.center })) }));
    const key = str(pick.key);
    if (key && d.ask.some(c => c.key === key)) d = { ...d, key, how: 'claude', confidence: (str(pick.confidence) as 'high' | 'medium' | 'low') || 'low', reason: str(pick.reason) || d.reason };
  }
  if (!d.key) {
    await svc.from('etf_receipts').update({ status: 'unmatched', note: d.reason, updated_at: new Date().toISOString() }).eq('id', receiptId);
    return 'unmatched';
  }
  const { error: le } = await svc.rpc('etf_link', { p_receipt: receiptId, p_key: d.key, p_how: d.how, p_confidence: d.confidence, p_reason: d.reason, p_confirmed: d.confirmed, p_by: null });
  if (le) throw new Error(le.message);
  await svc.from('etf_receipts').update({ note: d.reason }).eq('id', receiptId);
  return d.confirmed ? 'matched' : 'review';
}

/** An email that just landed: if it's for payments@, read it and match it. Returns the receipt id, or null. */
// deno-lint-ignore no-explicit-any
export async function receiptFor(svc: any, messageId: string): Promise<string | null> {
  const { data: m, error } = await svc.from('ms_messages').select('id, thread_id, dir, from_email, subject, html, text_body, at').eq('id', messageId).single();
  if (error || !m || m.dir !== 'in') return null;
  const { data: t } = await svc.from('ms_threads').select('mailbox_id').eq('id', m.thread_id).single();
  if (!t?.mailbox_id) return null;
  const { data: box } = await svc.from('mail_boxes').select('local').eq('id', t.mailbox_id).single();
  if (box?.local !== PAYMENTS_BOX) return null;

  const body = plainText(m.html, m.text_body);
  const base = { message_id: m.id, received_at: m.at, forwarded_by: m.from_email, subject: m.subject, updated_at: new Date().toISOString() };
  const save = async (row: Record<string, unknown>) => {
    const { data, error: e } = await svc.from('etf_receipts').upsert({ ...base, ...row }, { onConflict: 'message_id' }).select('id').single();
    if (e) throw new Error(e.message);
    return data.id as string;
  };
  // only forwards are processed
  if (!isForward(m.subject, body)) return save({ status: 'not_forward', note: 'Not a forward: only forwarded bank notices are read' });
  let p: Record<string, unknown>;
  try {
    p = await claude(READ_RULES, `Forwarded by: ${m.from_email}\nSubject: ${m.subject || ''}\n\n${body}`);
  } catch (err) {
    return save({ status: 'error', note: err instanceof Error ? err.message : 'Couldn’t read it' });
  }
  if (p.is_receipt !== true) return save({ status: 'not_receipt', note: str(p.why_not) || 'Not an e-transfer received', parsed: p });
  const id = await save({
    status: 'new', note: null, parsed: p,
    sender_name: str(p.sender_name), sender_email: str(p.sender_email)?.toLowerCase() || null, amount: num(p.amount),
    sent_on: day(p.sent_on), reference: str(p.reference), memo: str(p.memo), bank: str(p.bank),
  });
  try { await matchReceipt(svc, id); }
  catch (err) { await svc.from('etf_receipts').update({ status: 'error', note: err instanceof Error ? err.message : 'Matching failed' }).eq('id', id); }
  return id;
}

// Receipts from email (supabase/functions/planner-mail: the `receipts` action in handle.ts, the checking in mail.ts),
// with a pretend database, a pretend Google and a pretend Claude: nothing here touches the network. Every person,
// address, shop, amount and token is made up for the test.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetAccess, handle, RECEIPTS_MAX, type ClaudeTool, type Deps, type MailboxRow, type Me, type Out, type Store } from '../../../../supabase/functions/planner-mail/handle';
import type { Fetch } from '../../../../supabase/functions/planner-mail/gmail';
import { b64u, mailKey, seal, tokenOwner } from '../../../../supabase/functions/planner-mail/secure';
import { EXPIRED, NOT_SET_UP, RECEIPT_SCHEMA, mailReceiptKey, moneyCategory, readReceiptsCursor, receiptInput, receiptQuery, receiptSystem, receiptsFrom, receiptsSince, writeReceiptsCursor,
  type CheckMail, type EmailReceipt } from '../../../../supabase/functions/planner-mail/mail';
import { MONEY_CATEGORIES } from '../../../../supabase/functions/_shared/plannerMoney';
import { CATEGORY_NAMES } from '../money/categories';

const KEY = b64u(new Uint8Array(32).map((_, i) => (i * 7 + 3) % 256));
const SECRET = 'made-up-client-secret';
const ENV: Record<string, string> = { GOOGLE_OAUTH_CLIENT_ID: 'made-up-client-id.apps.example', GOOGLE_OAUTH_CLIENT_SECRET: SECRET, PLANNER_MAIL_KEY: KEY, SUPABASE_URL: 'https://example.supabase.co' };
// Vijay's rows hold the household's docs; Rosh belongs to his household
const VIJAY: Me = { id: 'u-vijay', name: 'Vijay', app: 'vijayplanner', household: 'u-vijay' }, ROSH: Me = { id: 'u-rosh', name: 'Rosh', app: 'roshplanner', household: 'u-vijay' };
const LONER: Me = { id: 'u-loner', name: 'Sam', app: 'vijayplanner' };
const T0 = Date.parse('2026-11-13T17:00:00Z');   // 13 November 2026, noon in Toronto
const DAY = 86_400_000;
const web = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface Msg { id: string; at: number; from: string; subject: string; text: string }
/** What the pretend Claude answers for an email, by its subject. None: not a purchase. */
type Answer = Record<string, unknown>;

function world() {
  let n = 0;
  const w = {
    now: T0, env: { ...ENV } as Record<string, string>, boxes: [] as MailboxRow[],
    docs: [] as { user: string; kind: string; key: string; data: unknown }[],
    logs: [] as string[], calls: [] as { url: string; who: string }[],
    // Google: which refresh token is whose mailbox, and what is in each
    refresh: {} as Record<string, string>, access: {} as Record<string, string>, mail: {} as Record<string, Msg[]>, noRead: [] as string[], down: [] as string[],
    answers: {} as Record<string, Answer>, claudeFails: [] as string[], claudeTakesMs: 0,
    asked: [] as { system: string; user: string; tool?: ClaudeTool }[],
  };
  const reply = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch: Fetch = (url, init = {}) => {
    const u = new URL(url), form = new URLSearchParams(init.body || '');
    if (url === 'https://oauth2.googleapis.com/token') {
      const email = w.refresh[form.get('refresh_token') || ''];
      w.calls.push({ url, who: email || '?' });
      if (!email) return reply(400, { error: 'invalid_grant' });
      const access = `access-${++n}`; w.access[access] = email;
      return reply(200, { access_token: access, expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    }
    const email = w.access[(init.headers?.Authorization || '').replace(/^Bearer /, '')];
    w.calls.push({ url, who: email || '?' });
    if (!email) return reply(401, { error: { status: 'UNAUTHENTICATED' } });
    if (w.down.includes(email)) return reply(503, { error: { status: 'UNAVAILABLE' } });
    if (w.noRead.includes(email)) return reply(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
    const path = u.pathname.replace('/gmail/v1/users/me', ''), box = w.mail[email] || [];
    if (path === '/messages') {
      const q = u.searchParams.get('q') || '', after = q.match(/after:(\d{4})\/(\d{2})\/(\d{2})/);
      const from = after ? Date.parse(`${after[1]}-${after[2]}-${after[3]}T00:00:00Z`) : 0;
      const hits = box.filter(m => m.at >= from).sort((a, b) => b.at - a.at);
      const max = Number(u.searchParams.get('maxResults')), at = Number((u.searchParams.get('pageToken') || 'p0').slice(1));
      const page = hits.slice(at, at + max);
      return reply(200, { messages: page.map(m => ({ id: m.id, threadId: `t-${m.id}` })), ...(at + max < hits.length ? { nextPageToken: `p${at + max}` } : {}) });
    }
    const m = box.find(x => path === `/messages/${x.id}`);
    if (!m) return reply(404, { error: { status: 'NOT_FOUND' } });
    return reply(200, { id: m.id, threadId: `t-${m.id}`, labelIds: ['INBOX'], internalDate: String(m.at), snippet: m.text.slice(0, 60),
      payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }], body: { size: m.text.length, data: web(Buffer.from(m.text)) } } });
  };
  const store: Store = {
    async startState() { /* not used */ }, async peekState() { return null; }, async claimState() { return null; },
    async mailboxes(userId) { return w.boxes.filter(b => b.user_id === userId).map(b => ({ ...b })); },
    async mailbox(userId, id) { const b = w.boxes.find(x => x.id === id && x.user_id === userId); return b ? { ...b } : null; },
    async saveMailbox() { throw new Error('not used'); },
    async updateMailbox(id, patch) { const b = w.boxes.find(x => x.id === id); if (b) Object.assign(b, patch); },
    async deleteMailbox(id) { w.boxes = w.boxes.filter(b => b.id !== id); },
    async watched() { return []; }, async person() { return null; }, async addTodos() { return 0; }, async dropWaiting() { /* not used */ },
    async cronKey() { return 'cron'; },
    async haveDocs(owner, kind, keys) { return keys.filter(k => w.docs.some(d => d.user === owner && d.kind === kind && d.key === k)); },
    async addDocs(owner, list) {
      for (const d of list) if (!w.docs.some(x => x.user === owner && x.kind === d.kind && x.key === d.key)) w.docs.push({ user: owner, kind: d.kind, key: d.key, data: d.data });
    },
  };
  const claude = vi.fn(async (system: string, user: string, _schema: unknown, tool?: ClaudeTool): Promise<unknown> => {
    w.asked.push({ system, user, tool });
    w.now += w.claudeTakesMs;
    const parts = user.split('\n\n=====\n\n');
    const subjects = parts.map(p => p.match(/^Subject: (.*)$/m)?.[1] || '');
    if (subjects.some(s => w.claudeFails.includes(s))) throw new Error('Claude: 529 overloaded_error');
    return { receipts: subjects.map((s, i) => ({ mail_index: i + 1, is_purchase: false, ...(w.answers[s] || {}) })) };
  });
  const people: Record<string, Me> = { 'tok-vijay': VIJAY, 'tok-rosh': ROSH, 'tok-loner': LONER };
  const deps: Deps = { store, fetch, env: k => w.env[k] || '', now: () => w.now, me: async t => people[t] || null, claude, notify: vi.fn(async () => undefined), log: l => { w.logs.push(l); } };
  const post = (body: Record<string, unknown>): Promise<Out> => handle({ method: 'POST', path: '/planner-mail', query: new URLSearchParams(), body, cronKey: '' }, deps);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (o: Promise<Out>): Promise<Record<string, any>> => { const r = await o; if (!('json' in r)) throw new Error('not JSON'); return { status: r.status, ...(r.json as object) }; };
  /** A connected mailbox of someone's, with its sign-in locked as the real one is. */
  const box = async (who: Me, address: string, refresh = `refresh-${address}`) => {
    const row: MailboxRow = { id: `00000000-0000-4000-8000-${String(w.boxes.length + 1).padStart(12, '0')}`, user_id: who.id, provider: 'google', address, token_enc: '', scopes: 'https://www.googleapis.com/auth/gmail.readonly',
      todos: false, last_checked_at: null, cursor: null, problem: null, created_at: new Date(T0 - 100 * DAY + w.boxes.length).toISOString() };
    row.token_enc = await seal(await mailKey(KEY), refresh, tokenOwner(row));
    w.refresh[refresh] = address;
    w.boxes.push(row);
    return row;
  };
  let m = 0;
  /** An email in a mailbox, `daysAgo` days back. */
  const email = (address: string, subject: string, text: string, daysAgo = 3, from = 'Shop <orders@shop.example>') => {
    const msg = { id: `msg${String(++m).padStart(5, '0')}`, at: T0 - daysAgo * DAY, from, subject, text };
    (w.mail[address] ||= []).push(msg);
    return msg;
  };
  const receipts = (token: string, more: Record<string, unknown> = {}) => json(post({ token, action: 'receipts', ...more }));
  /** Call again until more is false, as the app does. */
  const all = async (token: string, more: Record<string, unknown> = {}) => {
    const answers = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await receipts(token, { ...more, ...(cursor ? { cursor } : {}) });
      answers.push(r);
      if (!r.more) break;
      cursor = r.cursor;
    }
    return answers;
  };
  const docsOf = (kind: string, user?: string) => w.docs.filter(d => d.kind === kind && (!user || d.user === user));
  const reads = () => w.calls.filter(c => /\/messages\/msg/.test(c.url));
  return { w, deps, post, json, box, email, receipts, all, docsOf, reads, claude };
}

beforeEach(() => { forgetAccess(); });

describe('receipts: who may ask, and when it isn’t set up', () => {
  it('needs a planner token the server knows', async () => {
    const x = world();
    await x.box(VIJAY, 'vijay@example.com');
    x.email('vijay@example.com', 'Your order', 'Total $10.00');
    expect(await x.post({ action: 'receipts' })).toEqual({ status: 401, json: { error: 'signed_out' } });
    expect(await x.post({ action: 'receipts', token: 'nope' })).toEqual({ status: 401, json: { error: 'signed_out' } });
    expect(x.w.calls).toHaveLength(0);
  });
  it('a missing secret is a plain problem, and Google isn’t asked', async () => {
    const x = world();
    x.w.env.PLANNER_MAIL_KEY = '';
    await x.box(VIJAY, 'vijay@example.com');
    expect(await x.receipts('tok-vijay')).toEqual({ status: 200, problem: NOT_SET_UP, code: 'not_set_up' });
    expect(x.w.calls).toHaveLength(0);
  });
  it('no mailboxes: nothing to look through', async () => {
    const x = world();
    expect(await x.receipts('tok-vijay')).toEqual({ status: 200, scanned: 0, found: 0, more: false, mailboxes: [] });
  });
});

describe('receipts: one look', () => {
  async function shop() {
    const x = world();
    await x.box(VIJAY, 'vijay@example.com');
    const order = x.email('vijay@example.com', 'Your Amazon.ca order #702-1', 'Order total: $56.49 CAD (HST $6.50). Paid with Visa ending 4242. Card 4111 1111 1111 1111 was charged.', 5, 'Amazon.ca <auto-confirm@amazon.example>');
    const ad = x.email('vijay@example.com', 'Your order is waiting: 20% off', 'Come back and finish your order!', 4);
    const sent = x.email('vijay@example.com', 'INTERAC e-Transfer: Your money transfer to PRIYA SHAH was deposited', 'Your INTERAC e-Transfer to PRIYA SHAH (priya@example.org) was deposited. Amount: $120.00', 2, 'Interac <notify@payments.interac.example>');
    const got = x.email('vijay@example.com', 'INTERAC e-Transfer: JOHN DOE sent you money', 'JOHN DOE sent you $40.00 and the money has been automatically deposited.', 1, 'Interac <notify@payments.interac.example>');
    x.w.answers[order.subject] = { is_purchase: true, merchant: '  Amazon  ', date: '2026-11-08', total: 56.49, tax: 6.5, currency: 'cad', card_last4: '4242', paid_by: 'card', category: 'Shopping',
      items: [{ name: 'USB-C cable', amount: 19.99, category: 'Shopping' }, { name: 'Coffee beans', amount: 30, category: 'Groceries' }] };
    x.w.answers[sent.subject] = { is_purchase: true, merchant: 'Priya Shah', date: '2026-11-11', total: 120, paid_by: 'etransfer', payee: { name: 'Priya Shah', email: 'Priya@Example.org' }, category: 'Transfers', items: [] };
    x.w.answers[got.subject] = { is_purchase: false };
    return { x, order, ad, sent, got };
  }

  it('finds what was paid, saves each as a household receipt, and remembers every email looked at', async () => {
    const { x, order, ad, sent, got } = await shop();
    const r = await x.receipts('tok-vijay');
    expect(r).toEqual({ status: 200, scanned: 4, found: 2, more: false, mailboxes: [{ address: 'vijay@example.com', scanned: 4, found: 2 }] });
    const saved = x.docsOf('receipt').map(d => d.data as EmailReceipt);
    expect(saved).toHaveLength(2);
    const amazon = saved.find(s => s.merchant === 'Amazon')!;
    expect(amazon).toMatchObject({ date: '2026-11-08', total: 56.49, tax: 6.5, currency: 'CAD', cardLast4: '4242', paidBy: 'card', payment: 'card', kind: 'receipt', category: 'Shopping', photos: 0,
      from: 'email', addedAt: new Date(T0).toISOString(), email: { mailbox: 'vijay@example.com', id: order.id, subject: order.subject, sender: 'Amazon.ca <auto-confirm@amazon.example>' },
      items: [{ name: 'USB-C cable', amount: 19.99, category: 'Shopping' }, { name: 'Coffee beans', amount: 30, category: 'Groceries' }] });
    expect(amazon.id).toBe(`email_${x.w.boxes[0].id.replace(/-/g, '').slice(-12)}_${order.id}`);
    expect(x.docsOf('receipt').find(d => (d.data as EmailReceipt).id === amazon.id)!.key).toBe(`2026-11-08~${amazon.id}`);
    // the e-transfer this person sent: a transaction, with who it went to
    const etf = saved.find(s => s.paidBy === 'etransfer')!;
    expect(etf).toMatchObject({ kind: 'transaction', merchant: 'Priya Shah', total: 120, category: 'Transfers', payee: { name: 'Priya Shah', email: 'priya@example.org' }, email: { id: sent.id } });
    // the advert and the e-transfer received: looked at, remembered, not saved
    const marks = x.docsOf('mailreceipt');
    expect(marks.map(d => d.key).sort()).toEqual([order, ad, sent, got].map(m => mailReceiptKey(x.w.boxes[0].id, m.id)).sort());
    expect(marks.find(d => d.key.endsWith(ad.id))!.data).toEqual({ at: new Date(T0).toISOString(), found: false });
    expect(marks.find(d => d.key.endsWith(got.id))!.data).toEqual({ at: new Date(T0).toISOString(), found: false });
    expect(marks.find(d => d.key.endsWith(order.id))!.data).toEqual({ at: new Date(T0).toISOString(), found: true, receiptKey: `2026-11-08~${amazon.id}` });
  });

  it('Claude is asked with the receipts tool, the emails five at most, a card number never in what it reads', async () => {
    const { x } = await shop();
    await x.receipts('tok-vijay');
    expect(x.w.asked).toHaveLength(1);
    const q = x.w.asked[0];
    expect(q.tool).toMatchObject({ name: 'receipts' });
    expect(x.claude.mock.calls[0][2]).toBe(RECEIPT_SCHEMA);
    expect(q.user).not.toContain('4111 1111 1111 1111');
    expect(q.user).toContain('[a card number]');
    expect(q.system).toContain('Vijay');
    expect(q.system).toContain('INTERAC');
  });

  it('a look run again reads nothing twice and saves nothing twice', async () => {
    const { x } = await shop();
    await x.receipts('tok-vijay');
    const before = x.reads().length, docs = x.w.docs.length;
    const again = await x.receipts('tok-vijay');
    expect(again).toMatchObject({ scanned: 0, found: 0, more: false, mailboxes: [{ address: 'vijay@example.com', scanned: 0, found: 0 }] });
    expect(x.reads().length).toBe(before);
    expect(x.w.docs.length).toBe(docs);
    expect(x.claude).toHaveBeenCalledTimes(1);
    // a new email since: only that one is read
    const late = x.email('vijay@example.com', 'Receipt from Uber', 'Total CA$18.20', 0);
    x.w.answers[late.subject] = { is_purchase: true, merchant: 'Uber', total: 18.2, date: '2026-11-13', paid_by: 'card', category: 'Transport' };
    expect(await x.receipts('tok-vijay')).toMatchObject({ scanned: 1, found: 1 });
    expect(x.reads().length).toBe(before + 1);
  });

  it('Gmail is searched from twelve months back by default, or from the day asked for', async () => {
    const { x } = await shop();
    await x.receipts('tok-vijay');
    const q = () => new URL(x.w.calls.filter(c => /\/messages\?/.test(c.url)).slice(-1)[0].url).searchParams.get('q')!;
    expect(q()).toBe(receiptQuery('2025-11-13'));
    expect(q()).toMatch(/^after:2025\/11\/13 -in:spam -in:trash \(category:purchases OR subject:\(receipt OR "order confirmation"/);
    await x.receipts('tok-vijay', { since: '2026-06-01' });
    expect(q()).toContain('after:2026/06/01 ');
    for (const bad of ['2027-01-01', '2020-01-01', 'yesterday', '2026-02-30']) { await x.receipts('tok-vijay', { since: bad }); expect(q()).toContain('after:2025/11/13 '); }
  });

  it('household money is written under the household’s owner, whoever asks', async () => {
    const x = world();
    await x.box(ROSH, 'rosh@example.com');
    const m = x.email('rosh@example.com', 'Your receipt from Loblaws', 'Total $82.10');
    x.w.answers[m.subject] = { is_purchase: true, merchant: 'Loblaws', total: 82.1, date: '2026-11-10', paid_by: 'card', category: 'Groceries' };
    expect(await x.receipts('tok-rosh')).toMatchObject({ found: 1 });
    expect(x.w.docs.every(d => d.user === 'u-vijay')).toBe(true);
    expect(x.docsOf('receipt', 'u-vijay')).toHaveLength(1);
    expect(x.docsOf('mailreceipt', 'u-vijay')).toHaveLength(1);
    // someone with no household: their own rows
    const y = world();
    await y.box(LONER, 'sam@example.com');
    const s = y.email('sam@example.com', 'Your receipt', 'Total $5');
    y.w.answers[s.subject] = { is_purchase: true, merchant: 'Shop', total: 5, date: '2026-11-10', paid_by: 'card', category: 'Other' };
    await y.receipts('tok-loner');
    expect(y.w.docs.every(d => d.user === 'u-loner')).toBe(true);
  });

  it('only this person’s own mailboxes are looked through, even with someone else’s mailbox in the cursor', async () => {
    const x = world();
    const mine = await x.box(VIJAY, 'vijay@example.com');
    const hers = await x.box(ROSH, 'rosh@example.com');
    x.email('vijay@example.com', 'Your receipt', 'Total $5');
    x.email('rosh@example.com', 'Your receipt from the spa', 'Total $150');
    const r = await x.receipts('tok-vijay');
    expect(r.mailboxes).toEqual([{ address: 'vijay@example.com', scanned: 1, found: 0 }]);
    // a cursor pointing at Rosh's mailbox: it isn't Vijay's, so it isn't read
    const forged = writeReceiptsCursor({ s: '2025-11-13', m: hers.id, i: 0, p: '', t: [] });
    const r2 = await x.receipts('tok-vijay', { cursor: forged });
    expect(r2.mailboxes.map((b: { address: string }) => b.address)).toEqual(['vijay@example.com']);
    expect(x.w.calls.every(c => c.who === 'vijay@example.com')).toBe(true);
    expect(x.w.docs.every(d => d.key.startsWith(`${mine.id}~`))).toBe(true);
  });
});

describe('receipts: a call at a time', () => {
  it('pages across two mailboxes with the cursor, 40 new emails a call at most, until more is false', async () => {
    const x = world();
    await x.box(VIJAY, 'one@example.com');
    await x.box(VIJAY, 'two@example.com');
    for (let i = 0; i < 60; i++) { const m = x.email('one@example.com', `Receipt one ${i}`, `Total $${i + 1}.00`, 1 + i); x.w.answers[m.subject] = { is_purchase: true, merchant: 'One', total: i + 1, paid_by: 'card', category: 'Shopping' }; }
    for (let i = 0; i < 10; i++) { const m = x.email('two@example.com', `Receipt two ${i}`, `Total $${i + 1}.00`, 1 + i); x.w.answers[m.subject] = { is_purchase: true, merchant: 'Two', total: i + 1, paid_by: 'card', category: 'Shopping' }; }
    const first = await x.receipts('tok-vijay');
    expect(first).toMatchObject({ scanned: RECEIPTS_MAX, found: RECEIPTS_MAX, more: true, mailboxes: [{ address: 'one@example.com', scanned: 40, found: 40 }] });
    expect(typeof first.cursor).toBe('string');
    const second = await x.receipts('tok-vijay', { cursor: first.cursor });
    // the rest of the first page (10), Gmail's second page (10), then the second mailbox (10)
    expect(second).toMatchObject({ scanned: 30, found: 30, more: false, mailboxes: [{ address: 'one@example.com', scanned: 20, found: 20 }, { address: 'two@example.com', scanned: 10, found: 10 }] });
    expect(second.cursor).toBeUndefined();
    expect(x.w.calls.some(c => new URL(c.url).searchParams.get('pageToken') === 'p50')).toBe(true);
    // every email once: 70 reads, 70 receipts (dates from when each arrived, since Claude gave none)
    expect(x.reads()).toHaveLength(70);
    expect(new Set(x.reads().map(c => c.url)).size).toBe(70);
    expect(x.docsOf('receipt')).toHaveLength(70);
    expect((x.docsOf('receipt')[0].data as EmailReceipt).date).toBe('2026-11-12');
  });

  it('every page with more has a new cursor; the same since sent with it is accepted, and the cursor’s day is kept', async () => {
    const x = world();
    await x.box(VIJAY, 'one@example.com');
    for (let i = 0; i < 100; i++) x.email('one@example.com', `Order ${i}`, 'Total $1', 1 + i);
    const seen: string[] = [];
    let cursor: string | undefined, pages = 0, total = 0;
    for (;;) {
      const r = await x.receipts('tok-vijay', { since: '2026-06-01', ...(cursor ? { cursor } : {}) });
      pages++; total += r.scanned;
      expect(r.scanned).toBe(r.mailboxes.reduce((a: number, b: { scanned: number }) => a + b.scanned, 0));
      if (!r.more) { expect(r.cursor).toBeUndefined(); break; }
      expect(typeof r.cursor === 'string' && r.cursor.length > 0).toBe(true);
      expect(seen).not.toContain(r.cursor);
      seen.push(r.cursor); cursor = r.cursor;
    }
    // 1 June 2026 to 12 November: 165 days of the hundred are inside, so every one, and each once
    expect(total).toBe(100);
    expect(pages).toBe(3);
    expect(x.w.calls.filter(c => /\/messages\?/.test(c.url)).every(c => new URL(c.url).searchParams.get('q')!.startsWith('after:2026/06/01 '))).toBe(true);
  });

  it('a receipt already there is never written over, and reading an email again gives the same id', async () => {
    const x = world();
    const row = await x.box(VIJAY, 'one@example.com');
    const m = x.email('one@example.com', 'Your receipt from Costco', 'Total $99.00', 2);
    x.w.answers[m.subject] = { is_purchase: true, merchant: 'Costco', total: 99, date: '2026-11-11', paid_by: 'card', category: 'Groceries' };
    await x.receipts('tok-vijay');
    const doc = x.docsOf('receipt')[0];
    // the app matched it to a bank row
    doc.data = { ...(doc.data as object), txnId: 'plaid_1', matchedAt: '2026-11-13T18:00:00.000Z' };
    // the mark lost (or the app re-scanning from three days back): read again, and the receipt is the same one, untouched
    x.w.docs = x.w.docs.filter(d => d.kind !== 'mailreceipt');
    x.w.answers[m.subject] = { ...x.w.answers[m.subject], total: 1 };
    expect(await x.receipts('tok-vijay', { since: '2026-11-10' })).toMatchObject({ scanned: 1 });
    expect(x.docsOf('receipt')).toHaveLength(1);
    expect(x.docsOf('receipt')[0].data).toMatchObject({ id: `email_${row.id.replace(/-/g, '').slice(-12)}_${m.id}`, total: 99, txnId: 'plaid_1' });
    // with the mark in place a re-scan is a no-op
    expect(await x.receipts('tok-vijay', { since: '2026-11-10' })).toMatchObject({ scanned: 0, found: 0 });
  });

  it('stops after about a minute and carries on from the same place', async () => {
    const x = world();
    await x.box(VIJAY, 'one@example.com');
    for (let i = 0; i < 30; i++) x.email('one@example.com', `Order ${i}`, 'Total $1', 1 + i);
    x.w.claudeTakesMs = 25_000;   // each question to Claude takes 25 s (three are asked side by side)
    const first = await x.receipts('tok-vijay');
    expect(first).toMatchObject({ scanned: 15, more: true });
    x.w.claudeTakesMs = 0;
    const rest = await x.all('tok-vijay', {});
    expect(rest[0]).toMatchObject({ scanned: 15, more: false });   // started over without a cursor: the 15 done are skipped
    expect(x.reads()).toHaveLength(30);
    const y = world();
    await y.box(VIJAY, 'one@example.com');
    for (let i = 0; i < 30; i++) y.email('one@example.com', `Order ${i}`, 'Total $1', 1 + i);
    y.w.claudeTakesMs = 25_000;
    const a = await y.receipts('tok-vijay');
    y.w.claudeTakesMs = 0;
    expect(await y.receipts('tok-vijay', { cursor: a.cursor })).toMatchObject({ scanned: 15, more: false });
  });

  it('emails Claude couldn’t answer for are passed over for this look, not remembered, and tried at the next', async () => {
    const x = world();
    await x.box(VIJAY, 'one@example.com');
    const bad = x.email('one@example.com', 'Receipt that fails', 'Total $9', 2);
    const good = x.email('one@example.com', 'Receipt good', 'Total $3', 30);
    // the two land in different questions only past five; here put the failing one with four others
    for (let i = 0; i < 4; i++) x.email('one@example.com', `Filler ${i}`, 'Hello', 3 + i);
    x.w.answers[good.subject] = { is_purchase: true, merchant: 'Good', total: 3, date: '2026-10-14', paid_by: 'card', category: 'Other' };
    x.w.claudeFails = [bad.subject];
    const r = await x.receipts('tok-vijay');
    expect(r.more).toBe(false);
    expect(x.docsOf('mailreceipt').some(d => d.key.endsWith(bad.id))).toBe(false);
    expect(x.docsOf('mailreceipt').some(d => d.key.endsWith(good.id))).toBe(true);
    expect(x.w.logs.some(l => /not read for receipts \(Claude: 529/.test(l))).toBe(true);
    expect(JSON.stringify(x.w.logs)).not.toContain('Receipt that fails');
    x.w.claudeFails = [];
    x.w.answers[bad.subject] = { is_purchase: true, merchant: 'Late', total: 9, date: '2026-11-11', paid_by: 'card', category: 'Other' };
    expect(await x.receipts('tok-vijay')).toMatchObject({ scanned: 5, found: 1 });   // the five of that question, read again
  });

  it('a cursor that isn’t one of ours starts the look again, and nothing is read twice', async () => {
    const x = world();
    await x.box(VIJAY, 'one@example.com');
    x.email('one@example.com', 'Receipt', 'Total $2');
    await x.receipts('tok-vijay');
    for (const junk of ['not a cursor!', 'eyJ4IjoxfQ', 123, { s: '2026-01-01' }]) expect(await x.receipts('tok-vijay', { cursor: junk })).toMatchObject({ status: 200, scanned: 0, more: false });
    expect(x.reads()).toHaveLength(1);
  });
});

describe('receipts: a mailbox that can’t be read', () => {
  it('has its problem in plain words, and the other mailboxes are still looked through', async () => {
    const x = world();
    const gone = await x.box(VIJAY, 'old@example.com');
    delete x.w.refresh['refresh-old@example.com'];   // Google no longer knows its sign-in
    await x.box(VIJAY, 'locked@example.com');
    x.w.noRead.push('locked@example.com');
    await x.box(VIJAY, 'busy@example.com');
    x.w.down.push('busy@example.com');
    const signedOut = await x.box(VIJAY, 'signedout@example.com');
    x.w.boxes.find(b => b.id === signedOut.id)!.token_enc = null;
    await x.box(VIJAY, 'fine@example.com');
    const m = x.email('fine@example.com', 'Your receipt', 'Total $4');
    x.w.answers[m.subject] = { is_purchase: true, merchant: 'Fine', total: 4, date: '2026-11-10', paid_by: 'card', category: 'Other' };
    const r = await x.receipts('tok-vijay');
    expect(r.more).toBe(false);
    expect(r.found).toBe(1);
    expect(r.mailboxes).toEqual([
      { address: 'old@example.com', scanned: 0, found: 0, problem: EXPIRED },
      { address: 'locked@example.com', scanned: 0, found: 0, problem: 'This mailbox wasn’t given permission to be read. Disconnect it, connect it again, and tick both boxes on Google’s page.' },
      { address: 'busy@example.com', scanned: 0, found: 0, problem: expect.stringMatching(/^Google didn’t answer/) },
      { address: 'signedout@example.com', scanned: 0, found: 0, problem: EXPIRED },
      { address: 'fine@example.com', scanned: 1, found: 1 },
    ]);
    // the run-out sign-in is marked on the mailbox, as everywhere else
    expect(x.w.boxes.find(b => b.id === gone.id)).toMatchObject({ token_enc: null, problem: EXPIRED });
    expect(JSON.stringify(x.w.logs)).not.toMatch(/@example\.com|refresh-|access-/);
  });
});

describe('receipts: what Claude says, checked (receiptsFrom)', () => {
  const mails: CheckMail[] = [
    { id: 'mail00001', at: Date.parse('2026-11-10T15:00:00Z'), from: 'Shop <orders@shop.example>', subject: 'Your order', text: '' },
    { id: 'mail00002', at: Date.parse('2026-11-11T03:00:00Z'), from: 'Interac <notify@interac.example>', subject: 'INTERAC e-Transfer', text: '' },
    { id: 'mail00003', at: Date.parse('2024-01-01T15:00:00Z'), from: 'Old <old@shop.example>', subject: 'Receipt 4111 1111 1111 1111', text: '' },
  ];
  let n = 0;
  const c = { mailbox: 'vijay@example.com', since: '2025-11-13', today: '2026-11-13', nowIso: '2026-11-13T17:00:00.000Z', uid: (m: CheckMail) => `id-${m.id}-${++n}` };
  const one = (r: Record<string, unknown>, i = 1) => receiptsFrom({ receipts: [{ mail_index: i, is_purchase: true, merchant: 'Shop', total: 10, date: '2026-11-10', paid_by: 'card', category: 'Shopping', ...r }] }, mails, c)[i - 1].receipt?.data;

  it('gives one entry per email, null where it isn’t a purchase', () => {
    const out = receiptsFrom({ receipts: [{ mail_index: 1, is_purchase: true, merchant: 'Shop', total: 10, date: '2026-11-10', category: 'Shopping' }, { mail_index: 2, is_purchase: false, total: 5 }] }, mails, c);
    expect(out.map(o => o.mail.id)).toEqual(['mail00001', 'mail00002', 'mail00003']);
    expect(out.map(o => !!o.receipt)).toEqual([true, false, false]);
    for (const junk of [null, undefined, 'text', {}, { receipts: 'x' }, { receipts: [null, 5, 'x'] }]) expect(receiptsFrom(junk, mails, c).every(o => o.receipt === null)).toBe(true);
  });
  it('only emails that were asked about, and one receipt per email (the first answer)', () => {
    const out = receiptsFrom({ receipts: [{ mail_index: 0, is_purchase: true, total: 1, date: '2026-11-10' }, { mail_index: 9, is_purchase: true, total: 1, date: '2026-11-10' }, { mail_index: 1.5, is_purchase: true, total: 1 },
      { mail_index: 1, is_purchase: true, merchant: 'First', total: 1, date: '2026-11-10' }, { mail_index: 1, is_purchase: true, merchant: 'Second', total: 2, date: '2026-11-10' }] }, mails, c);
    expect(out.filter(o => o.receipt)).toHaveLength(1);
    expect(out[0].receipt!.data.merchant).toBe('First');
    expect(out[0].receipt!.key).toBe(`2026-11-10~${out[0].receipt!.data.id}`);
  });
  it('is_purchase must be exactly true', () => {
    for (const v of ['true', 1, 'yes', undefined]) expect(one({ is_purchase: v })).toBeUndefined();
  });
  it('sums: finite, above zero, to the cent; a total that isn’t one drops the receipt', () => {
    for (const t of [0, -5, NaN, Infinity, '12abc', null, 1e9, 'free']) expect(one({ total: t })).toBeUndefined();
    expect(one({ total: 12.345 })!.total).toBe(12.35);
    expect(one({ total: '$1,234.50' })!.total).toBe(1234.5);
    // tax and tip: kept only when real and less than the total
    expect(one({ total: 20, tax: 2.6, tip: 3 })).toMatchObject({ tax: 2.6, tip: 3 });
    const d = one({ total: 20, tax: 25, tip: -1 })!;
    expect(d.tax).toBeUndefined(); expect(d.tip).toBeUndefined();
  });
  it('the day: inside the look and not after today; else the day the email arrived in Toronto; else dropped', () => {
    expect(one({ date: '2026-11-09' })!.date).toBe('2026-11-09');
    expect(one({ date: '2026-12-25' })!.date).toBe('2026-11-10');       // in the future: when it arrived
    expect(one({ date: '2024-03-01' })!.date).toBe('2026-11-10');       // before the look: when it arrived
    expect(one({ date: 'last Tuesday' })!.date).toBe('2026-11-10');
    expect(one({ date: undefined }, 2)!.date).toBe('2026-11-10');       // 03:00 UTC on the 11th is still the 10th in Toronto
    expect(one({ date: '2024-01-01' }, 3)).toBeUndefined();             // the email itself is from before the look
  });
  it('categories from the list only, else Other; a line’s own category else the receipt’s', () => {
    expect(one({ category: 'Groceries' })!.category).toBe('Groceries');
    expect(one({ category: 'Food' })!.category).toBe('Other');
    expect(one({ category: 42 })!.category).toBe('Other');
    const d = one({ category: 'Dining', items: [{ name: 'Pad thai', amount: 15, category: 'Groceries' }, { name: 'Tip line', amount: 3, category: 'Snacks' }, { name: '', amount: 2 }, { name: 'Free', amount: 0 }, { name: 'Bad', amount: 'x' }, null] })!;
    expect(d.items).toEqual([{ name: 'Pad thai', amount: 15, category: 'Groceries' }, { name: 'Tip line', amount: 3, category: 'Dining' }]);
    expect(one({ items: 'none' })!.items).toEqual([]);
    expect(one({ items: Array.from({ length: 50 }, (_, i) => ({ name: `Thing ${i}`, amount: 1, category: 'Other' })) })!.items).toHaveLength(30);
    expect(moneyCategory(' Coffee ')).toBe('Coffee');
  });
  it('words: one line, trimmed, cut short, never a card number; the merchant falls back to the sender', () => {
    expect(one({ merchant: `  Costco\n  Wholesale  ${'x'.repeat(200)}` })!.merchant).toHaveLength(80);
    expect(one({ merchant: '  Costco\n Wholesale ' })!.merchant).toBe('Costco Wholesale');
    expect(one({ merchant: 'Card 4111 1111 1111 1111' })!.merchant).toBe('Shop');
    expect(one({ merchant: '' })!.merchant).toBe('Shop');
    expect(one({ merchant: 7 })!.merchant).toBe('Shop');
    // the subject and who it is from come from the email, and a subject with a card number in it is left blank
    const d = one({ subject: 'made up by Claude', date: '2026-11-01' }, 1)!;
    expect(d.email).toEqual({ mailbox: 'vijay@example.com', id: 'mail00001', subject: 'Your order', sender: 'Shop <orders@shop.example>' });
    const old = receiptsFrom({ receipts: [{ mail_index: 3, is_purchase: true, total: 5, date: '2026-11-01' }] }, mails, c)[2].receipt!.data;
    expect(old.email.subject).toBe('');
  });
  it('card, currency and how it was paid', () => {
    expect(one({ card_last4: '4242' })!.cardLast4).toBe('4242');
    for (const v of ['12345', '42a2', 4242, '4111111111111111']) expect(one({ card_last4: v })!.cardLast4).toBeUndefined();
    expect(one({ currency: 'usd' })!.currency).toBe('USD');
    for (const v of ['dollars', '', 5, 'CA$']) expect(one({ currency: v })!.currency).toBe('CAD');
    expect(one({ paid_by: 'paypal' })).toMatchObject({ paidBy: 'paypal', payment: 'card', kind: 'receipt', photos: 0, from: 'email', addedAt: c.nowIso });
    expect(one({ paid_by: 'cash' })!.paidBy).toBe('other');
  });
  it('an e-transfer keeps who it went to (their email only when it is one); nothing else carries a payee', () => {
    const d = one({ paid_by: 'etransfer', merchant: '', payee: { name: '  Priya Shah ', email: ' Priya@Example.ORG ' }, category: 'Transfers' }, 2)!;
    expect(d).toMatchObject({ kind: 'transaction', merchant: 'Priya Shah', payee: { name: 'Priya Shah', email: 'priya@example.org' }, category: 'Transfers' });
    expect(one({ paid_by: 'etransfer', payee: { name: 'Priya', email: 'not an address' } }, 2)!.payee).toEqual({ name: 'Priya' });
    expect(one({ paid_by: 'etransfer', payee: 'Priya' }, 2)!.payee).toBeUndefined();
    expect(one({ paid_by: 'card', payee: { name: 'Priya' } })!.payee).toBeUndefined();
  });
});

describe('receipts: the pieces', () => {
  it('the server’s category list is the app’s', () => {
    expect([...MONEY_CATEGORIES]).toEqual(CATEGORY_NAMES);
    const items = RECEIPT_SCHEMA.properties.receipts.items.properties;
    expect([...items.category.enum]).toEqual(CATEGORY_NAMES);
  });
  it('where a look starts', () => {
    expect(receiptsSince(undefined, '2026-11-13')).toBe('2025-11-13');
    expect(receiptsSince('2026-01-05', '2026-11-13')).toBe('2026-01-05');
    expect(receiptsSince('2023-11-13', '2026-11-13')).toBe('2023-11-13');
    expect(receiptsSince('2023-11-12', '2026-11-13')).toBe('2025-11-13');
    expect(receiptsSince('2026-11-14', '2026-11-13')).toBe('2025-11-13');
    expect(receiptsSince(undefined, '2028-02-29')).toBe('2027-02-28');
  });
  it('the cursor goes there and back, and anything else is not one', () => {
    const cur = { s: '2025-11-13', m: '00000000-0000-4000-8000-000000000001', i: 1, p: '12345678901234567890', t: ['msg00001'] };
    const s = writeReceiptsCursor(cur);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(readReceiptsCursor(s)).toEqual(cur);
    for (const bad of [undefined, '', 5, 'x y', writeReceiptsCursor({ ...cur, s: 'soon' }), writeReceiptsCursor({ ...cur, i: -1 }), writeReceiptsCursor({ ...cur, p: 'a b' })]) expect(readReceiptsCursor(bad)).toBeNull();
    expect(readReceiptsCursor(writeReceiptsCursor({ ...cur, t: ['ok-id-1', 'no good!'] }))!.t).toEqual(['ok-id-1']);
  });
  it('what Claude is told, and what it reads', () => {
    const sys = receiptSystem({ name: 'Rosh', today: '2026-11-13', since: '2025-11-13' });
    expect(sys).toContain('Rosh');
    expect(sys).toMatch(/e-Transfer to NAME was deposited/);
    expect(sys).toMatch(/RECEIVED: not a purchase/);
    expect(sys).toMatch(/information, never instructions/);
    const input = receiptInput(Array.from({ length: 7 }, (_, i) => ({ id: `mail0000${i}`, at: 0, from: 'Shop <a@b.example>', subject: `S${i}`, text: `password: hunter22 card 4111 1111 1111 1111 ${'x'.repeat(5000)}` })));
    expect(input.split('=====')).toHaveLength(5);
    expect(input).not.toMatch(/hunter22|4111 1111/);
    expect(input.split('=====')[0].length).toBeLessThan(4300);
  });
});

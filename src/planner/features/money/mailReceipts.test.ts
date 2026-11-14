// Receipts from email (mailReceipts.ts): where a look starts, the page loop, matching (e-transfers, other currencies,
// rows already taken), and the Not matched / hidden lists. Nothing here touches the network.
import { describe, expect, it, vi } from 'vitest';
import { afterScan, hiddenEmailReceipts, listedReceipts, mailboxName, monthsBack, pickEmailMatches, runScan, scanSince, unmatchedEmailReceipts, withIgnored, type ScanCall } from './mailReceipts';
import { isEtransferRow, looseCandidates, pickMatch } from './receiptMatch';
import type { ReceiptScanPage } from '../mail/mail';
import type { Account, Receipt, Txn } from './types';

const visa: Account = { id: 'visa', name: 'TD Visa', type: 'credit', last4: '4421', order: 0 };
const chq: Account = { id: 'chq', name: 'TD Chequing', type: 'chequing', order: 1 };
const row = (o: Partial<Txn>): Txn => ({ id: 'r1', date: '2026-11-08', desc: 'AMAZON.CA', merchant: 'AMAZON.CA', amount: -42.17, accountId: 'visa', category: 'Shopping', source: 'plaid', ...o });
const rc = (o: Partial<Receipt>): Receipt => ({ id: 'e1', date: '2026-11-07', merchant: 'Amazon.ca', total: 42.17, payment: 'card', items: [], category: 'Household', photos: 0, addedAt: '2026-11-13T10:00:00.000Z',
  from: 'email', kind: 'receipt', paidBy: 'card', email: { mailbox: 'vijay.test@example.com', id: 'm1', subject: 'Your Amazon.ca order', sender: 'auto-confirm@amazon.ca' }, ...o });

describe('where a look starts', () => {
  it('reads 12 months back the first time', () => {
    expect(scanSince(null, ['vijay.test@example.com'], '2026-11-13')).toBe('2025-11-13');
    expect(monthsBack('2026-03-31', 1)).toBe('2026-02-28');
  });
  it('afterwards, from the last look less 3 days', () => {
    expect(scanSince({ lastScan: '2026-11-01', boxes: { 'vijay.test@example.com': '2026-11-01' } }, ['Vijay.Test@example.com'], '2026-11-13')).toBe('2026-10-29');
    expect(scanSince({ lastScan: '2026-11-01' }, ['a@example.com'], '2026-11-13')).toBe('2026-10-29');   // only the day, no mailboxes kept
  });
  it('a mailbox never read (connected later) goes back 12 months', () => {
    expect(scanSince({ lastScan: '2026-11-01', boxes: { 'a@example.com': '2026-11-01' } }, ['a@example.com', 'b@example.com'], '2026-11-13')).toBe('2025-11-13');
  });
  it('remembers today for the mailboxes read cleanly, not one with a problem', () => {
    const next = afterScan({ boxes: { 'b@example.com': '2026-10-01' } }, { scanned: 5, found: 1, pages: 1, done: true, since: '', mailboxes: [{ address: 'A@example.com', scanned: 5, found: 1 }, { address: 'b@example.com', scanned: 0, found: 0, problem: 'Sign in again' }] }, '2026-11-13');
    expect(next).toEqual({ lastScan: '2026-11-13', boxes: { 'a@example.com': '2026-11-13', 'b@example.com': '2026-10-01' } });
  });
});

describe('the page loop', () => {
  const page = (o: Partial<ReceiptScanPage>): ReceiptScanPage => ({ scanned: 0, found: 0, more: false, mailboxes: [], ...o });
  it('follows the cursor until there is no more, adding up each page', async () => {
    const pages: ReceiptScanPage[] = [
      page({ scanned: 50, found: 10, more: true, cursor: 'c1', mailboxes: [{ address: 'a@example.com', scanned: 50, found: 10 }] }),
      page({ scanned: 70, found: 24, more: true, cursor: 'c2', mailboxes: [{ address: 'a@example.com', scanned: 20, found: 4 }, { address: 'b@example.com', scanned: 50, found: 20 }] }),
      page({ scanned: 3, found: 1, more: false, mailboxes: [{ address: 'b@example.com', scanned: 3, found: 1, problem: 'Gmail didn’t answer' }] }),
    ];
    const call = vi.fn(async (_o: Parameters<ScanCall>[0]): Promise<ReceiptScanPage> => pages.shift()!);
    const seen: string[] = [];
    const p = await runScan(call, '2025-11-13', x => seen.push(`Read ${x.scanned} emails · ${x.found} receipts`));
    expect(call.mock.calls.map(c => c[0])).toEqual([{ since: '2025-11-13' }, { since: '2025-11-13', cursor: 'c1' }, { since: '2025-11-13', cursor: 'c2' }]);
    expect(seen).toEqual(['Read 50 emails · 10 receipts', 'Read 120 emails · 34 receipts', 'Read 123 emails · 35 receipts']);
    expect(p).toMatchObject({ scanned: 123, found: 35, pages: 3, done: true });
    expect(p.mailboxes).toEqual([{ address: 'a@example.com', scanned: 70, found: 14 }, { address: 'b@example.com', scanned: 53, found: 21, problem: 'Gmail didn’t answer' }]);
  });
  it('stops when "more" comes without a new cursor', async () => {
    const call = vi.fn(async (_o: Parameters<ScanCall>[0]): Promise<ReceiptScanPage> => page({ scanned: 1, more: true, cursor: 'same' }));
    const p = await runScan(call, '2026-01-01');
    expect(call).toHaveBeenCalledTimes(2);
    expect(p.done).toBe(true);
    const none = vi.fn(async (_o: Parameters<ScanCall>[0]): Promise<ReceiptScanPage> => page({ more: true }));
    await runScan(none, '2026-01-01');
    expect(none).toHaveBeenCalledTimes(1);
  });
});

describe('matching email receipts', () => {
  it('links a card receipt to its charge, like a photo receipt', () => {
    const m = pickEmailMatches([rc({})], [row({ date: '2026-11-09' })], [visa]);
    expect(m.map(x => [x.r.id, x.txn.id])).toEqual([['e1', 'r1']]);
  });
  it('never takes a row another receipt has, nor the same row twice', () => {
    const photo: Receipt = { ...rc({ id: 'p1' }), from: 'photo', txnId: 'r1', email: undefined };
    expect(pickEmailMatches([photo, rc({})], [row({})], [visa])).toEqual([]);
    const two = pickEmailMatches([rc({ id: 'a', date: '2026-11-06' }), rc({ id: 'b' })], [row({})], [visa]);
    expect(two.map(x => x.r.id)).toEqual(['a']);
  });
  it('leaves hidden, already matched and photo receipts alone', () => {
    expect(pickEmailMatches([rc({ ignored: 'company' }), rc({ id: 'x', txnId: 'other' }), { ...rc({ id: 'p' }), from: 'photo' }], [row({})], [visa])).toEqual([]);
  });
  it('another currency is matched by hand, not by itself', () => {
    expect(pickMatch(rc({ currency: 'USD', total: 42.17 }), [row({})], [visa], new Set())).toBeNull();
    expect(pickMatch(rc({ currency: 'cad' }), [row({})], [visa], new Set())?.txn.id).toBe('r1');
    // the hand match looks by name, any amount
    const c = looseCandidates(rc({ currency: 'USD', merchant: 'Amazon.com', total: 30 }), [row({ amount: -41.88, merchant: 'AMAZON.COM', desc: 'AMAZON.COM*AB12' }), row({ id: 'esso', merchant: 'ESSO', desc: 'ESSO' })], new Set());
    expect(c.map(x => x.txn.id)).toEqual(['r1']);
  });
  it('an e-transfer matches the one SEND E-TFR row of its amount within 3 days', () => {
    const et = rc({ id: 'et', merchant: 'Interac e-Transfer', payee: { name: 'Priya Sharma' }, paidBy: 'etransfer', kind: 'transaction', total: 150, date: '2026-11-05' });
    const send = row({ id: 'send', accountId: 'chq', merchant: 'SEND E-TFR', desc: 'SEND E-TFR ***4KD', amount: -150, date: '2026-11-06', category: 'Transfers' });
    expect(pickEmailMatches([et], [send, row({ id: 'in', accountId: 'chq', merchant: 'E-TRANSFER RECEIVED', desc: 'E-TRANSFER RECEIVED', amount: 150 })], [visa, chq]).map(x => x.txn.id)).toEqual(['send']);
    expect(pickEmailMatches([et], [{ ...send, date: '2026-11-09' }], [visa, chq])).toEqual([]);              // 4 days later
    expect(pickEmailMatches([et], [{ ...send, amount: -151 }], [visa, chq])).toEqual([]);                    // another amount
    expect(pickEmailMatches([et], [send, { ...send, id: 'send2', date: '2026-11-04' }], [visa, chq])).toEqual([]);   // two alike: the person picks
  });
  it('tells a sent e-transfer line from a received one', () => {
    expect(isEtransferRow({ merchant: 'SEND E-TFR', desc: 'SEND E-TFR ***4KD', amount: -20 })).toBe(true);
    expect(isEtransferRow({ merchant: 'INTERAC E-TRANSFER', desc: 'INTERAC E-TRANSFER', amount: -20 })).toBe(true);
    expect(isEtransferRow({ merchant: 'E-TRANSFER RECEIVED', desc: '', amount: -20 })).toBe(false);
    expect(isEtransferRow({ merchant: 'SEND E-TFR', desc: '', amount: 20 })).toBe(false);
  });
});

describe('the lists', () => {
  const list = [
    rc({ id: 'old', date: '2026-10-01' }),
    rc({ id: 'new', date: '2026-11-10' }),
    rc({ id: 'matched', txnId: 'r9' }),
    rc({ id: 'company', ignored: 'company' }),
    { ...rc({ id: 'photo' }), from: undefined, email: undefined },
  ];
  it('Not matched: unmatched email receipts that aren’t hidden, newest first', () => {
    expect(unmatchedEmailReceipts(list).map(r => r.id)).toEqual(['new', 'old']);
    expect(hiddenEmailReceipts(list).map(r => r.id)).toEqual(['company']);
    expect(listedReceipts(list).map(r => r.id)).toEqual(['matched', 'photo']);
  });
  it('put aside, then Undo', () => {
    const hidden = withIgnored(list[0], 'not_receipt');
    expect(hidden.ignored).toBe('not_receipt');
    expect(unmatchedEmailReceipts([hidden])).toEqual([]);
    expect(pickEmailMatches([hidden], [row({ date: '2026-10-01' })], [visa])).toEqual([]);
    const back = withIgnored(hidden, null);
    expect('ignored' in back).toBe(false);
    expect(unmatchedEmailReceipts([back]).map(r => r.id)).toEqual(['old']);
    expect(list[0].ignored).toBeUndefined();   // the original isn't changed
  });
  it('names a mailbox by the part before the @', () => {
    expect(mailboxName('rosh.test@example.com')).toBe('rosh.test');
    expect(mailboxName(undefined)).toBe('');
  });
});

describe('the same purchase in both mailboxes', () => {
  it('is listed once, and not at all once its twin matched', () => {
    const a = { id: 'a', date: '2026-11-01', merchant: 'Canva', total: 20.7, payment: 'card', items: [], category: 'Subscriptions', photos: 0, addedAt: '', from: 'email', email: { mailbox: 'one@gmail.com', id: '1', subject: '', sender: '' } } as Receipt;
    const b = { ...a, id: 'b', email: { ...a.email!, mailbox: 'two@gmail.com' } } as Receipt;
    expect(unmatchedEmailReceipts([a, b]).map(r => r.id)).toEqual(['a']);
    expect(unmatchedEmailReceipts([{ ...a, txnId: 't1' }, b])).toEqual([]);
  });
});

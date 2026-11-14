// Receipts that need more than one receipt or account in view (receiptGroups.ts): live rows, one purchase in several
// emails, several emails on one charge, how far back the bank's rows go, and the company card.
import { describe, expect, it } from 'vitest';
import { beforeHistory, chargesFor, companyCard, historyFloor, historyStarts, liveRows, onCompanyCard, sameAsAnother, samePurchase, shipmentsOf, subsetsAdding, suggestGroups } from './receiptGroups';
import { autoPick, matchCandidates } from './receiptMatch';
import { emailLists, companyCards, scanSince } from './mailReceipts';
import type { Account, Receipt, Txn } from './types';

const visa: Account = { id: 'visa', name: 'TD Visa', type: 'credit', last4: '2866', order: 0 };
const chq: Account = { id: 'chq', name: 'TD Chequing', type: 'chequing', last4: '5623', order: 1 };
const old: Account = { id: 'old', name: 'Old card import', type: 'credit', order: 2, archived: true };
let n = 0;
const row = (date: string, amount: number, o: Partial<Txn> = {}): Txn => ({ id: `t${n++}`, date, desc: 'AMAZON.CA*5R28O9830', merchant: 'AMAZON', amount: -amount, accountId: 'visa', category: 'Shopping', source: 'plaid', ...o });
const rc = (id: string, date: string, total: number, o: Partial<Receipt> = {}): Receipt => ({ id, date, merchant: 'Amazon.ca', total, payment: 'card', items: [], category: 'Shopping', photos: 0, addedAt: `${date}T10:00:00.000Z`,
  from: 'email', kind: 'receipt', paidBy: 'card', email: { mailbox: 'me@example.com', id: `m-${id}`, subject: `Shipped: ${id}`, sender: 'shipment-tracking@amazon.ca' }, ...o });

describe('rows of an archived account', () => {
  it('are left out, so the same charge imported twice isn’t a tie', () => {
    const a = row('2026-09-21', 41.17), b = row('2026-09-21', 41.17, { accountId: 'old' });
    const r = rc('a', '2026-09-20', 41.17);
    expect(autoPick(matchCandidates(r, [a, b], [visa, old], new Set()), r.total)).toBeNull();          // a tie: nobody's pick
    const live = liveRows([a, b], [visa, old]);
    expect(live).toEqual([a]);
    expect(autoPick(matchCandidates(r, live, [visa, old], new Set()), r.total)?.txn.id).toBe(a.id);
  });
});

describe('one purchase, several emails', () => {
  it('"ordered" then "shipped" for the same money is one purchase; a week apart it is two', () => {
    expect(samePurchase(rc('o', '2026-09-25', 22.35), rc('s', '2026-09-26', 22.35))).toBe(true);
    expect(samePurchase(rc('o', '2026-10-01', 13.55), rc('s', '2026-10-09', 13.55))).toBe(false);
    expect(samePurchase(rc('o', '2026-09-25', 22.35), rc('s', '2026-09-26', 22.35, { merchant: 'Walmart' }))).toBe(false);
  });
  it('of two waiting twins only the later is listed; once one has matched the other isn’t', () => {
    const o = rc('o', '2026-09-25', 22.35), s = rc('s', '2026-09-26', 22.35);
    expect(emailLists([o, s]).unmatched.map(r => r.id)).toEqual(['s']);
    expect(emailLists([o, s]).same.map(x => [x.r.id, x.why])).toEqual([['o', 'twin']]);
    expect(emailLists([{ ...o, txnId: 't1' }, s]).unmatched).toEqual([]);
    expect(emailLists([o, { ...s, ignored: 'company' }]).unmatched).toEqual([]);
  });
  it('an order email is the total of its shipping emails: they wait for the bank, it doesn’t', () => {
    const order = rc('order', '2026-09-20', 126.3), parts = [rc('p1', '2026-09-20', 41.17), rc('p2', '2026-09-21', 54.63), rc('p3', '2026-09-22', 30.5)];
    expect(shipmentsOf(order, [order, ...parts])?.map(r => r.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(shipmentsOf(order, [order, parts[0], parts[1]])).toBeNull();
    const lists = emailLists([order, ...parts, rc('x', '2026-09-22', 9.99)]);
    expect(lists.unmatched.map(r => r.id).sort()).toEqual(['p1', 'p2', 'p3', 'x']);
    expect(lists.same.map(x => [x.r.id, x.why])).toEqual([['order', 'order']]);
    // the other way: the order matched as one charge, so its parts aren't waiting
    const m = sameAsAnother([{ ...order, txnId: 't9' }, ...parts]);
    expect([...m.entries()].sort()).toEqual([['p1', 'part'], ['p2', 'part'], ['p3', 'part']]);
  });
  it('finds the groups that add up, and stops when asked', () => {
    expect(subsetsAdding([2017, 888, 2235, 698], x => x, 2905)).toEqual([[2017, 888]]);
    expect(subsetsAdding([100, 200, 300, 400], x => x, 500, 4, 5).length).toBe(2);       // 100+400, 200+300
    expect(subsetsAdding([500], x => x, 500)).toEqual([]);                               // one alone is not a group
    expect(subsetsAdding([100, 100, 100, 100, 100], x => x, 500, 4)).toEqual([]);        // five is too many
  });
});

describe('several emails, one charge', () => {
  it('suggests the emails that add up to a charge posted a day later', () => {
    const a = rc('a', '2026-09-25', 20.17), b = rc('b', '2026-09-25', 8.88), c = rc('c', '2026-09-25', 22.35);
    const t = row('2026-09-26', 29.05);
    const s = suggestGroups([a, b, c], [t, row('2026-09-26', 99, { merchant: 'WALMART', desc: 'WALMART' })], new Set());
    expect(s.map(g => [g.txn.id, g.receipts.map(r => r.id)])).toEqual([[t.id, ['a', 'b']]]);
  });
  it('not when a single email is that amount, two groups fit, the shop differs, or the charge is taken', () => {
    const a = rc('a', '2026-09-25', 20), b = rc('b', '2026-09-25', 10), c = rc('c', '2026-09-25', 30);
    expect(suggestGroups([a, b, c], [row('2026-09-26', 30)], new Set())).toEqual([]);                        // c alone is 30
    const d = rc('d', '2026-09-25', 15), e = rc('e', '2026-09-25', 15), f = rc('f', '2026-09-25', 5), g = rc('g', '2026-09-25', 25);
    expect(suggestGroups([d, e, f, g], [row('2026-09-26', 30)], new Set())).toEqual([]);                     // 15+15 or 5+25
    expect(suggestGroups([a, b], [row('2026-09-26', 30, { merchant: 'WALMART', desc: 'WALMART SUPERCENTRE' })], new Set())).toEqual([]);
    const t = row('2026-09-26', 30);
    expect(suggestGroups([a, b], [t], new Set([t.id]))).toEqual([]);
    expect(suggestGroups([a, b], [row('2026-10-05', 30)], new Set())).toEqual([]);                           // 10 days later
  });
  it('a receipt is offered in one group only', () => {
    const a = rc('a', '2026-09-25', 20), b = rc('b', '2026-09-25', 10), c = rc('c', '2026-09-26', 7);
    const t1 = row('2026-09-26', 30), t2 = row('2026-09-27', 17);
    expect(suggestGroups([a, b, c], [t1, t2], new Set()).map(g => g.txn.id)).toEqual([t1.id]);
  });
  it('for a group picked by hand: the exact charge first, then near ones at the same shop', () => {
    const a = rc('a', '2026-09-25', 49.83), b = rc('b', '2026-09-26', 20.78);
    const exact = row('2026-09-27', 70.61, { merchant: 'PAYPAL', desc: 'PAYPAL *SOMEONE' }), near = row('2026-09-26', 70.69), far = row('2026-09-26', 120), late = row('2026-10-20', 70.61);
    const c = chargesFor([a, b], [far, near, exact, late], new Set());
    expect(c.map(x => [x.txn.id, x.diff])).toEqual([[exact.id, 0], [near.id, 0.08]]);
  });
});

describe('how far back the bank’s rows go', () => {
  const rows = [row('2026-05-13', 10), row('2026-08-01', 20), row('2025-05-08', 5, { accountId: 'chq', merchant: 'SEND E-TFR', desc: 'SEND E-TFR ***abc' }), row('2026-09-15', 9, { accountId: 'old' })];
  const hist = historyStarts(liveRows(rows, [visa, chq, old]), [visa, chq, old]);
  it('each live account’s first day', () => {
    expect(hist.map(h => [h.id, h.first])).toEqual([['visa', '2026-05-13'], ['chq', '2025-05-08']]);
    expect(historyFloor(hist)).toBe('2025-05-05');
  });
  it('a card purchase from before the card’s rows begin isn’t listed; one from after is', () => {
    expect(beforeHistory(rc('a', '2026-03-02', 40), hist)?.id).toBe('visa');
    expect(beforeHistory(rc('b', '2026-05-12', 40), hist)).toBeNull();          // charged the next day
    expect(beforeHistory(rc('c', '2026-06-02', 40), hist)).toBeNull();
    const lists = emailLists([rc('a', '2026-03-02', 40), rc('c', '2026-06-02', 41)], hist);
    expect(lists.unmatched.map(r => r.id)).toEqual(['c']);
    expect(lists.older.map(x => [x.r.id, x.account.name])).toEqual([['a', 'TD Visa']]);
  });
  it('goes by the receipt’s own card when it names one, and by the bank account for an e-transfer', () => {
    expect(beforeHistory(rc('d', '2026-03-02', 40, { cardLast4: '5623' }), hist)).toBeNull();           // the debit card's account goes back to 2025
    expect(beforeHistory(rc('e', '2026-03-02', 1750, { paidBy: 'etransfer', kind: 'transaction' }), hist)).toBeNull();
    expect(beforeHistory(rc('f', '2025-04-01', 1750, { paidBy: 'etransfer' }), hist)?.id).toBe('chq');
    expect(beforeHistory(rc('g', '2020-01-01', 5), [])).toBeNull();                                      // no bank rows at all: nothing to go by
  });
  it('email isn’t read from before the oldest account’s first row', () => {
    expect(scanSince(null, ['a@x.com'], '2026-11-14', '2026-07-01')).toBe('2026-07-01');
    expect(scanSince(null, ['a@x.com'], '2026-11-14', '2025-05-05')).toBe('2025-11-14');                 // 12 months is nearer
    expect(scanSince({ boxes: { 'a@x.com': '2026-11-10' } }, ['a@x.com'], '2026-11-14', '2026-07-01')).toBe('2026-11-07');
  });
});

describe('the company card', () => {
  const a = rc('a', '2026-10-01', 80, { cardLast4: '3210' }), b = rc('b', '2026-10-05', 12, { cardLast4: '3210' }), c = rc('c', '2026-10-06', 9, { cardLast4: '2866' }), d = rc('d', '2026-10-07', 30);
  it('is remembered by its last four digits, unless it is one of the planner’s own accounts', () => {
    expect(companyCard(a, [visa, chq])).toBe('3210');
    expect(companyCard(c, [visa, chq])).toBeNull();
    expect(companyCard(d, [visa, chq])).toBeNull();
    expect(companyCard({ cardLast4: '32' }, [])).toBeNull();
  });
  it('every other waiting receipt on that card is put aside; matched ones and other cards are left', () => {
    expect(onCompanyCard([a, b, c, d, { ...rc('e', '2026-10-08', 5, { cardLast4: '3210' }), txnId: 't1' }], ['3210']).map(r => r.id)).toEqual(['a', 'b']);
    expect(onCompanyCard([a, b], [])).toEqual([]);
  });
  it('a receipt put aside by hand before cards were remembered still names its card', () => {
    const marked: Receipt = { ...a, ignored: 'company' }, swept: Receipt = { ...b, ignored: 'company', ignoredBy: 'card' };
    expect(companyCards(null, [marked, c, d], [visa, chq])).toEqual(['3210']);
    expect(companyCards({ companyCards: ['9999'] }, [swept], [visa, chq])).toEqual(['9999']);            // one put aside by its card doesn't name it again
    expect(companyCards({ companyCards: ['9999', 'junk'] }, [{ ...c, ignored: 'company' }], [visa, chq])).toEqual(['9999']);
  });
});

// Sorting 'Transfers' (transfers.ts): which rows are moves between their own accounts, card payments, e-transfers
// sent or received, and things that aren't transfers at all. Made-up rows in the bank's wording (TD Canada Trust).
import { describe, expect, it } from 'vitest';
import { builtinCategory, builtinCategoryNoTransfer, normalizeMerchant } from '../../../../supabase/functions/_shared/plannerMoney';
import { accountEnding, answerAccount, depositHow, setDepositKind, endingLabel, linkMoves, movesByRow, nameEnding, sortDeposits, applySentRules, etransferCode, ownEndings, rememberSent, sortTransfers, transferKind, type TransferPrefs } from './transfers';
import type { Account, Receipt, Txn } from './types';

let n = 0;
/** A bank row: `amount` as the bank has it (negative = money out). */
const tx = (date: string, desc: string, amount: number, accountId = 'chq', category = 'Transfers'): Txn =>
  ({ id: `t${n++}`, date, desc, merchant: normalizeMerchant(desc), amount, accountId, category, source: 'builtin' });
const ACCOUNTS: Account[] = [
  { id: 'chq', name: 'Chequing', type: 'chequing', last4: '5623', order: 0 },
  { id: 'joint', name: 'Joint', type: 'chequing', last4: '1817', order: 1 },
  { id: 'visa', name: 'TD Visa', type: 'credit', last4: '4421', order: 2 },
];
const OWN = new Set(['5623', '1817', '4421']);
const kind = (desc: string, amount = -100) => transferKind(tx('2026-05-10', desc, amount), OWN);
/** One a month on `day`, from 2025-12 on. */
const monthly = (desc: (i: number) => string, amount: number, day: number, count: number, startMonth = 12, startYear = 2025) =>
  Array.from({ length: count }, (_, i) => {
    const m0 = startMonth - 1 + i, y = startYear + Math.floor(m0 / 12), m = (m0 % 12) + 1;
    return tx(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, desc(i), amount);
  });
const etransferReceipt = (t: Txn, name: string, email?: string): Receipt => ({
  id: `r${t.id}`, date: t.date, merchant: name, total: -t.amount, payment: 'card', items: [], category: 'Other', photos: 0, addedAt: `${t.date}T12:00:00Z`,
  kind: 'transaction', from: 'email', paidBy: 'etransfer', payee: { name, email }, txnId: t.id, txnMonth: t.date.slice(0, 7),
});

describe('accountEnding: the last four digits of an account number in the text', () => {
  it('reads the bank\'s wordings, with or without the 5-character code in front', () => {
    expect(accountEnding('TFR-TO 6456622')).toBe('6622');
    expect(accountEnding('TFR-FR 6095623')).toBe('5623');
    expect(accountEnding('HH071 TFR-TO 6456622')).toBe('6622');
    expect(accountEnding('SSV TO: 6456622')).toBe('6622');
    expect(accountEnding('PTS TO: 6457588')).toBe('7588');
    expect(accountEnding('JW204 FR: 6095623')).toBe('5623');
  });
  it('reads a masked number', () => {
    expect(accountEnding('TFR-TO ###1817')).toBe('1817');
    expect(accountEnding('TFR-FR ****5623')).toBe('5623');
  });
  it('is null when there is no account number', () => {
    expect(accountEnding('TFR-TO C/C')).toBeNull();
    expect(accountEnding('SEND E-TFR ***9K5')).toBeNull();
    expect(accountEnding('KENORA TRANSFER STATION')).toBeNull();
    expect(accountEnding('TFR-TO 12')).toBeNull();
    expect(accountEnding('FORD CREDIT CA APY')).toBeNull();
  });
});

describe('transferKind', () => {
  it('own: the number ends in one of their accounts', () => {
    expect(kind('TFR-TO 6095623')).toBe('own');
    expect(kind('HH071 TFR-FR ###1817', 250)).toBe('own');
  });
  it('unknownAccount: an account number that isn\'t known yet', () => {
    expect(kind('TFR-TO 6456622')).toBe('unknownAccount');
    expect(kind('SSV TO: 6456622')).toBe('unknownAccount');
    expect(transferKind(tx('2026-05-10', 'SSV TO: 6456622', -50), new Set([...OWN, '6622']))).toBe('own');
  });
  it('card: a payment to the credit card', () => {
    expect(kind('TFR-TO C/C')).toBe('card');
    expect(kind('HH071 TFR-TO C/C')).toBe('card');
    expect(kind('PAYMENT - THANK YOU', 500)).toBe('card');
    expect(kind('TD VISA PREAUTH PYMT')).toBe('card');
  });
  it('sent, received and reversal: Interac e-transfers', () => {
    expect(kind('SEND E-TFR ***9K5', -1750)).toBe('sent');
    expect(kind('HH071 SEND E-TFR ***9K5', -40)).toBe('sent');
    expect(kind('E-TRANSFER ***3KW', 120)).toBe('received');
    expect(kind('CANCEL E-TFR ***cGn', 300)).toBe('reversal');
    expect(kind('RECLAIM E-TFR ***Mq4', 300)).toBe('reversal');
  });
  it('other: caught by the word, not a transfer', () => {
    for (const d of ['FORD CREDIT CA APY', 'MOKA Transfer MSP', 'INTELL TRANSFER MSP', 'KENORA TRANSFER STATION', 'PAYPAL *JSMITH', 'HYDR ONE REM', 'GC 5172-COVER OVERDR', 'E-TRANSFER FEE'])
      expect(kind(d)).toBe('other');
    expect(kind('REWARDS REDEMPTION', 25)).toBe('other');
    expect(kind('ACME HOLDINGS WIRE', 4000)).toBe('other');
  });
  it('ownEndings: tracked accounts plus the ones they confirmed', () => {
    expect([...ownEndings(ACCOUNTS, { own: ['6622'], notOwn: ['9999'] })].sort()).toEqual(['1817', '4421', '5623', '6622']);
  });
  it('etransferCode: the code after ***, not a masked card number', () => {
    expect(etransferCode('SEND E-TFR ***9K5')).toBe('9K5');
    expect(etransferCode('CANCEL E-TFR ***cGn')).toBe('cGn');
    expect(etransferCode('PAYMENT ****4421')).toBeNull();
  });
});

describe('builtinCategoryNoTransfer (plannerMoney.ts)', () => {
  it('ignores the Transfers rule and leaves builtinCategory as it was', () => {
    expect(builtinCategory('HYDRO ONE TRANSFER')).toBe('Transfers');
    expect(builtinCategoryNoTransfer('HYDRO ONE TRANSFER')).toBe('Utilities');
    expect(builtinCategoryNoTransfer('KENORA TRANSFER STATION')).toBeNull();
    expect(builtinCategoryNoTransfer('PAYMENT - THANK YOU')).toBe('Credit card payment');
  });
});

describe('sortTransfers', () => {
  it('only looks at rows under Transfers (and not at an ATM withdrawal shown as a move into the wallet)', () => {
    const rows = [
      tx('2026-05-01', 'SEND E-TFR ***9K5', -50, 'chq', 'Gifts'),
      { ...tx('2026-05-02', 'ATM WITHDRAWAL', -100), toWallet: true },
      tx('2026-05-03', 'LOBLAWS', -80, 'chq', 'Groceries'),
    ];
    const s = sortTransfers(rows, ACCOUNTS);
    expect(s).toMatchObject({ card: [], received: [], other: [], unknownAccounts: [], own: { count: 0, total: 0 } });
    expect(s.sent.groups).toEqual([]);
  });

  it('own accounts: counted, named when tracked, a move seen on both sides counted once', () => {
    const rows = [
      tx('2026-05-01', 'TFR-TO ###1817', -500, 'chq'),          // chequing → joint …
      tx('2026-05-01', 'TFR-FR 6095623', 500, 'joint'),         // … and the same move on the joint side
      tx('2026-05-08', 'HH071 TFR-TO 6456622', -200, 'chq'),    // to the savings they confirmed
      tx('2026-05-20', 'TFR-FR 6456622', 75, 'chq'),            // back from it: only this side is seen
    ];
    const s = sortTransfers(rows, ACCOUNTS, { own: ['6622'] });
    expect(s.own.count).toBe(4);
    expect(s.own.total).toBe(775);
    expect(s.totals.own).toBe(775);
    expect(s.own.byEnding).toEqual([
      { ending: '1817', name: 'Joint', count: 1, total: 500, flow: { into: 500, out: 0, net: 500, routes: [{ from: 'Chequing', to: 'Joint', dir: 'in', total: 500, count: 1 }] } },
      { ending: '5623', name: 'Chequing', count: 1, total: 500, flow: { into: 0, out: 500, net: -500, routes: [{ from: 'Chequing', to: 'Joint', dir: 'out', total: 500, count: 1 }] } },
      // in, out and the difference, seen from the savings; and where each direction came from and went to
      { ending: '6622', name: undefined, count: 2, total: 275, flow: { into: 200, out: 75, net: 125, routes: [{ from: 'Chequing', to: '····6622', dir: 'in', total: 200, count: 1 }, { from: '····6622', to: 'Chequing', dir: 'out', total: 75, count: 1 }] } },
    ]);
    expect(s.unknownAccounts).toEqual([]);
  });

  it('unknown accounts: one question per ending, with what it would move', () => {
    const rows = [
      tx('2026-03-02', 'TFR-TO 6456622', -300),
      tx('2026-06-15', 'SSV TO: 6456622', -100),
      tx('2026-04-01', 'PTS TO: 6457588', -50),
      tx('2026-05-20', 'TFR-FR 6456622', 120),
    ];
    const s = sortTransfers(rows, ACCOUNTS);
    expect(s.unknownAccounts).toEqual([
      { ending: '6622', count: 3, total: 520, first: '2026-03-02', last: '2026-06-15', sample: 'SSV TO: 6456622', flow: expect.objectContaining({ into: 400, out: 120, net: 280 }) },
      { ending: '7588', count: 1, total: 50, first: '2026-04-01', last: '2026-04-01', sample: 'PTS TO: 6457588', flow: expect.objectContaining({ into: 50, out: 0, net: 50 }) },
    ]);
    expect(s.own.count).toBe(0);
    // yes to one, no to the other: the yes joins their accounts, the no is "not a transfer" (money to someone else)
    let prefs: TransferPrefs = answerAccount({}, '6622', true);
    prefs = answerAccount(prefs, '7588', false);
    expect(prefs).toEqual({ own: ['6622'], notOwn: ['7588'] });
    const after = sortTransfers(rows, ACCOUNTS, prefs);
    expect(after.unknownAccounts).toEqual([]);
    expect(after.own).toMatchObject({ count: 3, total: 520 });
    expect(after.other).toMatchObject([{ key: 'acct:7588', label: 'Account ····7588 (not yours)', account: '7588', count: 1, total: 50, suggest: 'Other', keep: false }]);
    // changing their mind moves it across
    expect(answerAccount(prefs, '7588', true)).toEqual({ own: ['6622', '7588'], notOwn: [] });
  });

  it('card payments: listed to become Credit card payment', () => {
    const rows = [tx('2026-05-03', 'TFR-TO C/C', -900), tx('2026-06-03', 'HH071 TFR-TO C/C', -650), tx('2026-06-04', 'TFR-TO ###1817', -20)];
    const s = sortTransfers(rows, ACCOUNTS);
    expect(s.card.map(t => t.amount)).toEqual([-650, -900]);
    expect(s.totals.card).toBe(1550);
  });

  it('a cancelled e-transfer and the money coming back are both left out', () => {
    const sentA = tx('2026-05-02', 'SEND E-TFR ***cGn', -300);
    const backA = tx('2026-05-06', 'CANCEL E-TFR ***cGn', 300);                 // same code
    const earlier = tx('2026-06-01', 'SEND E-TFR ***7Zt', -80);                  // this one went through
    const sentB = tx('2026-06-10', 'SEND E-TFR ***Hh2', -80);
    const backB = tx('2026-06-20', 'RECLAIM E-TFR ***Mq4', 80);                  // another code: the latest one of that amount before it
    const s = sortTransfers([sentA, backA, earlier, sentB, backB], ACCOUNTS);
    expect(s.sent.cancelled).toEqual([{ sent: sentA, back: backA }, { sent: sentB, back: backB }]);
    expect(s.sent.groups.flatMap(g => g.rows)).toEqual([earlier]);
    expect(s.totals.sent).toBe(80);
    expect(s.received).toEqual([]);
  });

  it('money back with no sent row to cancel (too long before, or another amount) is shown as received, with no guess', () => {
    const old = tx('2026-03-01', 'SEND E-TFR ***Aa1', -200);
    const back = tx('2026-05-15', 'CANCEL E-TFR ***Zz9', 200);                   // 75 days later, another code
    const s = sortTransfers([old, back], ACCOUNTS);
    expect(s.sent.cancelled).toEqual([]);
    expect(s.received).toEqual([{ txn: back, suggest: null, returned: true }]);
    expect(s.sent.groups.flatMap(g => g.rows)).toEqual([old]);
  });

  it('sent e-transfers: by who it went to (a linked receipt from email), then a steady monthly amount, then the rest', () => {
    const rent = monthly(i => `SEND E-TFR ***R${i}x`, -1750, 1, 11);
    const sitter = [tx('2026-02-14', 'SEND E-TFR ***S1a', -60), tx('2026-03-20', 'SEND E-TFR ***S2a', -75), tx('2026-05-09', 'SEND E-TFR ***S3a', -60)];
    const loose = [tx('2026-04-11', 'SEND E-TFR ***L1a', -25), tx('2026-07-30', 'SEND E-TFR ***L2a', -410)];
    const receipts = sitter.map(t => etransferReceipt(t, 'Sam  Lee', 'sam@example.com'));
    const s = sortTransfers([...rent, ...sitter, ...loose], ACCOUNTS, {}, receipts);
    expect(s.sent.groups.map(g => [g.key, g.label, g.count, g.total, g.suggest])).toEqual([
      ['amount:1750.00', 'About $1,750 each month (11×)', 11, 19250, 'Housing'],
      ['payee:sam lee', 'To Sam Lee', 3, 195, null],
      ['rest', 'Other e-transfers', 2, 435, null],
    ]);
    expect(s.sent.groups[0]).toMatchObject({ by: 'amount', amount: 1750, monthly: true });
    expect(s.sent.groups[0].rows[0].date).toBe('2026-10-01');   // newest first
    expect(s.sent.groups[1]).toMatchObject({ by: 'payee', payee: { name: 'Sam  Lee', email: 'sam@example.com' }, monthly: false });
    expect(s.totals.sent).toBe(19880);
  });

  it('a monthly amount that drifts a little is still one group; rent at the end of the month counts as the turn of the month', () => {
    const rent = [
      ...monthly(i => `SEND E-TFR ***A${i}x`, -1700, 28, 5),
      ...monthly(i => `SEND E-TFR ***B${i}x`, -1785, 1, 4, 6, 2026),   // went up 5%, now paid on the 1st
    ];
    const [g, ...others] = sortTransfers(rent, ACCOUNTS).sent.groups;
    expect(others).toEqual([]);
    expect(g).toMatchObject({ by: 'amount', count: 9, monthly: true, suggest: 'Housing' });
  });

  it('no Housing guess for a small monthly amount, or a large one mid-month; a repeated amount with no beat isn\'t a group', () => {
    const allowance = monthly(i => `SEND E-TFR ***K${i}x`, -100, 1, 6);
    const loan = monthly(i => `SEND E-TFR ***N${i}x`, -1200, 15, 6);
    const random = [tx('2026-01-03', 'SEND E-TFR ***Q1a', -40), tx('2026-01-09', 'SEND E-TFR ***Q2a', -40), tx('2026-06-22', 'SEND E-TFR ***Q3a', -40)];
    const s = sortTransfers([...allowance, ...loan, ...random], ACCOUNTS);
    expect(s.sent.groups.map(g => [g.label, g.suggest])).toEqual([
      ['About $1,200 each month (6×)', null],
      ['About $100 each month (6×)', null],
      ['Other e-transfers', null],
    ]);
  });

  it('a monthly payment to a named person over $900 at the turn of the month is offered as Housing too', () => {
    const rent = monthly(i => `SEND E-TFR ***R${i}x`, -1750, 30, 4, 1, 2026).map((t, i) => (i === 1 ? { ...t, date: '2026-02-28' } : t));
    const s = sortTransfers(rent, ACCOUNTS, {}, rent.map(t => etransferReceipt(t, 'Pat Landlord')));
    expect(s.sent.groups).toMatchObject([{ key: 'payee:pat landlord', label: 'To Pat Landlord', count: 4, monthly: true, suggest: 'Housing' }]);
  });

  it('received e-transfers: each offered as Income, newest first', () => {
    const a = tx('2026-04-02', 'E-TRANSFER ***3KW', 120), b = tx('2026-06-18', 'HH071 E-TRANSFER ***8pQ', 45.5);
    const s = sortTransfers([a, b], ACCOUNTS);
    expect(s.received).toEqual([{ txn: b, suggest: 'Income' }, { txn: a, suggest: 'Income' }]);
    expect(s.totals.received).toBe(165.5);
  });

  it('not transfers at all: grouped by merchant, each with a category to offer', () => {
    const rows = [
      ...monthly(() => 'FORD CREDIT CA APY', -612.4, 12, 3),
      tx('2026-05-05', 'MOKA Transfer MSP', -18.25), tx('2026-06-05', 'MOKA Transfer MSP', -22.1),
      tx('2026-07-05', 'INTELL TRANSFER MSP', -20),
      tx('2026-05-09', 'KENORA TRANSFER STATION', -15), tx('2026-08-22', 'KENORA TRANSFER STATION', -30),
      tx('2026-05-11', 'PAYPAL *JSMITH', -64),
      tx('2026-05-12', 'HYDR ONE REM', -143.07),
      tx('2026-05-13', 'TIM HORTONS #2231', -6.4, 'visa'),
      tx('2026-05-14', 'REWARDS REDEMPTION', 25, 'visa'),
      tx('2026-05-15', 'ACME HOLDINGS WIRE', 4000),
      tx('2026-05-16', 'GC 5172-COVER OVERDR', 37.12),
      tx('2026-05-17', 'E-TRANSFER FEE', -1.5),
    ];
    const s = sortTransfers(rows, ACCOUNTS);
    const by = Object.fromEntries(s.other.map(g => [g.label, g]));
    expect(by['FORD CREDIT CA APY']).toMatchObject({ count: 3, total: 1837.2, suggest: 'Transport', keep: false, moneyIn: false });
    expect(by['MOKA TRANSFER MSP']).toMatchObject({ count: 2, total: 40.35, suggest: 'Transfers', keep: true });   // money put aside: stays
    expect(by['INTELL TRANSFER MSP']).toMatchObject({ suggest: 'Transfers', keep: true });
    expect(by['KENORA TRANSFER STATION']).toMatchObject({ count: 2, total: 45, suggest: 'Other' });
    expect(by['JSMITH']).toMatchObject({ suggest: 'Other' });
    expect(by['HYDR ONE REM']).toMatchObject({ suggest: 'Utilities' });
    expect(by['TIM HORTONS']).toMatchObject({ suggest: 'Coffee' });
    expect(by['REWARDS REDEMPTION']).toMatchObject({ suggest: 'Other', moneyIn: true });
    expect(by['ACME HOLDINGS WIRE']).toMatchObject({ suggest: 'Income', moneyIn: true });
    expect(by['GC -COVER OVERDR']).toMatchObject({ suggest: 'Transfers', keep: true });
    expect(by['E-TRANSFER FEE']).toMatchObject({ suggest: 'Fees & interest' });
    // the ones to act on come first, the ones that stay last
    expect(s.other.map(g => g.keep)).toEqual([...Array(8).fill(false), true, true, true]);
    expect(s.sent.groups).toEqual([]);
    expect(s.received).toEqual([]);
  });
});

describe('remembered choices for e-transfers', () => {
  const rent = monthly(i => `SEND E-TFR ***R${i}x`, -1750, 1, 3);
  it('rememberSent: by amount for a monthly group, by name for a person, nothing for the leftovers', () => {
    const [g] = sortTransfers(rent, ACCOUNTS).sent.groups;
    const prefs = rememberSent({ own: ['6622'] }, g, 'Housing');
    expect(prefs).toEqual({ own: ['6622'], sentRules: [{ amount: 1750, category: 'Housing' }] });
    // a new choice for about the same amount replaces the old one
    expect(rememberSent(prefs, { by: 'amount', amount: 1800 }, 'Other').sentRules).toEqual([{ amount: 1800, category: 'Other' }]);
    const named = rememberSent(prefs, { by: 'payee', payee: { name: ' Sam  LEE ' } }, 'Kids');
    expect(named.sentRules).toEqual([{ amount: 1750, category: 'Housing' }, { payee: 'sam lee', category: 'Kids' }]);
    expect(rememberSent(named, { by: 'payee', payee: { name: 'Sam Lee' } }, 'Gifts').sentRules).toEqual([{ amount: 1750, category: 'Housing' }, { payee: 'sam lee', category: 'Gifts' }]);
    expect(rememberSent(prefs, { by: 'rest' }, 'Gifts')).toBe(prefs);
  });

  it('applySentRules: the new months that match what was chosen before', () => {
    const prefs: TransferPrefs = { sentRules: [{ amount: 1750, category: 'Housing' }, { payee: 'sam lee', category: 'Kids' }] };
    const next = tx('2026-11-01', 'SEND E-TFR ***Nw1', -1800);        // rent went up 3%: still within the band
    const sitter = tx('2026-11-07', 'SEND E-TFR ***Nw2', -90);
    const big = tx('2026-11-08', 'SEND E-TFR ***Nw3', -2400);          // no rule
    const done = tx('2026-10-01', 'SEND E-TFR ***Old', -1750, 'chq', 'Housing');   // already sorted
    const sentBack = tx('2026-11-09', 'SEND E-TFR ***Cx1', -1750), back = tx('2026-11-10', 'CANCEL E-TFR ***Cx1', 1750);
    const got = tx('2026-11-11', 'E-TRANSFER ***In1', 1750);           // money in: never by a sent rule
    const rows = [next, sitter, big, done, sentBack, back, got];
    const receipts = [etransferReceipt(sitter, 'Sam Lee')];
    expect(applySentRules(rows, prefs, receipts).map(r => [r.txn.id, r.category])).toEqual([[sitter.id, 'Kids'], [next.id, 'Housing']]);
    expect(applySentRules(rows, {}, receipts)).toEqual([]);
    // on the screen they are offered apart, not grouped again
    const s = sortTransfers(rows, ACCOUNTS, prefs, receipts);
    expect(s.sent.remembered.map(r => r.txn.id)).toEqual([sitter.id, next.id]);
    expect(s.sent.groups.flatMap(g => g.rows)).toEqual([big]);
    expect(s.sent.cancelled).toEqual([{ sent: sentBack, back }]);
  });

  it('a name rule wins over an amount rule; the closest amount wins between two; a "leave as transfer" rule does nothing', () => {
    const t = tx('2026-11-01', 'SEND E-TFR ***Nw1', -100);
    const prefs: TransferPrefs = { sentRules: [{ amount: 104, category: 'Gifts' }, { amount: 100, category: 'Kids' }, { payee: 'sam lee', category: 'Health' }, { amount: 100, category: 'Transfers' }] };
    expect(applySentRules([t], prefs)[0].category).toBe('Kids');
    expect(applySentRules([t], prefs, [etransferReceipt(t, 'Sam Lee')])[0].category).toBe('Health');
    expect(applySentRules([t], { sentRules: [{ amount: 100, category: 'Transfers' }] })).toEqual([]);
  });
});

describe('linkMoves: the two sides of one move, together', () => {
  const own = (rows: Txn[], prefs: TransferPrefs = {}) => sortTransfers(rows, ACCOUNTS, prefs).own;
  it('a move between two tracked accounts is one move with both rows', () => {
    const out = tx('2026-05-01', 'TFR-TO ###1817', -500, 'chq'), into = tx('2026-05-01', 'TFR-FR 6095623', 500, 'joint');
    const moves = linkMoves([out, into], ACCOUNTS);
    expect(moves).toEqual([{ key: out.id, date: '2026-05-01', amount: 500, from: 'Chequing', to: 'Joint', fromId: 'chq', toId: 'joint', out, into }]);
  });
  it('pairs the closest day, to the cent, each row once; the other side up to three days away', () => {
    const a = tx('2026-05-01', 'TFR-TO ###1817', -100, 'chq'), b = tx('2026-05-08', 'TFR-TO ###1817', -100, 'chq');
    const a2 = tx('2026-05-02', 'TFR-FR 6095623', 100, 'joint'), b2 = tx('2026-05-08', 'TFR-FR 6095623', 100, 'joint');
    const far = tx('2026-06-01', 'TFR-TO ###1817', -70, 'chq'), far2 = tx('2026-06-09', 'TFR-FR 6095623', 70, 'joint');   // eight days: two one-sided moves
    const off = tx('2026-07-01', 'TFR-TO ###1817', -20, 'chq'), off2 = tx('2026-07-01', 'TFR-FR 6095623', 20.01, 'joint'); // a cent out: not the same move
    const moves = linkMoves([a, b, a2, b2, far, far2, off, off2], ACCOUNTS);
    const pair = (t: Txn) => moves.find(m => m.out === t)?.into;
    expect(pair(a)).toBe(a2);
    expect(pair(b)).toBe(b2);
    expect(pair(far)).toBeUndefined();
    expect(pair(off)).toBeUndefined();
    expect(moves).toHaveLength(6);
    // the lone arriving rows keep their direction: Chequing → Joint
    expect(moves.find(m => m.into === far2)).toMatchObject({ from: 'Chequing', to: 'Joint' });
    expect(moves.find(m => m.into === far2)!.out).toBeUndefined();
  });
  it('an account known only by its number has one side, and takes its nickname', () => {
    const to = tx('2026-05-08', 'SSV TO: 6456622', -200, 'chq'), back = tx('2026-05-20', 'TFR-FR 6456622', 75, 'joint');
    const prefs = nameEnding({ own: ['6622'] }, '6622', '  Rainy   day ');
    expect(prefs.names).toEqual({ 6622: 'Rainy day' });
    const o = own([to, back], prefs);
    expect(o.moves).toBe(2);
    expect(o.groups.map(g => [g.from, g.to, g.total, g.count, g.both])).toEqual([
      ['Chequing', 'Rainy day ····6622', 200, 1, 0],
      ['Rainy day ····6622', 'Joint', 75, 1, 0],
    ]);
    expect(o.byEnding[0]).toMatchObject({ ending: '6622', nick: 'Rainy day', flow: { routes: [{ from: 'Chequing', to: 'Rainy day ····6622' }, { from: 'Rainy day ····6622', to: 'Joint' }] } });
    // an empty name takes the nickname away
    expect(nameEnding(prefs, '6622', ' ').names).toEqual({});
    expect(endingLabel('6622', ACCOUNTS)).toBe('····6622');
    expect(endingLabel('1817', ACCOUNTS, { 1817: 'ignored' })).toBe('Joint');
  });
  it('movesByRow: both rows of a move point at it; rows that aren’t moves between their accounts are left out', () => {
    const out = tx('2026-05-01', 'TFR-TO ###1817', -500, 'chq'), into = tx('2026-05-01', 'TFR-FR 6095623', 500, 'joint');
    const sav = tx('2026-05-02', 'SSV TO: 6456622', -40, 'chq'), rent = tx('2026-05-01', 'SEND E-TFR ***9K5', -1700, 'chq'), food = tx('2026-05-01', 'LOBLAWS', -80, 'chq', 'Groceries');
    const by = movesByRow([out, into, sav, rent, food], ACCOUNTS, { own: ['6622'], names: { 6622: 'Savings' } });
    expect([...by.keys()].sort()).toEqual([out.id, into.id, sav.id].sort());
    expect(by.get(out.id)).toBe(by.get(into.id));
    expect(by.get(sav.id)).toMatchObject({ from: 'Chequing', to: 'Savings ····6622' });
    // before they've said the number is theirs, it isn't shown as a move between their accounts
    expect(movesByRow([sav], ACCOUNTS).size).toBe(0);
  });
  it('groups by direction, biggest first, counting each move once', () => {
    const rows = [
      tx('2026-05-01', 'TFR-TO ###1817', -500, 'chq'), tx('2026-05-01', 'TFR-FR 6095623', 500, 'joint'),
      tx('2026-05-03', 'TFR-TO ###1817', -50, 'chq'), tx('2026-05-03', 'TFR-FR 6095623', 50, 'joint'),
      tx('2026-05-04', 'TFR-TO 6095623', -900, 'joint'), tx('2026-05-04', 'TFR-FR ###1817', 900, 'chq'),
    ];
    const o = own(rows);
    expect(o.count).toBe(6);       // rows
    expect(o.moves).toBe(3);       // moves
    expect(o.groups.map(g => [g.from, g.to, g.total, g.count, g.both])).toEqual([['Joint', 'Chequing', 900, 1, 1], ['Chequing', 'Joint', 550, 2, 2]]);
    expect(o.groups[1].moves.map(m => m.date)).toEqual(['2026-05-03', '2026-05-01']);   // newest first
  });
});

describe('deposits, and cash that was only passed on', () => {
  it('depositHow: deposits they made themselves, not pay, e-transfers or refunds', () => {
    expect(depositHow('GC 1234-DEPOSIT')).toBe('machine');
    expect(depositHow('TD ATM DEP 004512')).toBe('machine');
    expect(depositHow('MOBILE DEPOSIT')).toBe('mobile');
    expect(depositHow('DEPOSIT')).toBe('other');
    for (const d of ['DIRECT DEPOSIT ACME', 'PAYROLL DEP', 'E-TRANSFER DEPOSIT', 'CANADA FED DEPOSIT', 'DEPOT HOME', 'DIRECTCASH MSP', 'SEND E-TFR ***9K5']) expect(depositHow(d), d).toBeNull();
  });
  it('sums the deposits counted as income, lists the ones that aren’t, and the cash passed on', () => {
    const rows = [
      tx('2026-05-01', 'GC 1234-DEPOSIT', 900, 'chq', 'Income'), tx('2026-05-03', 'MOBILE DEPOSIT', 400, 'chq', 'Income'),
      tx('2026-05-05', 'TD ATM DEP 004512', 300, 'chq', 'Cash'),            // filed under Cash by its wording: offered as income
      tx('2026-05-06', 'GC 1234-DEPOSIT', 50, 'chq', 'Transfers'),          // they said this one isn't income
      tx('2026-05-02', 'SEND E-TFR ***aB1', -500, 'chq', 'Transferred cash'),
      tx('2026-05-02', 'PAYROLL ACME', 2000, 'chq', 'Income'),
    ];
    const d = sortDeposits(rows, []);
    expect(d.rows.map(r => [r.txn.amount, r.how])).toEqual([[50, 'machine'], [300, 'machine'], [400, 'mobile'], [900, 'machine']]);
    // cash and cheques apart: a cheque by phone is a cheque, the machine ones are cash until they say otherwise
    expect(d.rows.map(r => r.kind)).toEqual(['cash', 'cash', 'cheque', 'cash']);
    expect(d.cash).toEqual({ count: 3, total: 1250, income: 900, incomeCount: 1 });
    expect(d.cheque).toEqual({ count: 1, total: 400, income: 400, incomeCount: 1 });
    // "that $900 at the machine was a cheque": it moves over, and can move back
    const big = d.rows[3].txn;
    const said = setDepositKind({}, big.id, 'cheque');
    const moved = sortDeposits(rows, [], said);
    expect([moved.cash.income, moved.cheque.income, moved.cheque.count]).toEqual([0, 1300, 2]);
    expect(sortDeposits(rows, [], setDepositKind(said, big.id, 'cash')).cash.income).toBe(900);
    // a cheque by phone can be said to be cash too (it's theirs to say)
    expect(sortDeposits(rows, [], setDepositKind({}, d.rows[2].txn.id, 'cash')).cheque.count).toBe(0);
    expect([d.total, d.income, d.incomeCount]).toEqual([1650, 1300, 2]);
    expect(d.uncounted.map(t => t.amount)).toEqual([300]);
    expect([d.passed.length, d.passedTotal]).toEqual([1, 500]);
  });
  it('any sent e-transfer can be marked: sent before the deposit, after it, or nowhere near one', () => {
    const dep = tx('2026-05-10', 'GC 1234-DEPOSIT', 900, 'chq', 'Income'), chq = tx('2026-05-09', 'MOBILE DEPOSIT', 5000, 'chq', 'Income');
    const before = tx('2026-05-05', 'SEND E-TFR ***aB1', -900, 'chq'), after = tx('2026-05-12', 'SEND E-TFR ***aB2', -2000, 'joint'), far = tx('2026-03-01', 'SEND E-TFR ***aB3', -10, 'chq');
    const d = sortDeposits([dep, chq, before, after, far], [before, after, far]);
    // all three are there, newest first; the deposit beside each is only a reminder (a cheque isn't cash, so it's never the one)
    expect(d.sendable.map(m => [m.txn, m.near])).toEqual([[after, dep], [before, dep], [far, undefined]]);
    // through sortTransfers: only e-transfers still standing as transfers are listed; one already marked isn't
    const marked = { ...before, category: 'Transferred cash' };
    const s = sortTransfers([dep, marked, after], ACCOUNTS);
    expect(s.deposits.sendable.map(m => m.txn)).toEqual([after]);
    expect(s.deposits.passed).toEqual([marked]);
    expect(s.deposits.income - s.deposits.passedTotal).toBe(0);   // $900 deposited, $900 of it passed on
  });
});

// Adding accounts to a bank that's already connected (supabase/functions/planner-plaid/lib.ts): what Plaid Link
// is opened with, and reading the bank's accounts again afterwards. Stand-ins only, no network.
import { describe, expect, it } from 'vitest';
import { itemAccounts, linkTokenBody, plannerChoices, refreshAccounts, suggestFor, type ItemAccount, type PlaidAccount, type PlannerAccount, type RefreshIO } from '../../../../supabase/functions/planner-plaid/lib';
import { SCREENS, system } from '../../../../supabase/functions/planner-arvy/tools';

const base = { userId: 'u1', clientName: 'Vijay Planner', webhook: 'https://example.test/hook' };

describe('what Plaid Link is opened with', () => {
  it('a new bank asks for transactions', () => {
    const b = linkTokenBody(base);
    expect(b.products).toEqual(['transactions']);
    expect(b.access_token).toBeUndefined();
    expect(b.update).toBeUndefined();
  });
  it('reconnecting is update mode: the connection, no products, no account list', () => {
    const b = linkTokenBody({ ...base, accessToken: 'stand-in' });
    expect(b.access_token).toBe('stand-in');
    expect(b.products).toBeUndefined();
    expect(b.transactions).toBeUndefined();
    expect(b.update).toBeUndefined();
  });
  it('"Add or change accounts" is update mode with the account list, still no products', () => {
    const b = linkTokenBody({ ...base, accessToken: 'stand-in', addAccounts: true, redirect: 'https://example.test/back' });
    expect(b).toMatchObject({ access_token: 'stand-in', update: { account_selection_enabled: true }, redirect_uri: 'https://example.test/back', country_codes: ['CA'] });
    expect(b.products).toBeUndefined();
  });
  it('asking to add accounts without a connected bank is just a new bank', () => {
    expect(linkTokenBody({ ...base, addAccounts: true }).update).toBeUndefined();
  });
});

const chq: ItemAccount = { plaidId: 'p-chq', name: 'Chequing', mask: '1111', type: 'depository', subtype: 'checking', plannerId: 'acc-chq' };
const plaidChq: PlaidAccount = { account_id: 'p-chq', name: 'Chequing', mask: '1111', type: 'depository', subtype: 'checking' };
const plaidCard: PlaidAccount = { account_id: 'p-card', name: 'Visa', mask: '2222', type: 'credit', subtype: 'credit card' };
const plannerChq: PlannerAccount = { id: 'acc-chq', name: 'TD Chequing', type: 'chequing', last4: '1111', order: 0, plaid: { itemId: 'item1', plaidId: 'p-chq', linkedAt: '2026-11-01T00:00:00Z' } };
const handCard: PlannerAccount = { id: 'acc-ccd', name: 'Joint card', type: 'credit', order: 1 };
const item = { item_id: 'item1', institution_name: 'Test Bank', accounts: [chq] };

function stand(planner: PlannerAccount[], got: PlaidAccount[]) {
  const seen = { saved: null as ItemAccount[] | null, put: [] as PlannerAccount[], cleared: 0 };
  const io: RefreshIO = {
    accountsGet: async () => got,
    plannerAccounts: async () => planner,
    saveItemAccounts: async a => { seen.saved = a; },
    putAccounts: async a => { seen.put.push(...a); },
    clearNewAccounts: async () => { seen.cleared++; },
    now: () => '2026-11-12T12:00:00Z',
  };
  return { io, seen };
}

describe('after "Add or change accounts"', () => {
  it('a newly shared card is added to the bank’s list; the chequing keeps its planner account', async () => {
    const { io, seen } = stand([plannerChq, handCard], [plaidChq, plaidCard]);
    const r = await refreshAccounts(item, io);
    expect(seen.saved?.map(a => [a.plaidId, a.plannerId])).toEqual([['p-chq', 'acc-chq'], ['p-card', null]]);
    expect(r.accounts.find(a => a.plaidId === 'p-chq')?.suggest).toBe('acc-chq');
    expect(r.accounts.find(a => a.plaidId === 'p-card')?.suggest).toBe('new');
    expect(seen.put).toEqual([]);
  });
  it('the hand-made card is offered to choose, so its spending carries on there', async () => {
    const { io } = stand([plannerChq, handCard], [plaidChq, plaidCard]);
    const r = await refreshAccounts(item, io);
    expect(r.plannerAccounts.find(p => p.id === 'acc-ccd')).toMatchObject({ name: 'Joint card', type: 'credit', linked: false });
    expect(r.plannerAccounts.find(p => p.id === 'acc-chq')?.linked).toBe(false);   // linked to this same bank: still choosable
  });
  it('a card with the same last 4 digits is suggested', async () => {
    const { io } = stand([plannerChq, { ...handCard, last4: '2222' }], [plaidChq, plaidCard]);
    expect((await refreshAccounts(item, io)).accounts.find(a => a.plaidId === 'p-card')?.suggest).toBe('acc-ccd');
  });
  it('an account left untracked before stays untracked', async () => {
    const skipped: ItemAccount = { plaidId: 'p-sav', name: 'Savings', mask: '3333', type: 'depository', subtype: 'savings', plannerId: null };
    const { io } = stand([plannerChq], [plaidChq, { account_id: 'p-sav', name: 'Savings', mask: '3333', type: 'depository', subtype: 'savings' }]);
    const r = await refreshAccounts({ ...item, accounts: [chq, skipped] }, io);
    expect(r.accounts.find(a => a.plaidId === 'p-sav')?.suggest).toBe('skip');
  });
  it('an account no longer shared ends its link; its transactions stay', async () => {
    const { io, seen } = stand([plannerChq], [plaidCard]);
    await refreshAccounts(item, io);
    expect(seen.put).toEqual([{ ...plannerChq, plaid: { ...plannerChq.plaid!, removedAt: '2026-11-12T12:00:00Z' } }]);
  });
  it('clears “new accounts at the bank”', async () => {
    const { io, seen } = stand([plannerChq], [plaidChq]);
    await refreshAccounts(item, io);
    expect(seen.cleared).toBe(1);
  });
});

describe('the first connect is unchanged', () => {
  it('keeps the planner account a reconnect already linked', () => {
    expect(itemAccounts([plaidChq, plaidCard], [chq]).map(a => a.plannerId)).toEqual(['acc-chq', null]);
  });
  it('a new account is suggested new, or the same last 4 and kind not connected elsewhere', () => {
    const card = itemAccounts([plaidCard], [])[0];
    expect(suggestFor(card, [handCard], 'item1')).toBe('new');
    expect(suggestFor(card, [{ ...handCard, last4: '2222' }], 'item1')).toBe('acc-ccd');
    expect(suggestFor(card, [{ ...handCard, last4: '2222', plaid: { itemId: 'other', plaidId: 'x', linkedAt: '' } }], 'item1')).toBe('new');
  });
  it('an account connected to another bank is not offered', () => {
    expect(plannerChoices([{ ...handCard, plaid: { itemId: 'other', plaidId: 'x', linkedAt: '' } }], 'item1')[0].linked).toBe(true);
  });
});

describe('Arvy and adding a card to Money', () => {
  it('says where to add one, instead of “can’t do that yet”', () => {
    const s = system({ name: 'Rosh', profile: 'morning' });
    expect(s).toMatch(/Adding an account to Money.*not a cant_do_yet.*Credit card.*Add or change accounts.*open_screen, \/money\/accounts/);
    expect(SCREENS['/money/accounts']).toMatch(/credit card/);
  });
});

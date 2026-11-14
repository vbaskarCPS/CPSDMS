// supabase/functions/planner-plaid/lib.ts — the parts of the bank connections that don't need the network:
// what Plaid Link is opened with, how a bank's account list is read into the planner, which planner account
// each one is suggested for, and refreshing a connected bank's accounts after "Add or change accounts".
// index.ts does the calls; the tests (src/planner/features/money/plaidAccounts.test.ts) use stand-ins.

export interface ItemAccount { plaidId: string; name: string; mask: string | null; type: string; subtype: string | null; plannerId: string | null }
export interface PlannerAccount { id: string; name: string; type: 'chequing' | 'savings' | 'credit'; last4?: string; balance?: number; balanceAsOf?: string; order: number; archived?: boolean; plaid?: { itemId: string; plaidId: string; institution?: string; linkedAt: string; removedAt?: string } }
export interface PlaidAccount { account_id: string; name: string; official_name?: string | null; mask?: string | null; type: string; subtype?: string | null; balances?: { current?: number | null; available?: number | null; iso_currency_code?: string | null } }

/** The household doc that says a bank has accounts not shared with the planner yet (Plaid's NEW_ACCOUNTS_AVAILABLE). Key: the item id. */
export const NEW_ACCOUNTS_KIND = 'bank_new_accounts';

export const plannerType = (a: { type: string; subtype?: string | null }): PlannerAccount['type'] =>
  a.type === 'credit' ? 'credit' : (a.subtype === 'savings' || a.subtype === 'cd' || a.subtype === 'money market' || a.subtype === 'hsa') ? 'savings' : 'chequing';

/** The /link/token/create body. A new bank asks for transactions; an existing one (accessToken) is update mode:
 *  a fresh sign-in, or with addAccounts the bank's account list too, so more accounts can be shared. Plaid says
 *  update mode takes no products (https://plaid.com/docs/link/update-mode/). */
export function linkTokenBody(o: { userId: string; clientName: string; webhook: string; redirect?: string; accessToken?: string; addAccounts?: boolean }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    user: { client_user_id: o.userId }, client_name: o.clientName,
    country_codes: ['CA'], language: 'en', webhook: o.webhook, ...(o.redirect ? { redirect_uri: o.redirect } : {}),
  };
  if (o.accessToken) {
    body.access_token = o.accessToken;
    if (o.addAccounts) body.update = { account_selection_enabled: true };
  } else {
    body.products = ['transactions'];
    body.transactions = { days_requested: 730 };
  }
  return body;
}

/** The bank's accounts as the planner keeps them, keeping the planner account each was already linked to. */
export const itemAccounts = (got: PlaidAccount[], before: ItemAccount[]): ItemAccount[] => {
  const kept = new Map(before.map(a => [a.plaidId, a.plannerId]));
  return got.map(a => ({ plaidId: a.account_id, name: a.name || a.official_name || 'Account', mask: a.mask || null, type: a.type, subtype: a.subtype || null, plannerId: kept.get(a.account_id) || null }));
};

/** Which planner account a bank account is suggested for: the one it's linked to; else the same last 4 digits and
 *  kind, not connected to another bank; else a new one. `before`: the accounts the bank shared until now, so one
 *  that was left untracked on purpose stays untracked. */
export function suggestFor(a: ItemAccount, planner: PlannerAccount[], itemId: string, before?: ItemAccount[]): string {
  if (a.plannerId) return a.plannerId;
  if (before?.some(b => b.plaidId === a.plaidId)) return 'skip';
  const t = plannerType(a);
  const hit = planner.find(p => !(p.plaid && !p.plaid.removedAt && p.plaid.itemId !== itemId) && p.type === t && a.mask && p.last4 === a.mask);
  return hit ? hit.id : 'new';
}

/** The planner accounts to choose from; `linked` = connected to a different bank (so not offered). */
export const plannerChoices = (planner: PlannerAccount[], itemId: string) =>
  planner.map(p => ({ id: p.id, name: p.name, type: p.type, last4: p.last4 || null, linked: !!(p.plaid && !p.plaid.removedAt && p.plaid.itemId !== itemId) }));

export interface RefreshIO {
  accountsGet: () => Promise<PlaidAccount[]>;                       // Plaid /accounts/get with the item's access token
  plannerAccounts: () => Promise<PlannerAccount[]>;                 // the household's 'account' docs
  saveItemAccounts: (accounts: ItemAccount[]) => Promise<void>;     // planner_bank_items.accounts
  putAccounts: (accounts: PlannerAccount[]) => Promise<void>;       // 'account' docs
  clearNewAccounts: () => Promise<void>;                            // the NEW_ACCOUNTS_KIND doc
  now: () => string;
}

/** After "Add or change accounts" in Plaid Link: read the bank's account list again, end the link of any account
 *  that's no longer shared (its rows stay), and hand back the same choices as a first connect. */
export async function refreshAccounts(item: { item_id: string; institution_name: string | null; accounts: ItemAccount[] }, io: RefreshIO) {
  const got = await io.accountsGet();
  const accounts = itemAccounts(got, item.accounts);
  const all = await io.plannerAccounts();
  const stillShared = new Set(accounts.map(a => a.plaidId));
  const now = io.now();
  const ended = item.accounts.filter(a => a.plannerId && !stillShared.has(a.plaidId))
    .map(a => all.find(p => p.id === a.plannerId))
    .filter((p): p is PlannerAccount => !!p?.plaid && !p.plaid.removedAt && p.plaid.itemId === item.item_id)
    .map(p => ({ ...p, plaid: { ...p.plaid!, removedAt: now } }));
  await io.saveItemAccounts(accounts);
  if (ended.length) await io.putAccounts(ended);
  await io.clearNewAccounts();
  const planner = all.filter(a => !a.archived);
  return {
    itemId: item.item_id, institution: item.institution_name,
    accounts: accounts.map(a => ({ ...a, suggest: suggestFor(a, planner, item.item_id, item.accounts) })),
    plannerAccounts: plannerChoices(planner, item.item_id),
  };
}

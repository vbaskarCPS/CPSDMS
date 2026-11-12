// supabase/functions/planner-plaid/index.ts — the planner's bank connections through Plaid.
//
// From the app (planner token checked with planner_me; money belongs to the household):
//   POST { token, action: 'link_token', redirectUri?, itemId?, addAccounts? } → { linkToken }  opens Plaid Link (itemId: reconnect that bank;
//                                                                   with addAccounts: choose which of its accounts are shared)
//   POST { token, action: 'exchange', publicToken, institution? } → { itemId, accounts: [{ plaidId, name, mask, type, subtype, suggest }] }
//   POST { token, action: 'accounts', itemId }                   → after addAccounts: the bank's accounts again, as 'exchange' returns them
//   POST { token, action: 'map', itemId, map: { [plaidId]: plannerAccountId | 'new' | 'skip' } } → links the accounts, syncs
//   POST { token, action: 'list' }                                → { items: [...] }  (no tokens, ever)
//   POST { token, action: 'sync', itemId? }                       → pulls what's new for the household's banks
//   POST { token, action: 'remove', itemId }                      → disconnects (Plaid revokes the token; rows stay)
//   POST { token, action: 'sandbox_link' }                        → test mode only: connects Plaid's test bank (then as 'exchange')
// From Plaid (no planner token; checked with the Plaid-Verification JWT):
//   POST { webhook_type, webhook_code, item_id, ... }             → TRANSACTIONS SYNC_UPDATES_AVAILABLE syncs that bank;
//                                                                   ITEM errors mark it for reconnecting; ITEM NEW_ACCOUNTS_AVAILABLE
//                                                                   marks it so Money → Accounts offers to add them
// From pg_cron (x-cron-key = planner_secrets.cron_key), daily:
//   POST { action: 'tick' }                                       → syncs every active bank
//
// The access token lives in Vault (planner_plaid_save_item / planner_plaid_token); this function is the
// only reader. Bank sign-ins happen inside Plaid Link: the planner never sees a bank password.
// Secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV ('sandbox' | 'production').
// Deployed without JWT verification: the planner has no Supabase accounts, and Plaid can't send one.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { applySync, type PlaidTxn, type PlannerTxn } from '../_shared/plannerMoney.ts';
import { itemAccounts, linkTokenBody, NEW_ACCOUNTS_KIND, plannerChoices, plannerType, refreshAccounts, suggestFor, type ItemAccount, type PlaidAccount, type PlannerAccount } from './lib.ts';

const env = (k: string) => (Deno.env.get(k) || '').trim();
const PLAID_ENV = env('PLAID_ENV') === 'production' ? 'production' : 'sandbox';
const PLAID_BASE = `https://${PLAID_ENV}.plaid.com`;
const SUPABASE_URL = env('SUPABASE_URL');
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/planner-plaid`;
// Plaid only sends people back to addresses registered in its dashboard (Developers → API → Allowed redirect URIs)
const REDIRECTS = ['https://planner.propertystars.app/vijayplanner/plaid-oauth', 'https://planner.propertystars.app/roshplanner/plaid-oauth'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class PlaidError extends Error { constructor(public code: string, message: string, public type = '') { super(message); } }
async function plaid<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env('PLAID_CLIENT_ID'), secret: env('PLAID_SECRET'), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PlaidError(String(data.error_code || res.status), String(data.display_message || data.error_message || `Plaid ${res.status}`), String(data.error_type || ''));
  return data as T;
}

interface Me { id: string; display_name: string; household_id: string; settings?: { app?: string } }
interface ItemRow {
  id: string; household_id: string; added_by: string; item_id: string; institution_id: string | null; institution_name: string | null;
  accounts: ItemAccount[]; cursor: string | null; status: string; error: string | null; last_sync_at: string | null; created_at: string;
}

// ── household docs (service role writes them directly, under the household's user id) ──
async function docs<T>(svc: SupabaseClient, owner: string, kind: string): Promise<{ key: string; data: T }[]> {
  const { data, error } = await svc.from('planner_docs').select('key, data').eq('user_id', owner).eq('kind', kind);
  if (error) throw new Error(error.message);
  return ((data || []) as { key: string; data: T }[]).filter(d => d.data !== null);
}
async function putDocs(svc: SupabaseClient, owner: string, list: { kind: string; key: string; data: unknown }[]) {
  if (!list.length) return;
  const now = new Date().toISOString();
  const { error } = await svc.from('planner_docs').upsert(list.map(d => ({ user_id: owner, kind: d.kind, key: d.key, data: d.data, updated_at: now })), { onConflict: 'user_id,kind,key' });
  if (error) throw new Error(error.message);
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());

// ── sync one bank: pull everything since its cursor, write the household's months and balances ──
async function syncItem(svc: SupabaseClient, item: ItemRow): Promise<{ added: number; updated: number; removed: number }> {
  const accessToken = (await svc.rpc('planner_plaid_token', { p_item_id: item.item_id })).data as string | null;
  if (!accessToken) throw new Error('This bank is not connected');
  const accountMap: Record<string, string> = {};
  for (const a of item.accounts) if (a.plannerId) accountMap[a.plaidId] = a.plannerId;

  // page through /transactions/sync; if the data changes mid-way, Plaid asks us to start over from the same cursor
  let added: PlaidTxn[] = [], modified: PlaidTxn[] = [], removed: { transaction_id: string }[] = [];
  let balances: PlaidAccount[] = [];
  let cursor: string | undefined;
  for (let restart = 0; ; restart++) {
    added = []; modified = []; removed = []; cursor = item.cursor || undefined;
    try {
      for (let page = 0; page < 50; page++) {
        const r = await plaid<{ added: PlaidTxn[]; modified: PlaidTxn[]; removed: { transaction_id: string }[]; accounts?: PlaidAccount[]; next_cursor: string; has_more: boolean }>(
          '/transactions/sync', { access_token: accessToken, cursor, count: 500, options: { include_original_description: true, days_requested: 730 } });
        added.push(...r.added); modified.push(...r.modified); removed.push(...r.removed);
        if (r.accounts?.length) balances = r.accounts;
        cursor = r.next_cursor;
        if (!r.has_more) break;
      }
      break;
    } catch (e) {
      if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restart < 3) continue;
      throw e;
    }
  }

  const owner = item.household_id;
  const months: Record<string, PlannerTxn[]> = {};
  for (const d of await docs<{ rows?: PlannerTxn[] }>(svc, owner, 'txns')) months[d.key] = d.data?.rows || [];
  const rules: Record<string, string> = {};
  for (const d of await docs<{ category?: string }>(svc, owner, 'rule')) if (d.data?.category) rules[d.key] = d.data.category;

  const res = applySync(months, { added, modified, removed }, accountMap, rules);
  const out: { kind: string; key: string; data: unknown }[] = [...res.touched].map(m => ({ kind: 'txns', key: m, data: { rows: months[m] } }));

  // balances: what the bank says now (credit cards: the amount owed, as on the card's CSV)
  if (balances.length) {
    const accs = await docs<PlannerAccount>(svc, owner, 'account');
    for (const b of balances) {
      const pid = accountMap[b.account_id];
      const acc = pid && accs.find(a => a.key === pid)?.data;
      const cur = b.balances?.current;
      if (!acc || typeof cur !== 'number') continue;
      out.push({ kind: 'account', key: acc.id, data: { ...acc, balance: Math.round(cur * 100) / 100, balanceAsOf: today() } });
    }
  }
  await putDocs(svc, owner, out);
  await svc.from('planner_bank_items').update({ cursor, last_sync_at: new Date().toISOString(), status: 'active', error: null }).eq('item_id', item.item_id);
  return { added: res.added, updated: res.updated, removed: res.removed };
}

async function syncSafely(svc: SupabaseClient, item: ItemRow) {
  try { return { itemId: item.item_id, ok: true, ...(await syncItem(svc, item)) }; }
  catch (e) {
    const login = e instanceof PlaidError && (e.code === 'ITEM_LOGIN_REQUIRED' || e.code === 'PENDING_EXPIRATION' || e.code === 'ACCESS_NOT_GRANTED');
    const msg = e instanceof Error ? e.message : String(e);
    await svc.from('planner_bank_items').update({ status: login ? 'login_required' : 'error', error: msg.slice(0, 300) }).eq('item_id', item.item_id);
    console.error('planner-plaid sync', item.item_id, msg);
    return { itemId: item.item_id, ok: false, error: msg, reconnect: login };
  }
}

// ── Plaid webhook verification: an ES256 JWT over the body's SHA-256 (https://plaid.com/docs/api/webhooks/webhook-verification/) ──
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const keyCache = new Map<string, CryptoKey>();
async function verifyWebhook(jwt: string, rawBody: string): Promise<boolean> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return false;
  const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  if (header.alg !== 'ES256' || !header.kid) return false;
  let key = keyCache.get(header.kid);
  if (!key) {
    const r = await plaid<{ key: JsonWebKey & { expired_at?: number | null } }>('/webhook_verification_key/get', { key_id: header.kid });
    if (r.key.expired_at) return false;
    key = await crypto.subtle.importKey('jwk', { kty: r.key.kty, crv: r.key.crv, x: r.key.x, y: r.key.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    keyCache.set(header.kid, key);
  }
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return false;
  const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  if (typeof claims.iat !== 'number' || Math.abs(Date.now() / 1000 - claims.iat) > 300) return false;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody)))).map(b => b.toString(16).padStart(2, '0')).join('');
  return digest === claims.request_body_sha256;
}

const publicItem = (i: ItemRow, newAccounts = false) => ({
  itemId: i.item_id, newAccounts, institution: i.institution_name || 'Bank', status: i.status, error: i.status === 'active' ? null : i.error,
  lastSyncAt: i.last_sync_at, createdAt: i.created_at, accounts: i.accounts.map(a => ({ plaidId: a.plaidId, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype, plannerId: a.plannerId })),
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const svc = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  try {
    const raw = await req.text();
    const b = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();

    // ── from Plaid ──
    if (typeof b.webhook_type === 'string') {
      const jwt = req.headers.get('plaid-verification') || '';
      if (!jwt || !(await verifyWebhook(jwt, raw).catch(() => false))) return json({ error: 'Not verified' }, 401);
      const itemId = String(b.item_id || '');
      const { data: item } = await svc.from('planner_bank_items').select('*').eq('item_id', itemId).neq('status', 'removed').maybeSingle();
      if (!item) return json({ ok: true, ignored: 'unknown item' });
      await svc.from('planner_bank_items').update({ last_webhook_at: new Date().toISOString() }).eq('item_id', itemId);
      const type = b.webhook_type, code = String(b.webhook_code || '');
      if (type === 'TRANSACTIONS' && (code === 'SYNC_UPDATES_AVAILABLE' || code === 'DEFAULT_UPDATE' || code === 'INITIAL_UPDATE' || code === 'HISTORICAL_UPDATE')) {
        return json(await syncSafely(svc, item as ItemRow));
      }
      if (type === 'ITEM' && (code === 'ERROR' || code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT')) {
        const err = (b.error as { error_code?: string; error_message?: string } | null) || null;
        await svc.from('planner_bank_items').update({ status: 'login_required', error: (err?.error_message || code).slice(0, 300) }).eq('item_id', itemId);
      } else if (type === 'ITEM' && code === 'LOGIN_REPAIRED') {
        await svc.from('planner_bank_items').update({ status: 'active', error: null }).eq('item_id', itemId);
      } else if (type === 'ITEM' && code === 'NEW_ACCOUNTS_AVAILABLE') {
        // the bank has accounts this connection doesn't share yet: Money → Accounts offers "add them" until they're chosen
        await putDocs(svc, (item as ItemRow).household_id, [{ kind: NEW_ACCOUNTS_KIND, key: itemId, data: { at: new Date().toISOString() } }]);
      } else if (type === 'ITEM' && code === 'USER_PERMISSION_REVOKED') {
        await svc.rpc('planner_plaid_forget', { p_item_id: itemId });
      }
      return json({ ok: true });
    }

    // ── from pg_cron ──
    if (b.action === 'tick') {
      const { data: k } = await svc.from('planner_secrets').select('value').eq('name', 'cron_key').maybeSingle();
      if (!k?.value || (req.headers.get('x-cron-key') || '') !== k.value) return json({ error: 'Not allowed' }, 403);
      const { data: items } = await svc.from('planner_bank_items').select('*').in('status', ['active', 'error']);
      const results = [];
      for (const it of (items || []) as ItemRow[]) results.push(await syncSafely(svc, it));
      return json({ ok: true, results });
    }

    // ── from the app ──
    const anon = createClient(SUPABASE_URL, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
    const { data: who, error: whoErr } = await anon.rpc('planner_me', { p_token: typeof b.token === 'string' ? b.token : '' });
    if (whoErr || !who?.ok) return json({ error: 'signed_out' }, 401);
    const me = who.user as Me;
    const household = me.household_id || me.id;
    const itemOf = async (itemId: unknown) => {
      const { data } = await svc.from('planner_bank_items').select('*').eq('item_id', String(itemId || '')).eq('household_id', household).neq('status', 'removed').maybeSingle();
      return data as ItemRow | null;
    };

    if (b.action === 'link_token') {
      const redirect = typeof b.redirectUri === 'string' && REDIRECTS.includes(b.redirectUri) ? b.redirectUri : undefined;
      let accessToken: string | undefined;
      if (b.itemId) {   // "update mode": same bank, fresh sign-in (and with addAccounts, its account list)
        const item = await itemOf(b.itemId);
        if (!item) return json({ error: 'Not found' }, 404);
        accessToken = ((await svc.rpc('planner_plaid_token', { p_item_id: item.item_id })).data as string | null) || undefined;
        if (!accessToken) return json({ error: 'Not found' }, 404);
      }
      const body = linkTokenBody({
        userId: me.id, clientName: me.settings?.app === 'roshplanner' ? 'Rosh Planner' : 'Vijay Planner', webhook: WEBHOOK_URL,
        redirect, accessToken, addAccounts: b.addAccounts === true,
      });
      let r: { link_token: string; expiration: string };
      try { r = await plaid('/link/token/create', body); }
      catch (e) {
        // the return address isn't registered in Plaid's dashboard yet: banks that sign in inside Link still work
        if (!(body.redirect_uri && e instanceof PlaidError && /redirect/i.test(e.message))) throw e;
        delete body.redirect_uri;
        r = await plaid('/link/token/create', body);
      }
      return json({ linkToken: r.link_token, expiration: r.expiration });
    }

    // test mode only: a sandbox bank connection without opening Link (Plaid's test bank, test data)
    if (b.action === 'sandbox_link' && PLAID_ENV === 'sandbox') {
      const r = await plaid<{ public_token: string }>('/sandbox/public_token/create', {
        institution_id: 'ins_109508', initial_products: ['transactions'], options: { webhook: WEBHOOK_URL, transactions: { days_requested: 730 } } });
      b.publicToken = r.public_token;
      b.action = 'exchange';
    }

    if (b.action === 'exchange') {
      const publicToken = typeof b.publicToken === 'string' ? b.publicToken : '';
      if (!publicToken) return json({ error: 'publicToken required' }, 400);
      const ex = await plaid<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken });
      const got = await plaid<{ accounts: PlaidAccount[]; item: { institution_id?: string | null } }>('/accounts/get', { access_token: ex.access_token });
      const inst = (b.institution as { name?: string; institution_id?: string } | undefined) || {};
      let instName = inst.name || null;
      const instId = got.item.institution_id || inst.institution_id || null;
      if (!instName && instId) {
        try { instName = (await plaid<{ institution: { name: string } }>('/institutions/get_by_id', { institution_id: instId, country_codes: ['CA'] })).institution.name; } catch { /* name is cosmetic */ }
      }
      // keep the planner account a reconnect already linked
      const { data: before } = await svc.from('planner_bank_items').select('accounts').eq('item_id', ex.item_id).maybeSingle();
      const accounts = itemAccounts(got.accounts, (before?.accounts || []) as ItemAccount[]);
      const { error } = await svc.rpc('planner_plaid_save_item', {
        p_household: household, p_added_by: me.id, p_item_id: ex.item_id, p_access_token: ex.access_token,
        p_institution_id: instId, p_institution_name: instName, p_accounts: accounts,
      });
      if (error) throw new Error(error.message);
      // suggest a planner account for each: the same last 4 digits and kind, not already connected elsewhere
      const planner = (await docs<PlannerAccount>(svc, household, 'account')).map(d => d.data).filter(a => !a.archived);
      return json({ itemId: ex.item_id, institution: instName, accounts: accounts.map(a => ({ ...a, suggest: suggestFor(a, planner, ex.item_id) })),
        plannerAccounts: plannerChoices(planner, ex.item_id) });
    }

    // back from "Add or change accounts" (update mode with account selection): the access token is the same, so
    // nothing to swap; read the bank's accounts again and offer the same choices as a first connect
    if (b.action === 'accounts') {
      const item = await itemOf(b.itemId);
      if (!item) return json({ error: 'Not found' }, 404);
      const accessToken = (await svc.rpc('planner_plaid_token', { p_item_id: item.item_id })).data as string | null;
      if (!accessToken) return json({ error: 'Not found' }, 404);
      return json(await refreshAccounts(item, {
        accountsGet: async () => (await plaid<{ accounts: PlaidAccount[] }>('/accounts/get', { access_token: accessToken })).accounts,
        plannerAccounts: async () => (await docs<PlannerAccount>(svc, household, 'account')).map(d => d.data),
        saveItemAccounts: async accounts => {
          const { error } = await svc.from('planner_bank_items').update({ accounts, status: 'active', error: null }).eq('item_id', item.item_id);
          if (error) throw new Error(error.message);
        },
        putAccounts: list => putDocs(svc, household, list.map(a => ({ kind: 'account', key: a.id, data: a }))),
        clearNewAccounts: async () => { await svc.from('planner_docs').delete().eq('user_id', household).eq('kind', NEW_ACCOUNTS_KIND).eq('key', item.item_id); },
        now: () => new Date().toISOString(),
      }));
    }

    if (b.action === 'map') {
      const item = await itemOf(b.itemId);
      if (!item) return json({ error: 'Not found' }, 404);
      const map = (b.map || {}) as Record<string, string>;
      const accDocs = (await docs<PlannerAccount>(svc, household, 'account')).map(d => d.data);
      let order = accDocs.reduce((m, a) => Math.max(m, a.order ?? 0), -1) + 1;
      const now = new Date().toISOString();
      const writes: { kind: string; key: string; data: unknown }[] = [];
      const accounts = item.accounts.map(a => {
        const want = map[a.plaidId];
        if (!want || want === 'skip') return { ...a, plannerId: null };
        let acc = want === 'new' ? null : accDocs.find(p => p.id === want) || null;
        if (!acc) acc = { id: crypto.randomUUID(), name: `${item.institution_name || 'Bank'} ${a.name}`.slice(0, 60), type: plannerType(a), last4: a.mask || undefined, order: order++ };
        const linked: PlannerAccount = { ...acc, last4: acc.last4 || a.mask || undefined, plaid: { itemId: item.item_id, plaidId: a.plaidId, institution: item.institution_name || undefined, linkedAt: now } };
        writes.push({ kind: 'account', key: linked.id, data: linked });
        return { ...a, plannerId: linked.id };
      });
      // accounts that were linked to this bank and now aren't: mark the link ended (their rows stay)
      for (const prev of item.accounts) {
        if (!prev.plannerId || accounts.some(a => a.plannerId === prev.plannerId)) continue;
        const acc = accDocs.find(p => p.id === prev.plannerId);
        if (acc?.plaid && !acc.plaid.removedAt) writes.push({ kind: 'account', key: acc.id, data: { ...acc, plaid: { ...acc.plaid, removedAt: now } } });
      }
      await putDocs(svc, household, writes);
      // changing which accounts are linked: start the bank's history over so every linked account gets all of it
      await svc.from('planner_bank_items').update({ accounts, cursor: null }).eq('item_id', item.item_id);
      const synced = await syncSafely(svc, { ...item, accounts, cursor: null });
      return json({ ok: true, linked: accounts.filter(a => a.plannerId).length, sync: synced });
    }

    if (b.action === 'list') {
      const { data } = await svc.from('planner_bank_items').select('*').eq('household_id', household).neq('status', 'removed').order('created_at');
      const fresh = new Set((await docs<unknown>(svc, household, NEW_ACCOUNTS_KIND)).map(d => d.key));
      return json({ items: ((data || []) as ItemRow[]).map(i => publicItem(i, fresh.has(i.item_id))), env: PLAID_ENV });
    }

    if (b.action === 'sync') {
      let q = svc.from('planner_bank_items').select('*').eq('household_id', household).neq('status', 'removed');
      if (b.itemId) q = q.eq('item_id', String(b.itemId));
      const { data } = await q;
      const results = [];
      for (const it of (data || []) as ItemRow[]) results.push(await syncSafely(svc, it));
      return json({ ok: true, results });
    }

    if (b.action === 'remove') {
      const item = await itemOf(b.itemId);
      if (!item) return json({ error: 'Not found' }, 404);
      const accessToken = (await svc.rpc('planner_plaid_token', { p_item_id: item.item_id })).data as string | null;
      if (accessToken) {
        try { await plaid('/item/remove', { access_token: accessToken }); }
        catch (e) { if (!(e instanceof PlaidError && (e.code === 'ITEM_NOT_FOUND' || e.code === 'INVALID_ACCESS_TOKEN'))) throw e; }
      }
      await svc.rpc('planner_plaid_forget', { p_item_id: item.item_id });
      const now = new Date().toISOString();
      const accDocs = (await docs<PlannerAccount>(svc, household, 'account')).map(d => d.data);
      const writes = accDocs.filter(a => a.plaid?.itemId === item.item_id && !a.plaid.removedAt)
        .map(a => ({ kind: 'account', key: a.id, data: { ...a, plaid: { ...a.plaid!, removedAt: now } } }));
      await putDocs(svc, household, writes);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Something went wrong';
    console.error('planner-plaid', msg);
    return json({ error: msg, code: e instanceof PlaidError ? e.code : undefined }, e instanceof PlaidError ? 502 : 500);
  }
});


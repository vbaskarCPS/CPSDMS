// src/planner/features/money/plaid.ts — connecting banks through Plaid (supabase/functions/planner-plaid).
// Plaid Link (Plaid's own sign-in window, loaded from cdn.plaid.com) is where the bank password goes; the
// planner only ever gets a one-time public token, which the edge function swaps for the real one.
import { supabase } from '../../../lib/supabase';
import { getPass, forgetPass, SignedOut } from '../../lib/auth';
import { appBase } from '../../lib/app';

export interface BankAccount { plaidId: string; name: string; mask: string | null; type: string; subtype: string | null; plannerId: string | null }
export interface BankItem { itemId: string; institution: string; newAccounts?: boolean; status: 'active' | 'login_required' | 'error'; error: string | null; lastSyncAt: string | null; createdAt: string; accounts: BankAccount[] }
export interface Exchanged {
  itemId: string; institution: string | null;
  accounts: (BankAccount & { suggest: string })[];
  plannerAccounts: { id: string; name: string; type: string; last4: string | null; linked: boolean }[];
}
export interface SyncResult { itemId: string; ok: boolean; added?: number; updated?: number; removed?: number; error?: string; reconnect?: boolean }

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const p = getPass();
  if (!p) throw new SignedOut();
  const { data, error } = await supabase.functions.invoke('planner-plaid', { body: { ...body, token: p.token } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error; } catch { /* keep */ }
    if (msg === 'signed_out') { forgetPass(); throw new SignedOut(); }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const listBanks = () => invoke<{ items: BankItem[]; env: 'sandbox' | 'production' }>({ action: 'list' });
export const syncBanks = (itemId?: string) => invoke<{ results: SyncResult[] }>({ action: 'sync', itemId });
export const removeBank = (itemId: string) => invoke<{ ok: true }>({ action: 'remove', itemId });
export const mapAccounts = (itemId: string, map: Record<string, string>) => invoke<{ linked: number; sync: SyncResult }>({ action: 'map', itemId, map });

// ── Plaid Link ──
interface LinkHandler { open: () => void; exit: (o?: { force: boolean }) => void; destroy: () => void }
interface LinkMeta { institution?: { name?: string; institution_id?: string } | null }
interface PlaidGlobal {
  create: (o: {
    token: string; receivedRedirectUri?: string;
    onSuccess: (publicToken: string, meta: LinkMeta) => void;
    onExit: (err: { display_message?: string; error_message?: string } | null, meta?: LinkMeta) => void;
  }) => LinkHandler;
}
declare global { interface Window { Plaid?: PlaidGlobal } }

let loading: Promise<PlaidGlobal> | null = null;
function loadLink(): Promise<PlaidGlobal> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.async = true;
    s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid didn’t load')));
    s.onerror = () => { loading = null; reject(new Error('Couldn’t reach Plaid. Check the connection and try again.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Where Plaid sends people back after a bank's own sign-in page (OAuth banks: TD, RBC, …). Must be
 *  registered in the Plaid dashboard; the edge function only passes the ones it knows. */
export const redirectUri = () => `${location.origin}${appBase()}/plaid-oauth`;
const PENDING = 'planner-plaid-link';

/** 'closed': Link ended without connecting; `institution` is the bank they'd picked, when Plaid says. */
export type LinkOutcome = { kind: 'new'; exchanged: Exchanged } | { kind: 'reconnected'; itemId: string } | { kind: 'closed'; message?: string; institution?: string };

/** Open Plaid Link: a new bank, or (itemId) a fresh sign-in for one already connected, or (itemId, addAccounts)
 *  the bank's account list, to share more of its accounts (or fewer). */
export async function openLink(itemId?: string, addAccounts = false): Promise<LinkOutcome> {
  const add = !!itemId && addAccounts;
  const [{ linkToken }, Plaid] = await Promise.all([
    invoke<{ linkToken: string }>({ action: 'link_token', itemId, redirectUri: redirectUri(), ...(add ? { addAccounts: true } : {}) }),
    loadLink(),
  ]);
  try { sessionStorage.setItem(PENDING, JSON.stringify({ linkToken, itemId: itemId || null, addAccounts: add })); } catch { /* private mode: OAuth banks need a second try */ }
  return run(Plaid, linkToken, itemId, undefined, add);
}

/** After "Add or change accounts": the bank's accounts again, to choose where each goes (as after a first connect). */
export const bankAccounts = (itemId: string) => invoke<Exchanged>({ action: 'accounts', itemId });

/** Back from a bank's own sign-in page (the /plaid-oauth route): finish the same Link session. */
export async function resumeLink(): Promise<LinkOutcome> {
  let saved: { linkToken: string; itemId: string | null; addAccounts?: boolean } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch { saved = null; }
  if (!saved?.linkToken) return { kind: 'closed', message: 'That bank sign-in expired. Start again from Accounts.' };
  const Plaid = await loadLink();
  return run(Plaid, saved.linkToken, saved.itemId || undefined, location.href, !!saved.addAccounts);
}

function run(Plaid: PlaidGlobal, token: string, itemId?: string, receivedRedirectUri?: string, addAccounts = false): Promise<LinkOutcome> {
  return new Promise((resolve, reject) => {
    const done = () => { try { sessionStorage.removeItem(PENDING); } catch { /* fine */ } };
    const handler = Plaid.create({
      token, receivedRedirectUri,
      onSuccess: (publicToken, meta) => {
        done(); handler.destroy();
        if (itemId && addAccounts) { bankAccounts(itemId).then(exchanged => resolve({ kind: 'new', exchanged }), reject); return; }   // same connection, new account list
        if (itemId) { resolve({ kind: 'reconnected', itemId }); return; }   // update mode: same connection, nothing to swap
        invoke<Exchanged>({ action: 'exchange', publicToken, institution: meta.institution || undefined })
          .then(exchanged => resolve({ kind: 'new', exchanged }), reject);
      },
      onExit: (err, meta) => { done(); handler.destroy(); resolve({ kind: 'closed', message: err?.display_message || err?.error_message || undefined, institution: meta?.institution?.name || undefined }); },
    });
    handler.open();
  });
}

export function syncedLabel(iso: string | null): string {
  if (!iso) return 'not synced yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'synced just now';
  if (mins < 60) return `synced ${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `synced ${h} h ago`;
  return `synced ${new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
}

// src/planner/features/shop/store.ts — reading and writing the list; the deals refresh.
import { getDoc, getDocs, putDoc, putDocs } from '../../lib/docs';
import { shoppingDeals } from '../../lib/ai';
import { DEFAULT_PREFS, type ShopItem, type ShopPrefs } from './types';

export async function loadList(): Promise<ShopItem[]> {
  const docs = await getDocs<ShopItem>('shop');
  return docs.map(d => d.data).filter(i => i && i.id && i.text).sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1));
}
export const saveItem = (i: ShopItem) => putDoc('shop', i.id, i);
/** Soft-remove: a JSON null, never a DELETE. */
export const removeItem = (i: ShopItem) => putDoc('shop', i.id, null);
export async function loadPrefs(): Promise<ShopPrefs> { const p = (await getDoc<Partial<ShopPrefs>>('shopprefs', 'prefs').catch(() => null)) || {}; return { ...DEFAULT_PREFS, ...p, specialty: Array.isArray(p.specialty) ? p.specialty : DEFAULT_PREFS.specialty }; }
export const savePrefs = (p: ShopPrefs) => putDoc('shopprefs', 'prefs', p);

/** Look up this week's deals for the open items that haven't been checked today (or all, when forced); saves them on the items. */
export async function refreshDeals(items: ShopItem[], prefs: ShopPrefs, force = false): Promise<ShopItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const stale = items.filter(i => !i.done && (force || !i.dealsAt || i.dealsAt.slice(0, 10) !== today));
  if (!stale.length) return items;
  const r = await shoppingDeals(stale.map(i => ({ id: i.id, text: i.text })), prefs.postal, prefs.stores, prefs.specialty || []);
  const at = new Date().toISOString();
  const next = items.map(i => {
    const hit = r.items.find(x => x.id === i.id);
    const keepStore = i.store && (hit?.deals.some(d => d.merchant === i.store) || (prefs.specialty || []).some(s => s.name === i.store));
    return hit ? { ...i, section: hit.section, deals: hit.deals, suggestedStore: hit.suggestedStore, reason: hit.reason, dealsAt: at, store: keepStore ? i.store : undefined } : i;
  });
  await putDocs(next.filter(i => stale.some(s => s.id === i.id)).map(i => ({ kind: 'shop', key: i.id, data: i })));
  return next;
}

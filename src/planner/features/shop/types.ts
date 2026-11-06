// src/planner/features/shop/types.ts — the shared shopping list (doc kind 'shop', one doc per item; 'shopprefs' for the
// postal code and stores). Shared by the household: Vijay and Rosh add to and tick the same list.
import type { Deal } from '../../lib/ai';

export interface ShopItem {
  id: string; text: string; qty?: string; done: boolean; by: string; addedAt: string; doneAt?: string;
  section?: string;            // store section, from the deals lookup
  deals?: Deal[];              // this week's flyer offers for it, best first
  dealsAt?: string;            // when the deals were last looked up
  store?: string;              // the store you've decided to get it at (defaults to the best deal's)
  suggestedStore?: string;     // a no-flyer store Coach Claude thinks is the best place for it
  reason?: string;
  pick?: Deal;                 // the exact product you built it out to (type, size, store, price)
  count?: number;              // how many of it
  for?: string[];              // the recipes it was added for
}
/** stores: the ones with flyers; specialty: the ones without (Lococo's, the Indian / Caribbean / Middle Eastern grocers) with a note on what they're for. */
export interface ShopPrefs { postal: string; stores: string[]; specialty: { name: string; note?: string }[] }

export const DEFAULT_PREFS: ShopPrefs = { postal: 'L8E', stores: ['Walmart', 'Fortinos', 'No Frills', 'Food Basics', 'Canadian Tire'], specialty: [{ name: "Lococo's", note: 'produce & meat, cheap' }, { name: 'Indian grocer', note: 'basmati, atta, dal, spices, ghee' }, { name: 'Caribbean grocer', note: 'plantain, scotch bonnet, saltfish, yam' }, { name: 'Middle Eastern grocer', note: 'pita, tahini, halal meat, labneh, olives' }] };
/** A typical walk through a grocery store, so the aisle view is in the order you'd meet the sections. */
export const SECTION_ORDER = ['Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen', 'Pantry', 'Snacks & Drinks', 'Baby', 'Health & Beauty', 'Household & Cleaning', 'Pet', 'Hardware & Auto', 'Other'];
export const sectionRank = (s?: string) => { const i = SECTION_ORDER.indexOf(s || 'Other'); return i < 0 ? 99 : i; };

export const ANYWHERE = 'Anywhere';
/** The store an item goes under: your pick, else the best deal's store, else Anywhere. */
export const storeOf = (i: ShopItem): string => i.store || i.pick?.merchant || i.deals?.[0]?.merchant || i.suggestedStore || ANYWHERE;
const same = (a: Deal, b: Deal) => a.merchant === b.merchant && a.name === b.name;
/** The offer the item shows: the one you picked (with this week's price if it's still listed), else the best at your store, else the best. */
export const bestDeal = (i: ShopItem): Deal | undefined => {
  if (i.pick && (!i.store || i.store === i.pick.merchant)) return i.deals?.find(d => same(d, i.pick!)) || i.pick;
  return i.store ? i.deals?.find(d => d.merchant === i.store) : i.deals?.[0];
};
export const sameDeal = same;

/** Price per kg, per litre or each, so different sizes and stores compare. Meat priced by the lb becomes per kg. */
export interface UnitPrice { value: number; unit: 'kg' | 'L' | 'each' }
export function unitPrice(d: Deal): UnitPrice | null {
  const p = d.price; if (typeof p !== 'number' || p <= 0) return null;
  if (d.per === 'lb') return { value: p / 0.45359237, unit: 'kg' };
  if (d.per === 'kg') return { value: p, unit: 'kg' };
  if (d.per === '100g') return { value: p * 10, unit: 'kg' };
  if (!d.amount || !d.unit) return null;
  if (d.unit === 'g') return { value: p / (d.amount / 1000), unit: 'kg' };
  if (d.unit === 'ml') return { value: p / (d.amount / 1000), unit: 'L' };
  return { value: p / d.amount, unit: 'each' };
}
export const perLabel = (d: Deal) => (d.per === 'lb' ? '/lb' : d.per === 'kg' ? '/kg' : d.per === '100g' ? '/100 g' : '');
/** Deals still valid today (regular prices don't expire). */
export const liveDeals = (i: ShopItem, now = new Date()): Deal[] => (i.deals || []).filter(d => !d.validTo || new Date(d.validTo) > now);
export const isFlyer = (d?: Deal) => !!d && d.kind !== 'regular';
/** The flyer's sale line, unless it only repeats the price ("$4.99/lb" next to $4.99/lb). */
export const saleNote = (d: Deal): string | undefined => (d.saleStory && !(typeof d.price === 'number' && d.saleStory.replace(/\s/g, '').startsWith(`$${d.price.toFixed(2)}`)) ? d.saleStory : undefined);

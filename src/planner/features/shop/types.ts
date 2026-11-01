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
}
/** stores: the ones with flyers; specialty: the ones without (Lococo's, the Indian / Caribbean / Middle Eastern grocers) with a note on what they're for. */
export interface ShopPrefs { postal: string; stores: string[]; specialty: { name: string; note?: string }[] }

export const DEFAULT_PREFS: ShopPrefs = { postal: 'L8E', stores: ['Walmart', 'Fortinos', 'No Frills', 'Food Basics', 'Canadian Tire'], specialty: [{ name: "Lococo's", note: 'produce & meat, cheap' }, { name: 'Indian grocer', note: 'basmati, atta, dal, spices, ghee' }, { name: 'Caribbean grocer', note: 'plantain, scotch bonnet, saltfish, yam' }, { name: 'Middle Eastern grocer', note: 'pita, tahini, halal meat, labneh, olives' }] };
/** A typical walk through a grocery store, so the aisle view is in the order you'd meet the sections. */
export const SECTION_ORDER = ['Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen', 'Pantry', 'Snacks & Drinks', 'Baby', 'Health & Beauty', 'Household & Cleaning', 'Pet', 'Hardware & Auto', 'Other'];
export const sectionRank = (s?: string) => { const i = SECTION_ORDER.indexOf(s || 'Other'); return i < 0 ? 99 : i; };

export const ANYWHERE = 'Anywhere';
/** The store an item goes under: your pick, else the best deal's store, else Anywhere. */
export const storeOf = (i: ShopItem): string => i.store || i.deals?.[0]?.merchant || i.suggestedStore || ANYWHERE;
export const bestDeal = (i: ShopItem): Deal | undefined => (i.store ? i.deals?.find(d => d.merchant === i.store) : i.deals?.[0]);
/** Deals still valid today (regular prices don't expire). */
export const liveDeals = (i: ShopItem, now = new Date()): Deal[] => (i.deals || []).filter(d => !d.validTo || new Date(d.validTo) > now);
export const isFlyer = (d?: Deal) => !!d && d.kind !== 'regular';

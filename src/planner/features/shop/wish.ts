// src/planner/features/shop/wish.ts — wish lists, a special part of Shopping. Each of the two keeps a list of things
// they'd love (a price, where it's from, a few pictures); the other one sees it and can quietly mark a wish as got,
// so a gift stays a surprise, at Christmas or any other time. This file is the thinking with no screen in it: the
// saved shapes, who sees what, the totals, reading a typed price or link, and turning what was read off a screenshot
// into a filled-in wish. The screens are WishLists.tsx and WishSheets.tsx; saving is wishStore.ts.
//
// Saved as household documents of kind 'wish' (shared, like the shopping list):
//   <id>        the wish itself. Only the one who wished it ever writes it.
//   <id>~got    the quiet mark ("I've got it"). Only the one who bought it ever writes it.
// Two documents on purpose: the wisher saving an edit can't wipe a mark they can't see, and marking never touches the
// wish (not even its "last changed" time). Pictures are kind 'wishimg', key <id>~<picture id>, one each.
//
// THE MARK IS HIDDEN ON THE SCREEN, NOT LOCKED AWAY. Both planners read the same shared documents, so someone who
// went looking in the data could find it. What is promised is that nothing the planner SHOWS a wisher depends on a
// mark that hasn't been given: a person's own list is only ever built by myList(), and myList() throws away every
// mark that isn't "given" before it looks at anything. Anything new that shows someone their own wishes (a count on
// Today, something Arvy says) must go through myList() too.
import type { ReceiptRead } from '../../lib/ai';

export const WISH_KIND = 'wish';
export const WISHIMG_KIND = 'wishimg';
export const MAX_WISH_PICS = 3;
const GOT_TAIL = '~got';

export type WishWhen = 'anytime' | 'christmas' | 'birthday' | 'other';
/** A picture on a wish: its small square preview rides along with the wish; the full one is its own document. */
export interface WishPic { id: string; thumb: string }
export interface Wish {
  id: string;
  of: string;            // whose wish it is (username)
  what: string;
  price?: number;        // dollars
  shop?: string;
  link?: string;         // always https
  note?: string;         // size, colour…
  when: WishWhen;
  occasion?: string;     // typed in, when `when` is 'other'
  hearts: 1 | 2 | 3;     // how much they want it
  pics: WishPic[];
  addedAt: string;
  removedAt?: string;    // taken off the list by its wisher after the other had quietly got it: kept for the buyer only
}
/** The quiet mark on someone else's wish. `givenAt` is the moment it stops being a secret. */
export interface WishGot { wish: string; by: string; at: string; note?: string; paid?: number; givenAt?: string }
/** Everything loaded: the wishes of both, and the marks by wish id. */
export interface WishBook { wishes: Wish[]; gots: Record<string, WishGot> }

export const gotKey = (wishId: string): string => `${wishId}${GOT_TAIL}`;
export const picKey = (wishId: string, picId: string): string => `${wishId}~${picId}`;

// ───────────── small readers ─────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const amount = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) && v > 0 && v <= 1_000_000 ? round2(v) : undefined);

/** Is this a picture kept in the document itself? Anything else (a web address) is never put in an <img>: it's
 *  shared data, and loading it would tell some other site that the list was opened. */
export const isPicture = (s: unknown): s is string => typeof s === 'string' && /^data:image\/(jpeg|png|webp|gif|svg\+xml)[;,]/.test(s);
/** How big a kept picture is, in bytes (a data: URL is base64: four letters for every three bytes). */
export function pictureBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.max(0, Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0));
}

/** "$1,299.99", "$45" (whole dollars lose the cents). */
export function money(n: number): string {
  const [whole, cents] = round2(n).toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cents === '00' ? '' : `.${cents}`}`;
}
/** A username as a first name: 'rosh' → "Rosh". */
export const firstName = (username: string): string => (username ? username.charAt(0).toUpperCase() + username.slice(1) : 'Someone');
/** What the other one is called on the second list. The planner knows the two of them by name; for anyone else
 *  (the demo's sample person) it's whoever the other wishes belong to, when that's one person. */
export function theirName(known: string, book: WishBook, me: string): string {
  if (known && known !== 'Household') return known;
  const others = [...new Set(book.wishes.filter(w => w.of !== me).map(w => w.of))];
  return others.length === 1 ? firstName(others[0]) : 'Your other half';
}

// ───────────── a typed price, a typed link ─────────────

/** A typed price → dollars. Nothing typed (or 0) is "no price": undefined. Something that isn't a price is null. */
export function parsePrice(typed: string): number | undefined | null {
  const t = typed.replace(/\s+/g, '').replace(/^(?:cad|usd|ca|us|c)?\$?/i, '').replace(/\$?(?:cad|usd)?$/i, '');
  if (!typed.trim()) return undefined;
  let digits: string;
  if (/^\d+(\.\d{1,2})?$/.test(t)) digits = t;                              // 1299 · 1299.99
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) digits = t.replace(/,/g, '');   // 1,299.99
  else if (/^\d+,\d{2}$/.test(t)) digits = t.replace(',', '.');             // 12,50 (a comma for the cents)
  else return null;
  const n = round2(Number(digits));
  if (!isFinite(n) || n > 1_000_000) return null;
  return n > 0 ? n : undefined;
}

/** A typed or pasted link → the one that's saved, always https. Nothing typed: undefined. Not a link: null.
 *  "lululemon.com/p/1" gets its https://, an http:// link is turned into https://, and anything else that could be
 *  opened (javascript:, data:, a link with a sign-in in it) is refused. A phone's share sheet often pastes the
 *  product's name in front of the link; the link is picked out. */
export function cleanLink(typed: string): string | undefined | null {
  let t = typed.trim();
  if (!t) return undefined;
  const found = t.match(/https?:\/\/\S+/i);
  if (found) t = found[0].replace(/[.,;!]+$/, '');
  else if (/\s/.test(t)) return null;
  if (/^http:\/\//i.test(t)) t = `https://${t.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = `https://${t}`;
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!/^([a-z0-9-]+\.)+[a-z0-9-]*[a-z][a-z0-9-]*$/i.test(u.hostname)) return null;   // a real site name, with a dot in it
  return u.href.length <= 2000 ? u.href : null;
}
/** The link of a saved wish if it's safe to open, else null (saved data is checked again before it becomes a link). */
export const safeLink = (link: string | undefined): string | null => (link ? cleanLink(link) || null : null);
/** The site a link goes to, as people say it: "lululemon.com". */
export function linkSite(link: string): string {
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ───────────── the form ─────────────

/** A wish as it's being typed. */
export interface WishDraft { what: string; price: string; shop: string; link: string; note: string; when: WishWhen; occasion: string; hearts: 1 | 2 | 3 }
export const emptyDraft = (): WishDraft => ({ what: '', price: '', shop: '', link: '', note: '', when: 'anytime', occasion: '', hearts: 2 });
export const draftOf = (w: Wish): WishDraft => ({ what: w.what, price: w.price ? round2(w.price).toFixed(2).replace(/\.00$/, '') : '', shop: w.shop || '', link: w.link || '', note: w.note || '', when: w.when, occasion: w.occasion || '', hearts: w.hearts });

/** What stops a wish being saved, in words; null when it's fine. Only "what it is" has to be there. */
export function draftProblem(d: WishDraft): string | null {
  if (!d.what.trim()) return 'Say what it is first.';
  if (parsePrice(d.price) === null) return 'That price doesn’t look like a number. Try 129.99, or leave it empty.';
  if (cleanLink(d.link) === null) return 'That link doesn’t look right. It should start with https://';
  if (d.when === 'other' && !d.occasion.trim()) return 'Say which occasion, or pick another.';
  return null;
}

/** The wish as it's saved: tidy words, the price as a number, an https link, and nothing that's empty. */
export function wishFrom(d: WishDraft, keep: { id: string; of: string; addedAt: string; pics: WishPic[] }): Wish {
  const price = parsePrice(d.price) || undefined, link = cleanLink(d.link) || undefined;
  const shop = text(d.shop, 60), note = text(d.note, 500), occasion = text(d.occasion, 40);
  const hearts = d.hearts === 1 || d.hearts === 3 ? d.hearts : 2;
  return {
    id: keep.id, of: keep.of, what: text(d.what, 120),
    ...(price ? { price } : {}), ...(shop ? { shop } : {}), ...(link ? { link } : {}), ...(note ? { note } : {}),
    when: d.when === 'other' && !occasion ? 'anytime' : d.when, ...(d.when === 'other' && occasion ? { occasion } : {}),
    hearts, pics: keep.pics.slice(0, MAX_WISH_PICS).map(p => ({ id: p.id, thumb: p.thumb })), addedAt: keep.addedAt,
  };
}

export const HEART_WORDS: Record<1 | 2 | 3, string> = { 1: 'Would be nice', 2: 'I’d love it', 3: 'Top of my list' };
/** "Christmas", "Birthday", the occasion they typed; nothing for anytime. */
export const whenWords = (w: Pick<Wish, 'when' | 'occasion'>): string => (w.when === 'christmas' ? 'Christmas' : w.when === 'birthday' ? 'Birthday' : w.when === 'other' ? w.occasion || '' : '');
/** The line under a wish: "$129.99 · Lululemon · Christmas". With a link and no shop name, the site stands in. */
export function wishLine(w: Wish): string {
  const link = safeLink(w.link);
  return [w.price ? money(w.price) : '', w.shop || (link ? linkSite(link) : ''), whenWords(w)].filter(Boolean).join(' · ');
}

// ───────────── from a screenshot ─────────────

/** What rides along with the screenshot when it's read. There is no reader of its own for wish lists: the receipt
 *  reader (lib/ai readReceipt) is asked, and told what it is really looking at. */
export const SHOT_NOTE = 'This is NOT a receipt: it is a screenshot of a product page, for a gift wish list. Nothing was bought. Put the shop or website in merchant, the product’s price in total, and exactly one line in items: the product’s full name, with its price as the amount. Leave the date, time, tax and tip empty or 0.';

const NOT_A_NAME = /^(item|items|product|unknown|n\/?a|none|receipt|total|subtotal)$/i;
/** What the receipt reader made of a product screenshot → the start of a wish: the shop, the price and the name,
 *  each only when it looks sensible. A real receipt or a basket (many lines) gives the shop and nothing else: its
 *  total isn't the price of one thing. Nothing useful read → {} (the form opens with just the picture). */
export function wishFromRead(r: Pick<ReceiptRead, 'merchant' | 'total' | 'items'> | null | undefined): Partial<Pick<WishDraft, 'what' | 'price' | 'shop'>> {
  if (!r) return {};
  const out: Partial<Pick<WishDraft, 'what' | 'price' | 'shop'>> = {};
  const shop = text(r.merchant, 200);
  if (shop && shop.length <= 60 && !NOT_A_NAME.test(shop)) out.shop = shop;
  const lines = (Array.isArray(r.items) ? r.items : []).filter(i => i && typeof i.name === 'string' && amount(i.amount));
  const total = amount(r.total);
  if (lines.length > 3) return out;
  // the product's line: the only one; else the one that is the total; else the dearest (the others are delivery, a warranty…)
  const main = lines.length === 1 ? lines[0] : lines.find(i => total && Math.abs(i.amount - total) < 0.005) || [...lines].sort((a, b) => b.amount - a.amount)[0];
  const price = main ? (lines.length === 1 && total ? total : amount(main.amount)) : total;
  if (price) out.price = round2(price).toFixed(2).replace(/\.00$/, '');
  const what = main ? text(main.name, 200).replace(/\s+/g, ' ') : '';
  if (what && what.length <= 120 && !NOT_A_NAME.test(what)) out.what = what;
  return out;
}

// ───────────── reading what's saved ─────────────

function asWish(key: string, data: unknown): Wish | null {
  const d = obj(data);
  if (!d || d.id !== key || key.endsWith(GOT_TAIL)) return null;
  const what = text(d.what, 120), of = text(d.of, 60);
  if (!what || !of) return null;
  const price = amount(d.price), shop = text(d.shop, 60), link = safeLink(text(d.link, 2000)), note = text(d.note, 500), occasion = text(d.occasion, 40);
  const when: WishWhen = d.when === 'christmas' || d.when === 'birthday' ? d.when : d.when === 'other' && occasion ? 'other' : 'anytime';
  const pics = (Array.isArray(d.pics) ? d.pics : []).map(obj).filter((p): p is Record<string, unknown> => !!p && typeof p.id === 'string' && !!p.id && isPicture(p.thumb))
    .slice(0, MAX_WISH_PICS).map(p => ({ id: p.id as string, thumb: p.thumb as string }));
  return {
    id: key, of, what, ...(price ? { price } : {}), ...(shop ? { shop } : {}), ...(link ? { link } : {}), ...(note ? { note } : {}),
    when, ...(when === 'other' ? { occasion } : {}), hearts: d.hearts === 1 || d.hearts === 3 ? d.hearts : 2, pics,
    addedAt: text(d.addedAt, 40), ...(text(d.removedAt, 40) ? { removedAt: text(d.removedAt, 40) } : {}),
  };
}
function asGot(key: string, data: unknown): WishGot | null {
  const d = obj(data);
  if (!d || !key.endsWith(GOT_TAIL) || d.wish !== key.slice(0, -GOT_TAIL.length)) return null;
  const by = text(d.by, 60), at = text(d.at, 40);
  if (!by || !at) return null;
  const note = text(d.note, 300), paid = amount(d.paid), givenAt = text(d.givenAt, 40);
  return { wish: d.wish as string, by, at, ...(note ? { note } : {}), ...(paid ? { paid } : {}), ...(givenAt ? { givenAt } : {}) };
}
/** The documents of kind 'wish' → wishes and marks. Anything that isn't one (a removed document is a null) is left
 *  out, and so is a mark whose wish is gone. */
export function readWishDocs(docs: { key: string; data: unknown }[]): WishBook {
  const wishes: Wish[] = [], gots: Record<string, WishGot> = {};
  for (const d of docs) { const w = asWish(d.key, d.data); if (w) wishes.push(w); }
  const ids = new Set(wishes.map(w => w.id));
  for (const d of docs) { const g = asGot(d.key, d.data); if (g && ids.has(g.wish)) gots[g.wish] = g; }
  return { wishes, gots };
}
/** One mark, read back on its own (wishStore looks at the freshest one before a wish is taken off a list). */
export const readGot = (wishId: string, data: unknown): WishGot | null => asGot(gotKey(wishId), data);

// ───────────── who sees what ─────────────

/** Most wanted first, then the newest. Only what the wisher wrote decides the order: never a mark. */
const byWant = (a: Wish, b: Wish) => b.hearts - a.hearts || b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id);

/** A gift that's been handed over, as its wisher sees it. */
export interface Received { wish: Wish; from: string; at: string }
export interface MyList { wishes: Wish[]; received: Received[] }
/** What a person sees of their OWN list. A wish the other one has quietly got looks exactly like one they haven't:
 *  same place, same order, same count. Only "It's been given" changes anything: the wish moves to Received, with
 *  who gave it. (See the note at the top of this file: hidden on the screen, not locked.) */
export function myList(book: WishBook, me: string): MyList {
  // the marks that haven't been given are dropped here, before anything is worked out, so nothing below can lean on them
  const given: Record<string, WishGot> = {};
  for (const [id, g] of Object.entries(book.gots)) if (g.givenAt) given[id] = g;
  const mine = book.wishes.filter(w => w.of === me);
  return {
    wishes: mine.filter(w => !w.removedAt && !given[w.id]).sort(byWant),
    received: mine.filter(w => given[w.id]).map(w => ({ wish: w, from: given[w.id].by, at: given[w.id].givenAt! }))
      .sort((a, b) => b.at.localeCompare(a.at) || a.wish.id.localeCompare(b.wish.id)),
  };
}

export interface GotRow { wish: Wish; got: WishGot }
/** `all`: everything still on their list (what they'd see on it). `toGet`: the part nobody has got yet. `spent`: what
 *  the Got group cost (what was paid when that was written down, else the wish's price). The `…NoPrice` counts are
 *  the wishes left out of each sum because they have no price. */
export interface WishTotals { all: number; allNoPrice: number; toGet: number; toGetNoPrice: number; spent: number; spentNoPrice: number }
export interface TheirList { toGet: Wish[]; got: GotRow[]; totals: WishTotals }
/** What a person sees of the OTHER one's list: what's still to get, and what they've got (not yet given first, newest
 *  first), with the sums. A wish its wisher took off the list is gone, unless it had already been got: then it stays
 *  in Got, so the one who bought it knows. */
export function theirList(book: WishBook, me: string): TheirList {
  const theirs = book.wishes.filter(w => w.of !== me);
  const toGet = theirs.filter(w => !w.removedAt && !book.gots[w.id]).sort(byWant);
  const got = theirs.filter(w => book.gots[w.id]).map(w => ({ wish: w, got: book.gots[w.id] }))
    .sort((a, b) => Number(!!a.got.givenAt) - Number(!!b.got.givenAt) || b.got.at.localeCompare(a.got.at) || a.wish.id.localeCompare(b.wish.id));
  const sum = (ws: Wish[]) => round2(ws.reduce((s, w) => s + (w.price || 0), 0));
  const onList = [...toGet, ...got.filter(r => !r.got.givenAt && !r.wish.removedAt).map(r => r.wish)];
  return {
    toGet, got,
    totals: {
      all: sum(onList), allNoPrice: onList.filter(w => !w.price).length,
      toGet: sum(toGet), toGetNoPrice: toGet.filter(w => !w.price).length,
      spent: round2(got.reduce((s, r) => s + (r.got.paid || r.wish.price || 0), 0)), spentNoPrice: got.filter(r => !r.got.paid && !r.wish.price).length,
    },
  };
}

// ───────────── got, not any more, given ─────────────

/** "I've got it": the quiet mark. */
export const gotIt = (wishId: string, by: string, now: string): WishGot => ({ wish: wishId, by, at: now });
/** The buyer's own note on it (where it was bought) and what was paid. Null when what was paid isn't a number. */
export function gotWithNote(got: WishGot, note: string, paidTyped: string): WishGot | null {
  const paid = parsePrice(paidTyped);
  if (paid === null) return null;
  const n = text(note, 300);
  return { wish: got.wish, by: got.by, at: got.at, ...(n ? { note: n } : {}), ...(paid ? { paid } : {}), ...(got.givenAt ? { givenAt: got.givenAt } : {}) };
}
/** "It's been given": from now on its wisher sees it, under Received. */
export const given = (got: WishGot, now: string): WishGot => ({ ...got, givenAt: now });
/** A slip of the thumb: not given after all. It goes back to being a secret. */
export function notGiven(got: WishGot): WishGot { const { givenAt: _was, ...rest } = got; return rest; }

/** What happens to a wish its wisher takes off their list. With no mark on it, or once the gift has been given, it's
 *  simply gone ('drop': the wish, its mark and its pictures). Quietly got and not yet given, it's kept out of the
 *  wisher's sight ('keep'), so the one who bought it still has it under Got. On the wisher's screen the two look the
 *  same: the wish is gone. */
export function removalOf(w: Wish, got: WishGot | null | undefined, now: string): { drop: true } | { keep: Wish } {
  return got && !got.givenAt ? { keep: { ...w, removedAt: now } } : { drop: true };
}

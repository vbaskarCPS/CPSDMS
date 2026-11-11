// Wish lists (wish.ts): whose wishes show where, what a wisher can and can't see of a quiet "got it", the sums, a typed
// price and link, a screenshot read into a wish, and what's saved.
import { describe, expect, it } from 'vitest';
import {
  SHOT_NOTE, cleanLink, draftOf, draftProblem, emptyDraft, firstName, given, gotIt, gotKey, gotWithNote, isPicture, linkSite, money, myList, notGiven,
  parsePrice, picKey, pictureBytes, readGot, readWishDocs, removalOf, safeLink, theirList, theirName, whenWords, wishFrom, wishFromRead, wishLine,
  type Wish, type WishBook, type WishGot,
} from './wish';

const THUMB = 'data:image/jpeg;base64,AAAA';
const wish = (id: string, of: string, over: Partial<Wish> = {}): Wish => ({ id, of, what: `Wish ${id}`, when: 'anytime', hearts: 2, pics: [], addedAt: `2026-11-0${id.slice(-1)}T10:00:00.000Z`, ...over });
const book = (wishes: Wish[], gots: WishGot[] = []): WishBook => ({ wishes, gots: Object.fromEntries(gots.map(g => [g.wish, g])) });
const NOW = '2026-11-11T18:00:00.000Z', LATER = '2026-12-25T09:00:00.000Z';

// Vijay wants three things, Rosh two
const v1 = wish('v1', 'vijay', { what: 'Headphones', price: 449, hearts: 3 });
const v2 = wish('v2', 'vijay', { what: 'Dutch oven', price: 139.99 });
const v3 = wish('v3', 'vijay', { what: 'Running shoes' });
const r1 = wish('r1', 'rosh', { what: 'Gold hoops', price: 185, hearts: 3 });
const r2 = wish('r2', 'rosh', { what: 'Pottery class', hearts: 1 });
const all = [v1, v2, v3, r1, r2];

describe('whose wishes show where', () => {
  it('each one’s own list has only their own wishes; the other list has only the other one’s', () => {
    const b = book(all);
    expect(myList(b, 'vijay').wishes.map(w => w.id)).toEqual(['v1', 'v3', 'v2']);
    expect(theirList(b, 'vijay').toGet.map(w => w.id)).toEqual(['r1', 'r2']);
    expect(myList(b, 'rosh').wishes.map(w => w.id)).toEqual(['r1', 'r2']);
    expect(theirList(b, 'rosh').toGet.map(w => w.id)).toEqual(['v1', 'v3', 'v2']);
  });
  it('most wanted first, then the newest: the same order on both phones', () => {
    const b = book([wish('a1', 'vijay', { hearts: 1 }), wish('a2', 'vijay', { hearts: 3 }), wish('a3', 'vijay', { hearts: 3 }), wish('a4', 'vijay')]);
    expect(myList(b, 'vijay').wishes.map(w => w.id)).toEqual(['a3', 'a2', 'a4', 'a1']);
    expect(theirList(b, 'rosh').toGet.map(w => w.id)).toEqual(['a3', 'a2', 'a4', 'a1']);
  });
  it('an empty list is empty on both sides', () => {
    expect(myList(book([]), 'vijay')).toEqual({ wishes: [], received: [] });
    const t = theirList(book([v1]), 'vijay');
    expect([t.toGet, t.got]).toEqual([[], []]);
    expect(t.totals).toEqual({ all: 0, allNoPrice: 0, toGet: 0, toGetNoPrice: 0, spent: 0, spentNoPrice: 0 });
  });
  it('the second list is named after the other one; the demo’s sample person gets the name from the wishes', () => {
    expect(theirName('Rosh', book(all), 'vijay')).toBe('Rosh');
    expect(theirName('Household', book([wish('d1', 'demo'), r1, r2]), 'demo')).toBe('Rosh');
    expect(theirName('Household', book([wish('d1', 'demo')]), 'demo')).toBe('Your other half');
    expect(firstName('vijay')).toBe('Vijay');
  });
});

describe('what the wisher can and cannot see', () => {
  const before = book(all);
  const after = book(all, [{ ...gotIt('v1', 'rosh', NOW), note: 'Best Buy, hidden in the hall closet', paid: 399 }, gotIt('v3', 'rosh', NOW)]);

  it('a wish that’s quietly been got looks exactly like one that hasn’t: same wishes, same order, same count, nothing received', () => {
    expect(myList(after, 'vijay')).toEqual(myList(before, 'vijay'));
    expect(myList(after, 'vijay').wishes).toHaveLength(3);
    expect(myList(after, 'vijay').received).toEqual([]);
  });
  it('nothing about the mark is anywhere in what the wisher is shown: not who, not when, not the note, not the price paid', () => {
    const shown = JSON.stringify(myList(after, 'vijay'));
    for (const secret of ['rosh', NOW, 'hall closet', '399', 'got', 'paid']) expect(shown).not.toContain(secret);
  });
  it('the note and what was paid change nothing on the wisher’s side either', () => {
    const noted = book(all, [gotWithNote(gotIt('v1', 'rosh', NOW), 'changed my mind about where to hide it', '410')!]);
    expect(myList(noted, 'vijay')).toEqual(myList(before, 'vijay'));
  });
  it('the buyer does see it: in Got, with the date and their own note, and off the still-to-get part', () => {
    const t = theirList(after, 'rosh');
    expect(t.toGet.map(w => w.id)).toEqual(['v2']);
    expect(t.got.map(r => r.wish.id).sort()).toEqual(['v1', 'v3']);
    expect(t.got.find(r => r.wish.id === 'v1')!.got).toEqual({ wish: 'v1', by: 'rosh', at: NOW, note: 'Best Buy, hidden in the hall closet', paid: 399 });
  });
  it('the wisher changing a wish that’s been got still shows nothing (and the mark is a separate document, so it isn’t touched)', () => {
    const edited = book(all.map(w => (w.id === 'v1' ? { ...w, note: 'In black, please' } : w)), Object.values(after.gots));
    expect(myList(edited, 'vijay').wishes.map(w => w.id)).toEqual(['v1', 'v3', 'v2']);
    expect(theirList(edited, 'rosh').got.find(r => r.wish.id === 'v1')!.wish.note).toBe('In black, please');
    expect(gotKey('v1')).not.toBe('v1');
  });
});

describe('got, not any more, given', () => {
  it('"Not any more" puts it back to get, and the wisher’s list is what it always was', () => {
    const marked = book(all, [gotIt('v1', 'rosh', NOW)]);
    const undone = book(all);   // the mark is removed
    expect(theirList(marked, 'rosh').toGet.map(w => w.id)).toEqual(['v3', 'v2']);
    expect(theirList(undone, 'rosh').toGet.map(w => w.id)).toEqual(['v1', 'v3', 'v2']);
    expect(myList(undone, 'vijay')).toEqual(myList(marked, 'vijay'));
  });
  it('"It’s been given" is the moment the wisher sees it: under Received, with who gave it, and off their wishes', () => {
    const b = book(all, [given({ ...gotIt('v1', 'rosh', NOW), note: 'Best Buy', paid: 399 }, LATER)]);
    const mine = myList(b, 'vijay');
    expect(mine.wishes.map(w => w.id)).toEqual(['v3', 'v2']);
    expect(mine.received).toEqual([{ wish: v1, from: 'rosh', at: LATER }]);
    expect(JSON.stringify(mine)).not.toContain('Best Buy');   // the buyer's note stays the buyer's
    expect(JSON.stringify(mine)).not.toContain('399');
  });
  it('for the buyer a given wish stays in Got, after the ones still hidden', () => {
    const b = book(all, [given(gotIt('v1', 'rosh', '2026-11-01T00:00:00.000Z'), LATER), gotIt('v2', 'rosh', NOW)]);
    const t = theirList(b, 'rosh');
    expect(t.got.map(r => r.wish.id)).toEqual(['v2', 'v1']);
    expect(t.got[1].got.givenAt).toBe(LATER);
  });
  it('"Not given yet" makes it a secret again, with its note kept', () => {
    const g = notGiven(given({ ...gotIt('v1', 'rosh', NOW), note: 'Best Buy' }, LATER));
    expect(g).toEqual({ wish: 'v1', by: 'rosh', at: NOW, note: 'Best Buy' });
    expect(myList(book(all, [g]), 'vijay')).toEqual(myList(book(all), 'vijay'));
  });
  it('a note and what was paid go on the mark; what was paid has to be a number', () => {
    const g = gotIt('v1', 'rosh', NOW);
    expect(gotWithNote(g, '  Best Buy  ', '$399')).toEqual({ wish: 'v1', by: 'rosh', at: NOW, note: 'Best Buy', paid: 399 });
    expect(gotWithNote({ ...g, note: 'x', paid: 5 }, '', '')).toEqual(g);
    expect(gotWithNote(g, 'x', 'lots')).toBeNull();
    expect(gotWithNote(given(g, LATER), 'x', '')!.givenAt).toBe(LATER);
  });
});

describe('taking a wish off your own list', () => {
  it('a wish nobody has marked is simply gone', () => {
    expect(removalOf(v1, null, NOW)).toEqual({ drop: true });
  });
  it('a wish that’s quietly been got is kept for the one who bought it, and hidden from the wisher like any removed wish', () => {
    const plan = removalOf(v1, gotIt('v1', 'rosh', '2026-11-10T00:00:00.000Z'), NOW);
    expect(plan).toEqual({ keep: { ...v1, removedAt: NOW } });
    const kept = book([(plan as { keep: Wish }).keep, v2, v3], [gotIt('v1', 'rosh', '2026-11-10T00:00:00.000Z')]);
    expect(myList(kept, 'vijay').wishes.map(w => w.id)).toEqual(['v3', 'v2']);   // exactly what a real removal shows
    expect(myList(kept, 'vijay')).toEqual(myList(book([v2, v3]), 'vijay'));
    const t = theirList(kept, 'rosh');
    expect(t.got.map(r => r.wish.id)).toEqual(['v1']);
    expect(t.got[0].wish.removedAt).toBe(NOW);
    expect(t.totals.all).toBe(139.99);   // it's no longer on the list
  });
  it('a removed wish nobody had got shows to no one', () => {
    const b = book([{ ...v1, removedAt: NOW }, v2]);
    expect(theirList(b, 'rosh').toGet.map(w => w.id)).toEqual(['v2']);
    expect(theirList(b, 'rosh').got).toEqual([]);
  });
  it('a gift that was given after its wish was taken off still arrives under Received; clearing it from there removes it for good', () => {
    const g = given(gotIt('v1', 'rosh', '2026-11-10T00:00:00.000Z'), LATER);
    const b = book([{ ...v1, removedAt: NOW }], [g]);
    expect(myList(b, 'vijay').received.map(r => r.wish.id)).toEqual(['v1']);
    expect(removalOf(v1, g, LATER)).toEqual({ drop: true });
  });
});

describe('the sums on the other one’s list', () => {
  it('everything on the list, and what’s still to get, from the wishes that have prices', () => {
    const t = theirList(book(all), 'rosh').totals;
    expect(t.all).toBe(588.99);
    expect(t.toGet).toBe(588.99);
    expect([t.allNoPrice, t.toGetNoPrice]).toEqual([1, 1]);   // the running shoes have no price
    expect([t.spent, t.spentNoPrice]).toEqual([0, 0]);
  });
  it('once something is got, still-to-get goes down and spent goes up; the whole list stays the same', () => {
    const t = theirList(book(all, [gotIt('v1', 'rosh', NOW)]), 'rosh').totals;
    expect(t.all).toBe(588.99);
    expect(t.toGet).toBe(139.99);
    expect(t.spent).toBe(449);
  });
  it('spent uses what was paid when that was written down, else the wish’s price; a got wish with neither is counted apart', () => {
    const t = theirList(book(all, [{ ...gotIt('v1', 'rosh', NOW), paid: 399.5 }, gotIt('v2', 'rosh', NOW), gotIt('v3', 'rosh', NOW)]), 'rosh').totals;
    expect(t.spent).toBe(539.49);
    expect(t.spentNoPrice).toBe(1);
    expect(t.toGet).toBe(0);
    expect(t.toGetNoPrice).toBe(0);
  });
  it('a given gift is off the list’s total but still in what was spent', () => {
    const t = theirList(book(all, [given(gotIt('v1', 'rosh', NOW), LATER)]), 'rosh').totals;
    expect(t.all).toBe(139.99);
    expect(t.spent).toBe(449);
  });
  it('no prices at all: the sums are zero and every wish is counted as having none', () => {
    const t = theirList(book([v3, wish('v4', 'vijay')]), 'rosh').totals;
    expect(t).toEqual({ all: 0, allNoPrice: 2, toGet: 0, toGetNoPrice: 2, spent: 0, spentNoPrice: 0 });
  });
  it('cents add up without drifting', () => {
    const t = theirList(book([wish('c1', 'vijay', { price: 0.1 }), wish('c2', 'vijay', { price: 0.2 })]), 'rosh').totals;
    expect(t.all).toBe(0.3);
  });
});

describe('a typed price', () => {
  it('reads the ways people write one', () => {
    expect(parsePrice('$1,299.99')).toBe(1299.99);
    expect(parsePrice('1299')).toBe(1299);
    expect(parsePrice(' 45.5 ')).toBe(45.5);
    expect(parsePrice('$ 45')).toBe(45);
    expect(parsePrice('CA$129.99')).toBe(129.99);
    expect(parsePrice('129.99 CAD')).toBe(129.99);
    expect(parsePrice('12,50')).toBe(12.5);
    expect(parsePrice('1,299')).toBe(1299);
  });
  it('nothing typed (or zero) is "no price", not a mistake', () => {
    expect(parsePrice('')).toBeUndefined();
    expect(parsePrice('   ')).toBeUndefined();
    expect(parsePrice('0')).toBeUndefined();
    expect(parsePrice('$0.00')).toBeUndefined();
  });
  it('nonsense is refused', () => {
    for (const t of ['about fifty', 'abc', '12abc', '-5', '1.2.3', '$', '12.999', '1,2', '1.299,99', '9999999', '1e3', '12 or 15']) expect(parsePrice(t), t).toBeNull();
  });
  it('a price is shown the way a shop writes it', () => {
    expect(money(1299.99)).toBe('$1,299.99');
    expect(money(45)).toBe('$45');
    expect(money(1234567.5)).toBe('$1,234,567.50');
    expect(money(0.3)).toBe('$0.30');
  });
});

describe('a typed link', () => {
  it('an https link is kept', () => {
    expect(cleanLink('https://shop.example.com/p/123?colour=black')).toBe('https://shop.example.com/p/123?colour=black');
  });
  it('a bare site name gets its https://, and an http:// link becomes https://', () => {
    expect(cleanLink('shop.example.com/p/1')).toBe('https://shop.example.com/p/1');
    expect(cleanLink('www.example.ca')).toBe('https://www.example.ca/');
    expect(cleanLink('http://shop.example.com/p/1')).toBe('https://shop.example.com/p/1');
    expect(cleanLink('HTTP://Shop.Example.com/p/1')).toBe('https://shop.example.com/p/1');
  });
  it('a share sheet’s "name + link" paste: the link is picked out', () => {
    expect(cleanLink('Merino throw blanket https://shop.example.com/p/1.')).toBe('https://shop.example.com/p/1');
  });
  it('nothing typed is "no link"', () => {
    expect(cleanLink('')).toBeUndefined();
    expect(cleanLink('  ')).toBeUndefined();
  });
  it('anything that isn’t a plain https web address is refused', () => {
    for (const t of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>hi</b>', 'ftp://example.com/x', 'file:///etc/hosts', 'tel:5551234', 'https://someone:secret@example.com/', 'https://example.com:8443/x', 'https://localhost/x', 'https://10.0.0.1/x', 'just some words', 'hello', 'https://', 'https://exa mple.com'])
      expect(cleanLink(t), t).toBeNull();
  });
  it('saved data is checked again before it becomes a link on the screen', () => {
    expect(safeLink('https://shop.example.com/p/1')).toBe('https://shop.example.com/p/1');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink(undefined)).toBeNull();
    expect(linkSite('https://www.shop.example.com/p/1')).toBe('shop.example.com');
    expect(linkSite('nonsense')).toBe('');
  });
});

describe('a screenshot read into a wish', () => {
  const read = (merchant: string, total: number, items: [string, number][]) => ({ merchant, total, items: items.map(([name, amount]) => ({ name, amount, category: 'Shopping' })) });

  it('a product page read well: the shop, the price and the name', () => {
    expect(wishFromRead(read('Simons', 128, [['Merino wool throw blanket, oat', 128]]))).toEqual({ shop: 'Simons', price: '128', what: 'Merino wool throw blanket, oat' });
  });
  it('no total, but the line has the price: that’s the price', () => {
    expect(wishFromRead(read('Best Buy', 0, [['Over-ear headphones', 449.99]]))).toEqual({ shop: 'Best Buy', price: '449.99', what: 'Over-ear headphones' });
  });
  it('a price with no name (a line without an amount is dropped by the reader): the shop and the price, the name is left to type', () => {
    expect(wishFromRead(read('Mejuri', 185, []))).toEqual({ shop: 'Mejuri', price: '185' });
  });
  it('the product plus delivery: the product’s line, at its own price', () => {
    expect(wishFromRead(read('KitchenAid', 514.98, [['Delivery', 14.99], ['Stand mixer, sage green', 499.99]]))).toEqual({ shop: 'KitchenAid', price: '499.99', what: 'Stand mixer, sage green' });
    expect(wishFromRead(read('KitchenAid', 499.99, [['Stand mixer', 499.99], ['Was', 599.99]]))).toEqual({ shop: 'KitchenAid', price: '499.99', what: 'Stand mixer' });
  });
  it('nothing useful: the form opens with just the picture', () => {
    expect(wishFromRead(read('', 0, []))).toEqual({});
    expect(wishFromRead(null)).toEqual({});
    expect(wishFromRead(undefined)).toEqual({});
    expect(wishFromRead(read('Unknown', 0, [['Item', 0]]))).toEqual({});
  });
  it('odd answers: a real receipt or a basket gives the shop only; a placeholder name or a paragraph for a name is left out', () => {
    const costco = read('Costco Wholesale', 182.37, [['Eggs', 9.99], ['Chicken thighs', 24.89], ['Rice', 21.99], ['Paper towels', 23.99]]);
    expect(wishFromRead(costco)).toEqual({ shop: 'Costco Wholesale' });
    expect(wishFromRead(read('Simons', 128, [['Item', 128]]))).toEqual({ shop: 'Simons', price: '128' });
    expect(wishFromRead(read('Simons', 128, [['x'.repeat(200), 128]]))).toEqual({ shop: 'Simons', price: '128' });
    expect(wishFromRead(read('y'.repeat(90), 128, [['Blanket', 128]]))).toEqual({ price: '128', what: 'Blanket' });
    expect(wishFromRead(read('Simons', NaN, [['Blanket', -5]]))).toEqual({ shop: 'Simons' });
    expect(wishFromRead({ merchant: 'Simons', total: 128, items: undefined as never })).toEqual({ shop: 'Simons', price: '128' });
  });
  it('what’s read fills a form the person still checks: it parses as a wish they could save', () => {
    const d = { ...emptyDraft(), ...wishFromRead(read('Simons', 1299.5, [['Wool coat', 1299.5]])) };
    expect(draftProblem(d)).toBeNull();
    expect(wishFrom(d, { id: 'n1', of: 'rosh', addedAt: NOW, pics: [] }).price).toBe(1299.5);
  });
  it('the reader is told it’s looking at a product page, in a note short enough to be sent whole', () => {
    expect(SHOT_NOTE).toMatch(/product page/);
    expect(SHOT_NOTE.length).toBeLessThanOrEqual(400);
  });
});

describe('the form', () => {
  const typed = { ...emptyDraft(), what: '  Wool coat ', price: '$1,299.50', shop: ' Simons ', link: 'shop.example.com/coat', note: ' Size M, camel ', when: 'other' as const, occasion: ' Our anniversary ', hearts: 3 as const };

  it('only "what it is" has to be there', () => {
    expect(draftProblem(emptyDraft())).toBe('Say what it is first.');
    expect(draftProblem({ ...emptyDraft(), what: 'A book' })).toBeNull();
  });
  it('a price or link that can’t be read, or "something else" with nothing typed, is said in words', () => {
    expect(draftProblem({ ...emptyDraft(), what: 'A book', price: 'cheap' })).toMatch(/price/);
    expect(draftProblem({ ...emptyDraft(), what: 'A book', link: 'javascript:alert(1)' })).toMatch(/link/);
    expect(draftProblem({ ...emptyDraft(), what: 'A book', when: 'other' })).toMatch(/occasion/);
    expect(draftProblem(typed)).toBeNull();
  });
  it('the saved shape: tidy words, the price as a number, an https link, whose it is, and nothing empty', () => {
    expect(wishFrom(typed, { id: 'n1', of: 'rosh', addedAt: NOW, pics: [{ id: 'p1', thumb: THUMB }] })).toEqual({
      id: 'n1', of: 'rosh', what: 'Wool coat', price: 1299.5, shop: 'Simons', link: 'https://shop.example.com/coat', note: 'Size M, camel',
      when: 'other', occasion: 'Our anniversary', hearts: 3, pics: [{ id: 'p1', thumb: THUMB }], addedAt: NOW,
    });
    expect(wishFrom({ ...emptyDraft(), what: 'A book' }, { id: 'n2', of: 'vijay', addedAt: NOW, pics: [] })).toEqual({ id: 'n2', of: 'vijay', what: 'A book', when: 'anytime', hearts: 2, pics: [], addedAt: NOW });
  });
  it('a saved wish never carries the other one’s mark, and at most three pictures (only their small previews)', () => {
    const four = ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, thumb: THUMB, dataUrl: 'data:image/jpeg;base64,BIG' }));
    const w = wishFrom(typed, { id: 'n1', of: 'rosh', addedAt: NOW, pics: four });
    expect(w.pics).toEqual([{ id: 'p1', thumb: THUMB }, { id: 'p2', thumb: THUMB }, { id: 'p3', thumb: THUMB }]);
    expect(Object.keys(w).sort()).toEqual(['addedAt', 'hearts', 'id', 'link', 'note', 'occasion', 'of', 'pics', 'price', 'shop', 'what', 'when']);
  });
  it('an occasion typed and then another choice picked: the occasion isn’t kept', () => {
    expect(wishFrom({ ...typed, when: 'christmas' }, { id: 'n1', of: 'rosh', addedAt: NOW, pics: [] })).not.toHaveProperty('occasion');
  });
  it('changing a wish starts from what was saved, and saving it unchanged gives the same wish back', () => {
    const saved = wishFrom(typed, { id: 'n1', of: 'rosh', addedAt: NOW, pics: [{ id: 'p1', thumb: THUMB }] });
    expect(draftOf(saved)).toEqual({ what: 'Wool coat', price: '1299.50', shop: 'Simons', link: 'https://shop.example.com/coat', note: 'Size M, camel', when: 'other', occasion: 'Our anniversary', hearts: 3 });
    expect(wishFrom(draftOf(saved), saved)).toEqual(saved);
    expect(draftOf(wish('x1', 'rosh', { price: 45 })).price).toBe('45');
  });
  it('the line under a wish: price, shop (or the link’s site), and when it’s for', () => {
    expect(wishLine(wish('x1', 'rosh', { price: 128, shop: 'Simons', when: 'christmas' }))).toBe('$128 · Simons · Christmas');
    expect(wishLine(wish('x1', 'rosh', { link: 'https://www.shop.example.com/p/1', when: 'birthday' }))).toBe('shop.example.com · Birthday');
    expect(wishLine(wish('x1', 'rosh', { when: 'other', occasion: 'Diwali' }))).toBe('Diwali');
    expect(wishLine(wish('x1', 'rosh'))).toBe('');
    expect(whenWords({ when: 'anytime' })).toBe('');
  });
});

describe('reading what’s saved', () => {
  const saved = { id: 'w1', of: 'vijay', what: 'Headphones', price: 449, when: 'christmas', hearts: 3, pics: [{ id: 'p1', thumb: THUMB }], addedAt: NOW };

  it('a wish and its mark are two documents: <id> and <id>~got', () => {
    const b = readWishDocs([{ key: 'w1', data: saved }, { key: 'w1~got', data: { wish: 'w1', by: 'rosh', at: NOW, note: 'Best Buy', paid: 399 } }]);
    expect(b.wishes).toEqual([saved]);
    expect(b.gots).toEqual({ w1: { wish: 'w1', by: 'rosh', at: NOW, note: 'Best Buy', paid: 399 } });
    expect(gotKey('w1')).toBe('w1~got');
    expect(picKey('w1', 'p1')).toBe('w1~p1');
  });
  it('removed documents (a null), junk, and a mark whose wish is gone are left out', () => {
    const b = readWishDocs([
      { key: 'w1', data: null }, { key: 'w1~got', data: { wish: 'w1', by: 'rosh', at: NOW } },   // the wish was removed: its mark goes with it
      { key: 'w2', data: 'hello' }, { key: 'w3', data: { id: 'other', of: 'vijay', what: 'x' } }, { key: 'w4', data: { id: 'w4', of: 'vijay' } },
      { key: 'w5', data: { id: 'w5', of: 'rosh', what: 'A book' } }, { key: 'w5~got', data: null }, { key: 'w6~got', data: { wish: 'w5', by: 'vijay', at: NOW } },
    ]);
    expect(b.wishes.map(w => w.id)).toEqual(['w5']);
    expect(b.gots).toEqual({});
  });
  it('whatever is in a saved wish, what comes out is safe to show: an https link or none, real pictures or none, one to three hearts', () => {
    const [w] = readWishDocs([{ key: 'w1', data: { ...saved, link: 'javascript:alert(1)', hearts: 9, when: 'someday', price: -4, pics: [{ id: 'p1', thumb: 'https://tracker.example.com/x.png' }, { id: 'p2', thumb: THUMB }, 'junk'], got: { by: 'rosh' } } }]).wishes;
    expect(w).toEqual({ id: 'w1', of: 'vijay', what: 'Headphones', when: 'anytime', hearts: 2, pics: [{ id: 'p2', thumb: THUMB }], addedAt: NOW });
  });
  it('a mark read on its own (before a wish is taken off a list)', () => {
    expect(readGot('w1', { wish: 'w1', by: 'rosh', at: NOW })).toEqual({ wish: 'w1', by: 'rosh', at: NOW });
    expect(readGot('w1', null)).toBeNull();
    expect(readGot('w1', { wish: 'w2', by: 'rosh', at: NOW })).toBeNull();
  });
  it('a picture is only ever one kept in the document, and its size is known from its text', () => {
    expect(isPicture(THUMB)).toBe(true);
    expect(isPicture('data:image/svg+xml,%3Csvg%3E')).toBe(true);
    expect(isPicture('https://example.com/x.jpg')).toBe(false);
    expect(isPicture('data:text/html;base64,AAAA')).toBe(false);
    expect(isPicture(undefined)).toBe(false);
    expect(pictureBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(pictureBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(pictureBytes(`data:image/jpeg;base64,${'A'.repeat(266_668)}`)).toBe(200_001);
  });
});

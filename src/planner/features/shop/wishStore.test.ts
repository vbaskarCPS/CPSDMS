// Saving wish lists (wishStore.ts) against pretend shared documents: who writes which document, pictures saved and
// fetched apart from the list, and what taking a wish off a list really does when the other one has quietly got it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// both planners read and write the same shared documents: one store here, and a note of every write
const store = new Map<string, unknown>();
const writes: string[] = [];
const put = (kind: string, key: string, data: unknown) => { store.set(`${kind}|${key}`, data); writes.push(`${kind}|${key}${data === null ? ' (removed)' : ''}`); };
vi.mock('../../lib/docs', () => ({
  getDocs: vi.fn(async (kind: string, from?: string, to?: string) => [...store].filter(([k]) => k.startsWith(`${kind}|`)).map(([k, data]) => ({ key: k.slice(kind.length + 1), data, updated_at: '' }))
    .filter(d => (!from || d.key >= from) && (!to || d.key <= to)).sort((a, b) => a.key.localeCompare(b.key))),
  putDoc: vi.fn(async (kind: string, key: string, data: unknown) => put(kind, key, data)),
  putDocs: vi.fn(async (docs: { kind: string; key: string; data: unknown }[]) => { for (const d of docs) put(d.kind, d.key, d.data); }),
}));

import { gotIt, given, myList, theirList, type Wish } from './wish';
import { clearGot, loadWishBook, loadWishPics, removeWish, saveGot, saveWish } from './wishStore';

const THUMB = 'data:image/jpeg;base64,AAAA', BIG = 'data:image/jpeg;base64,BBBBBBBB';
const coat: Wish = { id: 'w1', of: 'vijay', what: 'Wool coat', price: 300, when: 'christmas', hearts: 3, pics: [{ id: 'p1', thumb: THUMB }], addedAt: '2026-11-01T10:00:00.000Z' };
const book2: Wish = { id: 'w2', of: 'vijay', what: 'A cookbook', when: 'anytime', hearts: 2, pics: [], addedAt: '2026-11-02T10:00:00.000Z' };
const NOW = '2026-11-11T18:00:00.000Z';

beforeEach(() => { store.clear(); writes.length = 0; });

describe('saving a wish and its pictures', () => {
  it('the pictures are their own documents, saved before the wish that points at them; the list carries only the previews', async () => {
    await saveWish(coat, [{ id: 'p1', dataUrl: BIG }]);
    expect(writes).toEqual(['wishimg|w1~p1', 'wish|w1']);
    expect(JSON.stringify(store.get('wish|w1'))).not.toContain(BIG);
    expect((await loadWishBook()).wishes).toEqual([coat]);
    expect(await loadWishPics('w1')).toEqual({ p1: BIG });
  });
  it('a picture taken off a wish is removed; another wish’s pictures are never fetched with it', async () => {
    await saveWish(coat, [{ id: 'p1', dataUrl: BIG }]);
    await saveWish({ ...book2, pics: [{ id: 'p9', thumb: THUMB }] }, [{ id: 'p9', dataUrl: BIG }]);
    await saveWish({ ...coat, pics: [] }, [], ['p1']);
    expect(await loadWishPics('w1')).toEqual({});
    expect(await loadWishPics('w2')).toEqual({ p9: BIG });
  });
});

describe('the mark is the buyer’s document, the wish is the wisher’s', () => {
  it('"I’ve got it", a note, "It’s been given": the wish document is never written', async () => {
    await saveWish(coat);
    writes.length = 0;
    const got = gotIt('w1', 'rosh', NOW);
    await saveGot(got);
    await saveGot({ ...got, note: 'In the hall closet', paid: 250 });
    await saveGot(given(got, NOW));
    expect(writes).toEqual(['wish|w1~got', 'wish|w1~got', 'wish|w1~got']);
    expect(store.get('wish|w1')).toEqual(coat);
  });
  it('the wisher changing the wish, on a phone that never heard of the mark, doesn’t wipe it', async () => {
    await saveWish(coat);
    await saveGot(gotIt('w1', 'rosh', NOW));
    writes.length = 0;
    await saveWish({ ...coat, note: 'In camel, size M' });
    expect(writes).toEqual(['wish|w1']);
    const b = await loadWishBook();
    expect(theirList(b, 'rosh').got.map(r => [r.wish.id, r.wish.note, r.got.by])).toEqual([['w1', 'In camel, size M', 'rosh']]);
    expect(myList(b, 'vijay').wishes.map(w => w.id)).toEqual(['w1']);
  });
  it('"Not any more" removes only the mark', async () => {
    await saveWish(coat);
    await saveGot(gotIt('w1', 'rosh', NOW));
    writes.length = 0;
    await clearGot(coat);
    expect(writes).toEqual(['wish|w1~got (removed)']);
    expect(theirList(await loadWishBook(), 'rosh').toGet.map(w => w.id)).toEqual(['w1']);
  });
});

describe('taking a wish off your list', () => {
  it('nobody had got it: the wish and its pictures are removed, and no mark is made up', async () => {
    await saveWish(coat, [{ id: 'p1', dataUrl: BIG }]);
    writes.length = 0;
    await removeWish(coat, NOW);
    expect(writes).toEqual(['wish|w1 (removed)', 'wishimg|w1~p1 (removed)']);
    const b = await loadWishBook();
    expect([myList(b, 'vijay').wishes, theirList(b, 'rosh').toGet]).toEqual([[], []]);
  });
  it('quietly got already (even if this phone’s copy is from before the mark): gone from the wisher’s list, kept for the buyer with its pictures', async () => {
    await saveWish(coat, [{ id: 'p1', dataUrl: BIG }]);
    await saveWish(book2);
    await saveGot({ ...gotIt('w1', 'rosh', NOW), paid: 250 });
    await removeWish(coat, NOW);   // `coat` here is the wisher's old copy
    const b = await loadWishBook();
    expect(myList(b, 'vijay')).toEqual({ wishes: [book2], received: [] });
    const t = theirList(b, 'rosh');
    expect(t.got.map(r => [r.wish.id, r.wish.removedAt, r.got.paid])).toEqual([['w1', NOW, 250]]);
    expect(t.totals.spent).toBe(250);
    expect(await loadWishPics('w1')).toEqual({ p1: BIG });
  });
  it('then "Clear it away" by the buyer removes all of it: the wish, the mark and the pictures', async () => {
    await saveWish(coat, [{ id: 'p1', dataUrl: BIG }]);
    await saveGot(gotIt('w1', 'rosh', NOW));
    await removeWish(coat, NOW);
    const kept = theirList(await loadWishBook(), 'rosh').got[0].wish;
    await clearGot(kept);
    const b = await loadWishBook();
    expect([b.wishes, b.gots]).toEqual([[], {}]);
    expect(await loadWishPics('w1')).toEqual({});
  });
  it('a gift cleared from Received is removed for good, mark and all', async () => {
    await saveWish(coat);
    await saveGot(given(gotIt('w1', 'rosh', NOW), NOW));
    expect(myList(await loadWishBook(), 'vijay').received.map(r => r.from)).toEqual(['rosh']);
    await removeWish(coat, NOW);
    const b = await loadWishBook();
    expect([b.wishes, b.gots]).toEqual([[], {}]);
  });
});

// src/planner/features/shop/wishStore.ts — reading and writing the wish lists (wish.ts says what the documents are
// and who sees what). The one who wished only ever writes the wish; the one who bought only ever writes the mark;
// each picture is a document of its own, fetched when a wish is opened, not with the list.
import { getDocs, putDoc, putDocs } from '../../lib/docs';
import { WISH_KIND, WISHIMG_KIND, gotKey, isPicture, picKey, readGot, readWishDocs, removalOf, type Wish, type WishBook, type WishGot } from './wish';

export async function loadWishBook(): Promise<WishBook> {
  return readWishDocs(await getDocs(WISH_KIND));
}

/** A wish's full pictures, by picture id (the list itself only carries the small previews). */
export async function loadWishPics(wishId: string): Promise<Record<string, string>> {
  const docs = await getDocs<{ dataUrl?: string } | null>(WISHIMG_KIND, picKey(wishId, ''), picKey(wishId, '￿'));
  const out: Record<string, string> = {};
  for (const d of docs) if (isPicture(d.data?.dataUrl)) out[d.key.slice(wishId.length + 1)] = d.data.dataUrl;
  return out;
}

/** Save a wish (new or changed) with its pictures: the new pictures first, so the wish never points at one that
 *  isn't there; then the wish; then the pictures that were taken off it. */
export async function saveWish(w: Wish, fresh: { id: string; dataUrl: string }[] = [], gone: string[] = []): Promise<void> {
  for (const p of fresh) await putDoc(WISHIMG_KIND, picKey(w.id, p.id), { dataUrl: p.dataUrl });   // one at a time: each is a big document
  await putDoc(WISH_KIND, w.id, w);
  if (gone.length) await putDocs(gone.map(id => ({ kind: WISHIMG_KIND, key: picKey(w.id, id), data: null })));
}

const dropAll = (w: Wish, marked: boolean) => putDocs([
  { kind: WISH_KIND, key: w.id, data: null },
  ...(marked ? [{ kind: WISH_KIND, key: gotKey(w.id), data: null }] : []),
  ...w.pics.map(p => ({ kind: WISHIMG_KIND, key: picKey(w.id, p.id), data: null })),
]);

/** The wisher takes a wish off their list. The freshest mark is looked at first (this phone's copy may be from before
 *  the other one marked it): a wish that's quietly been got is kept for the one who bought it, out of the wisher's
 *  sight; anything else is removed for good. Either way it's gone from the wisher's screen, and nothing tells them
 *  which it was. If the mark can't be read (no signal), nothing is removed. */
export async function removeWish(w: Wish, now = new Date().toISOString()): Promise<void> {
  const docs = await getDocs(WISH_KIND, gotKey(w.id), gotKey(w.id));
  const got = readGot(w.id, docs[0]?.data);
  const plan = removalOf(w, got, now);
  if ('keep' in plan) await putDoc(WISH_KIND, w.id, plan.keep);
  else await dropAll(w, !!got);
}

/** The buyer's mark: "I've got it", its note, "It's been given". */
export const saveGot = (g: WishGot) => putDoc(WISH_KIND, gotKey(g.wish), g);
/** "Not any more." A wish its wisher had already taken off the list has no one left to show it to: it goes with the mark. */
export const clearGot = (w: Wish) => (w.removedAt ? dropAll(w, true) : putDoc(WISH_KIND, gotKey(w.id), null));

// src/planner/features/decor/store.ts — a page's stickers and the person's own pictures, fetched and saved.
// A page's stickers are asked for when the page opens and kept while the planner stays open, so coming back to a page
// shows them at once; the page itself never waits for them. A change is saved a moment after it is made (and at once
// when asked: flushPage), and a save that failed is tried again the next time anything changes or the planner comes
// back to the front. Everything here belongs to the signed-in person: another person signing in starts empty.
import { getDoc, getDocs, putDoc } from '../../lib/docs';
import { getPass } from '../../lib/auth';
import { DECOR_KIND, OWN_KIND, OWN_MAX, mineKey, readDecor, readOwn, writeDecor, type OwnPicture, type Placed, type SectionId } from './decor';

interface Page { items: Placed[]; loaded: boolean; dirty: boolean; failed: boolean; timer?: number; saving?: Promise<boolean> }
const NONE: Placed[] = [];
let who = '';                                   // whose stickers are held
const pages = new Map<SectionId, Page>();
const own = new Map<string, OwnPicture | null>();   // null = looked for, not there (deleted)
let ownAll: Promise<void> | null = null;        // every own picture has been asked for (the tray's "Mine")
let version = 0;
const listeners = new Set<() => void>();
const tell = () => { version++; for (const fn of [...listeners]) fn(); };
/** For useSyncExternalStore: called whenever a page's stickers or the own pictures change. */
export const onDecor = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const decorVersion = (): number => version;

/** A different person has signed in: forget what was held for the last one. */
function mine() {
  const id = getPass()?.user.id || '';
  if (id !== who) { for (const p of pages.values()) window.clearTimeout(p.timer); pages.clear(); own.clear(); ownAll = null; who = id; }
}
function page(section: SectionId): Page {
  mine();
  let p = pages.get(section);
  if (!p) { p = { items: NONE, loaded: false, dirty: false, failed: false }; pages.set(section, p); }
  return p;
}
/** How long after a change it is saved (ms), and how long after a save that failed it is tried again. */
export const SAVE_AFTER = 800, RETRY_AFTER = 6000;

/** The stickers on a page, as far as is known (none until they have arrived). */
export const pageItems = (section: SectionId): Placed[] => page(section).items;
/** Has this page's doc arrived? (Nothing is ever saved over a page that couldn't be read.) */
export const pageLoaded = (section: SectionId): boolean => page(section).loaded;
/** The last save didn't go through. */
export const pageFailed = (section: SectionId): boolean => page(section).failed;

/** Ask for a page's stickers. What is on the screen is kept if it has changes of its own not yet saved. */
export async function loadPage(section: SectionId): Promise<void> {
  const p = page(section), asked = who;
  if (p.dirty) { void flushPage(section); return; }
  try {
    const items = readDecor(await getDoc(DECOR_KIND, section));
    if (asked !== who || p.dirty) return;
    const same = p.loaded && JSON.stringify(items) === JSON.stringify(p.items);   // the first answer always counts: the page is now known
    p.loaded = true;
    if (!same) { p.items = items.length ? items : NONE; tell(); }
    void loadOwn(items);
  } catch { /* no connection: the page simply has no stickers until it can be read */ }
}
/** The page's stickers after a change: shown at once, saved a moment later. */
export function setPage(section: SectionId, items: Placed[]): void {
  const p = page(section);
  if (!p.loaded) return;
  p.items = items.length ? items : NONE; p.dirty = true;
  window.clearTimeout(p.timer);
  p.timer = window.setTimeout(() => { void flushPage(section); }, SAVE_AFTER);
  tell();
}
/** Save a page now if it has changes. True when everything is saved. */
export async function flushPage(section: SectionId): Promise<boolean> {
  const p = page(section), asked = who;
  window.clearTimeout(p.timer);
  if (p.saving) await p.saving;
  if (!p.dirty || asked !== who) return !p.dirty;
  p.dirty = false;
  const sent = p.items;
  p.saving = putDoc(DECOR_KIND, section, writeDecor(sent)).then(() => true, () => false);
  const ok = await p.saving;
  p.saving = undefined;
  if (!ok) { p.dirty = true; p.timer = window.setTimeout(() => { void flushPage(section); }, RETRY_AFTER); }   // no connection: keep trying
  if (p.failed !== !ok) { p.failed = !ok; tell(); }
  return ok && !p.dirty;
}
/** Leaving, or the planner going to the background: save whatever is waiting. */
export function flushAll(): void { for (const [s, p] of pages) if (p.dirty) void flushPage(s); }
/** How many stickers each page has, for the list of pages to decorate. */
export async function countPages(): Promise<Partial<Record<SectionId, number>>> {
  mine();
  const out: Partial<Record<SectionId, number>> = {};
  for (const d of await getDocs(DECOR_KIND)) out[d.key as SectionId] = readDecor(d.data).length;
  for (const [s, p] of pages) if (p.loaded) out[s] = p.items.length;   // what is held is newer than what was just read
  return out;
}

// ── the person's own pictures ──
/** One of the person's own pictures, if it has arrived. */
export const ownPicture = (key: string): OwnPicture | undefined => { mine(); return own.get(key) || undefined; };
/** Is this own picture known to be gone (deleted)? Its stickers are then not drawn and are cleared away. */
export const ownGone = (key: string): boolean => { mine(); return own.get(key) === null; };
/** Fetch the own pictures these stickers show, the ones not already here. */
export async function loadOwn(items: Placed[]): Promise<void> {
  mine();
  const asked = who, keys = [...new Set(items.map(p => mineKey(p.art)).filter((k): k is string => !!k && !own.has(k)))];
  if (!keys.length) return;
  await Promise.all(keys.map(async k => {
    try { const pic = readOwn(await getDoc(OWN_KIND, k)); if (asked === who) own.set(k, pic); } catch { /* try again next time the page opens */ }
  }));
  if (asked === who) tell();
}
/** Every own picture the person has kept, newest first (the tray's "Mine"). */
export function ownList(): { key: string; pic: OwnPicture }[] {
  mine();
  return [...own].filter((e): e is [string, OwnPicture] => !!e[1]).map(([key, pic]) => ({ key, pic })).sort((a, b) => b.key.localeCompare(a.key));
}
export async function loadAllOwn(): Promise<void> {
  mine();
  const asked = who;
  ownAll ??= getDocs(OWN_KIND).then(docs => {
    if (asked !== who) return;
    for (const d of docs) { const pic = readOwn(d.data); if (pic || !own.has(d.key)) own.set(d.key, pic); }
    tell();
  }, () => { ownAll = null; });
  await ownAll;
}
/** Keep a new own picture. Returns its key. Throws 'full' when the person already keeps as many as they may. */
export async function addOwn(pic: OwnPicture): Promise<string> {
  mine();
  if (ownList().length >= OWN_MAX) throw new Error('full');
  const key = `${Date.now().toString(36).padStart(9, '0')}${Math.random().toString(36).slice(2, 6)}`;
  await putDoc(OWN_KIND, key, pic);
  own.set(key, pic);
  tell();
  return key;
}
/** Delete an own picture for good. Its stickers come off every page as those pages are next opened. */
export async function removeOwn(key: string): Promise<void> {
  mine();
  await putDoc(OWN_KIND, key, null);
  own.set(key, null);
  tell();
}

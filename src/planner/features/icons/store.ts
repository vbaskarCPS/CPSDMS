// src/planner/features/icons/store.ts — the person's icon choice (choice.ts), kept in three places: in memory for
// what is on screen; in this phone's storage, pictures and all, so the bar draws the right icons the moment the
// planner opens (no flash of the old ones while the server is asked); and in their docs, so it follows them to their
// other phone: prefs/icons holds the pack and which places carry a picture of their own, and each of those pictures
// is a doc of kind 'lookicon' keyed by its place.
// A change shows at once and is saved behind it. If the save fails (no signal) the choice stays on this phone, marked
// as not sent, and goes up the next time the planner is opened, rather than being wiped by the older copy on the server.
// The demo keeps nothing on the phone: it starts from the planner's own icons every time. No React here.
import { getPass, onPassChange } from '../../lib/auth';
import { isDemo } from '../../lib/app';
import { getDoc, getDocs, putDocs } from '../../lib/docs';
import { cleanPrefs, drawn, isPicture, isPlace, NO_CHOICE, PLACES, toFetch, type Drawn, type IconPrefs, type Place } from './choice';

export const PREFS_KEY = 'icons';          // the doc ('prefs', 'icons')
export const PICTURE_KIND = 'lookicon';    // a place's own picture: ('lookicon', <place>) = { src, at }

type Pictures = Partial<Record<Place, string>>;
/** What this phone holds: the choice, the pictures themselves, and whether a change is still to be sent. */
interface Kept { prefs: IconPrefs; pictures: Pictures; unsaved?: boolean }

const userId = () => getPass()?.user.id ?? '';
const localKey = () => `planner-icons:${userId()}`;   // one per person, so two sign-ins on one phone don't share icons
const fresh = (): Kept => ({ prefs: { ...NO_CHOICE, own: {} }, pictures: {} });

function readLocal(): Kept {
  if (isDemo() || !userId()) return fresh();
  try {
    const raw = localStorage.getItem(localKey());
    if (!raw) return fresh();
    const k = JSON.parse(raw) as { prefs?: unknown; pictures?: Record<string, unknown>; unsaved?: unknown };
    const prefs = cleanPrefs(k.prefs), pictures: Pictures = {};
    for (const p of Object.keys(prefs.own) as Place[]) { const src = k.pictures?.[p]; if (isPicture(src)) pictures[p] = src; }
    return { prefs, pictures, unsaved: k.unsaved === true };
  } catch { return fresh(); }
}
function writeLocal(): void {
  if (isDemo() || !userId()) return;
  try { localStorage.setItem(localKey(), JSON.stringify(kept)); } catch { /* private mode, or storage is full: the choice holds until the planner is closed */ }
}

let whose = userId();
let kept: Kept = readLocal();
let version = 0;
let edits = 0;   // goes up with every change made here: a fetch that started before one doesn't overwrite it
let asking: Promise<void> | null = null;   // the fetch under way, if there is one
let askedAt = 0;
const watchers = new Set<() => void>();
const tell = () => { version++; for (const fn of [...watchers]) fn(); };

/** The look that is on: the id the looks put on <html data-look>; null = the planner's own look. */
export const lookNow = (): string | null => (typeof document === 'undefined' ? null : document.documentElement.dataset.look || null);
/** Changes whenever what should be drawn may have: the choice, a picture, or the look. */
export const iconsStamp = (): string => `${version}:${lookNow() ?? ''}`;
export const iconPrefs = (): IconPrefs => kept.prefs;
export const iconPictures = (): Pictures => kept.pictures;
/** What to draw at a place, right now. */
export const iconAt = (place: Place): Drawn => drawn(kept.prefs, lookNow(), place, kept.pictures);

let listening = false;
function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // the looks say so when the look changes; watching the attribute as well covers a look set with no word said
  window.addEventListener('planner-look', tell);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(tell).observe(document.documentElement, { attributes: true, attributeFilter: ['data-look'] });
  // back in front: pick up what was chosen on their other phone
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshIcons(); });
  void refreshIcons();
}
// someone signs in on this phone (or someone else does): their icons, not the last person's
onPassChange(() => {
  if (userId() === whose) return;
  whose = userId(); edits++; askedAt = 0;
  kept = readLocal();
  tell();
  void refreshIcons();
});
/** Hear about every change to what should be drawn. Returns the way to stop listening. */
export function onIcons(fn: () => void): () => void {
  watchers.add(fn);
  listen();
  return () => { watchers.delete(fn); };
}

/** Every doc that makes up the choice: sent whole when an earlier save didn't get through. */
function allDocs(k: Kept): { kind: string; key: string; data: unknown | null }[] {
  return [
    ...PLACES.map(p => ({ kind: PICTURE_KIND, key: p.id, data: k.prefs.own[p.id] && k.pictures[p.id] ? { src: k.pictures[p.id], at: k.prefs.own[p.id] } : null })),
    { kind: 'prefs', key: PREFS_KEY, data: k.prefs },
  ];
}

/** Bring this phone's copy in line with the account (at most once every half minute, unless `now`). */
export function refreshIcons(now = false): Promise<void> {
  if (!userId()) return Promise.resolve();
  if (asking) return asking;
  if (!now && Date.now() - askedAt < 30_000) return Promise.resolve();
  askedAt = Date.now();
  asking = pull().finally(() => { asking = null; });
  return asking;
}
async function pull(): Promise<void> {
  const who = userId(), mine = edits;
  const stale = () => who !== userId() || mine !== edits;
  try {
    if (kept.unsaved) {   // a change made here never reached the account: send it, don't take the older copy back
      const sending = kept;
      await putDocs(allDocs(sending));
      if (!stale()) { kept = { ...kept, unsaved: false }; writeLocal(); }
      return;
    }
    const doc = await getDoc<unknown>('prefs', PREFS_KEY);
    if (stale() || !doc) return;   // nothing chosen on the account yet: what's here stays
    const prefs = cleanPrefs(doc), need = toFetch(prefs, kept.prefs, kept.pictures);
    const pictures: Pictures = {};
    for (const p of Object.keys(prefs.own) as Place[]) if (kept.pictures[p] && !need.includes(p)) pictures[p] = kept.pictures[p];
    if (need.length) {
      for (const d of await getDocs<{ src?: unknown } | null>(PICTURE_KIND)) {
        const src = d.data?.src;
        if (isPlace(d.key) && need.includes(d.key) && isPicture(src)) pictures[d.key] = src;
      }
      if (stale()) return;
    }
    if (JSON.stringify([prefs, pictures]) === JSON.stringify([kept.prefs, kept.pictures])) return;
    kept = { prefs, pictures };
    writeLocal(); tell();
  } catch { /* no signal: what this phone has stays */ }
}

/** Make a change: on screen and on this phone at once, then to the account. Throws when the save doesn't get through
 *  (the change is kept here and sent later). */
async function change(next: Kept, docs: { kind: string; key: string; data: unknown | null }[]): Promise<void> {
  edits++;
  kept = { ...next, unsaved: true };
  writeLocal(); tell();
  const mine = edits;
  await putDocs(docs);
  if (mine === edits) { kept = { ...kept, unsaved: false }; writeLocal(); }
}

/** "Match my look", or one pack for always. */
export function choosePack(pack: IconPrefs['pack']): Promise<void> {
  const prefs = { ...kept.prefs, pack };
  return change({ ...kept, prefs }, [{ kind: 'prefs', key: PREFS_KEY, data: prefs }]);
}
/** Put their own picture (a small PNG or WebP as a data: URL: picture.ts makes it) on a place. */
export function setPicture(place: Place, src: string): Promise<void> {
  if (!isPicture(src)) return Promise.reject(new Error('That picture could not be used.'));
  const at = new Date().toISOString();
  const prefs = { ...kept.prefs, own: { ...kept.prefs.own, [place]: at } };
  return change({ prefs, pictures: { ...kept.pictures, [place]: src } }, [{ kind: PICTURE_KIND, key: place, data: { src, at } }, { kind: 'prefs', key: PREFS_KEY, data: prefs }]);
}
/** Take their picture off a place: the pack's drawing comes back. */
export function clearPicture(place: Place): Promise<void> {
  const own = { ...kept.prefs.own }, pictures = { ...kept.pictures };
  delete own[place]; delete pictures[place];
  const prefs = { ...kept.prefs, own };
  return change({ prefs, pictures }, [{ kind: PICTURE_KIND, key: place, data: null }, { kind: 'prefs', key: PREFS_KEY, data: prefs }]);
}

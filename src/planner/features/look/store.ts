// src/planner/features/look/store.ts — what the person has chosen in the Theme Studio, kept and applied.
// The choices (LookPrefs, looks.ts) are saved in two places: the doc prefs/look, so they follow the person to their
// other phone, and this phone's own storage under their user id, so the look is on before the first paint when the
// planner opens (no flash of the old colours). A picture of their own is a doc of kind 'lookimg' (one for the whole
// planner, one for any section), kept on this phone too so it shows at once.
// Only for someone signed in: the sign-in screen keeps the planner's own look, and so does the demo's first paint
// (inside the demo the Studio works, and nothing is kept, like everything else there).
import { appBase, isDemo } from '../../lib/app';
import { getPass, onPassChange } from '../../lib/auth';
import { getDoc, putDoc } from '../../lib/docs';
import { adoptFirstPaint, applyLook } from './apply';
import { cleanPrefs, dataUrlBytes, firstPaint, noPrefs, shrinkTo, wearing, type LookPrefs, type PicSlot } from './looks';

const KIND = 'prefs', KEY = 'look', PIC_KIND = 'lookimg';
const localKey = (userId: string) => `planner-look:${userId}`;
const firstKey = (userId: string) => `planner-look-first:${userId}`;   // read by planner.html before the app loads

let prefs: LookPrefs = noPrefs();
let userId: string | null = null;
let here = '/';                                          // the screen on show, as a path inside the app
const pics = new Map<PicSlot, { id: string; url: string }>();   // pictures loaded and ready to show
const watchers = new Set<() => void>();
let saveTimer = 0;

export const lookPrefs = (): LookPrefs => prefs;
/** Told whenever the choices change (the Studio redraws). Returns the way to stop. */
export const onLookPrefs = (fn: () => void): (() => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };
let version = 0;
const tell = () => { version++; for (const fn of [...watchers]) fn(); };
/** Goes up with every change to the choices or the pictures (a screen redraws when it does). */
export const lookVersion = (): number => version;
const pictureOf = (slot: PicSlot): string | null => { const p = pics.get(slot); return p && p.id === prefs.pic.on[slot] ? p.url : null; };
const show = () => applyLook(prefs, here, pictureOf);

/** The path inside the app, from the address bar ('/roshplanner/food/add' → '/food/add'). */
function pathNow(): string {
  if (typeof location === 'undefined') return '/';
  const base = appBase();
  return location.pathname.startsWith(base) ? location.pathname.slice(base.length) || '/' : '/';
}
const readLocal = (id: string): LookPrefs | null => { try { const raw = localStorage.getItem(localKey(id)); return raw ? cleanPrefs(JSON.parse(raw)) : null; } catch { return null; } };
const writeLocal = (id: string, p: LookPrefs): void => {
  try { localStorage.setItem(localKey(id), JSON.stringify(p)); localStorage.setItem(firstKey(id), JSON.stringify(firstPaint(p))); } catch { /* private mode, or full: the saved doc still has it */ }
};

/** The screen changed: wear what that screen wears (called on every change of route). */
export function lookAt(pathname: string): void {
  here = pathname || '/';
  show();
  void wantPicture();
}

/** Before anything is drawn: put on what this phone remembers for whoever is signed in. */
export function bootLook(): void {
  adoptFirstPaint();                         // the page colour planner.html has already put on is ours to keep or take off
  here = pathNow();
  const pass = isDemo() ? null : getPass();  // the demo opens in the planner's own look; so does the sign-in screen
  userId = pass?.user.id ?? null;
  prefs = (userId && readLocal(userId)) || noPrefs();
  show();
  void wantPicture();
}

/** Someone is signed in: pick up what was saved from their other phone, and take the look off when they sign out.
 *  Returns the way to stop. */
export function startLook(): () => void {
  const follow = (id: string | null) => {
    if (id === userId && id !== null) return;
    if (saveTimer) save();                   // whoever was here: their last change goes to their account, not the next person's
    userId = id;
    pics.clear();
    prefs = (id && !isDemo() && readLocal(id)) || noPrefs();
    show(); tell();
    if (id) void pull();
  };
  const now = getPass()?.user.id ?? null;
  if (now !== userId) follow(now); else if (now) void pull();
  const off = onPassChange(p => follow(p?.user.id ?? null));
  // back from the background: the other phone may have changed it meanwhile
  const onShow = () => { if (document.visibilityState === 'visible' && userId) void pull(); };
  document.addEventListener('visibilitychange', onShow);
  return () => { off(); document.removeEventListener('visibilitychange', onShow); };
}

/** What was saved for the account. The newer of that and this phone's copy wins: a newer one from the account is put
 *  on; a newer one on this phone (a change made with no signal) is sent up. */
async function pull(): Promise<void> {
  const id = userId;
  if (!id) return;
  try {
    const saved = await getDoc<unknown>(KIND, KEY);
    if (id !== userId) return;
    const theirs = saved ? cleanPrefs(saved) : null;
    if (!theirs || theirs.at < prefs.at) { if (prefs.at && !saveTimer) save(); return; }
    if (theirs.at === prefs.at) return;
    prefs = theirs;
    if (!isDemo()) writeLocal(id, prefs);
    show(); tell();
    void wantPicture();
  } catch { /* offline: this phone's copy stands */ }
}
/** Send the choices to the account, for whoever they belong to (never someone who signed in a moment later). */
function save(): void {
  window.clearTimeout(saveTimer); saveTimer = 0;
  const who = userId, what = prefs;
  if (who && who === getPass()?.user.id) void putDoc(KIND, KEY, what).catch(() => undefined);   // not saved: the next opening sends it (pull)
}

/** Change the choices: on screen at once, kept on this phone at once, saved for the other phone a moment later
 *  (a slider being dragged sends many changes; one save covers them). */
export function setLook(change: (p: LookPrefs) => LookPrefs): void {
  prefs = cleanPrefs({ ...change(prefs), at: new Date().toISOString() });
  show(); tell();
  void wantPicture();
  if (!userId) return;
  if (!isDemo()) writeLocal(userId, prefs);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 700);
}
/** Save now (the Studio calls this on the way out, so a change made a moment ago isn't lost). */
export function flushLook(): void { if (saveTimer) save(); }
/** Everything back to the planner as it always was. The pictures are taken off too. */
export function clearLook(): void {
  const had = Object.keys(prefs.pic.on) as PicSlot[];
  setLook(() => noPrefs());
  for (const slot of had) { void dropLocalPic(slot); void putDoc(PIC_KIND, slot, null).catch(() => undefined); }
  pics.clear();
}

// ── a picture of their own ──
// On this phone the pictures live in IndexedDB (a few hundred kilobytes each: too much for localStorage's 5 MB once
// there is one per section). The key is user id + slot; what's kept is { id, url } where url is a data: address.
const DB = 'planner-look', STORE = 'pics';
let opened: Promise<IDBDatabase | null> | null = null;
/** The phone's store of pictures, opened once (null where there is none: private mode, an old browser). */
function db(): Promise<IDBDatabase | null> {
  opened ??= new Promise(done => {
    try {
      if (typeof indexedDB === 'undefined') { done(null); return; }
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
      open.onsuccess = () => done(open.result);
      open.onerror = () => done(null);
    } catch { done(null); }
  });
  return opened;
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await db();
  if (!d) return null;
  return new Promise(done => {
    try {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => done(req.result ?? null);
      req.onerror = () => done(null);
    } catch { done(null); }
  });
}
const picKey = (slot: PicSlot) => `${userId}:${slot}`;
const keepLocalPic = (slot: PicSlot, v: { id: string; url: string }) => (isDemo() ? Promise.resolve(null) : idb('readwrite', s => s.put(v, picKey(slot))));
const dropLocalPic = (slot: PicSlot) => (isDemo() ? Promise.resolve(null) : idb('readwrite', s => s.delete(picKey(slot))));

const fetching = new Map<string, Promise<boolean>>();
/** Get a slot's picture in hand if it isn't yet: from this phone first, then from the saved doc. True once it is. */
function fetchPicture(slot: PicSlot): Promise<boolean> {
  const id = prefs.pic.on[slot], who = userId;
  if (!id || !who) return Promise.resolve(false);
  if (pics.get(slot)?.id === id) return Promise.resolve(true);
  const job = `${who}:${slot}:${id}`;
  let p = fetching.get(job);
  if (!p) {
    p = (async () => {
      let got = isDemo() ? null : await idb<{ id: string; url: string }>('readonly', s => s.get(picKey(slot)));
      if (!got || got.id !== id) {
        const doc = await getDoc<{ id?: string; url?: string }>(PIC_KIND, slot).catch(() => null);
        got = doc && doc.id === id && typeof doc.url === 'string' && doc.url.startsWith('data:image/') ? { id, url: doc.url } : null;
        if (got && who === userId) void keepLocalPic(slot, got);
      }
      if (!got || who !== userId || prefs.pic.on[slot] !== id) return false;
      pics.set(slot, got);
      return true;
    })().finally(() => { fetching.delete(job); });
    fetching.set(job, p);
  }
  return p;
}
/** The picture this screen shows, if it isn't in hand yet. */
async function wantPicture(): Promise<void> {
  const slot = wearing(prefs, here).pic;
  if (!slot || pictureOf(slot)) return;
  if (await fetchPicture(slot)) { show(); tell(); }
}
/** The picture in a slot, for the Studio's little preview (null until loaded, or when there is none). */
export const pictureFor = (slot: PicSlot): string | null => pictureOf(slot);
/** Make sure a slot's picture is loaded (the Studio shows ones that aren't behind the screen it is on). */
export async function loadPicture(slot: PicSlot): Promise<void> {
  if (pictureOf(slot)) return;
  if (await fetchPicture(slot)) tell();
}

/** A picked photo, shrunk for a background: long side about 1400, JPEG, under 300 KB if a lower quality or a
 *  smaller size gets it there. Returns a data: address. */
export async function shrinkPicture(file: Blob, maxSide = 1400, maxBytes = 300_000): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('That file isn’t a picture this phone can open.')); i.src = src; });
    let out = '';
    for (const side of [maxSide, 1100, 900, 700]) {
      const { w, h } = shrinkTo(img.naturalWidth, img.naturalHeight, side);
      if (!w || !h) throw new Error('That picture is empty.');
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This phone couldn’t shrink the picture.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // a see-through picture gets white behind it, not black
      ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.82, 0.72, 0.62, 0.5]) {
        out = canvas.toDataURL('image/jpeg', q);
        if (dataUrlBytes(out) <= maxBytes) return out;
      }
    }
    return out;   // a very busy picture: the smallest it got
  } finally { URL.revokeObjectURL(src); }
}

/** Use this photo as the background of the whole planner ('all') or of one section. */
export async function setPicture(slot: PicSlot, file: Blob): Promise<void> {
  const url = await shrinkPicture(file);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await putDoc(PIC_KIND, slot, { id, url, at: new Date().toISOString() });   // saved first: if that fails, nothing changes
  pics.set(slot, { id, url });
  void keepLocalPic(slot, { id, url });
  setLook(p => ({ ...p, pic: { ...p.pic, on: { ...p.pic.on, [slot]: id } } }));
}
/** Take a slot's picture off (the look's own background shows again). */
export function removePicture(slot: PicSlot): void {
  pics.delete(slot);
  void dropLocalPic(slot);
  void putDoc(PIC_KIND, slot, null).catch(() => undefined);
  setLook(p => { const on = { ...p.pic.on }; delete on[slot]; return { ...p, pic: { ...p.pic, on } }; });
}

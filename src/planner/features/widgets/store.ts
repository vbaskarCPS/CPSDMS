// src/planner/features/widgets/store.ts — where a person's arrangement of Today is kept (widgets.ts says what it is).
// Three copies: the doc 'prefs' / 'widgets' on the server (private to the person, the one that counts), one in memory
// shared by the screens that are open, and one on the phone so Today draws in the right order the moment it opens,
// before the server has answered. A change shows at once and is saved a moment later.
// Like lib/useDoc: it never saves over a doc it couldn't read, and a screen coming back to the front reads it again, so
// two phones don't overwrite each other with old copies. The demo keeps nothing on the phone (nothing there is saved).
import { useEffect, useSyncExternalStore } from 'react';
import { isDemo } from '../../lib/app';
import { onPassChange } from '../../lib/auth';
import { getDoc, onDocsChanged, putDoc } from '../../lib/docs';
import { clean, EMPTY, type WidgetPrefs } from './widgets';

/** loaded = the server's copy has been read (until then nothing can be changed); trouble = what couldn't be done. */
interface State { uid: string; prefs: WidgetPrefs; loaded: boolean; trouble: 'load' | 'save' | null }
let state: State | null = null;
let unsaved = false;                     // a change the server doesn't have yet
let saving: Promise<void> | null = null;
let changes = 0;                         // counts changes, so an answer that was asked for before one isn't used after it
let timer = 0, again = 0;
const watchers = new Set<() => void>();
const same = (a: WidgetPrefs, b: WidgetPrefs) => JSON.stringify(a) === JSON.stringify(b);
const set = (patch: Partial<State>) => { if (state) { state = { ...state, ...patch }; watchers.forEach(fn => fn()); } };

// the copy on the phone, one per person
const localKey = (uid: string) => `pl-widgets:${uid}`;
function readLocal(uid: string): WidgetPrefs | null {
  if (isDemo()) return null;
  try { const raw = localStorage.getItem(localKey(uid)); return raw ? clean(JSON.parse(raw)) : null; } catch { return null; }
}
function writeLocal(uid: string, p: WidgetPrefs): void {
  if (isDemo()) return;
  try { localStorage.setItem(localKey(uid), JSON.stringify(p)); } catch { /* private mode: the server still has it */ }
}

// signed out on this phone: the copies kept here go too (a note's words are the person's own)
onPassChange(pass => {
  if (pass) return;
  window.clearTimeout(timer); window.clearTimeout(again);
  state = null; unsaved = false; changes++;
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('pl-widgets:') || k.startsWith('pl-widgetnote:')) localStorage.removeItem(k); } catch { /* nothing kept */ }
});

/** The copy in memory for this person, started from the phone's copy. */
function open(uid: string): State {
  if (!state || state.uid !== uid) {
    window.clearTimeout(timer); window.clearTimeout(again);
    unsaved = false; changes++;
    state = { uid, prefs: readLocal(uid) || EMPTY, loaded: false, trouble: null };
  }
  return state;
}

/** Read the server's copy, unless something here is still waiting to be saved (then this one is newer). */
async function refresh(): Promise<void> {
  const s = state, n = changes;
  if (!s || unsaved || saving) return;
  try {
    const prefs = clean(await getDoc<unknown>('prefs', 'widgets'));
    if (!state || state.uid !== s.uid || n !== changes || unsaved || saving) return;
    writeLocal(s.uid, prefs);
    if (!state.loaded || state.trouble === 'load' || !same(prefs, state.prefs)) set({ prefs: same(prefs, state.prefs) ? state.prefs : prefs, loaded: true, trouble: state.trouble === 'load' ? null : state.trouble });
  } catch {
    if (!state || state.uid !== s.uid || state.loaded) return;   // read before: carry on with what's here
    if (state.trouble !== 'load') set({ trouble: 'load' });
    window.clearTimeout(again);
    again = window.setTimeout(() => { if (watchers.size) void refresh(); }, 4000);
  }
}

async function save(): Promise<void> {
  window.clearTimeout(timer);
  if (!state || !unsaved || saving) return;
  const s = state;
  unsaved = false;
  saving = putDoc('prefs', 'widgets', s.prefs).then(
    () => { if (state && state.uid === s.uid && state.trouble === 'save') set({ trouble: null }); },
    () => {
      if (!state || state.uid !== s.uid) return;
      unsaved = true;
      if (state.trouble !== 'save') set({ trouble: 'save' });
      window.clearTimeout(again);
      again = window.setTimeout(() => void save(), 4000);
    },
  ).finally(() => {
    saving = null;
    if (unsaved && state?.trouble !== 'save') void save();       // changed again while that one was on its way
    else if (state && !state.loaded) void refresh();              // someone else signed in meanwhile: read theirs
  });
  await saving;
}

/** Change the arrangement. Shows at once, saved a moment later. false = not yet (the saved one hasn't been read). */
export function changeWidgets(fn: (p: WidgetPrefs) => WidgetPrefs): boolean {
  if (!state || !state.loaded) return false;
  const next = clean(fn(state.prefs));
  if (same(next, state.prefs)) return true;
  unsaved = true; changes++;
  writeLocal(state.uid, next);
  set({ prefs: next });
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void save(), 400);
  return true;
}

const watch = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };

/** This person's arrangement of Today, for a screen: the phone's copy straight away, then the server's. */
export function useWidgets(uid: string): { prefs: WidgetPrefs; loaded: boolean; trouble: State['trouble']; change: typeof changeWidgets } {
  const s = useSyncExternalStore(watch, () => open(uid));
  useEffect(() => {
    void refresh();
    // back at the front: pick up what another phone changed; going away: save what's waiting
    const onShow = () => { if (document.visibilityState === 'visible') void refresh(); else void save(); };
    const onHide = () => { void save(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pagehide', onHide);
    const off = onDocsChanged(kinds => { if (kinds.includes('prefs')) void refresh(); });
    return () => { document.removeEventListener('visibilitychange', onShow); window.removeEventListener('pagehide', onHide); off(); void save(); };
  }, [uid]);
  return { prefs: s.prefs, loaded: s.loaded, trouble: s.trouble, change: changeWidgets };
}

// ── a note's words: their own doc ('widgetnote' / the note's id), with a copy on the phone so the note isn't blank
//    for a moment each time Today opens ──
export const NOTE_KIND = 'widgetnote';
const noteKey = (uid: string, id: string) => `pl-widgetnote:${uid}:${id}`;
export function noteLocal(uid: string, id: string): string {
  if (isDemo()) return '';
  try { return localStorage.getItem(noteKey(uid, id)) || ''; } catch { return ''; }
}
export function keepNoteLocal(uid: string, id: string, text: string): void {
  if (isDemo()) return;
  try { if (text) localStorage.setItem(noteKey(uid, id), text); else localStorage.removeItem(noteKey(uid, id)); } catch { /* private mode */ }
}
/** A note taken off the page: its words go too. */
export async function dropNote(uid: string, id: string): Promise<void> {
  keepNoteLocal(uid, id, '');
  await putDoc(NOTE_KIND, id, null).catch(() => undefined);
}

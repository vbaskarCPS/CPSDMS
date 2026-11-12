// src/planner/features/sounds/store.ts — the person's sound choice (choice.ts) and the sounds themselves while the
// planner is open.
// The choice is kept in three places: in their docs (prefs/sounds), so it follows them to their other phone; in this
// phone's storage, so it is right the moment the planner opens; and in Cache Storage under the notification worker's
// own address, because the worker (public/planner-push-sw.js) can't read the page's storage and needs to know which
// kinds come without the phone's sound. That last copy is written whenever the choice changes and every time the
// planner starts. A change that couldn't be sent (no signal) stays on this phone and goes up next time.
// Sounds while open: one path for each kind of arrival, so nothing sounds twice. Chat messages (the other one's and
// Arvy's answers) sound when they appear in the chat's list (us.ts); a chat push only makes the list look again at
// once. Every other push sounds when the worker says it arrived. Never for their own message, never while the page
// is hidden (the phone's notification covers that), at most once every 3 seconds for each kind. A phone lets a page
// make sound only after it has been touched: the first tap anywhere wakes the sound, and until then nothing plays and
// nothing complains. No React here.
import { getPass } from '../../lib/auth';
import { isDemo } from '../../lib/app';
import { getDoc, putDoc } from '../../lib/docs';
import { pushScope } from '../../lib/push';
import { onUs, refreshUs, usLoaded, usRows } from '../us/us';
import { cleanSounds, freshArrivals, kindOfPush, makeGate, PREFS_KEY, type KindChoice, type SoundKind, type SoundPrefs } from './choice';
import { playOn } from './sounds';

// ── the choice ──
const userId = () => getPass()?.user.id ?? '';
const localKey = () => `planner-sounds:${userId()}`;
interface Kept { prefs: SoundPrefs; unsaved?: boolean }
function readLocal(): Kept {
  if (isDemo() || !userId()) return { prefs: cleanSounds(null) };
  try {
    const k = JSON.parse(localStorage.getItem(localKey()) || 'null') as { prefs?: unknown; unsaved?: unknown } | null;
    return { prefs: cleanSounds(k?.prefs), unsaved: k?.unsaved === true };
  } catch { return { prefs: cleanSounds(null) }; }
}
function writeLocal(): void {
  if (isDemo() || !userId()) return;
  try { localStorage.setItem(localKey(), JSON.stringify(kept)); } catch { /* private mode: the choice holds until the planner is closed */ }
}
export const SOUND_CACHE = 'planner-sounds';
/** Where the worker looks for the choice: under its own address, so Vijay's and Rosh's planners each have their own. */
export const workerCopyUrl = (): string => new URL(`${pushScope()}sounds.json`, location.origin).href;
async function writeWorkerCopy(): Promise<void> {
  if (isDemo() || typeof caches === 'undefined') return;
  try {
    const c = await caches.open(SOUND_CACHE);
    await c.put(workerCopyUrl(), new Response(JSON.stringify(kept.prefs), { headers: { 'content-type': 'application/json' } }));
  } catch { /* no Cache Storage here: the worker then lets the phone make its sound */ }
}

let kept: Kept = readLocal();
let whose = userId();
let version = 0;
const watchers = new Set<() => void>();
const tell = () => { version++; for (const fn of [...watchers]) fn(); };
export const onSounds = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };
export const soundsVersion = (): number => version;
export const soundPrefs = (): SoundPrefs => kept.prefs;
const mine = () => { if (whose !== userId()) { whose = userId(); kept = readLocal(); } };

/** What was chosen on their other phone (or, if a change here never went up, send that one). */
export async function refreshSounds(): Promise<void> {
  mine();
  if (!userId()) return;
  try {
    if (kept.unsaved) await sendUp();
    else {
      const got = await getDoc<unknown>('prefs', PREFS_KEY);
      if (got) { kept = { prefs: cleanSounds(got) }; writeLocal(); tell(); }
    }
  } catch { /* offline: this phone's copy stands */ }
  await writeWorkerCopy();
}
async function sendUp(): Promise<void> {
  await putDoc('prefs', PREFS_KEY, kept.prefs);
  kept = { prefs: kept.prefs }; writeLocal();
}
/** Change one kind's choice. Shows at once; throws when it couldn't be sent (it is kept here and sent later). */
export async function setChoice(kind: SoundKind, change: Partial<KindChoice>): Promise<void> {
  mine();
  kept = { prefs: { ...kept.prefs, [kind]: { ...kept.prefs[kind], ...change } }, unsaved: true };
  writeLocal(); tell();
  await writeWorkerCopy();
  await sendUp();
}

// ── the sound ──
let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = Ctx ? new Ctx() : null;
  } catch { ctx = null; }
  return ctx;
}
/** Play a sound now: the play buttons (a tap, so the phone allows it). */
export function playSound(id: string): void {
  const c = audio();
  if (!c) return;
  try { void c.resume().catch(() => undefined); playOn(c, id); } catch { /* no sound on this phone */ }
}
const gate = makeGate();
/** Something of this kind arrived while the planner is open: its sound, once. */
export function hear(kind: SoundKind): boolean {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  const sound = kept.prefs[kind].sound;
  // only once the phone has let the sound run (after the first tap): lined up on a stopped clock they'd all play later
  if (!ctx || ctx.state !== 'running' || sound === 'none') return false;
  if (!gate(kind, Date.now())) return false;
  try { playOn(ctx, sound); return true; } catch { return false; }
}

/** Start listening for arrivals (the Shell does, while someone is signed in). Returns the stop. */
export function startSounds(): () => void {
  mine();
  void refreshSounds();
  const wake = () => { const c = audio(); if (c) void c.resume().catch(() => undefined); window.removeEventListener('pointerdown', wake, true); };
  window.addEventListener('pointerdown', wake, true);   // the first tap anywhere, once
  let visibleSince = Date.now(), first = true;
  const seen = new Set<string>();
  const shown = () => { if (document.visibilityState === 'visible') visibleSince = Date.now(); };
  document.addEventListener('visibilitychange', shown);
  const offUs = onUs(() => {
    if (!usLoaded()) return;
    const me = getPass()?.user.username || '';
    const kinds = freshArrivals(usRows(), seen, me, visibleSince, first);
    first = false;
    for (const k of new Set(kinds)) hear(k);
  });
  const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
  const pushed = (e: MessageEvent) => {
    if (e.data?.type !== 'push-arrived') return;
    if (e.data.tag === 'chat') void refreshUs();       // the message sounds when it is in the list
    else hear(kindOfPush(e.data.tag));
  };
  sw?.addEventListener('message', pushed);
  return () => {
    window.removeEventListener('pointerdown', wake, true);
    document.removeEventListener('visibilitychange', shown);
    offUs(); sw?.removeEventListener('message', pushed);
  };
}

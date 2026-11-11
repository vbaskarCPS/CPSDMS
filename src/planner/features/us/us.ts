// src/planner/features/us/us.ts — the chat between the two of them: what's on screen, sending, and Arvy's proposals.
// Messages are planner docs of kind 'chat', shared by the household (read with planner_get, like the shopping list).
// Sending, and everything a message sets off (the push to the other phone, Arvy reading it, its proposals), happens
// in the planner-chat function; this file keeps the list fresh (it asks again every few seconds while the chat is
// open, once a minute otherwise), shows a message the moment it's sent, and makes a confirmed proposal's change with
// the same code Arvy's own changes use (arvy/act.ts). A message can be sent as a reply to another; and messages picked
// out of the chat (select.ts) can be handed to Arvy to do something with, or logged as an idea for the planner.
// No React here.
import { supabase } from '../../../lib/supabase';
import { invoke } from '../../lib/ai';
import { getPass } from '../../lib/auth';
import { isDemo } from '../../lib/app';
import { calendarKey, docsChanged, getDoc, getDocs, putDoc } from '../../lib/docs';
import { prepare } from '../arvy/act';
import { arvyIsOpen, onArvyChange, setArvyOpen } from '../arvy/arvy';
import { entryOf } from '../arvy/log';
import { BUCKET, CHAT_KIND, MAX_IMAGE_BYTES, MAX_MEDIA, MAX_VIDEO_BYTES, addProposals, canConfirm, isKey, plainEmoji, quoteOf, type ChatMsg, type Media, type Proposal, type ReplyTo } from '../../../../supabase/functions/planner-chat/chat';
import { readyImage, readyVideo, type Ready } from './media';
import { ideaFrom } from './select';

/** A message on screen. `sending` = shown before the server has it; `local` = previews of what's being sent. */
export interface Row { key: string; msg: ChatMsg; sending?: boolean; local?: string[] }

let rows: Row[] = [];
let open = false;
let seen = '';                 // when the last message they've seen was sent
let loaded = false;
const watchers = new Set<() => void>();
let version = 0;
const tell = () => { version++; for (const fn of [...watchers]) fn(); };
/** Goes up with every change to the chat (a screen redraws when it does). */
export const usVersion = (): number => version;
export const onUs = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };
export const usRows = (): Row[] => rows;
export const usIsOpen = (): boolean => open;
export const usLoaded = (): boolean => loaded;
const me = () => getPass()?.user.username || '';
/** The other one's first name ("Rosh"), for the title and the notices. */
export const otherName = (username = me()): string => (username === 'rosh' ? 'Vijay' : username === 'vijay' ? 'Rosh' : 'Household');

/** How many messages from the other one haven't been seen. */
export const unreadIn = (list: Row[], username: string, seenAt: string): number => list.filter(r => r.msg.by !== username && r.msg.at > seenAt).length;
export const usUnread = (): number => unreadIn(rows, me(), seen);

/** Fresh messages from the server, with the ones still on their way kept at the end. */
export function mergeRows(have: Row[], got: Row[]): Row[] {
  const keys = new Set(got.map(r => r.msg.id));
  return [...got, ...have.filter(r => r.sending && !keys.has(r.msg.id))].sort((a, b) => a.key.localeCompare(b.key));
}

const since = () => new Date(Date.now() - 45 * 864e5).toISOString();   // the last six weeks
let busy = false;
export async function refreshUs(): Promise<void> {
  if (busy || !getPass()) return;
  busy = true;
  try {
    if (!loaded) seen = (await getDoc<{ at?: string }>('prefs', 'chatseen').catch(() => null))?.at || '';
    const docs = await getDocs<ChatMsg>(CHAT_KIND, since());
    rows = mergeRows(rows, docs.filter(d => d.data && d.data.id && d.data.by).map(d => ({ key: d.key, msg: d.data })));
    loaded = true;
    if (open) markSeen();
    tell();
  } catch { /* offline: what's on screen stays, the next round tries again */ }
  finally { busy = false; }
}
function markSeen(): void {
  const last = [...rows].reverse().find(r => !r.sending && r.msg.by !== me());
  if (!last || last.msg.at <= seen) return;
  seen = last.msg.at;
  void putDoc('prefs', 'chatseen', { at: seen }).catch(() => undefined);
}

// the chat and Arvy share the space above the bar: opening one closes the other
export function setUsOpen(v: boolean): void {
  if (v === open) return;
  open = v;
  if (v) { setArvyOpen(false); markSeen(); void refreshUs(); }
  tell();
  schedule();
}
export const openUs = (): void => setUsOpen(true);
onArvyChange(() => { if (arvyIsOpen() && open) setUsOpen(false); });   // …and Arvy opening closes the chat

// ── keeping it fresh ──
let timer = 0, running = false;
function schedule(): void {
  if (!running) return;
  window.clearTimeout(timer);
  const reading = rows.some(r => r.msg.arvy?.state === 'reading' && Date.now() - Date.parse(r.msg.at) < 90_000);
  timer = window.setTimeout(async () => { if (document.visibilityState === 'visible') await refreshUs(); schedule(); }, open ? (reading ? 2000 : 4000) : 60_000);
}
/** Start keeping the chat fresh (the Shell does, while someone is signed in). Returns the stop. */
export function startUs(): () => void {
  running = true;
  const wake = () => { if (document.visibilityState === 'visible') { void refreshUs(); schedule(); } };
  document.addEventListener('visibilitychange', wake);
  void refreshUs(); schedule();
  return () => { running = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', wake); rows = []; loaded = false; open = false; seen = ''; };
}

// ── photos and videos ──
const links = new Map<string, { url: string; until: number }>();
const asked = new Set<string>();
/** A link to a photo or video, if this phone has one yet (they last an hour); asks for the ones it hasn't. */
export function mediaUrl(path: string): string | undefined {
  const hit = links.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  if (!asked.has(path) && !isDemo()) {
    asked.add(path);
    window.setTimeout(async () => {   // a moment, so every picture on screen is asked for in one go
      const want = [...asked].filter(p => !((links.get(p)?.until || 0) > Date.now()));
      for (const p of want) asked.delete(p);
      try {
        const r = await invoke<{ urls?: Record<string, string> }>({ action: 'media', paths: want }, 'planner-chat');
        for (const [p, url] of Object.entries(r.urls || {})) links.set(p, { url, until: Date.now() + 50 * 60_000 });
        tell();
      } catch { /* the preview stays; a tap asks again */ }
    }, 60);
  }
  return undefined;
}
/** What can't be sent, in words; null when the files are fine. */
export function filesProblem(files: { type: string; size: number }[]): string | null {
  if (files.length > MAX_MEDIA) return `${MAX_MEDIA} photos or videos at a time.`;
  for (const f of files) {
    const video = f.type.startsWith('video/');
    if (!video && !f.type.startsWith('image/')) return 'Photos and videos only.';
    if (video && f.size > MAX_VIDEO_BYTES) return 'That video is too big (50 MB at most). A shorter clip will go through.';
    if (!video && f.size > MAX_IMAGE_BYTES * 4) return 'That photo is too big.';
  }
  return null;
}

/** The quote a reply carries: where the message it answers is, who wrote it and its first line (or what was sent).
 *  null = it can't be replied to yet (it is still on its way). */
export function replyTo(row: Row): ReplyTo | null {
  return row.sending || !isKey(row.key) ? null : { key: row.key, ...(row.msg.name ? { name: row.msg.name } : {}), ...quoteOf(row.msg) };
}

/** Send a message, as a reply to `to` when one is given. It shows straight away; the row is swapped for the saved one
 *  when the server has it. Throws (with the message taken back off the screen) when it couldn't be sent. */
export async function say(text: string, files: File[] = [], to: Row | null = null): Promise<void> {
  const pass = getPass();
  const words = text.trim();
  if (!pass || (!words && !files.length)) return;
  const at = new Date().toISOString(), id = `local-${Math.random().toString(36).slice(2, 9)}`;
  const local = files.map(f => URL.createObjectURL(f));
  const reply = to ? replyTo(to) : null;
  const mine: Row = { key: `${at}~${id}`, sending: true, local, msg: { id, at, by: pass.user.username, name: pass.user.display_name.split(/\s+/)[0], ...(words ? { text: words } : {}),
    ...(files.length ? { media: files.map(f => ({ kind: f.type.startsWith('video/') ? 'video' as const : 'image' as const, path: '' })) } : {}), ...(reply ? { reply } : {}) } };
  rows = [...rows, mine]; tell();
  try {
    let saved: { key: string; msg: ChatMsg };
    if (isDemo()) saved = demoSay(mine.msg);
    else {
      const ready: Ready[] = [];
      for (const f of files) ready.push(f.type.startsWith('video/') ? await readyVideo(f) : await readyImage(f));
      const media: Media[] = [];
      if (ready.length) {
        const up = await invoke<{ files: { kind: 'image' | 'video'; path: string; token: string }[] }>({ action: 'upload', files: ready.map(r => ({ type: r.type, size: r.blob.size })) }, 'planner-chat');
        for (let i = 0; i < ready.length; i++) {
          const r = ready[i], slot = up.files[i];
          const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(slot.path, slot.token, r.blob, { contentType: r.type });
          if (error) throw new Error('A photo or video didn’t upload. Check your connection and try again.');
          media.push({ kind: slot.kind, path: slot.path, ...(r.thumb ? { thumb: r.thumb } : {}), ...(r.seconds ? { seconds: r.seconds } : {}), ...(r.w ? { w: r.w, h: r.h } : {}) });
        }
      }
      // the server is sent where the original is and the copy of it; the name on the quote it puts there itself
      saved = await invoke<{ key: string; msg: ChatMsg }>({ action: 'say', text: words, media, looks: ready.flatMap(r => r.looks).slice(0, 6),
        ...(reply ? { reply: { key: reply.key, ...(reply.text ? { text: reply.text } : {}), ...(reply.media ? { media: reply.media } : {}) } } : {}) }, 'planner-chat');
    }
    rows = rows.map(r => (r === mine || r.msg.id === id ? { key: saved.key, msg: saved.msg, local } : r)).sort((a, b) => a.key.localeCompare(b.key));
    tell(); schedule();
  } catch (e) {
    rows = rows.filter(r => r.msg.id !== id); tell();
    for (const u of local) URL.revokeObjectURL(u);
    throw e instanceof Error ? e : new Error('That didn’t send.');
  }
}

/** Confirm a proposal (the change is then made on this phone) or turn it down. The server says who got there first:
 *  if the other one already answered, nothing is changed here and the message shows what they chose. */
export async function answer(key: string, p: Proposal, how: 'done' | 'dismissed'): Promise<'done' | 'dismissed' | 'taken'> {
  const swap = (msg: ChatMsg) => { rows = rows.map(r => (r.key === key ? { ...r, msg } : r)); tell(); };
  if (how === 'done' && !canConfirm(p, me())) return 'taken';
  const r = isDemo() ? demoResolve(key, p.id, how) : await invoke<{ ok: boolean; msg: ChatMsg }>({ action: 'resolve', key, id: p.id, state: how }, 'planner-chat');
  swap(r.msg);
  if (!r.ok) return 'taken';
  if (how === 'dismissed') return 'dismissed';
  try {
    const change = await prepare(p.tool, p.input);
    if (!change) throw new Error('That can’t be added from here.');
    await change.apply();
    docsChanged(change.kinds);
    return 'done';
  } catch (e) {
    // the change didn't go through: the proposal goes back to waiting
    const back = isDemo() ? demoResolve(key, p.id, 'waiting') : await invoke<{ ok: boolean; msg: ChatMsg }>({ action: 'resolve', key, id: p.id, state: 'waiting' }, 'planner-chat').catch(() => null);
    if (back?.msg) swap(back.msg);
    throw e instanceof Error ? e : new Error('That didn’t save.');
  }
}

// ── messages picked out of the chat (select.ts): ask Arvy about them, or log them as an idea ──
/** What can be asked about picked messages: one of the three ready-made things (a to-do says whose), or their own words. */
export type Asking = { what: 'shopping' | 'calendar' } | { what: 'todo'; for: string } | { what: 'words'; words: string };
const NOT_YET = 'Arvy can’t do that from here yet.';

/** Ask Arvy to do something with the picked messages. Nothing is added here: its proposals land under the last one
 *  picked and wait for a Confirm tap like any other. Returns that message's key, how many proposals it made, and its
 *  note when it had nothing to offer. Throws, in words, when it couldn't. */
export async function askArvy(keys: string[], asking: Asking): Promise<{ key: string; added: number; note?: string }> {
  const picked = [...new Set(keys)].filter(isKey).sort();
  if (!picked.length) throw new Error('Pick a message first.');
  let r: { key?: string; msg?: ChatMsg; added?: number; note?: string } | null;
  try { r = isDemo() ? demoAsk(picked, asking) : await invoke<{ key?: string; msg?: ChatMsg; added?: number; note?: string }>({ action: 'ask', keys: picked, ...asking }, 'planner-chat'); }
  catch (e) { throw /unknown action/i.test(e instanceof Error ? e.message : '') ? new Error(NOT_YET) : e instanceof Error ? e : new Error(NOT_YET); }
  const key = r?.key, msg = r?.msg;
  if (!key || !msg) throw new Error(NOT_YET);   // a server that doesn't know this yet
  rows = rows.map(x => (x.key === key ? { ...x, msg } : x)); tell(); schedule();
  return { key, added: r?.added || 0, ...(r?.note ? { note: r.note } : {}) };
}

/** Log the picked messages as an idea for the planner, in Arvy's improvements log of the person who picked them
 *  (Settings › Arvy's log; arvy/log.ts). Throws when it didn't save. The demo saves nothing. */
export async function logIdea(picked: Row[]): Promise<void> {
  if (!picked.length) throw new Error('Pick a message first.');
  if (isDemo()) return;
  const entry = entryOf(ideaFrom(picked.map(r => r.msg)));
  await putDoc('arvylog', `${entry.at}~${entry.id}`, entry);
}

// ── the demo (/demo): nothing is sent anywhere; "can you get…" shows what Arvy does with a message ──
function demoAsk(keys: string[], a: Asking): { key: string; msg: ChatMsg; added: number; note?: string } | null {
  const picked = rows.filter(r => keys.includes(r.key));
  const last = picked[picked.length - 1];
  if (!last) return null;
  const said = picked.map(r => plainEmoji(quoteOf(r.msg).text || '').replace(/[?.!]+$/, '').trim()).filter(Boolean);
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const id = `p${Math.random().toString(36).slice(2, 8)}`, today = calendarKey();
  const ps: Proposal[] = [];
  if (a.what === 'shopping' && said.length) {
    const items = said.flatMap(t => (t.match(/(?:get|buy|pick up|need|out of)\s+(.+)/i)?.[1] || t).split(/,\s*|\s+and\s+/)).map(t => t.trim()).filter(Boolean).slice(0, 8).map(t => ({ text: cap(t).slice(0, 60) }));
    ps.push({ id, tool: 'add_shopping_items', input: { items }, lines: [`Shopping list: add ${items.map(i => i.text).join(', ')}`], state: 'waiting' });
  } else if (a.what === 'todo' && said.length) {
    ps.push({ id, tool: 'add_todos', for: a.for, input: { todos: [{ text: cap(said[0]).slice(0, 120) }], date: today }, lines: [`To-do for ${a.for === me() ? (getPass()?.user.display_name || 'me').split(/\s+/)[0] : otherName()}: ${cap(said[0]).slice(0, 120)}`], state: 'waiting' });
  } else if (a.what === 'calendar' && said.length) {
    ps.push({ id, tool: 'add_event', input: { title: cap(said[0]).slice(0, 80), date: today, who: 'both' }, lines: [`Calendar: ${cap(said[0]).slice(0, 80)}, today`], state: 'waiting' });
  }
  const next = addProposals(last.msg, ps, a.what === 'words' ? 'In the demo Arvy keeps to the shopping list, a to-do or the calendar.' : undefined);
  return { key: last.key, msg: next.msg, added: next.added.length, ...(next.note ? { note: next.note } : {}) };
}
function demoSay(m: ChatMsg): { key: string; msg: ChatMsg } {
  const id = Math.random().toString(36).slice(2, 8);
  const got = m.text?.match(/(?:get|buy|pick up|need|out of)\s+(.+)/i)?.[1];
  const items = got ? got.replace(/[?.!]+$/, '').split(/,\s*|\s+and\s+/).map(t => t.trim()).filter(Boolean).slice(0, 6).map(t => ({ text: t.charAt(0).toUpperCase() + t.slice(1) })) : [];
  const msg: ChatMsg = { ...m, id, arvy: items.length ? { state: 'done', proposals: [{ id: `p${id}`, tool: 'add_shopping_items', input: { items }, lines: [`Shopping list: add ${items.map(i => i.text).join(', ')}`], state: 'waiting' }] } : { state: 'none' } };
  return { key: `${m.at}~${id}`, msg };
}
function demoResolve(key: string, id: string, state: 'done' | 'dismissed' | 'waiting'): { ok: boolean; msg: ChatMsg } {
  const row = rows.find(r => r.key === key)!;
  const msg: ChatMsg = { ...row.msg, arvy: { ...row.msg.arvy!, proposals: (row.msg.arvy?.proposals || []).map(p => (p.id === id ? { ...p, state, ...(state === 'waiting' ? {} : { by: me(), at: new Date().toISOString() }) } : p)) } };
  return { ok: true, msg };
}

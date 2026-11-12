// src/planner/features/us/us.ts — the chat between the two of them: what's on screen, sending, and Arvy's proposals.
// Messages are planner docs of kind 'chat', shared by the household (read with planner_get, like the shopping list).
// Sending, and everything a message sets off (the push to the other phone, Arvy reading it, its proposals), happens
// in the planner-chat function; this file keeps the list fresh (it asks again every few seconds while the chat is
// open, once a minute otherwise), shows a message the moment it's sent, and makes a confirmed proposal's change with
// the same code Arvy's own changes use (arvy/act.ts). A message can be sent as a reply to another; and messages picked
// out of the chat (select.ts) can be handed to Arvy to do something with, or logged as an idea for the planner.
// A message addressed to Arvy ("RV plan…") gets a real answer in the chat: this phone, the asker's, works it out with
// Arvy's own code (arvy/arvy.ts in chat mode) and posts it through planner-chat as a message from Arvy. That runs
// here and not in the chat screen, so leaving the chat for another screen doesn't lose the answer.
// No React here.
import { supabase } from '../../../lib/supabase';
import { invoke } from '../../lib/ai';
import { getPass } from '../../lib/auth';
import { isDemo } from '../../lib/app';
import { calendarKey, docsChanged, getDoc, getDocs, putDoc } from '../../lib/docs';
import { prepare } from '../arvy/act';
import { NO_CONNECTION, TOOL_LABEL, arvyIsOpen, ask as askTurn, onArvyChange, setArvyOpen } from '../arvy/arvy';
import { entryOf, logArvy } from '../arvy/log';
import type { Pic } from '../arvy/pics';
import { ARVY, ARVY_NAME, ASK_PATIENCE_MS, BUCKET, CHAT_KIND, MAX_IMAGE_BYTES, MAX_MEDIA, MAX_VIDEO_BYTES, OWN_TOOLS, addProposals, canConfirm, canDismiss, isKey, isShared, plainEmoji, quoteOf, toArvy, type ChatMsg, type Media, type Proposal, type ReplyTo } from '../../../../supabase/functions/planner-chat/chat';
import { MAX_PICS, chatOffers } from '../../../../supabase/functions/planner-arvy/tools';
import { askedText } from './asked';
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
    // the demo keeps its chat nowhere: what is on screen is all there is, so it is left as it is
    const docs = isDemo() ? null : await getDocs<ChatMsg>(CHAT_KIND, since());
    if (docs) rows = mergeRows(rows, docs.filter(d => d.data && d.data.id && d.data.by).map(d => ({ key: d.key, msg: d.data })));
    loaded = true;
    if (open) markSeen();
    settleCutShort();
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
  const reading = rows.some(r => (r.msg.arvy?.state === 'reading' && Date.now() - Date.parse(r.msg.at) < 90_000) || (r.msg.ask?.state === 'working' && Date.now() - Date.parse(r.msg.ask.at) < ASK_PATIENCE_MS + 10_000));
  timer = window.setTimeout(async () => { if (document.visibilityState === 'visible') await refreshUs(); schedule(); }, open ? (reading ? 2000 : 4000) : 60_000);
}
/** Start keeping the chat fresh (the Shell does, while someone is signed in). Returns the stop. */
export function startUs(): () => void {
  running = true;
  const wake = () => { if (document.visibilityState === 'visible') { void refreshUs(); schedule(); } };
  document.addEventListener('visibilitychange', wake);
  void refreshUs(); schedule();
  return () => { running = false; window.clearTimeout(timer); document.removeEventListener('visibilitychange', wake); rows = []; loaded = false; open = false; seen = ''; asking.clear(); beat(); };
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
 *  when the server has it. Throws (with the message taken back off the screen) when it couldn't be sent.
 *  A message for Arvy ("RV plan…"; or with `picked`, the keys of messages picked out for it) comes back marked as
 *  asked, and this phone starts on the answer (answerIt). Returns the saved message; nothing when there was none to send. */
export async function say(text: string, files: File[] = [], to: Row | null = null, picked: string[] = []): Promise<Row | undefined> {
  const pass = getPass();
  const words = text.trim();
  if (!pass || (!words && !files.length)) return undefined;
  const at = new Date().toISOString(), id = `local-${Math.random().toString(36).slice(2, 9)}`;
  const local = files.map(f => URL.createObjectURL(f));
  const reply = to ? replyTo(to) : null;
  const mine: Row = { key: `${at}~${id}`, sending: true, local, msg: { id, at, by: pass.user.username, name: pass.user.display_name.split(/\s+/)[0], ...(words ? { text: words } : {}),
    ...(files.length ? { media: files.map(f => ({ kind: f.type.startsWith('video/') ? 'video' as const : 'image' as const, path: '' })) } : {}), ...(reply ? { reply } : {}) } };
  rows = [...rows, mine]; tell();
  try {
    let saved: { key: string; msg: ChatMsg };
    let looks: Pic[] = [];   // what Arvy can look at: the photos, or a video's stills
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
      looks = ready.flatMap(r => r.looks).slice(0, 6);
      // the server is sent where the original is and the copy of it; the name on the quote it puts there itself.
      // `turn` says this app can answer a message addressed to Arvy: the server then leaves that one to this phone
      saved = await invoke<{ key: string; msg: ChatMsg }>({ action: 'say', text: words, media, looks,
        ...(reply ? { reply: { key: reply.key, ...(reply.text ? { text: reply.text } : {}), ...(reply.media ? { media: reply.media } : {}) } } : {}),
        turn: true, ...(picked.length ? { picked } : {}) }, 'planner-chat');
    }
    const row: Row = { key: saved.key, msg: saved.msg, local };
    rows = rows.map(r => (r === mine || r.msg.id === id ? row : r)).sort((a, b) => a.key.localeCompare(b.key));
    tell(); schedule();
    // the server marked it as asked of Arvy: this phone works the answer out, whatever screen they go to next
    if (saved.msg.ask?.state === 'working' && saved.msg.by === pass.user.username) { if (isDemo()) demoAnswer(saved.key); else void answerIt(saved.key, looks.slice(0, MAX_PICS)); }
    return row;
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
  if ((how === 'done' && !canConfirm(p, me())) || (how === 'dismissed' && !canDismiss(p, me()))) return 'taken';
  // a change that isn't one of the three shared kinds: only one Arvy may set up from the chat is ever made from it
  if (how === 'done' && !isShared(p.tool) && (!OWN_TOOLS.includes(p.tool) || !chatOffers(p.tool))) throw new Error('That can’t be done from the chat.');
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

// ── a message addressed to Arvy: this phone works the answer out and posts it in the chat ──
// The server marks such a message as asked (ask.state 'working') and leaves it to the phone that sent it. That phone
// runs Arvy on it with the recent chat for context, then posts what Arvy said (action 'answer'): the server checks,
// cleans and keeps it as a message from Arvy, and tells the other phone. If the try fails, the server is told
// (action 'asked'), so both phones show a plain line and the asker can ask again.
// Which answers this phone is at is also kept on the phone (KEEP_ASKING, with a time that is refreshed while it
// works): one found there with nobody at it any more was cut short (the app was closed), and is settled as failed.
const asking = new Map<string, { step?: string }>();   // the asking message's key → what Arvy is looking at now
const KEEP_ASKING = 'us.asking';
const BEAT_MS = 5000, CUT_SHORT_MS = 20_000;
let beating: ReturnType<typeof setInterval> | null = null;
const kept = (): Record<string, number> => { try { const v = JSON.parse(localStorage.getItem(KEEP_ASKING) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {}; } catch { return {}; } };
const keep = (change: (k: Record<string, number>) => void): void => { try { const k = kept(); change(k); localStorage.setItem(KEEP_ASKING, JSON.stringify(k)); } catch { /* nothing kept on this phone: the other phone's patience covers it */ } };
function beat(): void {
  if (asking.size) keep(k => { for (const key of asking.keys()) k[key] = Date.now(); });
  if (asking.size && !beating) beating = setInterval(beat, BEAT_MS);
  if (!asking.size && beating) { clearInterval(beating); beating = null; }
}
/** Is this phone working out the answer to that message right now, and what is Arvy looking at? */
export const askingNow = (key: string): { step?: string } | undefined => asking.get(key);
const otherUser = (username = me()): string => (username === 'vijay' ? 'rosh' : username === 'rosh' ? 'vijay' : '');
const swapRow = (key: string, msg: ChatMsg): void => {
  rows = rows.some(r => r.key === key) ? rows.map(r => (r.key === key ? { ...r, msg } : r)) : [...rows, { key, msg }].sort((a, b) => a.key.localeCompare(b.key));
};

/** Work out Arvy's answer to the message under `key` and post it in the chat. Never throws: a try that fails leaves a
 *  plain line under the message, with "Ask again". `pics` = what came with the message for Arvy to look at. */
async function answerIt(key: string, pics: Pic[] = []): Promise<void> {
  const pass = getPass(), row = rows.find(r => r.key === key);
  if (!pass || !row || asking.has(key)) return;
  const mine = pass.user.username, first = pass.user.display_name.split(/\s+/)[0];
  asking.set(key, {}); beat(); tell(); schedule();
  let settled = false;   // the server has the outcome (the answer, or that this try gave up)
  try {
    const before = rows.filter(r => !r.sending && r.key < key).map(r => r.msg);
    const picked = (row.msg.ask?.keys || []).map(k => rows.find(r => r.key === k)?.msg).filter((m): m is ChatMsg => !!m);
    const names = { [mine]: first, ...(otherUser(mine) ? { [otherUser(mine)]: otherName(mine) } : {}) };
    const question = askedText({ before, picked, msg: row.msg, names, pictures: pics.length });
    const t = await askTurn([], question, '/us', false, tools => { asking.set(key, { step: tools.map(n => TOOL_LABEL[n] || n).join(', ') }); tell(); },
      pics.length ? { pics, at: row.msg.at } : undefined, { members: Object.keys(names), asked: row.msg.text });
    const r = await invoke<{ key?: string; msg?: ChatMsg; asked?: { key: string; msg: ChatMsg } }>({ action: 'answer', key, text: t.reply, links: t.links || [], sources: t.sources || [], changes: t.proposed || [] }, 'planner-chat');
    if (!r?.key || !r.msg) throw new Error('Arvy’s answer couldn’t be posted.');
    settled = true;
    swapRow(r.key, r.msg);
    if (r.asked?.msg) swapRow(key, r.asked.msg);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (/already answered/i.test(why)) { settled = true; void refreshUs(); }   // another phone of theirs got there first: that answer is the one
    else {
      const now = rows.find(r => r.key === key)?.msg;
      if (now?.ask) swapRow(key, { ...now, ask: { ...now.ask, state: 'failed' } });   // shown at once; the server is told next
      try { const r = await invoke<{ msg?: ChatMsg }>({ action: 'asked', key, state: 'failed' }, 'planner-chat'); settled = true; if (r?.msg) swapRow(key, r.msg); } catch { /* offline: settled when the server can be reached (settleCutShort) */ }
      if (why !== NO_CONNECTION) void logArvy({ type: 'error', title: `Arvy couldn’t answer in the chat: ${why}`.slice(0, 160), question: row.msg.text, path: '/us' });
    }
  } finally {
    asking.delete(key);
    if (settled) keep(k => { delete k[key]; }); else keep(k => { k[key] = 0; });   // not told yet: the next look at the chat does it
    beat(); tell(); schedule();
  }
}

/** Answers this phone started and never finished (the app was closed half-way, or it lost its connection before it
 *  could say so): the server is told they failed, so nobody waits for them. One another window of this phone is
 *  still at has a fresh time on it and is left alone. */
function settleCutShort(): void {
  const k = kept(), now = Date.now();
  for (const key of Object.keys(k)) {
    if (asking.has(key) || now - (Number(k[key]) || 0) < CUT_SHORT_MS) continue;
    keep(x => { delete x[key]; });
    const row = rows.find(r => r.key === key);
    if (row?.msg.by !== me() || row.msg.ask?.state !== 'working') continue;
    void invoke<{ msg?: ChatMsg }>({ action: 'asked', key, state: 'failed' }, 'planner-chat').then(r => { if (r?.msg) { swapRow(key, r.msg); tell(); } }).catch(() => { keep(x => { x[key] = 0; }); });
  }
}

/** "Ask again" under a message Arvy didn't answer: the server marks it as asked once more (only for the one who
 *  wrote it), and this phone starts over. Throws, in words, when it can't. */
export async function askAgain(key: string): Promise<void> {
  if (asking.has(key)) return;
  if (isDemo()) { const row = rows.find(r => r.key === key); if (row?.msg.ask) { swapRow(key, { ...row.msg, ask: { state: 'working', at: new Date().toISOString() } }); tell(); demoAnswer(key); } return; }
  const r = await invoke<{ msg?: ChatMsg }>({ action: 'asked', key, state: 'working' }, 'planner-chat');
  if (!r?.msg) throw new Error('Arvy can’t answer in the chat yet.');
  swapRow(key, r.msg); tell();
  if (r.msg.ask?.state === 'working') void answerIt(key);
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
  // their own words: Arvy answers in the chat, with everything it can do in its own. The words go as a message of
  // theirs (a reply to the last one picked, so both of them see what was asked), and the answer follows it
  if (asking.what === 'words' && !isDemo()) {
    const last = rows.find(x => x.key === picked[picked.length - 1] && !x.sending);
    if (!last) throw new Error('Pick a message first.');
    const sent = await say(asking.words, [], last, picked);
    if (!sent) throw new Error('What should Arvy do with them?');
    if (sent.msg.ask) return { key: sent.key, added: 0 };
    // a server from before this kept it as an ordinary message: asked the way it was until now
  }
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
/** The demo's answer to a message for Arvy: made up, a moment later, with a place to tap and something to confirm. */
function demoAnswer(key: string): void {
  window.setTimeout(() => {
    const row = rows.find(r => r.key === key);
    if (!row?.msg.ask) return;
    const at = new Date().toISOString(), id = Math.random().toString(36).slice(2, 8), today = calendarKey();
    const map = 'https://www.google.com/maps/search/?api=1&query=restaurant%20near%20Hamilton%2C%20Ontario';
    const answer: ChatMsg = { id, at, by: ARVY, name: ARVY_NAME, to: row.msg.by, reply: { key, name: row.msg.name, ...quoteOf(row.msg) },
      text: 'In the demo I can’t look anything up, so this one is made up: Maple Leaf Bistro (a made-up place) would do nicely. In your own planner I look up real places, read your calendar and set things up here for either of you to confirm.',
      links: [{ name: 'Maple Leaf Bistro (demo)', where: '100 Example St, Hamilton', buttons: [{ kind: 'call', url: 'tel:+19055550100' }, { kind: 'book', url: 'https://example.com/book' }, { kind: 'map', url: map }] }],
      arvy: { state: 'done', proposals: [{ id: `p${id}`, tool: 'add_event', input: { title: 'Dinner out', date: today, who: 'both' }, lines: ['Calendar: Dinner out, today'], state: 'waiting' }] } };
    swapRow(key, { ...row.msg, ask: { ...row.msg.ask, state: 'answered', answer: `${at}~${id}` } });
    swapRow(`${at}~${id}`, answer);
    tell();
  }, 1400);
}
function demoSay(m: ChatMsg): { key: string; msg: ChatMsg } {
  const id = Math.random().toString(36).slice(2, 8);
  if (toArvy(m.text)) return { key: `${m.at}~${id}`, msg: { ...m, id, ask: { state: 'working', at: m.at } } };
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

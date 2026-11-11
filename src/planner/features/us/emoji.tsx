// src/planner/features/us/emoji.tsx — the chat's emoji packs: for each occasion (occasions.ts), its smileys
// (smileys.tsx) and its drawings of things (stickers.tsx). They go into a message like any emoji, in among the words;
// a message that is only emoji of ours shows them big.
//
// How one travels: as an ordinary look-alike emoji (🎅 for the Santa-hat face) followed by its name spelled in
// invisible characters (Unicode "tag" characters, the same ones flags like England's are made of) and an invisible
// end mark. So nothing about sending changes: a notification, Arvy and an older copy of the planner show the ordinary
// emoji, and Arvy doesn't take it for words. Here, the name says which of our drawings to show.
// A message that is nothing but one ordinary emoji we have a drawing of (a typed 🎄) is drawn as ours too.
import type { ReactNode } from 'react';
import type { OccasionId } from './occasions';
import { SMILEYS } from './smileys';
import { STICKERS, bare, stickerOf, type StickerDef } from './stickers';

export type EmojiDef = StickerDef;
/** Every emoji of ours, the smileys first. */
export const EMOJI: EmojiDef[] = [...SMILEYS, ...STICKERS];
const BY_ID = new Map(EMOJI.map(e => [e.id, e]));
/** An occasion's pack: its smileys, then its things. */
export const packOf = (occasion: OccasionId): EmojiDef[] => EMOJI.filter(e => e.occasion === occasion);

// ── how one is written into a message ──
const TAG = 0xe0000, END = 0xe007f;
const hidden = (id: string) => [...id].map(c => String.fromCodePoint(TAG + c.charCodeAt(0))).join('') + String.fromCodePoint(END);
const nameIn = (tags: string) => [...tags].map(c => String.fromCharCode(c.codePointAt(0)! - TAG)).join('');
/** What goes into the message for one of ours: the look-alike, marked to show as a picture, then its hidden name. */
export const emojiText = (e: EmojiDef): string => `${bare(e.emoji)}️${hidden(e.id)}`;
// a look-alike, its hidden name, the end mark
const WHOLE = /([^\u{E0000}-\u{E007F}])️?([\u{E0020}-\u{E007E}]+)\u{E007F}/gu;
// …and one that has lost its end mark (a backspace took it): the name is followed by neither more name nor the end
const BROKEN = /([^\u{E0000}-\u{E007F}])️?([\u{E0020}-\u{E007E}]+)(?![\u{E0020}-\u{E007F}])/gu;

/** A message in pieces, in order: words as they are, and each emoji of ours. A hidden name we don't know (a flag, a
 *  pack from a newer copy of the planner) is left alone: it shows as its ordinary emoji. */
export type Part = string | EmojiDef;
export function partsOf(text: string): Part[] {
  const out: Part[] = [];
  const words = (s: string) => { if (!s) return; if (typeof out[out.length - 1] === 'string') out[out.length - 1] += s; else out.push(s); };
  let last = 0;
  for (const m of text.matchAll(WHOLE)) {
    const e = BY_ID.get(nameIn(m[2]));
    if (!e || m[1] !== bare(e.emoji)) continue;
    words(text.slice(last, m.index));
    out.push(e);
    last = m.index! + m[0].length;
  }
  words(text.slice(last));
  return out;
}
/** Has the text one of ours in it? */
export const hasOurs = (text: string): boolean => partsOf(text).some(p => typeof p !== 'string');

/** How big each one is drawn when a message is only emoji of ours: one, two or three, four to six. */
export const bigSize = (n: number): number => (n <= 1 ? 112 : n <= 3 ? 72 : 48);
/** The emoji to draw big, when a message is nothing but ours (six at most, spaces between them allowed) or nothing
 *  but one ordinary emoji we have a drawing of. null = an ordinary message. */
export function bigEmoji(text?: string | null): { list: EmojiDef[]; size: number } | null {
  if (!text) return null;
  const typed = stickerOf(text);
  if (typed) return { list: [typed], size: bigSize(1) };
  const parts = partsOf(text);
  const list = parts.filter((p): p is EmojiDef => typeof p !== 'string');
  if (!list.length || list.length > 6 || parts.some(p => typeof p === 'string' && p.trim())) return null;
  return { list, size: bigSize(list.length) };
}

// ── while a message is being written ──
/** Where typing would land, moved out of the inside of one of ours (its name is invisible, so a caret can sit in it). */
export function caretOutside(text: string, caret: number): number {
  for (const m of text.matchAll(WHOLE)) if (caret > m.index! && caret < m.index! + m[0].length) return m.index! + m[0].length;
  return Math.max(0, Math.min(caret, text.length));
}
/** The draft with one of ours put in at the caret, and where the caret is afterwards. */
export function putIn(text: string, e: EmojiDef, caret = text.length): { text: string; caret: number } {
  const at = caretOutside(text, caret), piece = emojiText(e);
  return { text: text.slice(0, at) + piece + text.slice(at), caret: at + piece.length };
}
/** The text without half an invisible character (a keyboard that deletes half of one at a time leaves the other half). */
function noHalves(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0xdb40) {   // the first half of an invisible character: kept only with its second half
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { out += text[i] + text[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc20 && c <= 0xdc7f) { const before = i ? text.charCodeAt(i - 1) : 0; if (!(before >= 0xd800 && before <= 0xdbff)) continue; }   // a second half on its own
    out += text[i];
  }
  return out;
}
/** The draft after an edit. One backspace on one of ours takes only its invisible end mark, which would leave the
 *  look-alike and an invisible name that takes ten more backspaces: so an emoji of ours that has lost its end goes
 *  whole. `caret` moves with what was taken out. */
export function healDraft(draft: string, caret = draft.length): { text: string; caret: number } {
  const text = noHalves(draft);
  if (text !== draft) caret = Math.min(caret, text.length);
  let out = '', last = 0, at = caret;
  const drop = (from: number, to: number) => { out += text.slice(last, from); last = to; if (caret > from) at -= Math.min(caret, to) - from; };
  for (const m of text.matchAll(BROKEN)) {
    const name = nameIn(m[2]);
    if ([...BY_ID.keys()].some(id => id.startsWith(name))) drop(m.index!, m.index! + m[0].length);
  }
  out += text.slice(last);
  return { text: out, caret: Math.max(0, Math.min(at, out.length)) };
}

// ── drawing them ──
/** One of ours. `still` = no movement (in a line of words, and in the tray: a screenful of moving faces is too much). */
export function Emoji({ e, size = 96, still, inline }: { e: EmojiDef; size?: number | string; still?: boolean; inline?: boolean }) {
  return <svg className={`st${still ? ' st-still' : ''}${inline ? ' st-in' : ''}`} viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={e.name}>{e.art}</svg>;
}
/** A message's words with ours drawn in the line. */
export function EmojiText({ text }: { text: string }): ReactNode {
  return <>{partsOf(text).map((p, i) => (typeof p === 'string' ? p : <Emoji key={i} e={p} size="1.45em" still inline />))}</>;
}

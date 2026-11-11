// src/planner/features/us/select.ts — a finger on a message in the chat: is it a press, a swipe or a scroll; which
// messages are picked; and what Copy and "log it as an idea" make of them. No React here (tested in select.test.ts);
// Us.tsx does the listening and the drawing, us.ts the asking and the saving.
//
// How the three are told apart. A finger comes down on a message and nothing happens yet.
//   - It stays put (within MOVE_SLOP) for HOLD_MS: a press and hold. The message is picked.
//   - It leaves that small circle mostly sideways and to the right: a swipe. The message follows the finger, and
//     letting go past SWIPE_ARM replies to it.
//   - It leaves the circle any other way (up, down, to the left): the list's own scrolling, or nothing. The press is off.
//   - It lifts before any of that: a tap, which does what a tap always did (opens a photo, plays a video).
// The list scrolls up and down by itself (us.css gives a message touch-action: pan-y), so a finger that scrolls never
// gets as far as a swipe, and a swipe never scrolls.
import { MAX_ASK, arvyLine, clip, plainEmoji, quoteOf, quoteWords, type ChatMsg } from '../../../../supabase/functions/planner-chat/chat';

/** Held still this long (ms), a message is picked. A little longer than RV's own hold: a chat is full of slow taps. */
export const HOLD_MS = 420;
/** A finger may wander this far (px) and still be pressing. */
export const MOVE_SLOP = 10;
/** Dragged this far to the right (px), letting go replies; and the furthest a message follows the finger. */
export const SWIPE_ARM = 56;
export const SWIPE_MAX = 84;

export type Finger = 'press' | 'swipe' | 'scroll';
/** What a finger on a message is doing, from how far it has moved (px) since it came down. `was` = what it was a
 *  moment ago: once a swipe, it stays one until it lifts. `canSwipe` is off for a mouse (dragging is how a mouse
 *  marks words) and while messages are being picked. */
export function fingerIs(was: 'press' | 'swipe', dx: number, dy: number, canSwipe = true): Finger {
  if (was === 'swipe') return 'swipe';
  if (Math.abs(dx) <= MOVE_SLOP && Math.abs(dy) <= MOVE_SLOP) return 'press';
  return canSwipe && dx > MOVE_SLOP && dx > Math.abs(dy) * 1.5 ? 'swipe' : 'scroll';
}
/** A message dragged `dx` px to the right: how far it follows the finger, how far along the way to a reply that is
 *  (0 to 1, for the arrow that grows beside it), and whether letting go now replies. */
export function swipeOf(dx: number): { shift: number; pull: number; armed: boolean } {
  const d = Math.max(0, dx - MOVE_SLOP);
  return { shift: Math.min(SWIPE_MAX, Math.round(d)), pull: Math.min(1, Math.round((d / (SWIPE_ARM - MOVE_SLOP)) * 100) / 100), armed: dx >= SWIPE_ARM };
}

// ── which messages are picked ──
/** The picked messages (their keys) after a tap on one: added if it wasn't picked, taken off if it was. Arvy reads
 *  `max` at a time, so no more than that can be picked: the list comes back as it was. */
export function togglePick(picked: string[], key: string, max = MAX_ASK): string[] {
  if (picked.includes(key)) return picked.filter(k => k !== key);
  return picked.length >= max ? picked : [...picked, key];
}
/** The picked rows in the order they were sent. One that is no longer on the screen, or still on its way, is left out. */
export function pickedRows<R extends { key: string; sending?: boolean }>(rows: R[], picked: string[]): R[] {
  return rows.filter(r => !r.sending && picked.includes(r.key));
}
/** What the bar says and offers for `n` picked messages: Reply only when it is exactly one. */
export const barFor = (n: number): { label: string; reply: boolean; about: string } => ({ label: `${n} selected`, reply: n === 1, about: n === 1 ? 'this message' : `these ${n} messages` });

// ── what is made of them ──
type Said = Pick<ChatMsg, 'name' | 'text' | 'media' | 'reply'>;
const wordsOf = (m: Said) => (m.text ? plainEmoji(m.text) : quoteWords(quoteOf(m)));
/** What Copy puts on the clipboard. One message: just its words. Several: a line each, with who said it. The chat's
 *  own emoji go as the ordinary emoji they stand for (their invisible names would only be clutter anywhere else), and
 *  a message with no words says what it was. */
export function copyText(msgs: Said[]): string {
  return msgs.length === 1 ? wordsOf(msgs[0]) : msgs.map(m => `${m.name}: ${wordsOf(m)}`).join('\n');
}
/** What "log it as an idea" writes in Arvy's improvements log (arvy/log.ts): the first words as its title, and every
 *  picked message, with who said it, as the detail. */
export function ideaFrom(msgs: Said[]): { type: 'idea'; title: string; detail: string; path: string; area: string } {
  const first = msgs.map(m => quoteOf(m).text).find(Boolean);
  const title = first ? clip(plainEmoji(first), 120) : msgs.length === 1 ? `a ${quoteWords(quoteOf(msgs[0])).toLowerCase()}` : `${msgs.length} messages`;
  return { type: 'idea', title: `From the chat: ${title}`, detail: msgs.map(arvyLine).join('\n'), path: '/us', area: 'other' };
}

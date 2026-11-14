// src/planner/features/money/accountColor.ts — a colour per account: the one picked on Money › Accounts, or one from
// the palette until then. A transaction row carries it as a line down its left side (.mo-acctline in money.css).
import type { Account } from './types';

/** Each is clear on a white card and on the dark ones (3:1 or better on all of them), and unlike its neighbours. */
export const ACCOUNT_COLORS: string[] = [
  '#3b82f6', '#ea6c0a', '#16a34a', '#ec4899', '#a855f7', '#0d9488',
  '#ef4444', '#7c9a0e', '#0e9bc2', '#a8743c', '#6366f1', '#78839a',
];
const NAMES = ['Blue', 'Orange', 'Green', 'Pink', 'Purple', 'Teal', 'Red', 'Lime', 'Sky blue', 'Brown', 'Indigo', 'Grey'];
/** What to call a palette colour out loud (the swatch buttons); the hex itself for any other. */
export const colorName = (hex: string): string => NAMES[ACCOUNT_COLORS.indexOf(hex.toLowerCase())] || hex;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** A picked colour, when it is one (anything else in the doc is ignored: it goes straight into a style). */
const own = (a: Account): string | null => (typeof a.color === 'string' && HEX.test(a.color.trim()) ? a.color.trim().toLowerCase() : null);
/** Accounts in a fixed order (`order`, then id), so a default doesn't depend on how the list was sorted. */
const inOrder = (all: Account[]) => [...all].sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

/** The account's colour: its own, else the palette colour for its place among the accounts (an account not in the
 *  list yet, like one being added, takes the next place). No two defaults are the same until the palette runs out. */
export function accountColor(a: Account, all: Account[]): string {
  const picked = own(a);
  if (picked) return picked;
  const at = inOrder(all).findIndex(x => x.id === a.id);
  return ACCOUNT_COLORS[(at < 0 ? all.length : at) % ACCOUNT_COLORS.length];
}

/** Account id → colour, for a screen full of rows. */
export function accountColors(all: Account[]): Record<string, string> {
  const out: Record<string, string> = {};
  inOrder(all).forEach((a, i) => { out[a.id] = own(a) || ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]; });
  return out;
}

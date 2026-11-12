// src/planner/features/decor/decor.ts — stickers on a planner page: which pages can be decorated, what is saved, and
// the sums behind placing, moving, resizing, turning and ordering them. No React and nothing from the browser here
// (tested in decor.test.ts); the drawings are in library.ts, the screen side in Layer.tsx and Decorate.tsx.
//
// A sticker is pinned to the page, not the screen: across as a share of the page's width (so it keeps its place on a
// narrower or a wider screen), down as pixels from the top of the page's content (pages are different lengths, and
// what is on them sits at the same height on every phone). Its size is in pixels and its turn in degrees.
// Saved per person and per page as one doc: kind 'decor', key = the page (SectionId), data = Decor.
import type { Profile } from '../../lib/app';

export const DECOR_KIND = 'decor';
/** The most stickers one page takes, and how small and how big one can be (its longer side, px). */
export const MAX_ON_PAGE = 40, MIN_SIZE = 24, MAX_SIZE = 320;

// ── the pages that can be decorated ──
export type SectionId = 'today' | 'plan' | 'calendar' | 'habits' | 'workout' | 'food' | 'cycle' | 'money' | 'shop' | 'health' | 'lifestyle';
export interface Section { id: SectionId; name: string; path: string; morningOnly?: boolean }
/** In the order "Decorate a page" lists them. Cycle is on the morning profile only (Rosh), like its menu tile. */
export const SECTIONS: Section[] = [
  { id: 'today', name: 'Today', path: '/' },
  { id: 'plan', name: 'Plan', path: '/plan' },
  { id: 'calendar', name: 'Calendar', path: '/calendar' },
  { id: 'habits', name: 'Habits', path: '/habits' },
  { id: 'workout', name: 'Train', path: '/workout' },
  { id: 'food', name: 'Food', path: '/food' },
  { id: 'cycle', name: 'Cycle', path: '/cycle', morningOnly: true },
  { id: 'money', name: 'Money', path: '/money' },
  { id: 'shop', name: 'Shopping', path: '/shop' },
  { id: 'health', name: 'Health', path: '/health' },
  { id: 'lifestyle', name: 'Lifestyle', path: '/lifestyle' },
];
export const sectionsFor = (profile: Profile): Section[] => SECTIONS.filter(s => !s.morningOnly || profile === 'morning');
export const sectionById = (id: string): Section | undefined => SECTIONS.find(s => s.id === id);
/** The page a path shows, if it is one that carries stickers: a section's own front page only. The screens inside a
 *  section (/food/add, /plan/brief) are other pages with other things on them, so they carry none. The Plan page for
 *  another day (/plan/2026-11-10) is still the Plan page. */
export function sectionOf(pathname: string): SectionId | null {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return 'today';
  if (parts.length === 2 && parts[0] === 'plan' && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) return 'plan';
  if (parts.length !== 1) return null;
  return SECTIONS.find(s => s.path === `/${parts[0]}`)?.id ?? null;
}
/** How a page is opened for decorating: its own address with this on the end (Layer.tsx reads it). */
export const DECORATE_PARAM = 'decorate';
export const decoratePath = (s: Section): string => `${s.path}?${DECORATE_PARAM}=1`;

// ── what is saved ──
/** One sticker on a page. `art` = a library sticker's id, or 'mine:<key>' for one of the person's own pictures.
 *  `x` = its middle, across, as a share of the page's width (0 to 1); `y` = its middle, px down from the top of the
 *  page's content; `s` = its longer side, px; `r` = its turn, degrees; `under` = tucked behind the page's cards. */
export interface Placed { id: string; art: string; x: number; y: number; s: number; r: number; under?: true }
/** A page's stickers, bottom one first. */
export interface Decor { v: 1; items: Placed[] }
/** A drawing's proportions (any unit): what turns a sticker's size into a width and a height. */
export interface Shape { w: number; h: number }
export interface Point { x: number; y: number }

const MINE = 'mine:';
export const mineArt = (key: string): string => MINE + key;
/** The key of the person's own picture a sticker shows; null for a library sticker. */
export const mineKey = (art: string): string | null => (art.startsWith(MINE) ? art.slice(MINE.length) : null);

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, places: number): number => { const k = 10 ** places; return Math.round(v * k) / k; };
/** A turn brought into -180 (not included) to 180. */
export function turn(deg: number): number {
  const d = round(((deg % 360) + 360) % 360, 1);
  return d > 180 ? round(d - 360, 1) : d;
}
/** A sticker kept within the rules: on the page (its middle never leaves it), a sensible size, a tidy turn.
 *  `floor` = the lowest its middle may sit (px), when the page's length is known. */
export function tidy(p: Placed, floor?: number): Placed {
  const out: Placed = { id: p.id, art: p.art, x: round(clamp(p.x, 0, 1), 4), y: Math.round(clamp(p.y, 0, floor ?? 100_000)), s: Math.round(clamp(p.s, MIN_SIZE, MAX_SIZE)), r: turn(p.r) };
  if (p.under) out.under = true;
  return out;
}
/** Whatever was saved, made safe to draw: anything that isn't a sticker is dropped, numbers are brought within the
 *  rules, two stickers never share an id, and a page never holds more than it may. */
export function readDecor(raw: unknown): Placed[] {
  const list = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(), out: Placed[] = [];
  for (const it of list as Partial<Placed>[]) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id || typeof it.art !== 'string' || !/^[\w:-]{1,80}$/.test(it.art) || seen.has(it.id)) continue;
    if (typeof it.x !== 'number' || typeof it.y !== 'number' || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
    seen.add(it.id);
    out.push(tidy({ id: it.id.slice(0, 24), art: it.art, x: it.x, y: it.y, s: num(it.s, 72), r: num(it.r, 0), ...(it.under === true ? { under: true as const } : {}) }));
    if (out.length === MAX_ON_PAGE) break;
  }
  return out;
}
/** What to save for a page; null (no doc at all) when nothing is on it. */
export const writeDecor = (items: Placed[]): Decor | null => (items.length ? { v: 1, items: items.map(p => tidy(p)) } : null);
export const newId = (): string => Math.random().toString(36).slice(2, 9);

// ── where a sticker is on the screen ──
/** A sticker's width and height in px: its longer side is `s`, the other follows the drawing's shape. */
export function boxOf(s: number, shape: Shape): { w: number; h: number } {
  const long = Math.max(shape.w, shape.h) || 1;
  return { w: (s * shape.w) / long, h: (s * shape.h) / long };
}
/** Where a sticker's middle is drawn, px from the top left of the page's content `width` wide. A page that is shorter
 *  today than when the sticker was put down (`floor`) shows it at its end rather than past it; what is saved stays. */
export function middle(p: Placed, width: number, floor?: number): Point {
  return { x: p.x * width, y: floor === undefined ? p.y : Math.min(p.y, Math.max(0, floor)) };
}
/** The other way: a point on the page (px) as a sticker's saved place. */
export const placeAt = (pt: Point, width: number): { x: number; y: number } => ({ x: width > 0 ? pt.x / width : 0.5, y: pt.y });
/** Half the width and half the height of the upright box a turned sticker fits in. */
function reach(p: Placed, shape: Shape): { hw: number; hh: number } {
  const { w, h } = boxOf(p.s, shape), a = (p.r * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
}
/** Do two stickers overlap on a page this wide? (By the upright boxes they fit in: near enough for ordering.) */
export function overlap(a: Placed, b: Placed, shapeOf: (art: string) => Shape, width: number): boolean {
  const ra = reach(a, shapeOf(a.art)), rb = reach(b, shapeOf(b.art));
  return Math.abs(a.x - b.x) * width < ra.hw + rb.hw && Math.abs(a.y - b.y) < ra.hh + rb.hh;
}

// ── changing what is on a page (each returns a new list; the one passed in is never changed) ──
/** A new sticker on top of the others, its middle at `at`. Null when the page is full. */
export function place(items: Placed[], art: string, at: { x: number; y: number }, s: number, id = newId(), floor?: number): Placed[] | null {
  if (items.length >= MAX_ON_PAGE) return null;
  return [...items, tidy({ id, art, x: at.x, y: at.y, s, r: 0 }, floor)];
}
/** One sticker changed (moved, resized, turned), kept within the rules. */
export function change(items: Placed[], id: string, patch: Partial<Pick<Placed, 'x' | 'y' | 's' | 'r'>>, floor?: number): Placed[] {
  return items.map(p => (p.id === id ? tidy({ ...p, ...patch }, floor) : p));
}
export const remove = (items: Placed[], id: string): Placed[] => items.filter(p => p.id !== id);
/** A copy of a sticker, a little down and to the right of it, on top. Null when the page is full. */
export function copy(items: Placed[], id: string, width: number, newOne = newId(), floor?: number): Placed[] | null {
  const from = items.find(p => p.id === id);
  if (!from || items.length >= MAX_ON_PAGE) return null;
  return [...items, tidy({ ...from, id: newOne, x: from.x + 18 / Math.max(1, width), y: from.y + 18 }, floor)];
}
/** Tucked behind the page's cards, or brought back out in front of them. Either way it goes on top of its new
 *  neighbours, where it can be seen. */
export function tuck(items: Placed[], id: string): Placed[] {
  const p = items.find(q => q.id === id);
  if (!p) return items;
  const next: Placed = { ...p };
  if (p.under) delete next.under; else next.under = true;
  return [...items.filter(q => q.id !== id), next];
}
/** One step up or down among the stickers it overlaps: past the nearest one that covers it (or that it covers).
 *  Stickers tucked behind the cards only trade places with each other, and so do the ones in front. The same list
 *  comes back when there is nothing to step past, so a tap always changes what is seen or does nothing. */
export function restack(items: Placed[], id: string, dir: 'forward' | 'back', overlaps: (a: Placed, b: Placed) => boolean): Placed[] {
  const i = items.findIndex(p => p.id === id);
  if (i < 0) return items;
  const me = items[i], step = dir === 'forward' ? 1 : -1;
  for (let j = i + step; j >= 0 && j < items.length; j += step) {
    const other = items[j];
    if (!!other.under !== !!me.under || !overlaps(me, other)) continue;
    const rest = items.filter(p => p.id !== id), at = rest.indexOf(other) + (dir === 'forward' ? 1 : 0);
    return [...rest.slice(0, at), me, ...rest.slice(at)];
  }
  return items;
}
export const canRestack = (items: Placed[], id: string, dir: 'forward' | 'back', overlaps: (a: Placed, b: Placed) => boolean): boolean => restack(items, id, dir, overlaps) !== items;
/** A page's stickers as they are drawn: the ones tucked behind the cards, and the ones in front. */
export function layers(items: Placed[]): { under: Placed[]; over: Placed[] } {
  return { under: items.filter(p => p.under), over: items.filter(p => !p.under) };
}

// ── the sums behind the handles and two fingers ──
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
/** The direction from one point to another, in degrees (0 = to the right, 90 = down the page). */
export const bearing = (from: Point, to: Point): number => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
/** A corner dragged: the size grows as the finger moves away from the sticker's middle. */
export function sizeFromDrag(startSize: number, middleAt: Point, startAt: Point, nowAt: Point): number {
  const d0 = Math.max(8, dist(middleAt, startAt));
  return Math.round(clamp((startSize * dist(middleAt, nowAt)) / d0, MIN_SIZE, MAX_SIZE));
}
/** Within this many degrees of straight (or a quarter turn), a turned sticker clicks to it. */
export const SNAP_DEG = 4;
/** The turning handle dragged around the sticker's middle. */
export function turnFromDrag(startTurn: number, middleAt: Point, startAt: Point, nowAt: Point): number {
  const r = turn(startTurn + bearing(middleAt, nowAt) - bearing(middleAt, startAt));
  const near = Math.round(r / 90) * 90;
  return Math.abs(r - near) <= SNAP_DEG ? turn(near) : r;
}
/** Two fingers: pinching resizes, twisting turns, and the sticker follows the point between them.
 *  `was` = the sticker's size, turn and middle (px on the page) when the second finger came down; `a0`, `b0` = the
 *  two fingers then; `a`, `b` = now (all in the same px). */
export function pinch(was: { s: number; r: number; at: Point }, a0: Point, b0: Point, a: Point, b: Point): { s: number; r: number; at: Point } {
  const d0 = Math.max(8, dist(a0, b0));
  return {
    s: Math.round(clamp((was.s * dist(a, b)) / d0, MIN_SIZE, MAX_SIZE)),
    r: turn(was.r + bearing(a, b) - bearing(a0, b0)),
    at: { x: was.at.x + (a.x + b.x - a0.x - b0.x) / 2, y: was.at.y + (a.y + b.y - a0.y - b0.y) / 2 },
  };
}
/** A finger this close (px) to the top or the bottom of what can be seen while it drags a sticker scrolls the page,
 *  faster the closer it is: so a sticker can be carried further than one screen. Returns px to scroll this frame. */
export const EDGE = 64, EDGE_SPEED = 14;
export function edgeScroll(y: number, top: number, bottom: number): number {
  if (y < top + EDGE) return -Math.ceil(EDGE_SPEED * clamp((top + EDGE - y) / EDGE, 0, 1));
  if (y > bottom - EDGE) return Math.ceil(EDGE_SPEED * clamp((y - (bottom - EDGE)) / EDGE, 0, 1));
  return 0;
}

// ── the person's own pictures (kind 'decorimg', key = a new id; data = OwnPicture) ──
export const OWN_KIND = 'decorimg';
/** The longer side an own picture is shrunk to, the size it should come in under, and how many a person can keep. */
export const OWN_MAX_SIDE = 512, OWN_MAX_BYTES = 200_000, OWN_MAX = 30;
/** One of the person's own pictures: the picture itself (a data: address, with its see-through parts kept) and its shape. */
export interface OwnPicture { url: string; w: number; h: number; at: string }
/** A picture's width and height shrunk to fit in `side` (never made bigger). */
export function fitWithin(w: number, h: number, side = OWN_MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, side / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
/** The sizes to try, biggest first, until the saved picture is small enough. */
export const OWN_SIDES = [512, 416, 336, 272, 216, 168];
/** About how many bytes a data: address holds. */
export function dataUrlBytes(url: string): number {
  const at = url.indexOf(',');
  return at < 0 ? 0 : /;base64$/i.test(url.slice(0, at)) ? Math.floor(((url.length - at - 1) * 3) / 4) : url.length - at - 1;
}
/** Only a picture we made ourselves is ever shown: a PNG, WebP or JPEG data: address of a sane size. */
export function readOwn(raw: unknown): OwnPicture | null {
  const d = raw as Partial<OwnPicture> | null;
  if (!d || typeof d.url !== 'string' || !/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(d.url) || dataUrlBytes(d.url) > OWN_MAX_BYTES * 3) return null;
  const w = num(d.w, 0), h = num(d.h, 0);
  if (w < 1 || h < 1 || w > 4096 || h > 4096) return null;
  return { url: d.url, w, h, at: typeof d.at === 'string' ? d.at : '' };
}

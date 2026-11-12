// src/planner/features/decor/parts.tsx — what drawing a page's stickers (Layer.tsx) and decorating a page
// (Decorate.tsx) share: the page and our two sheets in it, a sticker as it is drawn, and where the page's content is
// on the screen. Placing is done by decor.css (.dk-at) from two numbers, so a page's stickers are in the right place
// from the first paint, with no measuring.
import type { CSSProperties } from 'react';
import { boxOf, mineKey, type Placed, type Shape } from './decor';
import { artOf, srcOf } from './library';
import { ownPicture } from './store';

/** The page being shown and the two sheets of ours in it. */
export interface Host { main: HTMLElement; under: HTMLElement; over: HTMLElement }

/** What a sticker shows: the picture, its shape and its name. Null when it can't be drawn: one of the person's own
 *  pictures that hasn't arrived yet (or was deleted), or a drawing that is no longer in the library. */
export function pictureOf(art: string): { src: string; shape: Shape; name: string } | null {
  const key = mineKey(art);
  if (key) { const pic = ownPicture(key); return pic ? { src: pic.url, shape: pic, name: 'My own' } : null; }
  const a = artOf(art);
  return a ? { src: srcOf(a), shape: a, name: a.name } : null;
}
/** Where a sticker sits in its sheet and how big and turned it is (decor.css .dk-at does the placing from --x, --y). */
export function spot(p: Placed, shape: Shape, grow = 0, least = 0): CSSProperties {
  const { w, h } = boxOf(p.s, shape);
  return { '--x': p.x, '--y': `${p.y}px`, width: Math.max(least, w + grow), height: Math.max(least, h + grow), transform: `translate(-50%, -50%) rotate(${p.r}deg)` } as CSSProperties;
}
/** The lowest a sticker's middle may sit is this far (px) above the end of the page's content, so that at the end of
 *  the page it is still seen above the bottom bar. (decor.css .dk-at says the same.) */
const LAST = 8;
/** The page's content on the screen right now: its left and top edge and its width (px, on the screen), and the lowest
 *  a sticker's middle may sit (px below the content's top): the end of the page, or of the screen on a short page. */
export function measure(main: HTMLElement): { left: number; top: number; width: number; floor: number; pad: { l: number; r: number; t: number; b: number } } {
  const r = main.getBoundingClientRect(), cs = getComputedStyle(main);
  const pad = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  return { left: r.left + pad.l, top: r.top + pad.t, width: Math.max(1, r.width - pad.l - pad.r), floor: Math.max(r.height, window.innerHeight) - pad.t - pad.b - LAST, pad };
}

/** One sticker as it is seen on the page. */
export function Sticker({ p }: { p: Placed }) {
  const pic = pictureOf(p.art);
  if (!pic) return null;
  return <img className="dk-at dk-s" src={pic.src} alt="" draggable={false} style={spot(p, pic.shape)} />;
}


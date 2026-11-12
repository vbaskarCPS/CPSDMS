// src/planner/features/icons/picture.ts — getting a picture of their own ready to be an icon: which square of it to
// keep (they slide and zoom it on the screen), then that square shrunk to 96 px and kept as a small PNG or WebP, so a
// see-through background stays see-through. Only that small copy is ever saved: the photo they picked never leaves
// the phone. The sums are plain functions (tested in picture.test.ts); the drawing needs a browser.

/** How they have placed the picture: `zoom` 1 = as much of it as fits the square; `x`, `y` = the middle of the
 *  square, as shares of the picture's width and height (0.5, 0.5 = dead centre). */
export interface Fit { zoom: number; x: number; y: number }
export const MAX_ZOOM = 4;
export const CENTRED: Fit = { zoom: 1, x: 0.5, y: 0.5 };
/** The size an icon picture is kept at (px). The bar shows it at 26, a tile at 40: this is sharp on any phone. */
export const ICON_PX = 96;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The square of a `w` × `h` picture to keep, in the picture's own pixels. It never runs off the picture: a fit that
 *  would is pulled back inside. */
export function square(w: number, h: number, fit: Fit): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h) / clamp(fit.zoom || 1, 1, MAX_ZOOM);
  return { side, sx: clamp(fit.x * w - side / 2, 0, w - side), sy: clamp(fit.y * h - side / 2, 0, h - side) };
}

/** The fit after a tidy-up: zoom within its limits and the square back inside the picture. */
export function settle(w: number, h: number, fit: Fit): Fit {
  const zoom = clamp(fit.zoom || 1, 1, MAX_ZOOM), q = square(w, h, { ...fit, zoom });
  return { zoom, x: (q.sx + q.side / 2) / w, y: (q.sy + q.side / 2) / h };
}

/** The fit after the picture is dragged `dx`, `dy` px on a frame `frame` px across (the picture follows the finger). */
export function drag(w: number, h: number, fit: Fit, dx: number, dy: number, frame: number): Fit {
  const per = square(w, h, fit).side / frame;   // picture pixels per screen pixel
  return settle(w, h, { ...fit, x: fit.x - (dx * per) / w, y: fit.y - (dy * per) / h });
}

/** Where to put the whole picture inside a frame `frame` px across so the kept square fills it (for an <img>). */
export function place(w: number, h: number, fit: Fit, frame: number): { width: number; height: number; left: number; top: number } {
  const q = square(w, h, fit), k = frame / q.side;
  return { width: w * k, height: h * k, left: -q.sx * k, top: -q.sy * k };
}

// ── browser only from here ──

/** A picked file opened as a picture: something to draw from, its size, and a link to show it with. `close` lets go of it.
 *  Throws for a file this phone can't open as a picture. */
export interface Opened { source: CanvasImageSource; w: number; h: number; url: string; close: () => void }
export async function openPicture(file: Blob): Promise<Opened> {
  const url = URL.createObjectURL(file);
  try {
    // an <img> turns a photo taken sideways the right way up, and opens everything the phone can show
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((ok, no) => { img.onload = () => ok(); img.onerror = () => no(new Error('not a picture')); img.src = url; });
    if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) throw new Error('empty picture');
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, url, close: () => URL.revokeObjectURL(url) };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

/** The kept square as a small picture (a data: URL): WebP where the phone can make one, PNG otherwise. Both keep a
 *  see-through background. A big photo is brought down in halves first, which keeps it smooth. */
export function makeIcon(p: Pick<Opened, 'source' | 'w' | 'h'>, fit: Fit, px = ICON_PX): string {
  const q = square(p.w, p.h, fit);
  let from: CanvasImageSource = p.source, sx = q.sx, sy = q.sy, side = q.side;
  const canvas = (n: number) => { const c = document.createElement('canvas'); c.width = n; c.height = n; return c; };
  while (side / 2 >= px * 1.5) {
    const half = Math.round(side / 2), c = canvas(half), g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(from, sx, sy, side, side, 0, 0, half, half);
    from = c; sx = 0; sy = 0; side = half;
  }
  const out = canvas(px), g = out.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(from, sx, sy, side, side, 0, 0, px, px);
  const webp = out.toDataURL('image/webp', 0.92);
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
}

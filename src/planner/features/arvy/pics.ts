// src/planner/features/arvy/pics.ts — pictures sent to Arvy with a question (a screenshot of an appointment, a photo
// of a flyer): finding them in what was pasted or dropped, and getting them ready to read (browser only).
// A picture is shrunk to what Arvy can make use of (1568 px on its long side). A long scrolling screenshot would be
// unreadable squeezed into that, so it is cut into pieces from top to bottom instead. Nothing is uploaded or kept:
// the pictures ride along with the question, and the chat keeps only a small preview of each.
import { MAX_PICS } from '../../../../supabase/functions/planner-arvy/tools';

export { MAX_PICS };
/** What Arvy reads: one picture, or one piece of a long one (base64). */
export interface Pic { media_type: string; data: string }
/** One picture they added: its piece or pieces, and a small preview (a data: URL). */
export interface Picked { pics: Pic[]; thumb: string }

const LONG = 1568;   // the most Arvy uses on a picture's long side
const TALL = 2.6;    // taller than this many times its width is a scrolling screenshot: cut into pieces

/** The image files in something pasted or dropped (a screenshot on the clipboard arrives as a file). */
export function imagesFrom(dt: { files?: ArrayLike<File> | null; items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null } | null | undefined): File[] {
  if (!dt) return [];
  const out = Array.from(dt.files || []).filter(f => f.type.startsWith('image/'));
  if (out.length) return out;
  for (const it of Array.from(dt.items || [])) {
    if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

/** Where to cut a picture `w` wide and `h` tall: one piece, unless it's a long scrolling screenshot: then up to
 *  `room` pieces from top to bottom, overlapping a little so a line that falls on a cut is whole in one of them. */
export function slicesFor(w: number, h: number, room = MAX_PICS): { y: number; h: number }[] {
  if (!(w > 0 && h > 0)) return [];
  const n = h / w <= TALL ? 1 : Math.max(1, Math.min(room, Math.ceil(h / (w * 2.2))));
  if (n === 1) return [{ y: 0, h }];
  const overlap = Math.round(w * 0.12);
  const each = Math.ceil((h + overlap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({ y: Math.max(0, Math.min(h - each, i * (each - overlap))), h: each }));
}

/** A picture made ready: shrunk, cut if it's very long, with a small preview. `room` = how many pieces are still free.
 *  Throws for a file this browser can't open as a picture. */
export async function readyPic(file: File, room = MAX_PICS): Promise<Picked> {
  const bmp = await createImageBitmap(file);
  const draw = (sy: number, sh: number, max: number, quality: number): string => {
    const s = Math.min(1, max / Math.max(bmp.width, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(sh * s));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // a see-through picture would turn black as a JPEG
    g.drawImage(bmp, 0, sy, bmp.width, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  };
  try {
    const pics = slicesFor(bmp.width, bmp.height, Math.max(1, room)).map(s => ({ media_type: 'image/jpeg', data: draw(s.y, s.h, LONG, 0.85).split(',')[1] || '' })).filter(p => p.data);
    if (!pics.length) throw new Error('That picture is empty');
    return { pics, thumb: draw(0, Math.min(bmp.height, Math.round(bmp.width * 1.5)), 168, 0.6) };   // the preview: the top of it
  } finally { bmp.close?.(); }
}

/** Can this browser hand over a picture from the clipboard when a button asks for it? */
export const canReadClipboard = (): boolean => typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';
/** The pictures on the clipboard right now ([] when there's none). The browser may ask for permission first, and
 *  throws when it's refused. */
export async function clipboardImages(): Promise<File[]> {
  const out: File[] = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find(t => t.startsWith('image/'));
    if (type) out.push(new File([await item.getType(type)], 'pasted', { type }));
  }
  return out;
}

// src/planner/features/shop/wishPics.ts — a wish's pictures, made ready in the browser: the copy that's kept (long
// side 1200 px, JPEG, under about 200 KB so a list of them stays light), a small square preview that rides along with
// the wish, and reading a screenshot of a product page to fill the form in.
import { readReceipt, shrinkImage } from '../../lib/ai';
import { calendarKey } from '../../lib/docs';
import { SHOT_NOTE, pictureBytes, wishFromRead, type WishDraft } from './wish';

const LONG = 1200;        // the kept picture's long side
const AIM = 200_000;      // bytes: the quality comes down a step at a time until it's under this
const STEPS = [0.82, 0.72, 0.62, 0.5];
const THUMB = 160;        // the preview: a square cut from the middle

/** A picture someone added, ready to save with a wish. */
export interface KeptPic { id: string; thumb: string; dataUrl: string }

/** Shrink a picked or pasted picture to what's kept. Throws for a file this browser can't open as a picture. */
export async function keepPicture(file: File, id: string): Promise<KeptPic> {
  const bmp = await createImageBitmap(file);
  try {
    if (!(bmp.width > 0 && bmp.height > 0)) throw new Error('That picture is empty');
    const draw = (sx: number, sy: number, sw: number, sh: number, w: number, h: number, quality: number): string => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // a see-through picture would turn black as a JPEG
      g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', quality);
    };
    const s = Math.min(1, LONG / Math.max(bmp.width, bmp.height));
    let dataUrl = '';
    for (const q of STEPS) { dataUrl = draw(0, 0, bmp.width, bmp.height, bmp.width * s, bmp.height * s, q); if (pictureBytes(dataUrl) <= AIM) break; }
    // a very busy photo can still be too big at the lowest quality: then it's made a little smaller instead
    for (const less of [0.8, 0.64]) { if (pictureBytes(dataUrl) <= AIM) break; dataUrl = draw(0, 0, bmp.width, bmp.height, bmp.width * s * less, bmp.height * s * less, 0.6); }
    const side = Math.min(bmp.width, bmp.height);
    const thumb = draw((bmp.width - side) / 2, (bmp.height - side) / 2, side, side, Math.min(THUMB, side), Math.min(THUMB, side), 0.6);
    return { id, thumb, dataUrl };
  } finally { bmp.close?.(); }
}

/** Read a screenshot of a product page: the shop, the price and the name, when they can be made out. It asks the
 *  receipt reader (there's no reader just for this), so it's a best guess the person checks before saving. Never
 *  throws: if reading fails, or nothing useful comes back, it's {} and the form opens with just the picture. */
export async function readShot(file: File): Promise<Partial<Pick<WishDraft, 'what' | 'price' | 'shop'>>> {
  try {
    const big = await shrinkImage(file, 1800, 0.85);   // small print needs the detail
    return wishFromRead(await readReceipt([{ base64: big.base64, mediaType: big.mediaType }], ['Shopping', 'Other'], calendarKey(), SHOT_NOTE));
  } catch { return {}; }
}

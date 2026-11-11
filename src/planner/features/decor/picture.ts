// src/planner/features/decor/picture.ts — a picture the person picked from their phone, made into a sticker of their
// own: shrunk to about 512 px on its longer side with its see-through parts kept, and small enough to save as a doc
// (decor.ts: OwnPicture, the sizes and the limit). A PNG is kept as a PNG when that is small enough, since it is
// exact; otherwise WebP where the browser can write it (it keeps see-through parts and is far smaller), and a picture
// with nothing see-through in it (a photo) as a JPEG. Still too big: the next size down.
import { OWN_MAX_BYTES, OWN_SIDES, dataUrlBytes, fitWithin, type OwnPicture } from './decor';

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a picture')); };
    img.src = url;
  });
}

/** The picked file as an own sticker. Throws when the file isn't a picture the browser can open. */
export async function shrinkPicture(file: Blob): Promise<OwnPicture> {
  const img = await load(file);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error('not a picture');
  const canvas = document.createElement('canvas');
  let best: OwnPicture | null = null, lastW = 0;
  for (const side of OWN_SIDES) {
    const { w, h } = fitWithin(w0, h0, side);
    if (w === lastW) continue;   // the picture was never bigger than this: the same try again
    lastW = w;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('not a picture');
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    let solid = true;   // nothing see-through anywhere: a photo
    try { const px = ctx.getImageData(0, 0, w, h).data; for (let i = 3; i < px.length; i += 4 * 7) if (px[i] < 250) { solid = false; break; } } catch { solid = false; }
    const tries = solid ? [canvas.toDataURL('image/jpeg', 0.86)] : [canvas.toDataURL('image/png'), canvas.toDataURL('image/webp', 0.9)];
    for (const url of tries) {
      if (!/^data:image\/(png|webp|jpeg);base64,/.test(url)) continue;
      const pic = { url, w, h, at: new Date().toISOString() };
      if (dataUrlBytes(url) <= OWN_MAX_BYTES) return pic;
      if (!best || dataUrlBytes(url) < dataUrlBytes(best.url)) best = pic;
    }
  }
  if (!best) throw new Error('not a picture');
  return best;   // even the smallest size is over the aim: the smallest we made (readOwn still has its own ceiling)
}

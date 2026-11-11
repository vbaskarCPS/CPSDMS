// src/planner/features/us/media.ts — getting a photo or a video ready to send (browser only).
// A photo is shrunk before it goes up (the phone's 12 MB original isn't needed in a chat). A video goes up as it is;
// from it come a small preview and a few stills, which are all Arvy can look at: it can't watch a video or hear it.
import { shrinkImage } from '../../lib/ai';

export interface Ready {
  kind: 'image' | 'video'; type: string; blob: Blob;
  thumb?: string;                               // a tiny JPEG preview, as a data: URL
  looks: { media_type: string; data: string }[]; // what Arvy reads: the photo, or the video's stills
  seconds?: number; w?: number; h?: number;
}
const blobOf = async (dataUrl: string): Promise<Blob> => (await fetch(dataUrl)).blob();
const b64 = (dataUrl: string) => dataUrl.split(',')[1] || '';

/** A photo: sent at 1600 px at most, read by Arvy at 1280, previewed at 240. */
export async function readyImage(file: File): Promise<Ready> {
  const [big, look, small] = await Promise.all([shrinkImage(file, 1600, 0.85), shrinkImage(file, 1280, 0.8), shrinkImage(file, 240, 0.6)]);
  return { kind: 'image', type: 'image/jpeg', blob: await blobOf(big.dataUrl), thumb: small.dataUrl.length <= 40000 ? small.dataUrl : undefined, looks: [{ media_type: 'image/jpeg', data: look.base64 }] };
}

/** The moments (seconds) to take `n` stills at: spread through the clip, away from its very ends. */
export function stillTimes(seconds: number, n: number): number[] {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return [0];
  const count = Math.max(1, Math.min(n, Math.ceil(seconds)));
  return Array.from({ length: count }, (_, i) => Math.round(((i + 0.5) / count) * seconds * 100) / 100);
}

/** A video: the file itself, a preview and up to `n` stills. A clip this phone can't decode still goes: without stills. */
export async function readyVideo(file: File, n = 4): Promise<Ready> {
  const out: Ready = { kind: 'video', type: file.type || 'video/mp4', blob: file, looks: [] };
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  const wait = (ev: string, ms: number) => new Promise<boolean>(res => {
    const t = window.setTimeout(() => res(false), ms);
    v.addEventListener(ev, () => { window.clearTimeout(t); res(true); }, { once: true });
  });
  try {
    if (!(await wait('loadeddata', 6000)) || !v.videoWidth) return out;
    out.seconds = Number.isFinite(v.duration) ? Math.round(v.duration) : undefined; out.w = v.videoWidth; out.h = v.videoHeight;
    const draw = (max: number, q: number) => {
      const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', q);
    };
    for (const t of stillTimes(v.duration, n)) {
      if (Math.abs(v.currentTime - t) > 0.05) { v.currentTime = t; if (!(await wait('seeked', 3000))) break; }
      if (!out.thumb) { const th = draw(240, 0.6); if (th.length <= 40000) out.thumb = th; }
      out.looks.push({ media_type: 'image/jpeg', data: b64(draw(768, 0.7)) });
    }
  } catch { /* stills are a nicety: the video is still sent */ }
  finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
  return out;
}

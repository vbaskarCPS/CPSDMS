// src/lib/galleryService.ts
//
// Pitch gallery for the H01 map logsheet: ordered "steps" of the prep
// process, each with a title, an optional caption and up to three photos.
//
//   - Steps live in public.gallery_steps, keyed by contractor id.
//   - Photos live in the public-read `gallery` storage bucket under
//     <contractorId>/<uuid>.jpg, resized on the tablet before upload.
//   - Photos are also kept in the browser's Cache API after first load so the
//     pitch still works at a door with no signal (no service worker in this
//     app, so <img> tags are fed object URLs from the cache by hand).

import { supabase } from './supabase';

export const GALLERY_BUCKET = 'gallery';
export const GALLERY_MAX_PHOTOS = 3;
const CACHE_NAME = 'cps-gallery-v1';
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;

export interface GalleryStep {
  id: string;
  contractorId: string;
  title: string;
  caption: string;
  position: number;
  /** Storage paths inside the gallery bucket, in display order. */
  photos: string[];
}

function mapRow(r: any): GalleryStep {
  return {
    id: r.id,
    contractorId: r.contractor_id,
    title: r.title || '',
    caption: r.caption || '',
    position: r.position ?? 0,
    photos: Array.isArray(r.photos) ? r.photos.filter((p: unknown) => typeof p === 'string') : [],
  };
}

function newId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

// ---------------------------------------------------------------------------
// STEPS
// ---------------------------------------------------------------------------
export async function listGallerySteps(contractorId: string): Promise<GalleryStep[]> {
  const { data, error } = await supabase
    .from('gallery_steps')
    .select('*')
    .eq('contractor_id', contractorId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function createGalleryStep(
  contractorId: string,
  input: { title: string; caption?: string; photos: string[] },
  position: number,
): Promise<GalleryStep> {
  const { data, error } = await supabase
    .from('gallery_steps')
    .insert({
      contractor_id: contractorId,
      title: input.title.trim(),
      caption: (input.caption || '').trim() || null,
      position,
      photos: input.photos.slice(0, GALLERY_MAX_PHOTOS),
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateGalleryStep(
  id: string,
  input: { title: string; caption?: string; photos: string[] },
): Promise<GalleryStep> {
  const { data, error } = await supabase
    .from('gallery_steps')
    .update({
      title: input.title.trim(),
      caption: (input.caption || '').trim() || null,
      photos: input.photos.slice(0, GALLERY_MAX_PHOTOS),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

/** Deletes the row and its photos. Photo removal is best-effort. */
export async function deleteGalleryStep(step: GalleryStep): Promise<void> {
  const { error } = await supabase.from('gallery_steps').delete().eq('id', step.id);
  if (error) throw error;
  if (step.photos.length) {
    const { error: sErr } = await supabase.storage.from(GALLERY_BUCKET).remove(step.photos);
    if (sErr) console.warn('[Gallery] photo cleanup failed', sErr.message);
  }
}

/** Persists a new order: positions 0..n-1 in the order given. */
export async function reorderGallerySteps(steps: GalleryStep[]): Promise<void> {
  const updates = steps.map((s, i) =>
    s.position === i ? null : supabase.from('gallery_steps').update({ position: i }).eq('id', s.id),
  ).filter(Boolean);
  const results = await Promise.all(updates as any[]);
  const failed = results.find((r: any) => r?.error);
  if (failed) throw failed.error;
}

// ---------------------------------------------------------------------------
// PHOTOS
// ---------------------------------------------------------------------------
export function galleryPublicUrl(path: string): string {
  return supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Shrinks a tablet photo to ≤ MAX_EDGE_PX on the long edge, JPEG. Falls back
 *  to the original file if the browser can't decode it. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await (async () => {
    try { return await createImageBitmap(file); } catch { return null; }
  })();
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  return blob || file;
}

/** Resize + upload. Returns the storage path to keep on the step. */
export async function uploadGalleryPhoto(contractorId: string, file: File): Promise<string> {
  const blob = await shrinkImage(file);
  const path = `${contractorId}/${newId()}.jpg`;
  const { error } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

export async function deleteGalleryPhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(GALLERY_BUCKET).remove([path]);
  if (error) console.warn('[Gallery] photo delete failed', error.message);
}

// ---------------------------------------------------------------------------
// OFFLINE CACHE — object URLs served from the Cache API when there's no signal
// ---------------------------------------------------------------------------
const objectUrls = new Map<string, string>();

/** Resolves a photo to a displayable URL: cached blob first, else network
 *  (and cache it for next time), else the plain public URL as a last resort. */
export async function resolveGalleryImage(path: string): Promise<string> {
  const url = galleryPublicUrl(path);
  const known = objectUrls.get(path);
  if (known) return known;
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE_NAME); } catch { cache = null; }
  try {
    const hit = cache ? await cache.match(url) : undefined;
    if (hit) {
      const obj = URL.createObjectURL(await hit.blob());
      objectUrls.set(path, obj);
      return obj;
    }
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return url;
    if (cache) { try { await cache.put(url, res.clone()); } catch { /* quota / opaque — ignore */ } }
    const obj = URL.createObjectURL(await res.blob());
    objectUrls.set(path, obj);
    return obj;
  } catch {
    return url;
  }
}

/** Warm the cache for every photo in the gallery (best-effort, in background). */
export function warmGalleryCache(steps: GalleryStep[]): void {
  const paths = steps.flatMap(s => s.photos);
  paths.forEach(p => { resolveGalleryImage(p).catch(() => {}); });
}

/** Drop a removed photo from the cache so it doesn't linger. */
export async function evictGalleryImage(path: string): Promise<void> {
  const obj = objectUrls.get(path);
  if (obj) { URL.revokeObjectURL(obj); objectUrls.delete(path); }
  try { const c = await caches.open(CACHE_NAME); await c.delete(galleryPublicUrl(path)); } catch { /* ignore */ }
}

// src/pages/MapLogsheet/GallerySheet.tsx
//
// Full-screen pitch gallery for the H01 map logsheet.
//
//   View  — one step per screen (title, 1–3 photos, optional caption), swipe or
//           arrows to move, thumbnail strip to jump. This is the at-the-door mode.
//   Setup — the list of steps: add, edit, move up/down, delete.
//   Edit  — one step's form: title, caption, up to three photos.
//
// Photos come through galleryService's cache so the pitch works offline once
// it has been opened online at least once.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Settings, Plus, ArrowUp, ArrowDown, Pencil, Trash2, Loader, ImagePlus, Images, AlertCircle } from 'lucide-react';
import {
  GalleryStep, GALLERY_MAX_PHOTOS,
  listGallerySteps, createGalleryStep, updateGalleryStep, deleteGalleryStep, reorderGallerySteps,
  uploadGalleryPhoto, deleteGalleryPhoto, resolveGalleryImage, warmGalleryCache, evictGalleryImage,
} from '../../lib/galleryService';

interface GallerySheetProps {
  contractorId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Photo — resolves a storage path to a (cached) URL and renders it
// ---------------------------------------------------------------------------
const Photo: React.FC<{ path: string; className?: string; contain?: boolean }> = ({ path, className, contain }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(null); setFailed(false);
    resolveGalleryImage(path).then(u => { if (alive) setSrc(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path]);
  if (failed) {
    return <div className={`bg-gray-800 flex items-center justify-center text-gray-500 ${className || ''}`}><AlertCircle size={18} /></div>;
  }
  if (!src) {
    return <div className={`bg-gray-800 flex items-center justify-center ${className || ''}`}><Loader size={18} className="animate-spin text-gray-500" /></div>;
  }
  return <img src={src} alt="" className={`${contain ? 'object-contain' : 'object-cover'} ${className || ''}`} onError={() => setFailed(true)} draggable={false} />;
};

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------
const GallerySheet: React.FC<GallerySheetProps> = ({ contractorId, onClose }) => {
  const [steps, setSteps] = useState<GalleryStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'setup' | 'edit'>('view');
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // Edit form
  const [editing, setEditing] = useState<GalleryStep | null>(null); // null = new step
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Photos uploaded during this edit that must be removed if the user cancels.
  const orphansRef = useRef<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await listGallerySteps(contractorId);
      setSteps(list);
      warmGalleryCache(list);
      setIndex(i => Math.min(i, Math.max(0, list.length - 1)));
    } catch (err) {
      console.error('[Gallery] load failed', err);
      setError('Could not load the gallery.');
    } finally {
      setLoading(false);
    }
  }, [contractorId]);

  useEffect(() => { load(); }, [load]);

  // --- swipe (view mode) ---
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) setIndex(i => Math.min(i + 1, steps.length - 1));
    else setIndex(i => Math.max(i - 1, 0));
  };

  // --- edit helpers ---
  const openEdit = (step: GalleryStep | null) => {
    setEditing(step);
    setTitle(step?.title || '');
    setCaption(step?.caption || '');
    setPhotos(step?.photos || []);
    orphansRef.current = [];
    setMode('edit');
  };

  const cancelEdit = async () => {
    const orphans = orphansRef.current;
    orphansRef.current = [];
    setMode('setup');
    for (const p of orphans) { deleteGalleryPhoto(p).catch(() => {}); evictGalleryImage(p).catch(() => {}); }
  };

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const room = GALLERY_MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const f of files.slice(0, room)) {
        const path = await uploadGalleryPhoto(contractorId, f);
        added.push(path);
        orphansRef.current.push(path);
        resolveGalleryImage(path).catch(() => {});
      }
      setPhotos(prev => [...prev, ...added].slice(0, GALLERY_MAX_PHOTOS));
    } catch (err) {
      console.error('[Gallery] upload failed', err);
      setError('Upload failed — check your signal and try again.');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (path: string) => {
    setPhotos(prev => prev.filter(p => p !== path));
    // A photo that was already saved on the step is deleted at Save time; one
    // uploaded during this edit can go now.
    if (orphansRef.current.includes(path)) {
      orphansRef.current = orphansRef.current.filter(p => p !== path);
      deleteGalleryPhoto(path).catch(() => {});
      evictGalleryImage(path).catch(() => {});
    }
  };

  const saveEdit = async () => {
    if (!title.trim()) { setError('Give the step a title.'); return; }
    setBusy(true); setError(null);
    try {
      if (editing) {
        const removed = editing.photos.filter(p => !photos.includes(p));
        await updateGalleryStep(editing.id, { title, caption, photos });
        for (const p of removed) { deleteGalleryPhoto(p).catch(() => {}); evictGalleryImage(p).catch(() => {}); }
      } else {
        await createGalleryStep(contractorId, { title, caption, photos }, steps.length);
      }
      orphansRef.current = [];
      await load();
      setMode('setup');
    } catch (err) {
      console.error('[Gallery] save failed', err);
      setError('Could not save — try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeStep = async (step: GalleryStep) => {
    if (!window.confirm(`Delete "${step.title}" and its photos?`)) return;
    setBusy(true); setError(null);
    try {
      await deleteGalleryStep(step);
      step.photos.forEach(p => evictGalleryImage(p).catch(() => {}));
      const rest = steps.filter(s => s.id !== step.id);
      await reorderGallerySteps(rest);
      await load();
    } catch (err) {
      console.error('[Gallery] delete failed', err);
      setError('Could not delete — try again.');
    } finally {
      setBusy(false);
    }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next.map((s, k) => ({ ...s, position: k })));
    setBusy(true);
    try { await reorderGallerySteps(next); }
    catch (err) { console.error('[Gallery] reorder failed', err); setError('Could not reorder — try again.'); await load(); }
    finally { setBusy(false); }
  };

  const current = steps[index] || null;

  // ---------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-black/95">
        <div className="flex items-center gap-2 min-w-0">
          <Images size={18} className="text-yellow-300 shrink-0" />
          <span className="text-white font-bold text-base truncate">
            {mode === 'view' ? 'Gallery' : mode === 'setup' ? 'Gallery setup' : (editing ? 'Edit step' : 'New step')}
          </span>
          {mode === 'view' && steps.length > 0 && (
            <span className="text-xs text-gray-500 font-mono">{index + 1}/{steps.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mode === 'view' && (
            <button
              type="button"
              onClick={() => setMode('setup')}
              className="px-3 h-9 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-bold flex items-center gap-1.5 active:bg-gray-700"
            >
              <Settings size={14} /> Setup
            </button>
          )}
          {mode === 'setup' && (
            <button
              type="button"
              onClick={() => setMode('view')}
              className="px-3 h-9 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-bold active:bg-gray-700"
            >
              Done
            </button>
          )}
          {mode !== 'edit' && (
            <button type="button" onClick={onClose} className="p-2 text-gray-400 active:text-white" aria-label="Close"><X size={22} /></button>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800 text-red-200 text-xs flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-300"><X size={14} /></button>
        </div>
      )}

      {/* ── VIEW ── */}
      {mode === 'view' && (
        loading ? (
          <div className="flex-1 flex items-center justify-center"><Loader className="animate-spin text-gray-500" /></div>
        ) : steps.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3 text-gray-400">
            <Images size={40} className="opacity-30" />
            <p className="text-sm">No steps yet. Tap <span className="text-white font-bold">Setup</span> to build your pitch.</p>
            <button type="button" onClick={() => openEdit(null)} className="px-4 py-2.5 rounded-lg bg-yellow-500 text-black text-sm font-bold flex items-center gap-2"><Plus size={16} /> Add first step</button>
          </div>
        ) : current && (
          <>
            <div className="flex-1 min-h-0 flex flex-col" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <div className="shrink-0 px-4 pt-3 pb-2">
                <h2 className="text-white font-bold text-2xl leading-tight">{current.title}</h2>
                {current.caption && <p className="text-gray-300 text-sm mt-1">{current.caption}</p>}
              </div>
              <div className={`flex-1 min-h-0 px-2 pb-2 grid gap-2 ${
                current.photos.length <= 1 ? 'grid-cols-1' : current.photos.length === 2 ? 'grid-cols-1 landscape:grid-cols-2' : 'grid-cols-1 landscape:grid-cols-3'
              }`}>
                {current.photos.length === 0 ? (
                  <div className="rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-600 text-sm">No photos on this step</div>
                ) : current.photos.map(p => (
                  <div key={p} className="min-h-0 rounded-xl overflow-hidden bg-gray-900 border border-gray-800">
                    <Photo path={p} className="w-full h-full" contain />
                  </div>
                ))}
              </div>
            </div>

            {/* Nav + thumbnails */}
            <div className="shrink-0 border-t border-gray-800 bg-black/95 px-2 py-2 flex items-center gap-2">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex(i => Math.max(0, i - 1))}
                className="w-11 h-11 rounded-full bg-gray-800 border border-gray-700 text-white flex items-center justify-center disabled:opacity-30 active:bg-gray-700 shrink-0"
                aria-label="Previous"
              ><ChevronLeft size={22} /></button>
              <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto custom-scrollbar py-1">
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 ${i === index ? 'border-yellow-400' : 'border-gray-700 opacity-70'}`}
                    title={s.title}
                  >
                    {s.photos[0]
                      ? <Photo path={s.photos[0]} className="w-full h-full" />
                      : <div className="w-full h-full bg-gray-800 text-[10px] text-gray-400 flex items-center justify-center px-1 text-center leading-tight">{s.title}</div>}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={index >= steps.length - 1}
                onClick={() => setIndex(i => Math.min(steps.length - 1, i + 1))}
                className="w-11 h-11 rounded-full bg-gray-800 border border-gray-700 text-white flex items-center justify-center disabled:opacity-30 active:bg-gray-700 shrink-0"
                aria-label="Next"
              ><ChevronRight size={22} /></button>
            </div>
          </>
        )
      )}

      {/* ── SETUP (list) ── */}
      {mode === 'setup' && (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2">
          {steps.length === 0 && !loading && (
            <p className="text-sm text-gray-500 text-center py-6">No steps yet. Add the parts of your prep process in the order you pitch them.</p>
          )}
          {steps.map((s, i) => (
            <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-xl p-2 flex items-center gap-2">
              <div className="flex gap-1 shrink-0">
                {(s.photos.length ? s.photos : [null]).map((p, k) => (
                  <div key={k} className="w-12 h-12 rounded-md overflow-hidden bg-gray-800">
                    {p ? <Photo path={p} className="w-full h-full" /> : <div className="w-full h-full flex items-center justify-center text-gray-600"><ImagePlus size={14} /></div>}
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-bold text-sm truncate"><span className="text-gray-500 font-mono mr-1">{i + 1}.</span>{s.title}</div>
                {s.caption && <div className="text-[11px] text-gray-400 truncate">{s.caption}</div>}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} className="p-1.5 rounded bg-gray-800 text-gray-300 disabled:opacity-30"><ArrowUp size={14} /></button>
                <button type="button" disabled={busy || i === steps.length - 1} onClick={() => move(i, 1)} className="p-1.5 rounded bg-gray-800 text-gray-300 disabled:opacity-30"><ArrowDown size={14} /></button>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button type="button" disabled={busy} onClick={() => openEdit(s)} className="p-1.5 rounded bg-gray-800 text-blue-300 disabled:opacity-30"><Pencil size={14} /></button>
                <button type="button" disabled={busy} onClick={() => removeStep(s)} className="p-1.5 rounded bg-gray-800 text-red-400 disabled:opacity-30"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => openEdit(null)}
            className="w-full py-3.5 rounded-xl bg-yellow-500 text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Plus size={18} /> Add step
          </button>
        </div>
      )}

      {/* ── EDIT (one step) ── */}
      {mode === 'edit' && (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Crack filling"
              disabled={busy}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-base focus:outline-none focus:border-cps-blue"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Caption <span className="text-gray-600 font-normal">— optional talking point</span></label>
            <input
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="e.g. Hot rubber fill stops water getting under the surface"
              disabled={busy}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-cps-blue"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Photos <span className="text-gray-600 font-normal">— up to {GALLERY_MAX_PHOTOS}</span></label>
            <div className="grid grid-cols-3 gap-2">
              {photos.map(p => (
                <div key={p} className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 border border-gray-700">
                  <Photo path={p} className="w-full h-full" />
                  <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={() => removePhoto(p)}
                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center"
                    aria-label="Remove photo"
                  ><X size={14} /></button>
                </div>
              ))}
              {photos.length < GALLERY_MAX_PHOTOS && (
                <button
                  type="button"
                  disabled={busy || uploading}
                  onClick={() => fileRef.current?.click()}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-700 text-gray-400 flex flex-col items-center justify-center gap-1 text-xs disabled:opacity-50"
                >
                  {uploading ? <Loader size={18} className="animate-spin" /> : <ImagePlus size={20} />}
                  {uploading ? 'Uploading…' : 'Add photo'}
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
            <p className="text-[11px] text-gray-500 mt-1">Photos are shrunk before upload, so they're quick even on route signal.</p>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" disabled={busy || uploading} onClick={cancelEdit} className="flex-1 py-3 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 font-bold text-sm disabled:opacity-50">Cancel</button>
            <button type="button" disabled={busy || uploading} onClick={saveEdit} className="flex-1 py-3 rounded-xl bg-yellow-500 text-black font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {busy ? <Loader size={16} className="animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GallerySheet;

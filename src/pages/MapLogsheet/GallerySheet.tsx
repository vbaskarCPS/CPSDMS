// src/pages/MapLogsheet/GallerySheet.tsx
//
// Full-screen pitch gallery for the H01 map logsheet.
//
//   View  — the list of steps (cover photo + title). Tap one to open it.
//   Show  — one photo at a time, full screen, pinch/double-tap to zoom, swipe
//           to the next photo and on into the next step. The at-the-door mode.
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
// ZoomableImage — pinch / double-tap zoom, drag to pan, swipe when not zoomed
// ---------------------------------------------------------------------------
const MAX_ZOOM = 4;
const ZoomableImage: React.FC<{ path: string; onSwipe: (dir: -1 | 1) => void; onTap?: () => void }> = ({ path, onSwipe, onTap }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  // gesture state
  const start = useRef<{ x: number; y: number; t: number; s: number; tx: number; ty: number; dist: number; two: boolean; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    let alive = true;
    setSrc(null); setFailed(false); setT({ s: 1, x: 0, y: 0 });
    resolveGalleryImage(path).then(u => { if (alive) setSrc(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path]);

  const dist = (a: React.Touch, b: React.Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const mid = (a: React.Touch, b: React.Touch) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

  const onTouchStart = (e: React.TouchEvent) => {
    const cur = tRef.current;
    if (e.touches.length === 2) {
      const m = mid(e.touches[0], e.touches[1]);
      start.current = { x: m.x, y: m.y, t: Date.now(), s: cur.s, tx: cur.x, ty: cur.y, dist: dist(e.touches[0], e.touches[1]), two: true, moved: false };
    } else if (e.touches.length === 1) {
      const p = e.touches[0];
      start.current = { x: p.clientX, y: p.clientY, t: Date.now(), s: cur.s, tx: cur.x, ty: cur.y, dist: 0, two: false, moved: false };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const st = start.current; if (!st) return;
    if (e.touches.length === 2 && st.two) {
      const d = dist(e.touches[0], e.touches[1]);
      const m = mid(e.touches[0], e.touches[1]);
      const s = Math.min(MAX_ZOOM, Math.max(1, st.s * (d / Math.max(st.dist, 1))));
      st.moved = true;
      setT({ s, x: s === 1 ? 0 : st.tx + (m.x - st.x), y: s === 1 ? 0 : st.ty + (m.y - st.y) });
    } else if (e.touches.length === 1 && !st.two) {
      const p = e.touches[0];
      const dx = p.clientX - st.x, dy = p.clientY - st.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) st.moved = true;
      if (st.s > 1) setT({ s: st.s, x: st.tx + dx, y: st.ty + dy });
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = start.current; if (!st) return;
    if (e.touches.length > 0) { start.current = null; return; } // a finger is still down (end of pinch)
    start.current = null;
    if (st.two) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - st.x, dy = p.clientY - st.y;
    if (!st.moved) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // double tap: toggle zoom around the tap point
        lastTap.current = 0;
        setT(prev => prev.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: (window.innerWidth / 2 - p.clientX) * 1.5, y: (window.innerHeight / 2 - p.clientY) * 1.5 });
      } else {
        lastTap.current = now;
        onTap?.();
      }
      return;
    }
    if (st.s === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) onSwipe(dx < 0 ? 1 : -1);
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden touch-none select-none flex items-center justify-center bg-black"
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { start.current = null; }}
    >
      {failed ? (
        <div className="text-gray-500 flex flex-col items-center gap-2"><AlertCircle size={24} /><span className="text-xs">Photo unavailable offline</span></div>
      ) : !src ? (
        <Loader size={24} className="animate-spin text-gray-500" />
      ) : (
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="max-w-full max-h-full object-contain will-change-transform"
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})`, transition: start.current ? 'none' : 'transform 120ms ease-out' }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------
const GallerySheet: React.FC<GallerySheetProps> = ({ contractorId, onClose }) => {
  const [steps, setSteps] = useState<GalleryStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'show' | 'setup' | 'edit'>('view');
  const [index, setIndex] = useState(0);       // step being shown
  const [photoIdx, setPhotoIdx] = useState(0); // photo within that step
  const [chrome, setChrome] = useState(true);  // overlays visible in show mode
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

  // --- show mode navigation: through this step's photos, then into the next step ---
  const openStep = (i: number) => { setIndex(i); setPhotoIdx(0); setChrome(true); setMode('show'); };
  const stepPhotos = (i: number) => steps[i]?.photos || [];
  const go = (dir: -1 | 1) => {
    const n = stepPhotos(index).length;
    if (dir === 1) {
      if (photoIdx < n - 1) setPhotoIdx(photoIdx + 1);
      else if (index < steps.length - 1) { setIndex(index + 1); setPhotoIdx(0); }
    } else {
      if (photoIdx > 0) setPhotoIdx(photoIdx - 1);
      else if (index > 0) { const prev = index - 1; setIndex(prev); setPhotoIdx(Math.max(0, stepPhotos(prev).length - 1)); }
    }
  };
  const atStart = index === 0 && photoIdx === 0;
  const atEnd = index >= steps.length - 1 && photoIdx >= stepPhotos(index).length - 1;

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
      {/* Header (not in show mode — that has its own overlay) */}
      {mode !== 'show' && (
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-black/95">
        <div className="flex items-center gap-2 min-w-0">
          <Images size={18} className="text-yellow-300 shrink-0" />
          <span className="text-white font-bold text-base truncate">
            {mode === 'view' ? 'Gallery' : mode === 'setup' ? 'Gallery setup' : (editing ? 'Edit step' : 'New step')}
          </span>
          {mode === 'view' && steps.length > 0 && (
            <span className="text-xs text-gray-500 font-mono">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
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
      )}

      {error && (
        <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800 text-red-200 text-xs flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-300"><X size={14} /></button>
        </div>
      )}

      {/* ── VIEW (step list) ── */}
      {mode === 'view' && (
        loading ? (
          <div className="flex-1 flex items-center justify-center"><Loader className="animate-spin text-gray-500" /></div>
        ) : steps.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3 text-gray-400">
            <Images size={40} className="opacity-30" />
            <p className="text-sm">No steps yet. Tap <span className="text-white font-bold">Setup</span> to build your pitch.</p>
            <button type="button" onClick={() => openEdit(null)} className="px-4 py-2.5 rounded-lg bg-yellow-500 text-black text-sm font-bold flex items-center gap-2"><Plus size={16} /> Add first step</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 grid grid-cols-2 gap-3 content-start">
            {steps.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openStep(i)}
                className="text-left rounded-xl overflow-hidden bg-gray-900 border border-gray-800 active:border-yellow-400"
              >
                <div className="aspect-[4/3] bg-gray-800">
                  {s.photos[0]
                    ? <Photo path={s.photos[0]} className="w-full h-full" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-600"><Images size={24} /></div>}
                </div>
                <div className="px-2.5 py-2">
                  <div className="text-white font-bold text-sm truncate"><span className="text-gray-500 font-mono mr-1">{i + 1}.</span>{s.title}</div>
                  <div className="text-[11px] text-gray-500">{s.photos.length} photo{s.photos.length === 1 ? '' : 's'}</div>
                </div>
              </button>
            ))}
          </div>
        )
      )}

      {/* ── SHOW (one photo, full screen) ── */}
      {mode === 'show' && current && (
        <div className="flex-1 relative min-h-0">
          {current.photos.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">No photos on this step</div>
          ) : (
            <ZoomableImage
              key={`${current.id}:${photoIdx}`}
              path={current.photos[photoIdx]}
              onSwipe={go}
              onTap={() => setChrome(c => !c)}
            />
          )}

          {/* Top overlay: step title, counter, back */}
          <div className={`absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 to-transparent px-3 pt-2 pb-8 flex items-start gap-2 transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button type="button" onClick={() => setMode('view')} className="p-2 -ml-1 text-white shrink-0" aria-label="Back to steps"><ChevronLeft size={24} /></button>
            <div className="flex-1 min-w-0 pt-1.5">
              <div className="text-white font-bold text-lg leading-tight truncate">
                <span className="text-yellow-300 font-mono mr-1.5">{index + 1}/{steps.length}</span>{current.title}
              </div>
              {current.photos.length > 1 && (
                <div className="text-[11px] text-gray-300">photo {photoIdx + 1} of {current.photos.length}</div>
              )}
            </div>
            <button type="button" onClick={onClose} className="p-2 -mr-1 text-white shrink-0" aria-label="Close"><X size={24} /></button>
          </div>

          {/* Bottom overlay: caption, dots, prev/next */}
          <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-3 pb-3 pt-10 transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            {current.caption && <p className="text-white text-sm mb-2 leading-snug">{current.caption}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={atStart}
                onClick={() => go(-1)}
                className="w-11 h-11 rounded-full bg-gray-800/90 border border-gray-700 text-white flex items-center justify-center disabled:opacity-30 shrink-0"
                aria-label="Previous"
              ><ChevronLeft size={22} /></button>
              <div className="flex-1 flex items-center justify-center gap-1.5">
                {current.photos.map((_, k) => (
                  <button key={k} type="button" onClick={() => setPhotoIdx(k)} className={`h-2 rounded-full transition-all ${k === photoIdx ? 'w-6 bg-yellow-400' : 'w-2 bg-gray-500'}`} aria-label={`Photo ${k + 1}`} />
                ))}
              </div>
              <button
                type="button"
                disabled={atEnd}
                onClick={() => go(1)}
                className={`h-11 rounded-full border text-sm font-bold flex items-center justify-center gap-1 disabled:opacity-30 shrink-0 ${
                  photoIdx >= current.photos.length - 1 && index < steps.length - 1
                    ? 'px-4 bg-yellow-500 border-yellow-500 text-black'
                    : 'w-11 bg-gray-800/90 border-gray-700 text-white'
                }`}
                aria-label="Next"
              >
                {photoIdx >= current.photos.length - 1 && index < steps.length - 1 ? <>Next step <ChevronRight size={18} /></> : <ChevronRight size={22} />}
              </button>
            </div>
          </div>
        </div>
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

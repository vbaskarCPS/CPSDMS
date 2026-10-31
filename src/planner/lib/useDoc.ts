// src/planner/lib/useDoc.ts — load one planner doc and save it back with a short delay after each change.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDoc, getDocs, putDoc, type Doc } from './docs';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Never save over a doc we couldn't read: a failed load leaves the screen read-only (loadError) and retries;
 *  a screen coming back from the background re-reads the doc if it has nothing unsaved, so two open
 *  screens don't overwrite each other with stale copies. */
export function useDoc<T>(kind: string, key: string, empty: T, delay = 800) {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const dirty = useRef(false);
  const loaded = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<T>(empty);
  const gen = useRef(0);

  const load = useCallback(async (g: number, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const d = await getDoc<T>(kind, key);
      if (g !== gen.current) return;
      if (dirty.current) return;                       // something typed meanwhile: keep it
      const v = d ?? empty; latest.current = v; setData(v); loaded.current = true; setLoadError(false);
    } catch {
      if (g !== gen.current) return;
      if (!loaded.current) { setLoadError(true); window.setTimeout(() => { if (g === gen.current && !loaded.current) void load(g, true); }, 4000); }
    } finally { if (g === gen.current) setLoading(false); }
  }, [kind, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = ++gen.current;
    dirty.current = false; loaded.current = false; setLoadError(false);
    void load(g);
    // back from the background with nothing unsaved: pick up what another screen or device wrote
    const onShow = () => { if (document.visibilityState === 'visible' && !dirty.current && loaded.current) void load(g, true); };
    document.addEventListener('visibilitychange', onShow);
    return () => { window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', onShow); };
  }, [kind, key, load]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSave('saving');
    try { await putDoc(kind, key, latest.current); setSave('saved'); window.setTimeout(() => setSave(s => (s === 'saved' ? 'idle' : s)), 1500); }
    catch { dirty.current = true; setSave('error'); }
  }, [kind, key]);

  const update = useCallback((patch: Partial<T> | ((d: T) => T)) => {
    if (!loaded.current) return;                       // the doc never arrived: don't build a blank one over it
    setData(d => {
      const next = typeof patch === 'function' ? (patch as (d: T) => T)(d) : { ...d, ...patch };
      latest.current = next; dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { void flush(); }, delay);
      return next;
    });
  }, [delay, flush]);

  // save on the way out of the page too
  useEffect(() => {
    const onHide = () => { if (dirty.current) void flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); onHide(); };
  }, [flush]);

  return { data, update, loading, loadError, save, flush };
}

/** All docs of one kind (e.g. every habit), with a reload. */
export function useDocs<T>(kind: string, from?: string, to?: string) {
  const [docs, setDocs] = useState<Doc<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { try { setDocs(await getDocs<T>(kind, from, to)); } finally { setLoading(false); } }, [kind, from, to]);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);
  return { docs, loading, reload, setDocs };
}

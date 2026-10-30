// src/planner/lib/useDoc.ts — load one planner doc and save it back with a short delay after each change.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDoc, getDocs, putDoc, type Doc } from './docs';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useDoc<T>(kind: string, key: string, empty: T, delay = 800) {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>('idle');
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<T>(empty);
  const gen = useRef(0);

  useEffect(() => {
    const g = ++gen.current;
    setLoading(true); dirty.current = false;
    getDoc<T>(kind, key).then(d => { if (g !== gen.current) return; const v = d ?? empty; latest.current = v; setData(v); setLoading(false); })
      .catch(() => { if (g === gen.current) setLoading(false); });
    return () => { window.clearTimeout(timer.current); };
  }, [kind, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSave('saving');
    try { await putDoc(kind, key, latest.current); setSave('saved'); window.setTimeout(() => setSave(s => (s === 'saved' ? 'idle' : s)), 1500); }
    catch { dirty.current = true; setSave('error'); }
  }, [kind, key]);

  const update = useCallback((patch: Partial<T> | ((d: T) => T)) => {
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

  return { data, update, loading, save, flush };
}

/** All docs of one kind (e.g. every habit), with a reload. */
export function useDocs<T>(kind: string, from?: string, to?: string) {
  const [docs, setDocs] = useState<Doc<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => { try { setDocs(await getDocs<T>(kind, from, to)); } finally { setLoading(false); } }, [kind, from, to]);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);
  return { docs, loading, reload, setDocs };
}

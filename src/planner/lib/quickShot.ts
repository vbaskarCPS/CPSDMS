// src/planner/lib/quickShot.ts — a photo taken from the bottom bar, on its way to the screen that uses it.
// Dragging Health up opens the camera for a meal, dragging Wealth up for a receipt (ui/Shell.tsx). The bar takes the
// photo and goes to the screen (Add a meal, Add a receipt); the screen picks the photo up here, exactly as if its own
// "Take a photo" button had been used. Kept in memory only: a photo nobody picked up is dropped with the page.
import { useEffect, useRef } from 'react';

export type ShotKind = 'meal' | 'receipt';
/** Where each kind of photo is used. */
export const SHOT_TO: Record<ShotKind, string> = { meal: '/food/add', receipt: '/money/receipt' };

const waiting: Partial<Record<ShotKind, File[]>> = {};
const watchers = new Set<(kind: ShotKind) => void>();

/** The camera came back with photos of this kind. */
export function giveShot(kind: ShotKind, files: File[]): void {
  if (!files.length) return;
  waiting[kind] = [...(waiting[kind] || []), ...files];
  for (const fn of [...watchers]) fn(kind);
}
/** Take the photos waiting for this kind (each is handed over once). null = none. */
export function takeShot(kind: ShotKind): File[] | null {
  const files = waiting[kind];
  delete waiting[kind];
  return files?.length ? files : null;
}
export function onShot(fn: (kind: ShotKind) => void): () => void { watchers.add(fn); return () => { watchers.delete(fn); }; }

/** A screen that uses these photos: `use` gets them when they arrive, and any that were already waiting when it opened. */
export function useQuickShot(kind: ShotKind, use: (files: File[]) => void): void {
  const fn = useRef(use); fn.current = use;
  useEffect(() => {
    const check = () => { const files = takeShot(kind); if (files) fn.current(files); };
    check();
    return onShot(k => { if (k === kind) check(); });
  }, [kind]);
}

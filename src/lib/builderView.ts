// src/lib/builderView.ts — where the map builder was last looking, so a new map opens there
// (not in Hamilton). Kept per browser; a bad or missing value just means "no last view".
export interface BuilderView { center: [number, number]; zoom: number }

const KEY = 'cps.mapbuilder.lastView';

/** A saved view, or null when it's missing or not a sensible place on the map. */
export function parseBuilderView(raw: string | null | undefined): BuilderView | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { center?: unknown; zoom?: unknown };
    const c = v.center as number[] | undefined;
    const zoom = Number(v.zoom);
    if (!Array.isArray(c) || c.length !== 2) return null;
    const [lng, lat] = c.map(Number);
    if (![lng, lat, zoom].every(Number.isFinite)) return null;
    if (lng < -180 || lng > 180 || lat < -85 || lat > 85 || zoom < 3 || zoom > 20) return null;
    return { center: [lng, lat], zoom };
  } catch { return null; }
}

export function readBuilderView(): BuilderView | null {
  try { return parseBuilderView(localStorage.getItem(KEY)); } catch { return null; }
}

export function saveBuilderView(v: BuilderView): void {
  try { localStorage.setItem(KEY, JSON.stringify({ center: [+v.center[0].toFixed(5), +v.center[1].toFixed(5)], zoom: +v.zoom.toFixed(2) })); } catch { /* storage off */ }
}
